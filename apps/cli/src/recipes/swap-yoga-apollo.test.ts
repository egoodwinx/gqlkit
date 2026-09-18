import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { runOk, scaffoldProject, startServer, waitForServer } from "../test-support.js";

// Verifies docs/recipes/swap-yoga-for-apollo-server.md: swapping graphql-yoga
// for @apollo/server in packages/server, end to end (serves a real query).
test(
  "swap-yoga-for-apollo-server recipe applies and serves a query",
  { timeout: 5 * 60_000 },
  async () => {
    const { projectDir, scope, cleanup } = await scaffoldProject("recipe-swap-apollo", [
      "--no-web",
    ]);
    let server: ReturnType<typeof startServer> | undefined;
    try {
      const serverDir = `${projectDir}/packages/server`;
      // pnpm 11's default build-script allowlist blocks @apollo/protobufjs's
      // postinstall (a transitive dep of @apollo/server) unless approved —
      // not mentioned in the recipe doc, so approving it explicitly here.
      await runOk(
        "pnpm",
        [
          "--filter",
          `${scope}/server`,
          "add",
          "--allow-build=@apollo/protobufjs",
          "@apollo/server",
        ],
        projectDir,
      );
      await runOk("pnpm", ["--filter", `${scope}/server`, "remove", "graphql-yoga"], projectDir);

      const indexPath = `${serverDir}/src/index.ts`;
      const original = await readFile(indexPath, "utf8");
      const expectedOriginal = `import "dotenv/config";
import { createServer } from "node:http";
import { schema } from "${scope}/schema";
import { createYoga } from "graphql-yoga";
import { createContext } from "./context.js";

const yoga = createYoga({ schema, context: createContext });
const port = Number(process.env["PORT"] ?? 4000);

createServer(yoga).listen(port, () => {
  console.log(\`GraphQL server ready at http://localhost:\${port}\${yoga.graphqlEndpoint}\`);
});
`;
      assert.equal(
        original,
        expectedOriginal,
        "server template drifted from what this recipe expects",
      );

      const rewritten = `import "dotenv/config";
import { ApolloServer } from "@apollo/server";
import { startStandaloneServer } from "@apollo/server/standalone";
import { schema } from "${scope}/schema";
import { createContext } from "./context.js";

const server = new ApolloServer({ schema });
const port = Number(process.env["PORT"] ?? 4000);

const { url } = await startStandaloneServer(server, {
  listen: { port },
  context: async () => createContext(),
});

console.log(\`GraphQL server ready at \${url}\`);
`;
      await writeFile(indexPath, rewritten);

      await runOk("pnpm", ["run", "build"], projectDir);

      server = startServer(serverDir);
      await waitForServer("http://localhost:4000/", 15_000);
      const response = await fetch("http://localhost:4000/", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "{ __typename }" }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body, { data: { __typename: "Query" } });
    } finally {
      server?.kill();
      await cleanup();
    }
  },
);
