import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { runTurbo, scaffoldProject } from "../test-support.js";

// Verifies docs/recipes/outgrow-generated-crud-for-one-type.md: adding the
// boilerplate `posts`/`users` list fields, then outgrowing `posts` with a
// `where` filter, confirming the SDL doesn't move (resolver-body-only change).
test(
  "outgrow-generated-crud-for-one-type recipe: SDL is unchanged by Step 2",
  { timeout: 5 * 60_000 },
  async () => {
    const { projectDir, scope, cleanup } = await scaffoldProject("recipe-outgrow-crud", [
      "--no-web",
    ]);
    try {
      const queriesPath = `${projectDir}/packages/schema/src/resolvers/queries.ts`;
      const original = await readFile(queriesPath, "utf8");

      const step1 =
        original +
        `\n` +
        `builder.queryField("posts", (t) =>\n` +
        `  t.prismaField({\n` +
        `    type: ["Post"],\n` +
        `    resolve: (query, _root, _args, ctx) => ctx.prisma.post.findMany({ ...query }),\n` +
        `  }),\n` +
        `);\n` +
        `\n` +
        `builder.queryField("users", (t) =>\n` +
        `  t.prismaField({\n` +
        `    type: ["User"],\n` +
        `    resolve: (query, _root, _args, ctx) => ctx.prisma.user.findMany({ ...query }),\n` +
        `  }),\n` +
        `);\n`;
      await writeFile(queriesPath, step1);
      await runTurbo("build", `${scope}/schema`, projectDir);
      const sdlAfterStep1 = await readFile(
        `${projectDir}/packages/schema/dist/schema.graphql`,
        "utf8",
      );
      assert.match(sdlAfterStep1, /posts: \[Post!\]!/);
      assert.match(sdlAfterStep1, /users: \[User!\]!/);

      const step2 = step1.replace(
        `    resolve: (query, _root, _args, ctx) => ctx.prisma.post.findMany({ ...query }),\n  }),\n);\n\nbuilder.queryField("users"`,
        `    resolve: (query, _root, _args, ctx) =>\n` +
          `      ctx.prisma.post.findMany({ ...query, where: { published: true } }),\n` +
          `  }),\n);\n\nbuilder.queryField("users"`,
      );
      assert.notEqual(step2, step1, "expected diff anchor text to match queries.ts after step 1");
      await writeFile(queriesPath, step2);
      await runTurbo("build", `${scope}/schema`, projectDir);
      const sdlAfterStep2 = await readFile(
        `${projectDir}/packages/schema/dist/schema.graphql`,
        "utf8",
      );

      assert.equal(
        sdlAfterStep2,
        sdlAfterStep1,
        "SDL should be byte-identical: only the resolver body changed",
      );
    } finally {
      await cleanup();
    }
  },
);
