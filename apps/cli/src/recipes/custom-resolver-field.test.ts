import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { applyPatch, run, runOk, runTurbo, scaffoldProject } from "../test-support.js";

// Verifies docs/recipes/add-a-custom-resolver-field.md: adding `Post.excerpt`
// as a `t.field` computed resolver, and the "snapshot goes stale, then gets
// updated" workflow the recipe describes.
test(
  "add-a-custom-resolver-field recipe applies and the schema snapshot workflow behaves as documented",
  { timeout: 5 * 60_000 },
  async () => {
    const { projectDir, scope, cleanup } = await scaffoldProject("recipe-resolver-field", [
      "--no-web",
    ]);
    try {
      const postTypePath = `${projectDir}/packages/schema/src/types/post.ts`;
      await applyPatch(
        postTypePath,
        [
          [
            `    published: t.exposeBoolean("published"),\n`,
            `    published: t.exposeBoolean("published"),\n` +
              `    excerpt: t.field({\n` +
              `      type: "String",\n` +
              `      resolve: (post) => (post.content.length > 140 ? \`\${post.content.slice(0, 140)}…\` : post.content),\n` +
              `    }),\n`,
          ],
        ],
        "expected diff anchor text to match post.ts",
      );

      await runTurbo("build", `${scope}/schema`, projectDir);

      // The recipe's "Then" section: the SDL snapshot test fails until updated.
      const staleTest = await run("pnpm", ["--filter", `${scope}/schema`, "test"], projectDir);
      assert.notEqual(staleTest.code, 0, "snapshot test should fail while stale");

      const sdl = await readFile(`${projectDir}/packages/schema/dist/schema.graphql`, "utf8");
      assert.match(sdl, /excerpt: String!/, "built SDL should expose the new excerpt field");

      await runOk(
        "cp",
        [
          `${projectDir}/packages/schema/dist/schema.graphql`,
          `${projectDir}/packages/schema/schema.snapshot.graphql`,
        ],
        projectDir,
      );
      await runOk("pnpm", ["--filter", `${scope}/schema`, "test"], projectDir);
    } finally {
      await cleanup();
    }
  },
);
