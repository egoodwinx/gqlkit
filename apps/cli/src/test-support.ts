import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { slugify } from "./package-manager.js";

export const cliEntry = fileURLToPath(new URL("./index.js", import.meta.url));

// node:test sets NODE_TEST_CONTEXT/NODE_TEST_WORKER_ID on itself so it can
// coordinate with worker processes it spawns for test isolation. Spawning a
// child here inherits that env by default — and if the child in turn runs
// its own `node --test` (as every `pnpm ... test` step in these recipes
// does), that nested run sees NODE_TEST_CONTEXT already set, assumes it's
// one of those coordinated workers rather than a standalone run, and
// reports back over a channel nothing is listening on instead of exiting
// with a real failing status. Stripped here so nested test runs behave like
// a normal, standalone `node --test` invocation.
const CHILD_ENV = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !key.startsWith("NODE_TEST_")),
);

export function run(
  command: string,
  args: string[],
  cwd: string,
): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: CHILD_ENV });
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

// Throws (rather than returning a code) so callers can just `await` a step
// and let node:test report the failure, instead of repeating an assert on
// every single shell step of a multi-step recipe.
export async function runOk(command: string, args: string[], cwd: string): Promise<string> {
  const { code, output } = await run(command, args, cwd);
  if (code !== 0) {
    throw new Error(`\`${command} ${args.join(" ")}\` (in ${cwd}) failed:\n${output}`);
  }
  return output;
}

// A scaffolded project's per-package npm scripts (e.g. `schema`'s "build":
// "tsc --build && node dist/print-schema.js") don't run Prisma's "generate"
// step themselves — that dependency is only expressed in turbo.json's task
// graph. `pnpm --filter <pkg> <script>` calls the npm script directly and
// skips that graph entirely, which leaves pothos-types.ts/the generated
// Prisma client missing on a fresh scaffold. Going through `turbo run
// <task> --filter=<pkg>` instead resolves the same dependency graph
// `pnpm run build` at the repo root does, just scoped to one package.
export async function runTurbo(task: string, pkgFilter: string, cwd: string): Promise<string> {
  return runOk("pnpm", ["exec", "turbo", "run", task, `--filter=${pkgFilter}`], cwd);
}

export async function waitForServer(url: string, timeoutMs: number): Promise<void> {
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

// Loose shape for asserting on `response.json()` from a GraphQL endpoint
// without fighting `unknown` in every recipe test.
export interface GraphQLResponseBody {
  data: unknown;
  errors?: { message: string }[];
}

export interface ScaffoldedProject {
  workDir: string;
  projectDir: string;
  // The scaffolder renames the `@gqlkit/*` scope to `@<project-slug>/*` (see
  // scaffold.ts's placeholder replacement) — this is that scope, e.g.
  // "@recipe-add-auth", so callers can build `${scope}/schema` filters
  // instead of hardcoding "@gqlkit/schema", which only matches inside this
  // monorepo itself.
  scope: string;
  cleanup: () => Promise<void>;
}

// Scaffolds a real project via the built CLI, the same way a user would
// (`npx create-gqlkit-app ...`), into a throwaway temp dir. Recipes are
// verified against this rather than against `templates/` directly so a
// recipe check exercises the exact files a user would actually be editing.
export async function scaffoldProject(
  slug: string,
  extraArgs: string[] = [],
): Promise<ScaffoldedProject> {
  const workDir = await mkdtemp(path.join(tmpdir(), `gqlkit-recipe-${slug}-`));
  await runOk(process.execPath, [cliEntry, slug, "--pm", "pnpm", "--yes", ...extraArgs], workDir);
  const projectDir = path.join(workDir, slug);
  return {
    workDir,
    projectDir,
    scope: `@${slugify(slug)}`,
    cleanup: () => rm(workDir, { recursive: true, force: true }),
  };
}

// Applies one or more anchor-string replacements to a file on disk, failing
// loudly (rather than silently writing back the unpatched original) if an
// anchor no longer matches — e.g. because the scaffold template it targets
// has since drifted. Recipe tests use this to apply a doc's diff to a real
// scaffolded project and assert the diff actually landed.
export async function applyPatch(
  filePath: string,
  replacements: [search: string, replace: string][],
  errorMessage: string,
): Promise<void> {
  const original = await readFile(filePath, "utf8");
  const patched = replacements.reduce(
    (src, [search, replace]) => src.replace(search, replace),
    original,
  );
  assert.notEqual(patched, original, errorMessage);
  await writeFile(filePath, patched);
}

// Spawns the compiled entrypoint directly rather than `pnpm run start` —
// killing a pnpm-wrapped process doesn't reliably kill the node child it
// spawns underneath, leaking a server that holds the port forever.
export function startServer(serverDir: string) {
  const server = spawn(process.execPath, ["dist/index.js"], { cwd: serverDir });
  server.on("error", (err) => {
    console.error("server process error:", err);
  });
  return server;
}
