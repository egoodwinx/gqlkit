import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import {
  applyPatch,
  run,
  runOk,
  runTurbo,
  scaffoldProject,
  startServer,
  waitForServer,
} from "../test-support.js";

// Verifies docs/recipes/eject-client-codegen.md: swapping Genql for
// graphql-code-generator + graphql-request end to end, run against a real
// (unseeded) server the same way the recipe's own "Verify" section does —
// success there is "reaches searchPosts, fails only on the unset database,"
// not a clean result. While wiring this up, found the recipe's apps/web
// diff never updates the `createClient` import to also bring in
// `SearchPostsDocument`, which the rewritten call site needs to compile —
// fixed in the doc alongside adding this check.
test(
  "eject-client-codegen recipe applies and reaches the server",
  { timeout: 5 * 60_000 },
  async () => {
    const { projectDir, scope, cleanup } = await scaffoldProject("recipe-eject-codegen");
    let server: ReturnType<typeof startServer> | undefined;
    try {
      const clientDir = `${projectDir}/packages/client`;

      await runOk(
        "pnpm",
        [
          "--filter",
          `${scope}/client`,
          "add",
          "graphql-request",
          "@graphql-typed-document-node/core",
        ],
        projectDir,
      );
      await runOk(
        "pnpm",
        [
          "--filter",
          `${scope}/client`,
          "add",
          "-D",
          "@graphql-codegen/cli",
          "@graphql-codegen/typescript",
          "@graphql-codegen/typescript-operations",
          "@graphql-codegen/typed-document-node",
        ],
        projectDir,
      );
      await runOk(
        "pnpm",
        ["--filter", `${scope}/client`, "remove", "@genql/cli", "tsup"],
        projectDir,
      );

      await writeFile(
        `${clientDir}/codegen.yml`,
        `schema: ../schema/dist/schema.graphql
documents: "src/operations/**/*.graphql"
generates:
  src/generated/graphql.ts:
    plugins:
      - typescript
      - typescript-operations
      - typed-document-node
    config:
      useTypeImports: true
`,
      );

      await mkdir(`${clientDir}/src/operations`, { recursive: true });
      await writeFile(
        `${clientDir}/src/operations/search-posts.graphql`,
        `query SearchPosts($query: String!) {
  searchPosts(query: $query) {
    id
    title
    author {
      name
    }
  }
}
`,
      );

      await writeFile(
        `${clientDir}/src/client.ts`,
        `import { GraphQLClient } from "graphql-request";

export function createClient(url: string) {
  return new GraphQLClient(url);
}
`,
      );

      const clientIndexPath = `${clientDir}/src/index.ts`;
      const clientIndexSrc = await readFile(clientIndexPath, "utf8");
      assert.equal(clientIndexSrc, `export * from "./generated/index.js";\n`);
      await writeFile(
        clientIndexPath,
        `export { createClient } from "./client.js";\nexport * from "./generated/graphql.js";\n`,
      );

      const clientPkgPath = `${clientDir}/package.json`;
      const clientPkg = JSON.parse(await readFile(clientPkgPath, "utf8"));
      clientPkg.scripts.codegen = "graphql-codegen --config codegen.yml";
      clientPkg.scripts.build = "tsc --build";
      clientPkg.scripts.dev = "tsc --build --watch";
      await writeFile(clientPkgPath, `${JSON.stringify(clientPkg, null, 2)}\n`);

      await applyPatch(
        `${projectDir}/apps/web/src/index.ts`,
        [
          [
            `import { createClient } from "${scope}/client";`,
            `import { createClient, SearchPostsDocument } from "${scope}/client";`,
          ],
          [
            `const client = createClient({\n  url: process.env["GRAPHQL_URL"] ?? "http://localhost:4000/graphql",\n});`,
            `const client = createClient(process.env["GRAPHQL_URL"] ?? "http://localhost:4000/graphql");`,
          ],
          [
            `const result = await client.query({
  searchPosts: {
    __args: { query: "hello" },
    id: true,
    title: true,
    author: {
      name: true,
    },
  },
});`,
            `const result = await client.request(SearchPostsDocument, { query: "hello" });`,
          ],
        ],
        "expected diff anchors to match apps/web index.ts",
      );

      await runTurbo("build", `${scope}/schema`, projectDir);
      await runTurbo("codegen", `${scope}/client`, projectDir);
      await runTurbo("build", `${scope}/client`, projectDir);
      await runTurbo("build", `${scope}/web`, projectDir);
      // Not part of the recipe (packages/server is untouched by it) — the
      // recipe's own "Verify" section runs against an already-running
      // Phase 2 server, which this check has to build itself first.
      await runTurbo("build", `${scope}/server`, projectDir);

      server = startServer(`${projectDir}/packages/server`);
      await waitForServer("http://localhost:4000/graphql", 15_000);

      const webRun = await run(process.execPath, ["dist/index.js"], `${projectDir}/apps/web`);
      // Same success criterion the recipe itself uses: it reaches the real
      // resolver and fails only on the database being unset here, not on
      // never reaching the server or on a client-side wiring bug.
      assert.notEqual(webRun.code, 0);
      assert.match(webRun.output, /Unexpected error/);
      assert.doesNotMatch(webRun.output, /ECONNREFUSED|fetch failed/);
    } finally {
      server?.kill();
      await cleanup();
    }
  },
);
