import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export interface Config {
  db_path?: string;
}

/**
 * Directory the binary lives in — config + default data dir hang off this.
 *
 * Compiled (`bun build --compile`): execPath is the binary itself, so its
 * dirname is the install dir. Dev (`bun run src/...`): execPath is the bun
 * runtime — fall back to cwd so dev runs land beside the project.
 */
export function appDir(): string {
  const exe = process.execPath;
  if (basename(exe).toLowerCase().startsWith("bun")) {
    return process.cwd();
  }
  return dirname(exe);
}

export function configPath(): string {
  return join(appDir(), "config.json");
}

export function readConfig(): Config {
  try {
    const text = readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as Config) : {};
  } catch {
    return {};
  }
}
