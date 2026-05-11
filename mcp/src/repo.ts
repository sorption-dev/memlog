import { statSync } from "node:fs";
import { getUserVersion, type DB } from "./db.js";
import { expandGroupsToSessions } from "./groups.js";
import { makeLogger } from "./log.js";
import type {
  Entry,
  EntryWithNeighbors,
  Kind,
  Relation,
  RecentArgs,
  SearchArgs,
  SearchHit,
  SearchResult,
  WriteArgs,
  WriteLink,
} from "./types.js";
import { isDegraded, lemmatize } from "./tokens.js";

const log = makeLogger("repo");
const SLOW_MS = 150;

interface EntryRow {
  id: number;
  ts: string;
  session_id: string | null;
  msg_ref: string | null;
  kind: Kind;
  title: string;
  body: string;
  tags: string | null;
  superseded: number;
  source_session_file: string | null;
}

function rowToEntry(r: EntryRow): Entry {
  return {
    id: r.id,
    ts: r.ts,
    session_id: r.session_id,
    msg_ref: r.msg_ref,
    kind: r.kind,
    title: r.title,
    body: r.body,
    tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
    superseded: r.superseded === 1,
    source_session_file: r.source_session_file,
  };
}

function tagsForStorage(tags: string[] | undefined): string | null {
  if (!tags || tags.length === 0) return null;
  return JSON.stringify(tags);
}

export async function writeEntry(db: DB, args: WriteArgs): Promise<Entry> {
  const t0 = Date.now();
  const titleLemmas = await lemmatize(args.title);
  const bodyLemmas = await lemmatize(args.body);
  const lemmaMs = Date.now() - t0;
  const tagsJson = tagsForStorage(args.tags);

  const insert = db.prepare(`
    INSERT INTO entries
      (session_id, msg_ref, kind, title, body, tags, title_lemmas, body_lemmas, source_session_file)
    VALUES
      (@session_id, @msg_ref, @kind, @title, @body, @tags, @title_lemmas, @body_lemmas, @source_session_file)
  `);
  const linkInsert = db.prepare(`
    INSERT OR IGNORE INTO links (from_id, to_id, relation) VALUES (?, ?, ?)
  `);

  const tx = db.transaction((data: WriteArgs, linksToAdd: WriteLink[]) => {
    const info = insert.run({
      session_id: data.session_id ?? null,
      msg_ref: data.msg_ref ?? null,
      kind: data.kind,
      title: data.title,
      body: data.body,
      tags: tagsJson,
      title_lemmas: titleLemmas,
      body_lemmas: bodyLemmas,
      source_session_file: data.source_session_file ?? null,
    });
    const id = Number(info.lastInsertRowid);
    for (const l of linksToAdd) linkInsert.run(id, l.to_id, l.relation);
    return id;
  });

  const id = tx(args, args.links ?? []);
  const entry = getEntry(db, id);
  if (!entry) throw new Error(`Failed to retrieve just-inserted entry id=${id}`);
  const total = Date.now() - t0;
  log.debug("writeEntry", {
    id,
    kind: args.kind,
    bodyLen: args.body.length,
    links: args.links?.length ?? 0,
    lemmaMs,
    totalMs: total,
  });
  if (total > SLOW_MS) log.warn("slow writeEntry", { id, ms: total, lemmaMs });
  return entry;
}

export function getEntry(db: DB, id: number): Entry | null {
  const row = db.prepare(`SELECT * FROM entries WHERE id = ?`).get(id) as EntryRow | undefined;
  return row ? rowToEntry(row) : null;
}

export function getEntryWithNeighbors(
  db: DB,
  id: number,
): EntryWithNeighbors | null {
  const entry = getEntry(db, id);
  if (!entry) return null;

  const outRows = db
    .prepare(
      `SELECT l.to_id, l.relation, e.title, e.kind
       FROM links l JOIN entries e ON e.id = l.to_id
       WHERE l.from_id = ?`,
    )
    .all(id) as Array<{ to_id: number; relation: Relation; title: string; kind: Kind }>;
  const inRows = db
    .prepare(
      `SELECT l.from_id, l.relation, e.title, e.kind
       FROM links l JOIN entries e ON e.id = l.from_id
       WHERE l.to_id = ?`,
    )
    .all(id) as Array<{ from_id: number; relation: Relation; title: string; kind: Kind }>;

  return { ...entry, outgoing: outRows, incoming: inRows };
}

export function addLink(
  db: DB,
  from_id: number,
  to_id: number,
  relation: Relation,
): void {
  db.prepare(`INSERT OR IGNORE INTO links (from_id, to_id, relation) VALUES (?, ?, ?)`).run(
    from_id,
    to_id,
    relation,
  );
}

/**
 * Redact an entry in-place: overwrites title/body/tags/lemmas with a sentinel
 * but preserves id, ts, session_id, kind, links (both directions), superseded
 * flag, and source_session_file.
 *
 * Use for PII leaks or entries you want out of the searchable corpus without
 * severing graph edges — entries that depend_on / supersede / ... this one
 * keep working references. Idempotent.
 */
/**
 * Mutate an entry's content in place. Accepts a partial patch —
 * only fields explicitly provided are touched. `ts`, `id`, `session_id`,
 * `msg_ref`, `source_session_file`, `superseded`, and all links are
 * preserved. Lemma indices are rebuilt for whichever text fields change.
 *
 * Redacted entries cannot be edited (we'd resurrect content that was
 * explicitly struck from the searchable corpus). Callers should check
 * for the sentinel and surface the right UX instead.
 */
export interface UpdateArgs {
  kind?: Kind;
  title?: string;
  body?: string;
  tags?: string[];
}

export async function updateEntry(
  db: DB,
  id: number,
  patch: UpdateArgs,
): Promise<Entry | null> {
  const existing = getEntry(db, id);
  if (!existing) return null;
  if (existing.body === "[redacted]")
    throw new Error("cannot edit redacted entries");

  const sets: string[] = [];
  const values: Record<string, unknown> = { id };

  if (patch.kind !== undefined) {
    sets.push("kind = @kind");
    values.kind = patch.kind;
  }
  if (patch.title !== undefined) {
    sets.push("title = @title", "title_lemmas = @title_lemmas");
    values.title = patch.title;
    values.title_lemmas = await lemmatize(patch.title);
  }
  if (patch.body !== undefined) {
    sets.push("body = @body", "body_lemmas = @body_lemmas");
    values.body = patch.body;
    values.body_lemmas = await lemmatize(patch.body);
  }
  if (patch.tags !== undefined) {
    sets.push("tags = @tags");
    values.tags = tagsForStorage(patch.tags);
  }

  if (sets.length === 0) return existing;

  db.prepare(`UPDATE entries SET ${sets.join(", ")} WHERE id = @id`).run(values);
  log.info("updated", {
    id,
    fields: Object.keys(patch),
  });
  return getEntry(db, id);
}

export function redactEntry(db: DB, id: number): Entry | null {
  const existing = getEntry(db, id);
  if (!existing) return null;
  const MARKER = "[redacted]";
  db.prepare(
    `UPDATE entries
        SET title = @m, body = @m, tags = NULL,
            title_lemmas = @m, body_lemmas = @m
      WHERE id = @id`,
  ).run({ m: MARKER, id });
  log.info("redacted", { id, kind: existing.kind, hadTags: existing.tags.length });
  return getEntry(db, id);
}

/**
 * Hard-delete an entry. Cascades to `links` via ON DELETE CASCADE; the FTS
 * index is cleaned up by the `entries_ad` trigger. Irreversible — callers
 * should confirm with the user. Prefer `redactEntry` when graph edges and
 * history matter; this is for "I wrote it by mistake, get rid of it".
 */
export function deleteEntry(db: DB, id: number): boolean {
  const existing = getEntry(db, id);
  if (!existing) return false;
  const info = db.prepare(`DELETE FROM entries WHERE id = ?`).run(id);
  log.info("deleted", { id, kind: existing.kind, changes: info.changes });
  return info.changes > 0;
}

export interface Stats {
  dbPath: string;
  dbSizeBytes: number;
  schemaVersion: number;
  totalEntries: number;
  supersededEntries: number;
  redactedEntries: number;
  withSourceSession: number;
  byKind: Array<{ kind: Kind; n: number }>;
  topSessions: Array<{ session_id: string | null; n: number; last_ts: string }>;
  totalLinks: number;
  byRelation: Array<{ relation: Relation; n: number }>;
  activity: { last24h: number; last7d: number; last30d: number; allTime: number };
}

export type ActivityGranularity = "day" | "hour";
export interface ActivityBucket {
  /** UTC. For day: "YYYY-MM-DD". For hour: "YYYY-MM-DDTHH:00:00Z". */
  bucket: string;
  entries: number;
  chars: number;
}
export interface ActivityReport {
  granularity: ActivityGranularity;
  since: string;
  buckets: ActivityBucket[];
  totalEntries: number;
  totalChars: number;
  byKind: Array<{ kind: Kind; n: number }>;
  topSessions: Array<{ session_id: string | null; n: number; chars: number }>;
}

export interface ActivityArgs {
  /** "day": last N days (inclusive). "hour": today in UTC hours (00..23). */
  granularity?: ActivityGranularity;
  /** Used only when granularity="day". Default 7, max 90. */
  days?: number;
}

/**
 * Aggregate entry activity — all in SQL, no denormalized stats table. `chars`
 * excludes redacted bodies so the chart reflects real written content, not
 * the 10-char "[redacted]" placeholder. Buckets align on UTC boundaries.
 */
export function collectActivity(db: DB, args: ActivityArgs = {}): ActivityReport {
  const granularity: ActivityGranularity = args.granularity ?? "day";
  const charsExpr =
    `CASE WHEN body != '[redacted]' THEN length(title) + length(body) ELSE 0 END`;

  const since = new Date();
  const bucketKeys: string[] = [];
  let groupExpr: string;

  if (granularity === "hour") {
    // "Today" = 00:00..23:00 UTC of the current UTC date.
    since.setUTCHours(0, 0, 0, 0);
    groupExpr = `strftime('%Y-%m-%dT%H:00:00Z', ts)`;
    for (let h = 0; h < 24; h++) {
      const d = new Date(since);
      d.setUTCHours(h);
      bucketKeys.push(d.toISOString().replace(/\.\d{3}Z$/, "Z"));
    }
  } else {
    const days = Math.max(1, Math.min(90, Math.floor(args.days ?? 7) || 7));
    since.setUTCHours(0, 0, 0, 0);
    since.setUTCDate(since.getUTCDate() - (days - 1));
    groupExpr = `date(ts)`;
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setUTCHours(0, 0, 0, 0);
      d.setUTCDate(d.getUTCDate() - i);
      bucketKeys.push(d.toISOString().slice(0, 10));
    }
  }

  const sinceIso = since.toISOString();

  const rawRows = db
    .prepare(
      `SELECT ${groupExpr} AS b,
              count(*) AS n,
              sum(${charsExpr}) AS chars
         FROM entries
        WHERE ts >= ?
        GROUP BY b`,
    )
    .all(sinceIso) as Array<{ b: string; n: number; chars: number | null }>;

  const byBucket = new Map<string, { entries: number; chars: number }>();
  for (const row of rawRows) {
    byBucket.set(row.b, { entries: row.n, chars: row.chars ?? 0 });
  }

  const buckets: ActivityBucket[] = bucketKeys.map((k) => {
    const hit = byBucket.get(k);
    return { bucket: k, entries: hit?.entries ?? 0, chars: hit?.chars ?? 0 };
  });

  const byKind = db
    .prepare(
      `SELECT kind, count(*) AS n FROM entries WHERE ts >= ?
        GROUP BY kind ORDER BY n DESC`,
    )
    .all(sinceIso) as Array<{ kind: Kind; n: number }>;

  const topSessions = db
    .prepare(
      `SELECT session_id,
              count(*) AS n,
              sum(${charsExpr}) AS chars
         FROM entries WHERE ts >= ?
        GROUP BY session_id
        ORDER BY n DESC
        LIMIT 10`,
    )
    .all(sinceIso) as Array<{
    session_id: string | null;
    n: number;
    chars: number | null;
  }>;

  const totalEntries = buckets.reduce((acc, d) => acc + d.entries, 0);
  const totalChars = buckets.reduce((acc, d) => acc + d.chars, 0);

  return {
    granularity,
    since: sinceIso,
    buckets,
    totalEntries,
    totalChars,
    byKind,
    topSessions: topSessions.map((s) => ({
      session_id: s.session_id,
      n: s.n,
      chars: s.chars ?? 0,
    })),
  };
}

export function collectStats(db: DB, dbPath: string): Stats {
  const byKind = db
    .prepare(`SELECT kind, count(*) AS n FROM entries GROUP BY kind ORDER BY n DESC`)
    .all() as Array<{ kind: Kind; n: number }>;
  const topSessions = db
    .prepare(
      `SELECT session_id, count(*) AS n, max(ts) AS last_ts
         FROM entries GROUP BY session_id ORDER BY n DESC LIMIT 10`,
    )
    .all() as Array<{ session_id: string | null; n: number; last_ts: string }>;
  const byRelation = db
    .prepare(`SELECT relation, count(*) AS n FROM links GROUP BY relation ORDER BY n DESC`)
    .all() as Array<{ relation: Relation; n: number }>;

  const total = (db.prepare(`SELECT count(*) AS n FROM entries`).get() as { n: number }).n;
  const totalLinks = (db.prepare(`SELECT count(*) AS n FROM links`).get() as { n: number }).n;
  const superseded = (
    db.prepare(`SELECT count(*) AS n FROM entries WHERE superseded = 1`).get() as { n: number }
  ).n;
  const redacted = (
    db.prepare(`SELECT count(*) AS n FROM entries WHERE body = '[redacted]'`).get() as {
      n: number;
    }
  ).n;
  const withSourceSession = (
    db
      .prepare(`SELECT count(*) AS n FROM entries WHERE source_session_file IS NOT NULL`)
      .get() as { n: number }
  ).n;

  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const countSince = db.prepare(`SELECT count(*) AS n FROM entries WHERE ts >= ?`);
  const activity = {
    last24h: (countSince.get(iso(86400_000)) as { n: number }).n,
    last7d: (countSince.get(iso(7 * 86400_000)) as { n: number }).n,
    last30d: (countSince.get(iso(30 * 86400_000)) as { n: number }).n,
    allTime: total,
  };

  const schemaVersion = getUserVersion(db);

  let dbSizeBytes = 0;
  try {
    dbSizeBytes = statSync(dbPath).size;
  } catch {
    // ignore — file may not exist yet
  }

  return {
    dbPath,
    dbSizeBytes,
    schemaVersion,
    totalEntries: total,
    supersededEntries: superseded,
    redactedEntries: redacted,
    withSourceSession,
    byKind,
    topSessions,
    totalLinks,
    byRelation,
    activity,
  };
}

// ---------------------------------------------------------------------------
// Session-filter resolver — merges `session_id` (explicit) and `group`
// (named groups that expand to their member session_ids) for search/recent.
//
// Group CRUD lives in ./groups.ts because it's viewer-only (human curation)
// and should stay out of the MCP tool import graph.
// ---------------------------------------------------------------------------

/**
 * Merge args.session_id (explicit list) + args.group (expanded via groups.ts)
 * into a single deduplicated session_ids array. Returns null if neither is
 * set (meaning "no session filter"), or the merged array otherwise.
 */
function resolveSessionFilter(
  db: DB,
  args: { session_id?: string | string[]; group?: string | string[] },
): string[] | null {
  const explicit: string[] = args.session_id
    ? Array.isArray(args.session_id)
      ? args.session_id
      : [args.session_id]
    : [];
  const groupNames: string[] = args.group
    ? Array.isArray(args.group)
      ? args.group
      : [args.group]
    : [];
  if (explicit.length === 0 && groupNames.length === 0) return null;
  const fromGroups = groupNames.length > 0 ? expandGroupsToSessions(db, groupNames) : [];
  const merged = Array.from(new Set([...explicit, ...fromGroups]));
  return merged;
}

// Escape FTS5 query: quote each token to avoid operator injection, OR-join.
function buildFtsQuery(lemmatized: string): string {
  const tokens = lemmatized
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => t.replace(/"/g, ""));
  if (tokens.length === 0) return "";
  return tokens.map((t) => `"${t}"*`).join(" OR ");
}

type QueryParams = Record<string, string | number | null>;

export async function searchEntries(db: DB, args: SearchArgs): Promise<SearchResult> {
  const t0 = Date.now();
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
  const params: QueryParams = {};
  const wheres: string[] = [];

  let ftsJoin = "";
  let ftsQueryStr = "";
  if (args.query && args.query.trim().length > 0) {
    const lemmatized = await lemmatize(args.query);
    ftsQueryStr = buildFtsQuery(lemmatized);
    if (ftsQueryStr.length > 0) {
      ftsJoin = `JOIN entries_fts f ON f.rowid = e.id`;
      wheres.push(`entries_fts MATCH @fts`);
      params.fts = ftsQueryStr;
    }
  }

  if (args.kind) {
    const kinds = Array.isArray(args.kind) ? args.kind : [args.kind];
    if (kinds.length === 1) {
      wheres.push(`e.kind = @kind`);
      params.kind = kinds[0]!;
    } else if (kinds.length > 1) {
      const placeholders = kinds.map((_, i) => `@k${i}`).join(",");
      wheres.push(`e.kind IN (${placeholders})`);
      kinds.forEach((k, i) => (params[`k${i}`] = k));
    }
  }
  const sessionFilter = resolveSessionFilter(db, args);
  if (sessionFilter !== null) {
    if (sessionFilter.length === 0) {
      // An explicit empty set (e.g. empty group) should produce no results.
      wheres.push(`1 = 0`);
    } else {
      const placeholders = sessionFilter.map((_, i) => `@sid${i}`).join(",");
      wheres.push(`e.session_id IN (${placeholders})`);
      sessionFilter.forEach((v, i) => (params[`sid${i}`] = v));
    }
  }
  if (args.since) {
    wheres.push(`e.ts >= @since`);
    params.since = args.since;
  }
  if (!args.include_superseded) wheres.push(`e.superseded = 0`);
  if (args.tags && args.tags.length > 0) {
    for (let i = 0; i < args.tags.length; i++) {
      const key = `tag${i}`;
      wheres.push(`e.tags LIKE @${key}`);
      params[key] = `%"${args.tags[i]}"%`;
    }
  }

  const whereSQL = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";
  const order = ftsJoin
    ? `ORDER BY bm25(entries_fts, 2.0, 1.0, 1.5, 3.0, 1.5) ASC`
    : `ORDER BY e.ts DESC`;

  const sql = `
    SELECT e.id, e.ts, e.kind, e.title, e.tags, e.session_id
      ${ftsJoin ? `, bm25(entries_fts, 2.0, 1.0, 1.5, 3.0, 1.5) AS score` : `, 0 AS score`}
    FROM entries e
    ${ftsJoin}
    ${whereSQL}
    ${order}
    LIMIT @limit
  `;
  params.limit = limit;

  const rows = db.prepare(sql).all(params) as Array<{
    id: number;
    ts: string;
    kind: Kind;
    title: string;
    tags: string | null;
    session_id: string | null;
    score: number;
  }>;

  const hits: SearchHit[] = rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    kind: r.kind,
    title: r.title,
    tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
    score: r.score,
    session_id: r.session_id,
  }));

  const total = Date.now() - t0;
  log.debug("searchEntries", {
    query: args.query,
    fts: ftsQueryStr,
    hits: hits.length,
    limit,
    ms: total,
    degraded: isDegraded(),
  });
  if (total > SLOW_MS) log.warn("slow searchEntries", { ms: total, query: args.query });
  return { hits, degraded: isDegraded(), total: hits.length };
}

export function recentEntries(db: DB, args: RecentArgs): SearchResult {
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
  const wheres: string[] = [];
  const params: QueryParams = { limit };

  if (args.kind) {
    const kinds = Array.isArray(args.kind) ? args.kind : [args.kind];
    if (kinds.length === 1) {
      wheres.push(`kind = @kind`);
      params.kind = kinds[0]!;
    } else if (kinds.length > 1) {
      const placeholders = kinds.map((_, i) => `@k${i}`).join(",");
      wheres.push(`kind IN (${placeholders})`);
      kinds.forEach((k, i) => (params[`k${i}`] = k));
    }
  }
  const sessionFilter = resolveSessionFilter(db, args);
  if (sessionFilter !== null) {
    if (sessionFilter.length === 0) {
      wheres.push(`1 = 0`);
    } else {
      const placeholders = sessionFilter.map((_, i) => `@sid${i}`).join(",");
      wheres.push(`session_id IN (${placeholders})`);
      sessionFilter.forEach((v, i) => (params[`sid${i}`] = v));
    }
  }
  if (!args.include_superseded) wheres.push(`superseded = 0`);

  const whereSQL = wheres.length > 0 ? `WHERE ${wheres.join(" AND ")}` : "";
  const sql = `
    SELECT id, ts, kind, title, tags, session_id, 0 AS score
    FROM entries
    ${whereSQL}
    ORDER BY ts DESC
    LIMIT @limit
  `;

  const rows = db.prepare(sql).all(params) as Array<{
    id: number;
    ts: string;
    kind: Kind;
    title: string;
    tags: string | null;
    session_id: string | null;
    score: number;
  }>;

  const hits: SearchHit[] = rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    kind: r.kind,
    title: r.title,
    tags: r.tags ? (JSON.parse(r.tags) as string[]) : [],
    score: 0,
    session_id: r.session_id,
  }));

  return { hits, degraded: isDegraded(), total: hits.length };
}
