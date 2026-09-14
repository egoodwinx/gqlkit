#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { log, note, outro, spinner } from "@clack/prompts";
import pc from "picocolors";
import { attemptInitialMigration, installDependencies } from "./install.js";
import { PACKAGE_MANAGERS, type PackageManager } from "./package-manager.js";
import { collectAnswers } from "./prompts.js";
import { scaffold } from "./scaffold.js";

const HELP = `
Usage: create-gqlkit-app [project-name] [options]

Options:
  --pm <pnpm|npm|yarn>       Package manager to install with (only pnpm is supported; default: detected from how you ran this)
  --web / --no-web           Include or skip the example apps/web
  --examples / --no-examples Include or skip the example blog models (User/Post/Comment) and their resolvers
  -y, --yes                  Accept defaults for anything not passed above, skipping prompts entirely
  -h, --help                 Print this help text
`;

function isPackageManager(value: string): value is PackageManager {
  return (PACKAGE_MANAGERS as string[]).includes(value);
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      pm: { type: "string" },
      web: { type: "boolean" },
      "no-web": { type: "boolean" },
      examples: { type: "boolean" },
      "no-examples": { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(HELP);
    return;
  }

  if (values.pm && !isPackageManager(values.pm)) {
    console.error(
      `Unknown package manager "${values.pm}". Expected one of: ${PACKAGE_MANAGERS.join(", ")}`,
    );
    process.exitCode = 1;
    return;
  }

  const answers = await collectAnswers({
    projectName: positionals[0],
    packageManager: values.pm as PackageManager | undefined,
    includeWeb: values["no-web"] ? false : values.web,
    includeExamples: values["no-examples"] ? false : values.examples,
    yes: values.yes ?? false,
  });

  const targetDir = path.resolve(process.cwd(), answers.projectName.trim());
  if (existsSync(targetDir) && (await readdir(targetDir)).length > 0) {
    log.error(`"${targetDir}" already exists and isn't empty.`);
    process.exitCode = 1;
    return;
  }

  if (answers.packageManager !== "pnpm") {
    log.error(
      `This template links its internal packages with pnpm's "workspace:*" protocol, which ${answers.packageManager} cannot resolve at all. pnpm is the only supported package manager today.`,
    );
    process.exitCode = 1;
    return;
  }

  const writeSpinner = spinner();
  writeSpinner.start("Writing project files");
  await scaffold({
    targetDir,
    projectSlug: answers.projectSlug,
    includeWeb: answers.includeWeb,
    includeExamples: answers.includeExamples,
  });
  writeSpinner.stop("Project files written");

  const installSpinner = spinner();
  installSpinner.start(`Installing dependencies with ${answers.packageManager}`);
  const installed = await installDependencies(targetDir, answers.packageManager);
  installSpinner.stop(installed ? "Dependencies installed" : "Dependency install failed");
  if (!installed) process.exitCode = 1;

  let migrated = false;
  if (installed) {
    const migrateSpinner = spinner();
    migrateSpinner.start("Attempting initial Prisma migration (needs DATABASE_URL)");
    migrated = await attemptInitialMigration(targetDir);
    migrateSpinner.stop(migrated ? "Database migrated" : "Skipped — no reachable database yet");
  }

  const relDir = path.relative(process.cwd(), targetDir) || ".";
  const steps = [
    `cd ${relDir}`,
    !installed ? `${answers.packageManager} install` : undefined,
    "# edit DATABASE_URL in packages/schema/.env and packages/server/.env to point at a real Postgres database",
    !migrated ? "cd packages/schema && npx prisma migrate dev --name init && cd ../.." : undefined,
    `${answers.packageManager} dev`,
  ].filter((step): step is string => step !== undefined);

  note(steps.join("\n"), "Next steps");
  outro(pc.green("Done."));
}

await main();
