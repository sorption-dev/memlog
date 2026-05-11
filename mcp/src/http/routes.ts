/**
 * HTTP route table for the viewer API. Shared by the Vite dev-middleware
 * (viewer/server/api.ts) and the standalone server (./server.ts) — there is
 * only one source of truth for every /api/* endpoint.
 *
 * Handlers import repo/groups/morph statically; consumers just call
 * buildRoutes(ctx) and feed the returned table into dispatch().
 */
import type { DB } from "../db.js";
import * as repo from "../repo.js";
import * as groups from "../groups.js";
import { lemmatizeRu, morphStatus } from "../morph.js";
import { readSessionAround } from "../session-reader.js";
import {
  dispatch,
  parseQuery,
  readJsonBody,
  sendJson,
  type Route,
} from "./dispatch.js";
import type { Kind, Relation } from "../types.js";

export { dispatch, readJsonBody, sendJson, parseQuery };
export type { Route };

export interface RouteContext {
  db: DB;
  dbPath: string;
}

/** Call once on startup so the Pyodide morph indicator flips to "ready"
 * before the first Russian query arrives. Returns immediately; the actual
 * boot happens in the background. */
export function warmMorph(): void {
  void lemmatizeRu(["тест"]).catch(() => {
    // Degrades to lowercase; UI indicator shows "degraded".
  });
}

export function buildRoutes(ctx: RouteContext): Route[] {
  const { db, dbPath } = ctx;
  return [
    {
      method: "GET",
      match: /^\/api\/stats\/?$/,
      handle: (_req, res) => {
        const stats = repo.collectStats(db, dbPath);
        sendJson(res, 200, { ...stats, morphStatus: morphStatus() });
      },
    },
    {
      method: "GET",
      match: /^\/api\/stats\/activity\/?$/,
      handle: (req, res) => {
        const q = parseQuery(req);
        const granularity = q.get("granularity") === "hour" ? "hour" : "day";
        const days = Number(q.get("days")) || 7;
        sendJson(res, 200, repo.collectActivity(db, { granularity, days }));
      },
    },
    {
      method: "GET",
      match: /^\/api\/recent\/?$/,
      handle: (req, res) => {
        const q = parseQuery(req);
        const result = repo.recentEntries(db, {
          limit: q.get("limit") ? Number(q.get("limit")) : undefined,
          kind: (q.get("kind") as Kind | null) ?? undefined,
          session_id:
            q.getAll("session_id").length > 0 ? q.getAll("session_id") : undefined,
          include_superseded: q.get("include_superseded") === "1",
        });
        sendJson(res, 200, result);
      },
    },
    {
      method: "POST",
      match: /^\/api\/search\/?$/,
      handle: async (req, res) => {
        const body = (await readJsonBody(req)) as Parameters<
          typeof repo.searchEntries
        >[1];
        const result = await repo.searchEntries(db, body);
        sendJson(res, 200, result);
      },
    },
    {
      method: "GET",
      match: /^\/api\/entry\/(\d+)\/?$/,
      handle: (req, res, params) => {
        const id = Number(params.id);
        const q = parseQuery(req);
        const withNeighbors = q.get("with_neighbors") === "1";
        const entry = withNeighbors
          ? repo.getEntryWithNeighbors(db, id)
          : repo.getEntry(db, id);
        if (!entry) return sendJson(res, 404, { error: `entry #${id} not found` });
        sendJson(res, 200, entry);
      },
    },
    {
      method: "POST",
      match: /^\/api\/write\/?$/,
      handle: async (req, res) => {
        const body = (await readJsonBody(req)) as Parameters<
          typeof repo.writeEntry
        >[1];
        const entry = await repo.writeEntry(db, body);
        sendJson(res, 201, entry);
      },
    },
    {
      method: "GET",
      match: /^\/api\/entry\/(\d+)\/source\/?$/,
      handle: async (_req, res, params) => {
        const id = Number(params.id);
        const entry = repo.getEntry(db, id);
        if (!entry) return sendJson(res, 404, { error: `entry #${id} not found` });
        if (!entry.source_session_file) {
          return sendJson(res, 200, {
            path: null,
            fileExists: false,
            totalMessages: 0,
            targetIndex: null,
            windowStart: 0,
            windowEnd: 0,
            messages: [],
          });
        }
        const view = await readSessionAround(
          entry.source_session_file,
          entry.ts,
        );
        sendJson(res, 200, view);
      },
    },
    {
      method: "POST",
      match: /^\/api\/entry\/(\d+)\/redact\/?$/,
      handle: (_req, res, params) => {
        const id = Number(params.id);
        const entry = repo.redactEntry(db, id);
        if (!entry) return sendJson(res, 404, { error: `entry #${id} not found` });
        sendJson(res, 200, entry);
      },
    },
    {
      method: "DELETE",
      match: /^\/api\/entry\/(\d+)\/?$/,
      handle: (_req, res, params) => {
        const id = Number(params.id);
        const ok = repo.deleteEntry(db, id);
        if (!ok) return sendJson(res, 404, { error: `entry #${id} not found` });
        sendJson(res, 200, { ok: true });
      },
    },
    {
      method: "POST",
      match: /^\/api\/link\/?$/,
      handle: async (req, res) => {
        const body = (await readJsonBody(req)) as {
          from_id: number;
          to_id: number;
          relation: Relation;
        };
        repo.addLink(db, body.from_id, body.to_id, body.relation);
        sendJson(res, 201, { ok: true });
      },
    },
    {
      method: "GET",
      match: /^\/api\/sessions\/?$/,
      handle: (_req, res) => {
        sendJson(res, 200, groups.listSessions(db));
      },
    },
    {
      method: "GET",
      match: /^\/api\/groups\/?$/,
      handle: (_req, res) => {
        sendJson(res, 200, groups.listGroups(db));
      },
    },
    {
      method: "POST",
      match: /^\/api\/groups\/?$/,
      handle: async (req, res) => {
        const body = (await readJsonBody(req)) as {
          name: string;
          description?: string | null;
          color?: string | null;
        };
        if (!body.name || typeof body.name !== "string") {
          return sendJson(res, 400, { error: "name is required" });
        }
        try {
          const g = groups.createGroup(db, body.name, body.description, body.color);
          sendJson(res, 201, g);
        } catch (err) {
          const msg = (err as Error).message;
          const status = /UNIQUE/.test(msg) ? 409 : 500;
          sendJson(res, status, { error: msg });
        }
      },
    },
    {
      method: "PATCH",
      match: /^\/api\/groups\/([^/]+)\/?$/,
      handle: async (req, res, params) => {
        const name = decodeURIComponent(params.id ?? "");
        const body = (await readJsonBody(req)) as {
          name?: string;
          description?: string | null;
          color?: string | null;
        };
        try {
          const g = groups.updateGroup(db, name, body);
          if (!g) return sendJson(res, 404, { error: `group '${name}' not found` });
          sendJson(res, 200, g);
        } catch (err) {
          const msg = (err as Error).message;
          const status = /UNIQUE/.test(msg) ? 409 : 500;
          sendJson(res, status, { error: msg });
        }
      },
    },
    {
      method: "DELETE",
      match: /^\/api\/groups\/([^/]+)\/?$/,
      handle: (_req, res, params) => {
        const name = decodeURIComponent(params.id ?? "");
        const ok = groups.deleteGroup(db, name);
        if (!ok) return sendJson(res, 404, { error: `group '${name}' not found` });
        sendJson(res, 200, { ok: true });
      },
    },
    {
      method: "GET",
      match: /^\/api\/groups\/([^/]+)\/?$/,
      handle: (_req, res, params) => {
        const name = decodeURIComponent(params.id ?? "");
        const g = groups.getGroupByName(db, name);
        if (!g) return sendJson(res, 404, { error: `group '${name}' not found` });
        sendJson(res, 200, g);
      },
    },
    {
      method: "POST",
      match: /^\/api\/groups\/([^/]+)\/members\/?$/,
      handle: async (req, res, params) => {
        const name = decodeURIComponent(params.id ?? "");
        const body = (await readJsonBody(req)) as { session_id: string };
        if (!body.session_id) {
          return sendJson(res, 400, { error: "session_id is required" });
        }
        try {
          const added = groups.addGroupMember(db, name, body.session_id);
          sendJson(res, 200, { added });
        } catch (err) {
          sendJson(res, 404, { error: (err as Error).message });
        }
      },
    },
    {
      method: "DELETE",
      match: /^\/api\/groups\/([^/]+)\/members\/([^/]+)\/?$/,
      handle: (_req, res, params) => {
        const name = decodeURIComponent(params.id ?? "");
        const session = decodeURIComponent(params.rest ?? "");
        const removed = groups.removeGroupMember(db, name, session);
        sendJson(res, 200, { removed });
      },
    },
    {
      method: "GET",
      match: /^\/api\/graph\/?$/,
      handle: (req, res) => {
        const q = parseQuery(req);
        const includeSuperseded = q.get("include_superseded") === "1";
        const includeRedacted = q.get("include_redacted") !== "0";

        // Pull everything first so we can resolve supersede-chains before
        // filtering. Otherwise edges pointing to hidden superseded nodes
        // disappear and the graph fragments into islands.
        const allNodes = db
          .prepare(
            `SELECT id, kind, title, session_id, ts, superseded,
                    (body = '[redacted]') AS redacted
             FROM entries
             ORDER BY ts DESC
             LIMIT 5000`,
          )
          .all() as Array<{
          id: number;
          kind: string;
          title: string;
          session_id: string | null;
          ts: string;
          superseded: number;
          redacted: number;
        }>;

        const linksRaw = db
          .prepare(`SELECT from_id, to_id, relation FROM links`)
          .all() as Array<{ from_id: number; to_id: number; relation: string }>;

        // supersedes edge: from_id supersedes to_id (to_id is old).
        const supersededBy = new Map<number, number>();
        for (const l of linksRaw) {
          if (l.relation === "supersedes") supersededBy.set(l.to_id, l.from_id);
        }
        const chainHead = new Map<number, number>();
        for (const n of allNodes) {
          if (!n.superseded) continue;
          let head = n.id;
          const seen = new Set<number>();
          while (supersededBy.has(head) && !seen.has(head)) {
            seen.add(head);
            head = supersededBy.get(head)!;
          }
          chainHead.set(n.id, head);
        }

        let visible = allNodes;
        if (!includeSuperseded) visible = visible.filter((n) => n.superseded !== 1);
        if (!includeRedacted) visible = visible.filter((n) => n.redacted !== 1);
        const visibleIds = new Set(visible.map((n) => n.id));

        const seenKey = new Set<string>();
        const links: Array<{ from_id: number; to_id: number; relation: string }> = [];
        for (const raw of linksRaw) {
          const from = includeSuperseded
            ? raw.from_id
            : (chainHead.get(raw.from_id) ?? raw.from_id);
          const to = includeSuperseded
            ? raw.to_id
            : (chainHead.get(raw.to_id) ?? raw.to_id);
          if (from === to) continue;
          if (!visibleIds.has(from) || !visibleIds.has(to)) continue;
          if (!includeSuperseded && raw.relation === "supersedes") continue;
          const key = `${from}-${to}-${raw.relation}`;
          if (seenKey.has(key)) continue;
          seenKey.add(key);
          links.push({ from_id: from, to_id: to, relation: raw.relation });
        }

        sendJson(res, 200, { nodes: visible, links });
      },
    },
  ];
}
