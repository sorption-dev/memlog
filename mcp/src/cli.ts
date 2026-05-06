#!/usr/bin/env node
/**
 * memlog — unified CLI entrypoint.
 *
 *   memlog                      stdio JSON-RPC (default, for the Tauri shell)
 *   memlog --mcp                MCP stdio server (for Claude Code/Desktop)
 *   memlog --http               HTTP API server (opt-in, handy for curl/debug)
 *   memlog --help               show usage
 *
 * Optional flags:
 *   --db <path>                 override SQLite location (env MEMLOG_DB)
 *   --port <n>                  only with --http. default 5174 (env MEMLOG_PORT)
 *   --host <addr>               only with --http. default 127.0.0.1
 *
 * Three modes, one binary, one codebase. Packaged Tauri app uses the default
 * stdio JSON-RPC; Claude uses --mcp; developers/tests can use --http for curl.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { openDB, resolveDBPath } from "./db.js";
import { configInfo, makeLogger } from "./log.js";
import { morphStats, shutdownMorph } from "./morph.js";
import { buildServer } from "./server.js";
import { startHttpServer } from "./http/server.js";
import { runIpcStdio } from "./ipc/stdio.js";

const log = makeLogger("cli");

interface Args {
  mode: "ipc" | "mcp" | "http" | "help";
  dbPath?: string;
  port?: number;
  host?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { mode: "ipc" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--mcp":
        args.mode = "mcp";
        break;
      case "--http":
        args.mode = "http";
        break;
      case "--help":
      case "-h":
        args.mode = "help";
        break;
      case "--db":
        args.dbPath = argv[++i];
        break;
      case "--port":
        args.port = Number(argv[++i]);
        break;
      case "--host":
        args.host = argv[++i];
        break;
      default:
        if (a?.startsWith("--")) {
          console.error(`unknown flag: ${a}`);
          process.exit(2);
        }
    }
  }
  return args;
}

function printUsage(): void {
  process.stdout.write(
    [
      "memlog — personal journal with Russian-morphology-aware search",
      "",
      "USAGE",
      "  memlog                    stdio JSON-RPC (default — what the Tauri shell uses)",
      "  memlog --mcp              MCP stdio server (for Claude Code/Desktop)",
      "  memlog --http             HTTP API server (opt-in — dev curls / testing)",
      "",
      "OPTIONS",
      "  --db <path>               SQLite path               (env: MEMLOG_DB)",
      "  --port <n>                HTTP port (only --http)   (env: MEMLOG_PORT)",
      "  --host <addr>             HTTP host (only --http)   default 127.0.0.1",
      "  -h, --help                this message",
      "",
    ].join("\n"),
  );
}

function installSignalHandlers(onShutdown: (signal: string) => Promise<void>): void {
  let shuttingDown = false;
  const wrap = (signal: string) => async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await onShutdown(signal);
    process.exit(0);
  };
  process.on("SIGINT", () => void wrap("SIGINT")());
  process.on("SIGTERM", () => void wrap("SIGTERM")());
  process.on("uncaughtException", (err) => {
    log.error("uncaughtException", { error: err.message, stack: err.stack });
  });
  process.on("unhandledRejection", (reason) => {
    log.error("unhandledRejection", { reason: String(reason) });
  });
}

async function runMcp(dbPath: string): Promise<void> {
  log.info("memlog starting", { ...configInfo(), mode: "mcp" });
  const db = openDB(dbPath);
  const server = buildServer(db);
  installSignalHandlers(async (signal) => {
    log.info("shutdown", { signal, morph: morphStats() });
    try {
      await server.close();
    } catch {
      // ignore
    }
    shutdownMorph();
    db.close();
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("connected to stdio transport — ready for clients");
}

async function runHttp(
  dbPath: string,
  port: number,
  host: string,
): Promise<void> {
  log.info("memlog starting", { ...configInfo(), mode: "http" });
  const db = openDB(dbPath);
  const handle = await startHttpServer({ db, dbPath, port, host });
  installSignalHandlers(async (signal) => {
    log.info("shutdown", { signal, morph: morphStats() });
    try {
      await handle.close();
    } catch {
      // ignore
    }
    shutdownMorph();
    db.close();
  });
}

async function runIpc(dbPath: string): Promise<void> {
  log.info("memlog starting", { ...configInfo(), mode: "ipc" });
  const db = openDB(dbPath);
  installSignalHandlers(async (signal) => {
    log.info("shutdown", { signal, morph: morphStats() });
    shutdownMorph();
    db.close();
  });
  await runIpcStdio(db, dbPath);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "help") {
    printUsage();
    return;
  }
  const dbPath = args.dbPath ?? resolveDBPath();
  if (args.mode === "mcp") return runMcp(dbPath);
  if (args.mode === "http") {
    const port = args.port ?? (Number(process.env.MEMLOG_PORT) || 5174);
    const host = args.host ?? "127.0.0.1";
    return runHttp(dbPath, port, host);
  }
  return runIpc(dbPath);
}

main().catch((err: Error) => {
  log.error("fatal", { error: err?.message ?? String(err), stack: err?.stack });
  process.exit(1);
});
