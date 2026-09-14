export type PackageManager = "npm" | "pnpm" | "yarn";

export const PACKAGE_MANAGERS: PackageManager[] = ["pnpm", "npm", "yarn"];

export function detectPackageManager(): PackageManager {
  const userAgent = process.env["npm_config_user_agent"] ?? "";
  if (userAgent.startsWith("pnpm")) return "pnpm";
  if (userAgent.startsWith("yarn")) return "yarn";
  return "pnpm";
}

export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "app";
}
