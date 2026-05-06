import { Database } from "bun:sqlite";
import { mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { makeLogger } from "./log.js";

const log = makeLogger("db");

export type DB = Database;

/** bun:sqlite has no pragma() helper. Value pragmas go through a SELECT-style
 * query; mode pragmas (`journal_mode = WAL` etc.) go through exec(). */
export function getUserVersion(db: DB): number {
  const row = db.query("PRAGMA user_version").get() as
    | { user_version: number }
    | null;
  return row?.user_version ?? 0;
}
function setUserVersion(db: DB, v: number): void {
  // `?`-style bind doesn't work inside PRAGMA — inline the integer directly.
  // It's a Number, not user input, so no injection concern.
  db.exec(`PRAGMA user_version = ${Math.floor(v)}`);
}

const MIGRATIONS: string[] = [
  // v1 — initial schema
  `
  CREATE TABLE entries (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ts           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    session_id   TEXT,
    msg_ref      TEXT,
    kind         TEXT    NOT NULL CHECK (kind IN
                 ('decision','fact','preference','todo','context','question')),
    title        TEXT    NOT NULL,
    body         TEXT    NOT NULL,
    tags         TEXT,
    title_lemmas TEXT    NOT NULL,
    body_lemmas  TEXT    NOT NULL,
    superseded   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE links (
    from_id  INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    to_id    INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
    relation TEXT    NOT NULL CHECK (relation IN
             ('supersedes','depends_on','contradicts','refines','answers')),
    ts       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (from_id, to_id, relation)
  );

  CREATE INDEX idx_entries_ts      ON entries(ts DESC);
  CREATE INDEX idx_entries_kind_ts ON entries(kind, ts DESC);
  CREATE INDEX idx_entries_session ON entries(session_id, ts DESC);
  CREATE INDEX idx_entries_super   ON entries(superseded);
  CREATE INDEX idx_links_to        ON links(to_id);
  CREATE INDEX idx_links_from      ON links(from_id);

  CREATE VIRTUAL TABLE entries_fts USING fts5(
    title_lemmas, body_lemmas, tags,
    title, body,
    content='entries', content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
  );

  CREATE TRIGGER entries_ai AFTER INSERT ON entries BEGIN
    INSERT INTO entries_fts(rowid, title_lemmas, body_lemmas, tags, title, body)
    VALUES (new.id, new.title_lemmas, new.body_lemmas, coalesce(new.tags,''), new.title, new.body);
  END;

  CREATE TRIGGER entries_ad AFTER DELETE ON entries BEGIN
    INSERT INTO entries_fts(entries_fts, rowid, title_lemmas, body_lemmas, tags, title, body)
    VALUES ('delete', old.id, old.title_lemmas, old.body_lemmas, coalesce(old.tags,''), old.title, old.body);
  END;

  CREATE TRIGGER entries_au AFTER UPDATE ON entries BEGIN
    INSERT INTO entries_fts(entries_fts, rowid, title_lemmas, body_lemmas, tags, title, body)
    VALUES ('delete', old.id, old.title_lemmas, old.body_lemmas, coalesce(old.tags,''), old.title, old.body);
    INSERT INTO entries_fts(rowid, title_lemmas, body_lemmas, tags, title, body)
    VALUES (new.id, new.title_lemmas, new.body_lemmas, coalesce(new.tags,''), new.title, new.body);
  END;

  CREATE TRIGGER links_ai_supersede AFTER INSERT ON links
    WHEN new.relation = 'supersedes'
  BEGIN
    UPDATE entries SET superseded = 1 WHERE id = new.to_id;
  END;
  `,

  // v2 — track which Claude Code session file the entry was written from,
  // so you can jump back to the actual conversation that produced it.
  `
  ALTER TABLE entries ADD COLUMN source_session_file TEXT;
  CREATE INDEX idx_entries_source_session ON entries(source_session_file);
  `,

  // v3 — project groups. Named collections of session_ids so you can query
  // across related projects as one. No MCP CRUD tools — LLM only reads groups
  // via journal_context / group= parameter on search/recent. Create/edit
  // through the viewer UI.
  `
  CREATE TABLE project_groups (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT    NOT NULL UNIQUE,
    description  TEXT,
    color        TEXT,
    ts           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE project_group_members (
    group_id     INTEGER NOT NULL REFERENCES project_groups(id) ON DELETE CASCADE,
    session_id   TEXT    NOT NULL,
    ts           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    PRIMARY KEY (group_id, session_id)
  );

  CREATE INDEX idx_pgm_session ON project_group_members(session_id);
  `,
];

export function openDB(path: string): DB {
  mkdirSync(dirname(path), { recursive: true });
  const t0 = Date.now();
  // strict:true — allows binding named params (@name) via a bare object key
  // like { name: "…" } instead of { "@name": "…" }. Matches better-sqlite3's
  // ergonomics so repo.ts stays runtime-agnostic.
  const db = new Database(path, { strict: true });
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");
  migrate(db);

  let fileSize = 0;
  try {
    fileSize = statSync(path).size;
  } catch {
    // new DB
  }
  const entryCount = (db.prepare(`SELECT COUNT(*) AS n FROM entries`).get() as { n: number }).n;
  const linkCount = (db.prepare(`SELECT COUNT(*) AS n FROM links`).get() as { n: number }).n;
  const supersededCount = (
    db.prepare(`SELECT COUNT(*) AS n FROM entries WHERE superseded = 1`).get() as { n: number }
  ).n;
  const version = getUserVersion(db);

  log.info("opened", {
    path,
    sizeBytes: fileSize,
    entries: entryCount,
    links: linkCount,
    superseded: supersededCount,
    schemaVersion: version,
    openMs: Date.now() - t0,
  });
  return db;
}

function migrate(db: DB): void {
  const current = getUserVersion(db);
  if (current < MIGRATIONS.length) {
    log.info("migrating", { from: current, to: MIGRATIONS.length });
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    const sql = MIGRATIONS[v];
    if (!sql) continue;
    const t0 = Date.now();
    db.exec("BEGIN");
    try {
      db.exec(sql);
      setUserVersion(db, v + 1);
      db.exec("COMMIT");
      log.info("migration applied", { version: v + 1, ms: Date.now() - t0 });
    } catch (err) {
      db.exec("ROLLBACK");
      log.error("migration failed", { version: v + 1, error: (err as Error).message });
      throw err;
    }
  }
}

export function resolveDBPath(): string {
  const env = process.env.MEMLOG_DB;
  if (env && env.length > 0) return env;
  return `${process.cwd()}/data/db.sqlite`;
}
