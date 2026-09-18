import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import {
  applyPatch,
  type GraphQLResponseBody,
  runOk,
  scaffoldProject,
  startServer,
  waitForServer,
} from "../test-support.js";

// Verifies docs/recipes/add-authentication.md: wiring `currentUserId` from a
// request header and gating `createPost` behind a `loggedIn` scope — checked
// exactly the way the recipe's own "Verify" section does (no auth is
// rejected before the resolver runs; "authenticated" passes the scope check
// and fails only on the unset database in this environment).
test(
  "add-authentication recipe gates createPost behind the loggedIn scope",
  { timeout: 5 * 60_000 },
  async () => {
    const { projectDir, scope, cleanup } = await scaffoldProject("recipe-add-auth", ["--no-web"]);
    let server: ReturnType<typeof startServer> | undefined;
    try {
      await applyPatch(
        `${projectDir}/packages/schema/src/builder.ts`,
        [
          [
            `export interface AuthScopes {\n  public: boolean;\n}`,
            `export interface AuthScopes {\n  public: boolean;\n  loggedIn: boolean;\n}`,
          ],
          [
            `  scopeAuth: {\n` +
              `    // No-op default: nothing is gated behind a scope yet (see docs/recipes "Add authentication")\n` +
              `    authScopes: () => ({\n` +
              `      public: true,\n` +
              `    }),\n` +
              `  },`,
            `  scopeAuth: {\n` +
              `    authScopes: (ctx) => ({\n` +
              `      public: true,\n` +
              `      loggedIn: ctx.currentUserId !== null,\n` +
              `    }),\n` +
              `  },`,
          ],
        ],
        "expected diff anchors to match builder.ts",
      );

      await applyPatch(
        `${projectDir}/packages/schema/src/resolvers/mutations.ts`,
        [
          [
            `  t.prismaField({\n    type: "Post",\n    args: {`,
            `  t.prismaField({\n    type: "Post",\n    authScopes: {\n      loggedIn: true,\n    },\n    args: {`,
          ],
        ],
        "expected diff anchor to match mutations.ts",
      );

      const serverContextPath = `${projectDir}/packages/server/src/context.ts`;
      const serverContextSrc = await readFile(serverContextPath, "utf8");
      const expectedOriginal = `import type { Context } from "${scope}/schema";
import { prisma } from "${scope}/schema";

// Pothos's dataloader plugin (and t.loadable fields) key their per-request
// caches off this context object's identity, via a WeakMap. Returning a new
// object on every call is what gives each request its own DataLoader
// instances — reuse a shared object here and requests start seeing each
// other's cached results.
export function createContext(): Context {
  return {
    currentUserId: null,
    prisma,
  };
}
`;
      assert.equal(
        serverContextSrc,
        expectedOriginal,
        "server context.ts drifted from what this recipe expects",
      );
      const newServerContextSrc = `import type { Context } from "${scope}/schema";
import { prisma } from "${scope}/schema";
import type { YogaInitialContext } from "graphql-yoga";

// Pothos's dataloader plugin (and t.loadable fields) key their per-request
// caches off this context object's identity, via a WeakMap. Returning a new
// object on every call is what gives each request its own DataLoader
// instances — reuse a shared object here and requests start seeing each
// other's cached results.
export function createContext({ request }: YogaInitialContext): Context {
  const currentUserId = request.headers.get("x-user-id");

  return {
    currentUserId,
    prisma,
  };
}
`;
      await writeFile(serverContextPath, newServerContextSrc);

      // Phase 2's context.test.ts calls createContext() with no arguments,
      // which stops compiling now that createContext requires a
      // YogaInitialContext — this isn't mentioned in the recipe doc itself
      // (fixed there alongside adding this check).
      const contextTestPath = `${projectDir}/packages/server/src/context.test.ts`;
      await writeFile(
        contextTestPath,
        `import assert from "node:assert/strict";
import { test } from "node:test";
import type { YogaInitialContext } from "graphql-yoga";
import { createContext } from "./context.js";

function fakeInitialContext(headers: Record<string, string> = {}): YogaInitialContext {
  return { request: new Request("http://localhost", { headers }) } as YogaInitialContext;
}

test("createContext returns a fresh object identity on every call", () => {
  assert.notEqual(createContext(fakeInitialContext()), createContext(fakeInitialContext()));
});

test("createContext defaults currentUserId to null when no x-user-id header is present", () => {
  assert.equal(createContext(fakeInitialContext()).currentUserId, null);
});
`,
      );

      await runOk("pnpm", ["run", "build"], projectDir);

      server = startServer(`${projectDir}/packages/server`);
      await waitForServer("http://localhost:4000/graphql", 15_000);

      const createPostQuery =
        'mutation { createPost(input: {title:"x",content:"y",authorId:"z"}) { id } }';

      const unauthed = await fetch("http://localhost:4000/graphql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: createPostQuery }),
      });
      const unauthedBody = (await unauthed.json()) as GraphQLResponseBody;
      assert.equal(unauthedBody.data, null);
      assert.match(
        unauthedBody.errors?.[0]?.message ?? "",
        /Not authorized to resolve Mutation\.createPost/,
      );

      const authed = await fetch("http://localhost:4000/graphql", {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "u1" },
        body: JSON.stringify({ query: createPostQuery }),
      });
      const authedBody = (await authed.json()) as GraphQLResponseBody;
      // Scope check passed and the resolver actually ran — it now fails only
      // on the database being unreachable in this environment, not on auth.
      assert.doesNotMatch(authedBody.errors?.[0]?.message ?? "", /Not authorized/);
    } finally {
      server?.kill();
      await cleanup();
    }
  },
);
