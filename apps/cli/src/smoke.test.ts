import assert from "node:assert/strict";
import { test } from "node:test";
import { runOk, scaffoldProject, startServer, waitForServer } from "./test-support.js";

test(
  "scaffolded project installs, builds, and serves a working GraphQL endpoint",
  { timeout: 5 * 60_000 },
  async () => {
    const { projectDir, cleanup } = await scaffoldProject("smoke-app", ["--web"]);
    let server: ReturnType<typeof startServer> | undefined;
    try {
      await runOk("pnpm", ["run", "build"], projectDir);

      server = startServer(`${projectDir}/packages/server`);
      await waitForServer("http://localhost:4000/graphql", 15_000);
      const response = await fetch("http://localhost:4000/graphql", {
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

test(
  "--no-examples scaffolds a minimal schema that still builds and serves",
  { timeout: 5 * 60_000 },
  async () => {
    const { projectDir, cleanup } = await scaffoldProject("smoke-noex", [
      "--no-web",
      "--no-examples",
    ]);
    let server: ReturnType<typeof startServer> | undefined;
    try {
      await runOk("pnpm", ["run", "build"], projectDir);
      await runOk("pnpm", ["run", "test"], projectDir);

      server = startServer(`${projectDir}/packages/server`);
      await waitForServer("http://localhost:4000/graphql", 15_000);
      const response = await fetch("http://localhost:4000/graphql", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "{ _placeholder }" }),
      });
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body, { data: { _placeholder: true } });
    } finally {
      server?.kill();
      await cleanup();
    }
  },
);
