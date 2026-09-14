import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const templatesDir = path.join(cliRoot, "templates");
const fragmentsDir = path.join(cliRoot, "fragments");

export interface ScaffoldOptions {
  targetDir: string;
  projectSlug: string;
  includeWeb: boolean;
  includeExamples: boolean;
}

// Extensions (and dotfiles) worth scanning for the @gqlkit/* placeholder.
// Everything else (lockfiles, wasm, etc. — none of which templates actually
// contain, but future-proofing) is left untouched rather than read as text.
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".json",
  ".yaml",
  ".yml",
  ".js",
  ".md",
  ".graphql",
  ".prisma",
  ".example",
]);

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

async function replacePlaceholders(filePath: string, projectSlug: string) {
  const content = await readFile(filePath, "utf8");
  if (!content.includes("gqlkit")) return;
  const rewritten = content
    .split("@gqlkit/")
    .join(`\0SCOPE\0`)
    .split("gqlkit")
    .join(projectSlug)
    .split("\0SCOPE\0")
    .join(`@${projectSlug}/`);
  await writeFile(filePath, rewritten);
}

// The example blog domain (User/Post/Comment/Role) lives in these paths, spanning
// the Prisma models and the Pothos/Zod layer built on top of them. Skipped when
// includeExamples is false and replaced with the minimal fragments below, which
// keep the schema valid (GraphQL requires Query to have at least one field).
const EXAMPLE_PATHS = [
  "packages/schema/prisma/schema.prisma",
  "packages/schema/src/schema.ts",
  "packages/schema/schema.snapshot.graphql",
  "packages/schema/src/types",
  "packages/schema/src/resolvers",
  "packages/schema/src/validation",
];

export async function scaffold({
  targetDir,
  projectSlug,
  includeWeb,
  includeExamples,
}: ScaffoldOptions): Promise<void> {
  await mkdir(targetDir, { recursive: true });

  const rootTemplate = path.join(templatesDir, "root");
  for (const entry of await readdir(rootTemplate)) {
    await cp(path.join(rootTemplate, entry), path.join(targetDir, entry), { recursive: true });
  }

  await cp(path.join(templatesDir, "packages/schema"), path.join(targetDir, "packages/schema"), {
    recursive: true,
  });
  await cp(path.join(templatesDir, "packages/server"), path.join(targetDir, "packages/server"), {
    recursive: true,
  });

  if (!includeExamples) {
    for (const relPath of EXAMPLE_PATHS) {
      await rm(path.join(targetDir, relPath), { recursive: true, force: true });
    }
    const minimalSchema = path.join(fragmentsDir, "schema-minimal");
    await cp(
      path.join(minimalSchema, "prisma/schema.prisma"),
      path.join(targetDir, "packages/schema/prisma/schema.prisma"),
    );
    await cp(
      path.join(minimalSchema, "src/schema.ts"),
      path.join(targetDir, "packages/schema/src/schema.ts"),
    );
    await cp(
      path.join(minimalSchema, "schema.snapshot.graphql"),
      path.join(targetDir, "packages/schema/schema.snapshot.graphql"),
    );
  }

  if (includeWeb) {
    await cp(path.join(templatesDir, "packages/client"), path.join(targetDir, "packages/client"), {
      recursive: true,
    });
    await cp(path.join(templatesDir, "apps/web"), path.join(targetDir, "apps/web"), {
      recursive: true,
    });
  }

  const files = await walkFiles(targetDir);
  for (const file of files) {
    const ext = path.extname(file);
    if (!TEXT_EXTENSIONS.has(ext) && !file.endsWith(".gitignore")) continue;
    await replacePlaceholders(file, projectSlug);
  }

  // Seeded from .env.example so `build` (prisma generate needs a syntactically
  // valid DATABASE_URL, though not a reachable one) works before the user has
  // pointed this at a real database.
  await cp(
    path.join(targetDir, "packages/schema/.env.example"),
    path.join(targetDir, "packages/schema/.env"),
  );
  await cp(
    path.join(targetDir, "packages/server/.env.example"),
    path.join(targetDir, "packages/server/.env"),
  );
}
