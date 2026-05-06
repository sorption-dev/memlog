/**
 * @internal
 *
 * Groups module — viewer/UI-facing CRUD for project groups.
 *
 * Nothing here is exposed through MCP tools. The LLM only *reads* groups via
 * the `group` parameter on journal_search / journal_recent and the
 * journal_context output (which lists known groups). Creation, editing, and
 * membership changes are editorial operations — the human curates them
 * through the viewer UI.
 *
 * Why a separate module:
 *   1. Physical boundary — MCP's server.ts imports from ./repo.js for every
 *      registered tool. This file stays out of that import graph, so adding
 *      a new MCP tool never accidentally exposes CRUD of groups.
 *   2. File name declares intent — anyone opening groups.ts understands this
 *      is human-curated editorial data, not an LLM capability.
 *   3. Scales — future admin-only concerns (imports, backups) mirror this
 *      pattern as their own modules.
 *
 * If an operation here ever becomes MCP-worthy, move it to repo.ts and
 * re-evaluate the token/schema cost.
 */
import type { DB } from "./db.js";
import { makeLogger } from "./log.js";
import type { ProjectGroup, ProjectGroupWithMembers } from "./types.js";

const log = makeLogger("groups");

interface GroupRow {
  id: number;
  name: string;
  description: string | null;
  color: string | null;
  ts: string;
}

function rowToGroup(r: GroupRow): ProjectGroup {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    color: r.color,
    ts: r.ts,
  };
}

export function listGroups(db: DB): ProjectGroupWithMembers[] {
  const rows = db
    .prepare(`SELECT * FROM project_groups ORDER BY name`)
    .all() as GroupRow[];
  const memberStmt = db.prepare(
    `SELECT session_id FROM project_group_members WHERE group_id = ?`,
  );
  const entryCountStmt = db.prepare(
    `SELECT count(*) AS n FROM entries
     WHERE session_id IN (SELECT session_id FROM project_group_members WHERE group_id = ?)`,
  );
  return rows.map((r) => {
    const members = (memberStmt.all(r.id) as Array<{ session_id: string }>).map(
      (m) => m.session_id,
    );
    const entry_count = (entryCountStmt.get(r.id) as { n: number }).n;
    return {
      ...rowToGroup(r),
      members,
      member_count: members.length,
      entry_count,
    };
  });
}

export function getGroupByName(db: DB, name: string): ProjectGroupWithMembers | null {
  const row = db
    .prepare(`SELECT * FROM project_groups WHERE name = ?`)
    .get(name) as GroupRow | undefined;
  if (!row) return null;
  const members = (
    db
      .prepare(`SELECT session_id FROM project_group_members WHERE group_id = ?`)
      .all(row.id) as Array<{ session_id: string }>
  ).map((m) => m.session_id);
  const entry_count = (
    db
      .prepare(
        `SELECT count(*) AS n FROM entries
         WHERE session_id IN (SELECT session_id FROM project_group_members WHERE group_id = ?)`,
      )
      .get(row.id) as { n: number }
  ).n;
  return {
    ...rowToGroup(row),
    members,
    member_count: members.length,
    entry_count,
  };
}

export function createGroup(
  db: DB,
  name: string,
  description?: string | null,
  color?: string | null,
): ProjectGroup {
  const info = db
    .prepare(
      `INSERT INTO project_groups (name, description, color)
       VALUES (@name, @description, @color)`,
    )
    .run({ name, description: description ?? null, color: color ?? null });
  const id = Number(info.lastInsertRowid);
  log.info("group created", { id, name });
  return rowToGroup(
    db.prepare(`SELECT * FROM project_groups WHERE id = ?`).get(id) as GroupRow,
  );
}

export function updateGroup(
  db: DB,
  name: string,
  patch: { name?: string; description?: string | null; color?: string | null },
): ProjectGroup | null {
  const existing = db
    .prepare(`SELECT * FROM project_groups WHERE name = ?`)
    .get(name) as GroupRow | undefined;
  if (!existing) return null;
  const nextName = patch.name !== undefined ? patch.name : existing.name;
  const description = patch.description !== undefined ? patch.description : existing.description;
  const color = patch.color !== undefined ? patch.color : existing.color;
  db.prepare(
    `UPDATE project_groups
        SET name = @name, description = @description, color = @color
      WHERE id = @id`,
  ).run({ id: existing.id, name: nextName, description, color });
  log.info("group updated", { id: existing.id, from: name, to: nextName });
  return rowToGroup(
    db.prepare(`SELECT * FROM project_groups WHERE id = ?`).get(existing.id) as GroupRow,
  );
}

export function deleteGroup(db: DB, name: string): boolean {
  const info = db.prepare(`DELETE FROM project_groups WHERE name = ?`).run(name);
  if (info.changes > 0) log.info("group deleted", { name });
  return info.changes > 0;
}

export function addGroupMember(db: DB, name: string, session_id: string): boolean {
  const group = db
    .prepare(`SELECT id FROM project_groups WHERE name = ?`)
    .get(name) as { id: number } | undefined;
  if (!group) throw new Error(`group '${name}' not found`);
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO project_group_members (group_id, session_id) VALUES (?, ?)`,
    )
    .run(group.id, session_id);
  if (info.changes > 0) log.info("group member added", { group: name, session_id });
  return info.changes > 0;
}

export function removeGroupMember(db: DB, name: string, session_id: string): boolean {
  const group = db
    .prepare(`SELECT id FROM project_groups WHERE name = ?`)
    .get(name) as { id: number } | undefined;
  if (!group) return false;
  const info = db
    .prepare(
      `DELETE FROM project_group_members WHERE group_id = ? AND session_id = ?`,
    )
    .run(group.id, session_id);
  if (info.changes > 0) log.info("group member removed", { group: name, session_id });
  return info.changes > 0;
}

/**
 * Expand group names → member session_ids. Throws if any named group is missing
 * (silent-empty would hide typos and produce confusing zero-result searches).
 *
 * Called from repo.ts when searchEntries/recentEntries receive a `group` arg.
 * It's the one function from this module that repo.ts is allowed to import.
 */
export function expandGroupsToSessions(db: DB, names: string[]): string[] {
  if (names.length === 0) return [];
  const placeholders = names.map(() => "?").join(",");
  const groupRows = db
    .prepare(`SELECT id, name FROM project_groups WHERE name IN (${placeholders})`)
    .all(...names) as Array<{ id: number; name: string }>;
  const foundNames = new Set(groupRows.map((g) => g.name));
  for (const n of names) {
    if (!foundNames.has(n)) throw new Error(`group '${n}' not found`);
  }
  if (groupRows.length === 0) return [];
  const memberRows = db
    .prepare(
      `SELECT DISTINCT session_id FROM project_group_members
       WHERE group_id IN (${groupRows.map(() => "?").join(",")})`,
    )
    .all(...groupRows.map((g) => g.id)) as Array<{ session_id: string }>;
  return memberRows.map((r) => r.session_id);
}

export interface SessionSummary {
  session_id: string;
  entry_count: number;
  last_ts: string;
  groups: string[];
}

/**
 * List every distinct session_id seen in the entries table, with per-session
 * counts + which project groups include it. The "Projects" page in the viewer
 * uses this to drive the full projects list.
 */
export function listSessions(db: DB): SessionSummary[] {
  const rows = db
    .prepare(
      `SELECT session_id, count(*) AS n, max(ts) AS last_ts
         FROM entries
        WHERE session_id IS NOT NULL
        GROUP BY session_id
        ORDER BY last_ts DESC`,
    )
    .all() as Array<{ session_id: string; n: number; last_ts: string }>;
  if (rows.length === 0) return [];

  const membership = db
    .prepare(
      `SELECT m.session_id, g.name
         FROM project_group_members m
         JOIN project_groups g ON g.id = m.group_id`,
    )
    .all() as Array<{ session_id: string; name: string }>;
  const bySession = new Map<string, string[]>();
  for (const r of membership) {
    const arr = bySession.get(r.session_id) ?? [];
    arr.push(r.name);
    bySession.set(r.session_id, arr);
  }

  return rows.map((r) => ({
    session_id: r.session_id,
    entry_count: r.n,
    last_ts: r.last_ts,
    groups: bySession.get(r.session_id) ?? [],
  }));
}

/** Groups a specific session belongs to — used in journal_context output. */
export function groupsContainingSession(db: DB, session_id: string): ProjectGroup[] {
  const rows = db
    .prepare(
      `SELECT g.* FROM project_groups g
       JOIN project_group_members m ON m.group_id = g.id
       WHERE m.session_id = ?
       ORDER BY g.name`,
    )
    .all(session_id) as GroupRow[];
  return rows.map(rowToGroup);
}
