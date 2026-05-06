/**
 * HTTP primitives shared between the Vite dev-plugin and the standalone
 * node:http server. Exactly one matcher implementation, one JSON codec.
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export interface Route {
  method: string;
  /** Regex must match against pathname only (no query string). Captured
   * groups are exposed via the `id` / `rest` params passed to `handle`. */
  match: RegExp;
  handle: RouteHandler;
}

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: { id?: string; rest?: string },
) => Promise<void> | void;

export function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (c: string) => {
      raw += c;
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

export function parseQuery(req: IncomingMessage): URLSearchParams {
  const url = new URL(req.url ?? "/", "http://localhost");
  return url.searchParams;
}

/**
 * Try the routes in order. Returns `true` if a route matched (regardless of
 * whether the handler succeeded — errors are mapped to 500). Returns `false`
 * if no route matched, so the caller can decide what to do (Vite falls
 * through to the next middleware, standalone sends 404).
 */
export async function dispatch(
  routes: Route[],
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const rawUrl = req.url ?? "";
  const method = req.method ?? "GET";
  const pathname = rawUrl.split("?")[0] ?? rawUrl;

  for (const r of routes) {
    if (r.method !== method) continue;
    const m = pathname.match(r.match);
    if (!m) continue;
    try {
      await r.handle(req, res, { id: m[1], rest: m[2] });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const stack = err instanceof Error ? err.stack : undefined;
      // eslint-disable-next-line no-console
      console.error(`[api] ${method} ${rawUrl} →`, msg, stack);
      if (!res.writableEnded) sendJson(res, 500, { error: msg });
    }
    return true;
  }
  return false;
}
