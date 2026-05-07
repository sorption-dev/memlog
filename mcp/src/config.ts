import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export interface Config {
  db_path?: string;
}

const APP_NAME = "memlog";

/**
 * Canonical per-OS config directory.
 *   macOS:   ~/Library/Application Support/memlog
 *   Windows: %APPDATA%\memlog                   (Roaming — small, syncs across
 *                                                domain/MS-account machines)
 *   Linux:   $XDG_CONFIG_HOME/memlog            (default ~/.config/memlog)
 */
export function configDir(): string {
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", APP_NAME);
  }
  if (platform() === "win32") {
    const appdata =
      process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
    return join(appdata, APP_NAME);
  }
  const xdg = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
  return join(xdg, APP_NAME);
}

/**
 * Canonical per-OS data directory (the SQLite DB lives here).
 *   macOS:   ~/Library/Application Support/memlog   (no config/data split on
 *                                                    macOS — both go in
 *                                                    Application Support)
 *   Windows: %LOCALAPPDATA%\memlog                  (Local — does NOT roam.
 *                                                    SQLite WAL/lock files
 *                                                    misbehave on roaming
 *                                                    profiles, and the DB
 *                                                    can grow past sync
 *                                                    quotas)
 *   Linux:   $XDG_DATA_HOME/memlog                  (default
 *                                                    ~/.local/share/memlog)
 */
export function dataDir(): string {
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", APP_NAME);
  }
  if (platform() === "win32") {
    const local =
      process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(local, APP_NAME);
  }
  const xdg = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(xdg, APP_NAME);
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function defaultDBPath(): string {
  return join(dataDir(), "db.sqlite");
}

/**
 * Idempotent: ensure config + data dirs exist, and that `config.json`
 * carries the resolved default `db_path` so the user opens it and
 * immediately sees where the DB lives.
 */
export function ensureDataDir(): void {
  mkdirSync(configDir(), { recursive: true });
  mkdirSync(dataDir(), { recursive: true });
  const cfg = configPath();
  if (!existsSync(cfg)) {
    const defaults: Config = { db_path: defaultDBPath() };
    writeFileSync(cfg, JSON.stringify(defaults, null, 2) + "\n", "utf8");
  }
}

export function readConfig(): Config {
  ensureDataDir();
  try {
    const text = readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? (parsed as Config) : {};
  } catch {
    return {};
  }
}
