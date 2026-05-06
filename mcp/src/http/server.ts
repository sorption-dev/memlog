/**
 * Standalone HTTP server used by the packaged desktop app (and any other
 * caller that wants /api/* without Vite). Viewer dev uses the same routes
 * via viewer/server/api.ts — this file is specifically for production where
 * the frontend is served as static files and the backend is a plain node
 * process.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { makeLogger } from "../log.js";
import { buildRoutes, dispatch, sendJson, warmMorph } from "./routes.js";
import type { DB } from "../db.js";

const log = makeLogger("http");

export interface HttpServerHandle {
  port: number;
  close: () => Promise<void>;
}

export interface HttpServerOptions {
  db: DB;
  dbPath: string;
  /** 0 → OS picks a free port. */
  port?: number;
  /** Bind address; defaults to 127.0.0.1 (loopback only). */
  host?: string;
  /** Kick off Pyodide boot in the background so the first Russian query
   * doesn't pay the cold-start cost. Default: true. */
  warmup?: boolean;
}

export async function startHttpServer(
  opts: HttpServerOptions,
): Promise<HttpServerHandle> {
  const routes = buildRoutes({ db: opts.db, dbPath: opts.dbPath });
  if (opts.warmup !== false) warmMorph();

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    // CORS — the packaged Tauri webview lives on tauri://localhost / similar,
    // but the sidecar listens on http://127.0.0.1:RANDOM, so every fetch is
    // cross-origin. We bind loopback-only so permissive "*" is still safe:
    // nobody outside this machine can hit the port.
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    const matched = await dispatch(routes, req, res);
    if (!matched) {
      sendJson(res, 404, {
        error: `no route: ${req.method ?? "GET"} ${req.url ?? ""}`,
      });
    }
  });

  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 0;

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const addr = server.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : port;
  log.info("listening", { host, port: actualPort });

  const close = () =>
    new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });

  return { port: actualPort, close };
}
