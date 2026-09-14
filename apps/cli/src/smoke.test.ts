import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cliEntry = fileURLToPath(new URL("./index.js", import.meta.url));

function run(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("close", (code) => resolve({ code, output }));
    child.on("error", (err) => resolve({ code: 1, output: `${output}\n${err.stack}` }));
  });
}

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(`Server at ${url} did not come up within ${timeoutMs}ms`);
}

test(
  "scaffolded project installs, builds, and serves a working GraphQL endpoint",
  { timeout: 5 * 60_000 },
  async () => {
    const workDir = await mkdtemp(path.join(tmpdir(), "gqlkit-smoke-"));
    let server: ReturnType<typeof spawn> | undefined;
    try {
      const scaffoldResult = await run(
        process.execPath,
        [cliEntry, "smoke-app", "--pm", "pnpm", "--web", "--yes"],
        workDir,
      );
      assert.equal(scaffoldResult.code, 0, `scaffold failed:\n${scaffoldResult.output}`);

      const projectDir = path.join(workDir, "smoke-app");
      const buildResult = await run("pnpm", ["run", "build"], projectDir);
      assert.equal(buildResult.code, 0, `build failed:\n${buildResult.output}`);

      // Spawn the compiled entrypoint directly rather than `pnpm run start` —
      // killing a pnpm-wrapped process doesn't reliably kill the node child
      // it spawns underneath, leaking a server that holds the port forever.
      const serverDir = path.join(projectDir, "packages/server");
      server = spawn(process.execPath, ["dist/index.js"], { cwd: serverDir });
      server.on("error", (err) => {
        console.error("server process error:", err);
      });

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
      await rm(workDir, { recursive: true, force: true });
    }
  },
);

test(
  "--no-examples scaffolds a minimal schema that still builds and serves",
  { timeout: 5 * 60_000 },
  async () => {
    const workDir = await mkdtemp(path.join(tmpdir(), "gqlkit-smoke-noexamples-"));
    let server: ReturnType<typeof spawn> | undefined;
    try {
      const scaffoldResult = await run(
        process.execPath,
        [cliEntry, "smoke-noex", "--pm", "pnpm", "--no-web", "--no-examples", "--yes"],
        workDir,
      );
      assert.equal(scaffoldResult.code, 0, `scaffold failed:\n${scaffoldResult.output}`);

      const projectDir = path.join(workDir, "smoke-noex");
      const buildResult = await run("pnpm", ["run", "build"], projectDir);
      assert.equal(buildResult.code, 0, `build failed:\n${buildResult.output}`);

      const testResult = await run("pnpm", ["run", "test"], projectDir);
      assert.equal(testResult.code, 0, `test failed:\n${testResult.output}`);

      const serverDir = path.join(projectDir, "packages/server");
      server = spawn(process.execPath, ["dist/index.js"], { cwd: serverDir });
      server.on("error", (err) => {
        console.error("server process error:", err);
      });

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
      await rm(workDir, { recursive: true, force: true });
    }
  },
);
