import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = path.resolve(cliRoot, "../..");
const templatesDir = path.join(cliRoot, "templates");

const EXCLUDED_NAMES = new Set([
  "node_modules",
  "dist",
  "generated",
  ".turbo",
  ".env",
  "pothos-types.ts",
]);

function shouldCopy(source: string): boolean {
  const base = path.basename(source);
  if (EXCLUDED_NAMES.has(base)) return false;
  if (base.endsWith(".tsbuildinfo")) return false;
  return true;
}

async function copyPackage(name: string, from: string, to: string) {
  await mkdir(to, { recursive: true });
  await cp(from, to, { recursive: true, filter: (source) => shouldCopy(source) });
  console.log(`  copied ${name}`);
}

// Scaffolded projects don't publish anything, so changesets doesn't apply to them.
async function writeRootPackageJson(dest: string) {
  const original = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8")) as {
    devDependencies?: Record<string, string>;
  };
  delete original.devDependencies?.["@changesets/cli"];
  await writeFile(dest, `${JSON.stringify(original, null, 2)}\n`);
}

async function writeWorkspaceYaml(dest: string) {
  const original = await readFile(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  const doc = parseDocument(original);
  doc.delete("minimumReleaseAgeExclude");
  await writeFile(dest, doc.toString());
}

async function main() {
  await rm(templatesDir, { recursive: true, force: true });
  await mkdir(templatesDir, { recursive: true });

  console.log("Syncing scaffold templates from repo source of truth...");

  const rootDir = path.join(templatesDir, "root");
  await mkdir(rootDir, { recursive: true });
  const rootFiles = [
    "tsconfig.base.json",
    "eslint.config.js",
    ".prettierrc.json",
    ".prettierignore",
    "turbo.json",
    ".gitignore",
  ];
  for (const file of rootFiles) {
    await cp(path.join(repoRoot, file), path.join(rootDir, file));
  }
  await writeRootPackageJson(path.join(rootDir, "package.json"));
  await writeWorkspaceYaml(path.join(rootDir, "pnpm-workspace.yaml"));
  console.log("  copied root config");

  await copyPackage(
    "packages/schema",
    path.join(repoRoot, "packages/schema"),
    path.join(templatesDir, "packages/schema"),
  );
  await copyPackage(
    "packages/server",
    path.join(repoRoot, "packages/server"),
    path.join(templatesDir, "packages/server"),
  );
  await copyPackage(
    "packages/client",
    path.join(repoRoot, "packages/client"),
    path.join(templatesDir, "packages/client"),
  );
  await copyPackage(
    "apps/web",
    path.join(repoRoot, "apps/web"),
    path.join(templatesDir, "apps/web"),
  );

  console.log("Done.");
}

await main();
