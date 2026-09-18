import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPatch, runOk, scaffoldProject, startServer, waitForServer } from "../test-support.js";

interface FederationServiceResponse {
  data: { _service: { sdl: string } };
}

// Verifies docs/recipes/add-federation.md's in-repo portion: the schema
// builds as a valid federation subgraph (`User` becomes an entity, `Post`
// and `Comment` are untouched) and serves a real `_service { sdl }` query.
//
// NOT covered here: the recipe's "full split, actually composed and
// queried" section, which stands up a second, entirely independent service
// plus an Apollo Gateway to prove cross-service composition. That's
// infrastructure outside this repo, not something a check here can spin up
// — it stays a manual/one-off verification.
test(
  "add-federation recipe produces a valid subgraph schema",
  { timeout: 5 * 60_000 },
  async () => {
    const { projectDir, scope, cleanup } = await scaffoldProject("recipe-federation", ["--no-web"]);
    let server: ReturnType<typeof startServer> | undefined;
    try {
      await runOk(
        "pnpm",
        [
          "--filter",
          `${scope}/schema`,
          "add",
          "@pothos/plugin-federation",
          "@pothos/plugin-directives",
          "@apollo/subgraph@2.14.4",
        ],
        projectDir,
      );

      await applyPatch(
        `${projectDir}/packages/schema/src/builder.ts`,
        [
          [
            `import DataloaderPlugin from "@pothos/plugin-dataloader";`,
            `import DataloaderPlugin from "@pothos/plugin-dataloader";\nimport DirectivePlugin from "@pothos/plugin-directives";\nimport FederationPlugin from "@pothos/plugin-federation";`,
          ],
          [
            `  plugins: [ScopeAuthPlugin, PrismaPlugin, ZodPlugin, DataloaderPlugin],`,
            `  plugins: [ScopeAuthPlugin, PrismaPlugin, ZodPlugin, DataloaderPlugin, DirectivePlugin, FederationPlugin],`,
          ],
        ],
        "expected diff anchors to match builder.ts",
      );

      await applyPatch(
        `${projectDir}/packages/schema/src/types/user.ts`,
        [
          [
            `builder.prismaObject("User", {`,
            `export const UserRef = builder.prismaObject("User", {`,
          ],
          [
            `  }),\n});\n`,
            `  }),\n});\n\nbuilder.asEntity(UserRef, {\n  key: builder.selection<{ id: string }>("id"),\n  resolveReference: (reference, ctx) =>\n    ctx.prisma.user.findUniqueOrThrow({ where: { id: reference.id } }),\n});\n`,
          ],
        ],
        "expected diff anchors to match user.ts",
      );

      await applyPatch(
        `${projectDir}/packages/schema/src/schema.ts`,
        [
          [
            `export const schema = builder.toSchema();`,
            `export const schema = builder.toSubGraphSchema({});`,
          ],
        ],
        "expected diff anchor to match schema.ts",
      );

      // The recipe notes `pnpm dev` (tsx watch) breaks here and only the
      // built, tsc-compiled output works — verify against `pnpm build`, per
      // the recipe's own guidance, not a dev server.
      await runOk("pnpm", ["run", "build"], projectDir);

      server = startServer(`${projectDir}/packages/server`);
      await waitForServer("http://localhost:4000/graphql", 15_000);

      const response = await fetch("http://localhost:4000/graphql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "{ _service { sdl } }" }),
      });
      assert.equal(response.status, 200);
      const body = (await response.json()) as FederationServiceResponse;
      const sdl = body.data._service.sdl;
      assert.match(sdl, /type User\s*@key\(fields: "id"\)/);
      assert.doesNotMatch(sdl, /type Post[^{]*@key/, "Post should stay a plain, non-entity type");
    } finally {
      server?.kill();
      await cleanup();
    }
  },
);
