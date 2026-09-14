import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { PackageManager } from "./package-manager.js";

// Kills the whole process tree, not just the immediate child — a plain
// child.kill() only signals the process we spawned directly, leaving behind
// any grandchild it spawned in turn (e.g. npx's underlying prisma binary, or
// the real installer behind a Windows shell wrapper), which can keep holding
// a lock or a network connection after the CLI has already moved on.
function killTree(child: ChildProcess) {
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    return;
  }
  if (child.pid) {
    try {
      process.kill(-child.pid, "SIGTERM");
      return;
    } catch {
      // Not a process group leader (e.g. already exited) — fall through.
    }
  }
  child.kill();
}

// Bounds `install`: without this, a package manager blocked on an interactive
// prompt (e.g. pnpm's build-script approval for a dependency not already
// listed in pnpm-workspace.yaml's allowBuilds) would hang the CLI forever.
const INSTALL_TIMEOUT_MS = 5 * 60_000;

function run(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs?: number,
): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32",
      detached: process.platform !== "win32",
    });

    const onSignal = () => killTree(child);
    if (process.platform !== "win32") {
      process.once("SIGINT", onSignal);
      process.once("SIGTERM", onSignal);
    }
    const stopWatchingSignals = () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    };

    const timer = timeoutMs ? setTimeout(() => killTree(child), timeoutMs) : undefined;
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      stopWatchingSignals();
      resolve(code);
    });
    child.on("error", () => {
      if (timer) clearTimeout(timer);
      stopWatchingSignals();
      resolve(1);
    });
  });
}

export async function installDependencies(
  targetDir: string,
  packageManager: PackageManager,
): Promise<boolean> {
  const code = await run(packageManager, ["install"], targetDir, INSTALL_TIMEOUT_MS);
  return code === 0;
}

// Best-effort: a fresh scaffold has no DATABASE_URL yet, so this is expected
// to fail until the user sets one. npx resolves the locally installed prisma
// binary regardless of which package manager did the installing.
export async function attemptInitialMigration(targetDir: string): Promise<boolean> {
  const schemaDir = path.join(targetDir, "packages/schema");
  const code = await run("npx", ["prisma", "migrate", "dev", "--name", "init"], schemaDir, 30_000);
  return code === 0;
}
