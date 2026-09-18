import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import {
  applyPatch,
  runOk,
  scaffoldProject,
  startServer,
  waitForServer,
} from "../test-support.js";

// Verifies docs/recipes/add-real-time-subscriptions.md end to end: the
// pubsub wiring, the object-ref gotcha, and that a publish actually reaches
// an open SSE subscriber. `createPost` itself needs a live database to
// reach its `ctx.pubsub.publish` call, which this test environment doesn't
// have — same limitation the recipe's own "Verify" section calls out. It
// works around it exactly the way the recipe says it was originally
// verified: "a temporary debug mutation that called ctx.pubsub.publish
// directly." That debug field is added here, not by the recipe — the recipe
// diff itself is applied unmodified otherwise.
test(
  "add-real-time-subscriptions recipe delivers a publish to an open SSE subscriber",
  { timeout: 5 * 60_000 },
  async () => {
    const { projectDir, scope, cleanup } = await scaffoldProject("recipe-subscriptions", [
      "--no-web",
    ]);
    let server: ReturnType<typeof startServer> | undefined;
    let subscription: AbortController | undefined;
    try {
      await runOk(
        "pnpm",
        ["--filter", `${scope}/schema`, "add", "@graphql-yoga/subscription"],
        projectDir,
      );

      const schemaSrcDir = `${projectDir}/packages/schema/src`;

      await mkdir(`${schemaSrcDir}`, { recursive: true });
      await writeFile(
        `${schemaSrcDir}/pubsub.ts`,
        `import { createPubSub } from "@graphql-yoga/subscription";
import type { Post } from "../generated/prisma/client.js";

export type PubSubEvents = {
  postCreated: [Post];
};

export const pubsub = createPubSub<PubSubEvents>();
export type PubSub = typeof pubsub;
`,
      );

      await applyPatch(
        `${schemaSrcDir}/context.ts`,
        [
          [
            `import type { PrismaClient } from "../generated/prisma/client.js";`,
            `import type { PrismaClient } from "../generated/prisma/client.js";\nimport type { PubSub } from "./pubsub.js";`,
          ],
          [
            `  currentUserId: string | null;\n  prisma: PrismaClient;\n}`,
            `  currentUserId: string | null;\n  prisma: PrismaClient;\n  pubsub: PubSub;\n}`,
          ],
        ],
        "expected diff anchors to match schema context.ts",
      );

      await applyPatch(
        `${schemaSrcDir}/index.ts`,
        [
          [
            `export { prisma } from "./db.js";\n`,
            `export { prisma } from "./db.js";\nexport { pubsub } from "./pubsub.js";\n`,
          ],
        ],
        "expected diff anchor to match schema index.ts",
      );

      await applyPatch(
        `${schemaSrcDir}/types/post.ts`,
        [
          [
            `builder.prismaObject("Post", {`,
            `export const PostRef = builder.prismaObject("Post", {`,
          ],
        ],
        "expected diff anchor to match post.ts",
      );

      await writeFile(
        `${schemaSrcDir}/resolvers/subscriptions.ts`,
        `import { builder } from "../builder.js";
import { PostRef } from "../types/post.js";

builder.subscriptionType({});

builder.subscriptionField("postCreated", (t) =>
  t.field({
    type: PostRef,
    subscribe: (_root, _args, ctx) => ctx.pubsub.subscribe("postCreated"),
    resolve: (post) => post,
  }),
);
`,
      );

      await applyPatch(
        `${schemaSrcDir}/schema.ts`,
        [
          [
            `import "./resolvers/mutations.js";\n`,
            `import "./resolvers/mutations.js";\nimport "./resolvers/subscriptions.js";\n`,
          ],
        ],
        "expected diff anchor to match schema.ts",
      );

      await applyPatch(
        `${schemaSrcDir}/resolvers/mutations.ts`,
        [
          [
            `    resolve: (query, _root, args, ctx) =>
      ctx.prisma.post.create({
        ...query,
        data: {
          title: args.input.title,
          content: args.input.content,
          author: { connect: { id: args.input.authorId } },
        },
      }),`,
            `    resolve: async (query, _root, args, ctx) => {
      const post = await ctx.prisma.post.create({
        ...query,
        data: {
          title: args.input.title,
          content: args.input.content,
          author: { connect: { id: args.input.authorId } },
        },
      });
      ctx.pubsub.publish("postCreated", post);
      return post;
    },`,
          ],
          [
            // Appends after the (now unique-again) close of the createPost
            // mutation field — a plain anchor works here since this recipe's
            // schema only has the one mutation field to append after.
            `  }),\n);\n`,
            `  }),\n);\n
// Test-only: exercises the publish -> SSE path without a database, the same
// way this recipe's own manual verification did.
builder.mutationField("debugPublishPost", (t) =>
  t.field({
    type: "Boolean",
    resolve: (_root, _args, ctx) => {
      ctx.pubsub.publish("postCreated", {
        id: "debug-1",
        title: "debug title",
        content: "debug content",
        published: true,
        authorId: "debug-author",
        createdAt: new Date(),
      });
      return true;
    },
  }),
);
`,
          ],
        ],
        "expected diff anchor to match mutations.ts",
      );

      await applyPatch(
        `${projectDir}/packages/server/src/context.ts`,
        [
          [
            `import { prisma } from "${scope}/schema";`,
            `import { prisma, pubsub } from "${scope}/schema";`,
          ],
          [
            `    currentUserId: null,\n    prisma,\n  };`,
            `    currentUserId: null,\n    prisma,\n    pubsub,\n  };`,
          ],
        ],
        "expected diff anchors to match server context.ts",
      );

      await runOk("pnpm", ["run", "build"], projectDir);

      const sdl = await readFile(`${projectDir}/packages/schema/dist/schema.graphql`, "utf8");
      assert.match(sdl, /type Subscription \{\s*postCreated: Post!\s*\}/);

      server = startServer(`${projectDir}/packages/server`);
      await waitForServer("http://localhost:4000/graphql", 15_000);

      subscription = new AbortController();
      // Yoga's SSE result processor only sends response headers once it has
      // the subscription's AsyncIterable in hand, which it gets by calling
      // the `subscribe` resolver (i.e. `ctx.pubsub.subscribe`) up front — so
      // by the time this `fetch` resolves, the subscription is already
      // registered and it's safe to publish without a race.
      const response = await fetch("http://localhost:4000/graphql", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ query: "subscription { postCreated { id title } }" }),
        signal: subscription.signal,
      });
      const reader = response.body?.getReader();
      assert.ok(reader, "expected a streamable response body");
      const ssePromise = (async () => {
        const decoder = new TextDecoder();
        let received = "";
        while (!received.includes("postCreated")) {
          const { value, done } = await reader.read();
          if (done) break;
          received += decoder.decode(value);
        }
        return received;
      })();

      const publishResponse = await fetch("http://localhost:4000/graphql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "mutation { debugPublishPost }" }),
      });
      assert.equal(publishResponse.status, 200);
      assert.deepEqual(await publishResponse.json(), { data: { debugPublishPost: true } });

      const sseOutput = await ssePromise;
      assert.match(sseOutput, /"postCreated":\{"id":"debug-1","title":"debug title"\}/);
    } finally {
      subscription?.abort();
      server?.kill();
      await cleanup();
    }
  },
);
