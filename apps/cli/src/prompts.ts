import { cancel, confirm, intro, isCancel, log, select, text } from "@clack/prompts";
import pc from "picocolors";
import {
  detectPackageManager,
  PACKAGE_MANAGERS,
  slugify,
  type PackageManager,
} from "./package-manager.js";

export interface CliArgs {
  projectName?: string;
  packageManager?: PackageManager;
  includeWeb?: boolean;
  includeExamples?: boolean;
  yes: boolean;
}

export interface ScaffoldAnswers {
  projectName: string;
  projectSlug: string;
  packageManager: PackageManager;
  includeWeb: boolean;
  includeExamples: boolean;
}

function handleCancel(value: unknown): asserts value is never {
  if (isCancel(value)) {
    cancel("Cancelled.");
    process.exit(0);
  }
}

export async function collectAnswers(args: CliArgs): Promise<ScaffoldAnswers> {
  intro(pc.bgCyan(pc.black(" create-gqlkit-app ")));

  let projectName = args.projectName?.trim();
  if (!projectName) {
    if (args.yes) {
      projectName = "my-app";
    } else {
      const answer = await text({
        message: "Project name?",
        placeholder: "my-app",
        defaultValue: "my-app",
        validate: (value) => {
          if (!value || value.trim().length === 0) return "Project name can't be blank.";
          return undefined;
        },
      });
      handleCancel(answer);
      const trimmed: string = answer;
      projectName = trimmed.trim() || "my-app";
    }
  }

  let packageManager = args.packageManager;
  if (!packageManager) {
    if (args.yes) {
      packageManager = detectPackageManager();
    } else {
      const answer = await select<PackageManager>({
        message: "Package manager?",
        options: PACKAGE_MANAGERS.map((pm) => ({ value: pm })),
        initialValue: detectPackageManager(),
      });
      handleCancel(answer);
      packageManager = answer;
    }
  }

  let includeExamples = args.includeExamples;
  if (includeExamples === undefined) {
    if (args.yes) {
      includeExamples = true;
    } else {
      const answer = await confirm({
        message: "Include the example blog models (User/Post/Comment)?",
        initialValue: true,
      });
      handleCancel(answer);
      includeExamples = answer;
    }
  }

  let includeWeb = args.includeWeb;
  if (!includeExamples) {
    // apps/web's only query (searchPosts) reads the example Post model, so
    // there's nothing for it to query once that model is gone.
    if (includeWeb) {
      log.warn(
        "apps/web queries the example Post model, so it's skipped along with --no-examples.",
      );
    }
    includeWeb = false;
  } else if (includeWeb === undefined) {
    if (args.yes) {
      includeWeb = true;
    } else {
      const answer = await confirm({
        message: "Include the example apps/web?",
        initialValue: true,
      });
      handleCancel(answer);
      includeWeb = answer;
    }
  }

  const projectSlug = slugify(projectName);
  if (projectSlug === "app" && projectName.toLowerCase() !== "app") {
    log.warn(
      `"${projectName}" has no ASCII letters or digits to build a package scope from — using "@${projectSlug}/*" for the internal packages instead. The project directory itself still uses "${projectName}".`,
    );
  }

  return {
    projectName,
    projectSlug,
    packageManager,
    includeWeb,
    includeExamples,
  };
}
