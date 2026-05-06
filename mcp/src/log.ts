import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

type Level = "DEBUG" | "INFO" | "WARN" | "ERROR";

const LEVEL_RANK: Record<Level, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

const envLevel = (process.env.MEMLOG_LOG_LEVEL ?? "INFO").toUpperCase() as Level;
const threshold = LEVEL_RANK[envLevel] ?? LEVEL_RANK.INFO;

const logFile = process.env.MEMLOG_LOG_FILE;
if (logFile) {
  try {
    mkdirSync(dirname(logFile), { recursive: true });
  } catch {
    // ignore — file write will surface error later
  }
}

function write(level: Level, msg: string): void {
  if (LEVEL_RANK[level] < threshold) return;
  const line = `${new Date().toISOString()} [${level}] ${msg}\n`;
  // stderr is safe: Claude clients capture it as MCP logs; stdout is protocol-only.
  process.stderr.write(line);
  if (logFile) {
    try {
      appendFileSync(logFile, line);
    } catch {
      // logging should never crash
    }
  }
}

function format(scope: string, msg: string, extra?: Record<string, unknown>): string {
  if (!extra || Object.keys(extra).length === 0) return `[${scope}] ${msg}`;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined) continue;
    const s =
      typeof v === "string"
        ? v.length > 200
          ? JSON.stringify(v.slice(0, 200) + "…")
          : JSON.stringify(v)
        : typeof v === "object"
          ? safeJson(v)
          : String(v);
    parts.push(`${k}=${s}`);
  }
  return `[${scope}] ${msg} ${parts.join(" ")}`;
}

function safeJson(v: unknown): string {
  try {
    const s = JSON.stringify(v);
    return s.length > 400 ? s.slice(0, 400) + "…" : s;
  } catch {
    return "[unserializable]";
  }
}

export function makeLogger(scope: string) {
  return {
    debug: (msg: string, extra?: Record<string, unknown>) =>
      write("DEBUG", format(scope, msg, extra)),
    info: (msg: string, extra?: Record<string, unknown>) =>
      write("INFO", format(scope, msg, extra)),
    warn: (msg: string, extra?: Record<string, unknown>) =>
      write("WARN", format(scope, msg, extra)),
    error: (msg: string, extra?: Record<string, unknown>) =>
      write("ERROR", format(scope, msg, extra)),
  };
}

export function configInfo(): Record<string, unknown> {
  return {
    logLevel: envLevel,
    logFile: logFile ?? null,
    node: process.version,
    platform: process.platform,
    pid: process.pid,
  };
}
