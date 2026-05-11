/**
 * Stdio JSON-RPC backend — this is what the Tauri shell talks to.
 *
 * Protocol: newline-delimited JSON, one frame per line.
 *
 *   → {"id": 42, "method": "search", "params": {"query": "foo"}}
 *   ← {"id": 42, "result": {...}}
 *   ← {"id": 42, "error": "…"}
 *
 * No HTTP, no ports, no CORS. Rust's tauri::command "memlog" pipes frames
 * through the sidecar's stdin/stdout — the webview just calls
 * `invoke("memlog", {method, params})`. One process pair, one protocol,
 * encapsulated entirely inside the app bundle.
 *
 * Methods are thin wrappers around repo/groups functions — same ones the
 * MCP tools use, same ones the (still available via --http) HTTP routes
 * use. Zero duplication of business logic.
 */
import { createInterface } from "node:readline";
import * as repo from "../repo.js";
import * as groups from "../groups.js";
import type { DB } from "../db.js";
import { lemmatizeRu, morphStatus } from "../morph.js";
import { readSessionAround } from "../session-reader.js";
import { makeLogger } from "../log.js";

const log = makeLogger("ipc");

type Handler = (params: Record<string, unknown>) => unknown | Promise<unknown>;
type HandlerMap = Record<string, Handler>;

export function buildHandlers(db: DB, dbPath: string): HandlerMap {
  return {
    // Stats / activity / morph indicator
    stats: () => ({
      ...repo.collectStats(db, dbPath),
      morphStatus: morphStatus(),
    }),
    activity: (p) =>
      repo.collectActivity(db, {
        granularity: p.granularity === "hour" ? "hour" : "day",
        days: Number(p.days) || 7,
      }),

    // Entries CRUD
    recent: (p) =>
      repo.recentEntries(db, p as unknown as Parameters<typeof repo.recentEntries>[1]),
    search: (p) =>
      repo.searchEntries(db, p as unknown as Parameters<typeof repo.searchEntries>[1]),
    entry: (p) => {
      const id = Number(p.id);
      if (!Number.isFinite(id)) throw new Error("id must be a number");
      const entry = p.with_neighbors
        ? repo.getEntryWithNeighbors(db, id)
        : repo.getEntry(db, id);
      if (!entry) throw new Error(`entry #${id} not found`);
      return entry;
    },
    write: (p) =>
      repo.writeEntry(db, p as unknown as Parameters<typeof repo.writeEntry>[1]),
    update: async (p) => {
      const id = Number(p.id);
      if (!Number.isFinite(id)) throw new Error("id must be a number");
      const patch = p.patch as Parameters<typeof repo.updateEntry>[2];
      const entry = await repo.updateEntry(db, id, patch);
      if (!entry) throw new Error(`entry #${id} not found`);
      return entry;
    },
    redact: (p) => {
      const id = Number(p.id);
      const entry = repo.redactEntry(db, id);
      if (!entry) throw new Error(`entry #${id} not found`);
      return entry;
    },
    delete: (p) => {
      const id = Number(p.id);
      if (!Number.isFinite(id)) throw new Error("id must be a number");
      const ok = repo.deleteEntry(db, id);
      if (!ok) throw new Error(`entry #${id} not found`);
      return { ok: true };
    },
    link: (p) => {
      const { from_id, to_id, relation } = p as {
        from_id: number;
        to_id: number;
        relation: Parameters<typeof repo.addLink>[3];
      };
      repo.addLink(db, from_id, to_id, relation);
      return { ok: true };
    },
    entry_source: async (p) => {
      const id = Number(p.id);
      const entry = repo.getEntry(db, id);
      if (!entry) throw new Error(`entry #${id} not found`);
      if (!entry.source_session_file) {
        return {
          path: null,
          fileExists: false,
          totalMessages: 0,
          targetIndex: null,
          windowStart: 0,
          windowEnd: 0,
          messages: [],
        };
      }
      return await readSessionAround(entry.source_session_file, entry.ts);
    },

    // Sessions / groups
    sessions: () => groups.listSessions(db),
    groups_list: () => groups.listGroups(db),
    groups_get: (p) => {
      const g = groups.getGroupByName(db, String(p.name));
      if (!g) throw new Error(`group '${p.name}' not found`);
      return g;
    },
    groups_create: (p) =>
      groups.createGroup(
        db,
        String(p.name),
        p.description as string | null | undefined,
        p.color as string | null | undefined,
      ),
    groups_update: (p) => {
      const g = groups.updateGroup(
        db,
        String(p.name),
        p.patch as {
          name?: string;
          description?: string | null;
          color?: string | null;
        },
      );
      if (!g) throw new Error(`group '${p.name}' not found`);
      return g;
    },
    groups_delete: (p) => {
      const ok = groups.deleteGroup(db, String(p.name));
      if (!ok) throw new Error(`group '${p.name}' not found`);
      return { ok: true };
    },
    group_add_member: (p) => {
      const added = groups.addGroupMember(
        db,
        String(p.name),
        String(p.session_id),
      );
      return { added };
    },
    group_remove_member: (p) => {
      const removed = groups.removeGroupMember(
        db,
        String(p.name),
        String(p.session_id),
      );
      return { removed };
    },

    // Graph (direct SQL — same as the old HTTP handler; kept here because
    // it's viewer-only and doesn't live in repo.ts).
    graph: (p) => {
      const includeSuperseded = p.include_superseded === true;
      const includeRedacted = p.include_redacted !== false;
      return buildGraph(db, includeSuperseded, includeRedacted);
    },

    // Morph warmup (called from the app's startup path — lets the UI flip
    // to "ready" without waiting for the first Russian query).
    morph_warmup: () => {
      void lemmatizeRu(["тест"]).catch(() => {});
      return { status: morphStatus() };
    },
  };
}

function buildGraph(
  db: DB,
  includeSuperseded: boolean,
  includeRedacted: boolean,
): { nodes: unknown[]; links: unknown[] } {
  const allNodes = db
    .prepare(
      `SELECT id, kind, title, session_id, ts, superseded,
              (body = '[redacted]') AS redacted
         FROM entries ORDER BY ts DESC LIMIT 5000`,
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
  const out: Array<{ from_id: number; to_id: number; relation: string }> = [];
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
    out.push({ from_id: from, to_id: to, relation: raw.relation });
  }
  return { nodes: visible, links: out };
}

interface RpcRequest {
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface RpcResponse {
  id: number | string;
  result?: unknown;
  error?: string;
}

export async function runIpcStdio(db: DB, dbPath: string): Promise<void> {
  const handlers = buildHandlers(db, dbPath);

  // Fire-and-forget morph boot so the first Russian query isn't paying
  // cold-start latency (same behaviour as the HTTP server's warmup).
  void lemmatizeRu(["тест"]).catch(() => {});

  const write = (msg: RpcResponse) => {
    process.stdout.write(JSON.stringify(msg) + "\n");
  };

  log.info("ipc-stdio ready", { handlers: Object.keys(handlers).length });

  // Sentinel so Rust side knows the sidecar is up before sending the first
  // frame. Mirrors the old "listening port=…" log we used for HTTP.
  process.stderr.write("[ipc] ready\n");

  const rl = createInterface({ input: process.stdin });
  for await (const raw of rl) {
    const line = raw.trim();
    if (!line) continue;
    let req: RpcRequest;
    try {
      req = JSON.parse(line);
    } catch (err) {
      log.warn("dropping malformed frame", { error: (err as Error).message });
      continue;
    }
    const id = req.id;
    const fn = handlers[req.method];
    if (!fn) {
      write({ id, error: `unknown method: ${req.method}` });
      continue;
    }
    try {
      const result = await fn(req.params ?? {});
      write({ id, result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Match the HTTP handler's status-code-ish semantics for UNIQUE
      // collisions so the UI can distinguish duplicates from other errors.
      const errorPayload = /UNIQUE/.test(msg) ? `conflict: ${msg}` : msg;
      write({ id, error: errorPayload });
    }
  }
}
