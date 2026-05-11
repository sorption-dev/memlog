import { execFileSync } from "node:child_process";
import { basename } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { detectCurrentSessionFile } from "./claude-session.js";
import type { DB } from "./db.js";
import { groupsContainingSession, listGroups } from "./groups.js";
import { makeLogger } from "./log.js";
import { morphDiagnostic, morphStats, morphStatus } from "./morph.js";
import {
  addLink,
  collectStats,
  getEntry,
  getEntryWithNeighbors,
  recentEntries,
  redactEntry,
  searchEntries,
  writeEntry,
} from "./repo.js";
import { KINDS, RELATIONS } from "./types.js";

function tryExec(cmd: string, args: string[], cwd: string): string | null {
  try {
    return execFileSync(cmd, args, { cwd, encoding: "utf8", timeout: 2000 }).trim();
  } catch {
    return null;
  }
}

function detectSessionId(): string {
  const cwd = process.cwd();
  const gitRoot = tryExec("git", ["rev-parse", "--show-toplevel"], cwd);
  return basename(gitRoot ?? cwd);
}

function detectContext(db: DB) {
  const cwd = process.cwd();
  const gitRoot = tryExec("git", ["rev-parse", "--show-toplevel"], cwd);
  const gitRemote = gitRoot
    ? tryExec("git", ["remote", "get-url", "origin"], gitRoot)
    : null;
  const gitBranch = gitRoot
    ? tryExec("git", ["rev-parse", "--abbrev-ref", "HEAD"], gitRoot)
    : null;
  const suggestedProjectName = basename(gitRoot ?? cwd);

  const recentSessions = db
    .prepare(
      `SELECT session_id, count(*) AS n, max(ts) AS last_ts
       FROM entries
       WHERE session_id IS NOT NULL
       GROUP BY session_id
       ORDER BY last_ts DESC
       LIMIT 10`,
    )
    .all() as Array<{ session_id: string; n: number; last_ts: string }>;

  const currentProjectEntries = recentSessions.find(
    (r) => r.session_id === suggestedProjectName,
  );

  // Best-effort: newest .jsonl in ~/.claude/projects/<slug>/ modified within 30 min.
  const session = detectCurrentSessionFile(cwd);

  // All project groups + which ones contain the current suggestedProjectName.
  // This tells the LLM: "there's a group 'enapter' that includes your current
  // project — use group:'enapter' to search across related projects."
  const groups = listGroups(db).map((g) => ({
    name: g.name,
    description: g.description,
    member_count: g.member_count,
    entry_count: g.entry_count,
    members: g.members,
  }));
  const groupsContainingCurrent = groupsContainingSession(db, suggestedProjectName).map(
    (g) => g.name,
  );

  return {
    cwd,
    gitRoot,
    gitRemote,
    gitBranch,
    suggestedProjectName,
    currentProjectHasEntries: currentProjectEntries != null,
    currentProjectEntryCount: currentProjectEntries?.n ?? 0,
    recentSessions,
    claudeCode: process.env.CLAUDECODE === "1",
    clientEntrypoint: process.env.CLAUDE_CODE_ENTRYPOINT ?? null,
    detectedSessionFile: session?.path ?? null,
    detectedSessionAgeSec: session ? Math.round(session.ageMs / 1000) : null,
    groups,
    groupsContainingCurrent,
  };
}

const log = makeLogger("mcp");

function summarizeArgs(a: Record<string, unknown>): Record<string, unknown> {
  // Keep log lines readable — truncate long string fields.
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(a)) {
    if (typeof v === "string") {
      out[k] = v.length > 60 ? v.slice(0, 60) + "…" : v;
    } else if (Array.isArray(v)) {
      out[k] = `[${v.length}]`;
    } else if (v != null && typeof v !== "object") {
      out[k] = v;
    } else if (v != null) {
      out[k] = "{...}";
    }
  }
  return out;
}

async function instrumented<T>(
  name: string,
  args: Record<string, unknown>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const t0 = Date.now();
  log.info(`call: ${name}`, summarizeArgs(args));
  try {
    const result = await fn();
    log.info(`done: ${name}`, { ms: Date.now() - t0 });
    return result;
  } catch (err) {
    log.error(`fail: ${name}`, {
      ms: Date.now() - t0,
      error: (err as Error).message,
    });
    throw err;
  }
}

function morphWarningBanner(): string | null {
  if (morphStatus() !== "degraded") return null;
  const d = morphDiagnostic();
  return [
    "⚠️  MORPHOLOGY DEGRADED — Russian search recall will be poor.",
    `   Last error: ${d.lastError ?? "unknown"}`,
    `   Last error at: ${d.lastErrorAt ?? "-"}`,
    `   Backend: ${d.backend}${d.pyodideVersion ? ` ${d.pyodideVersion}` : ""}`,
    "   Fix: restart this MCP server (quit/reopen Claude Desktop or",
    "        `claude mcp restart memlog`). Search still works in ASCII-lowercase",
    "        fallback, but queries like 'решение' won't match 'решения' until fixed.",
  ].join("\n");
}

export const SERVER_INSTRUCTIONS = `
You have a persistent personal journal (memlog) accessible through 8 tools.
WRITING is proactive (the user won't remind you to log decisions/facts).
READING is on-demand only — wait for the user to ask before pulling
journal context into the conversation.

WHEN TO READ FROM THE JOURNAL (journal_context, journal_recent,
journal_search, journal_get):
• ONLY when the user explicitly asks about the journal / memlog
  ("что в журнале?", "вспомни из мемлога", "check the journal",
  "what did we decide last time?", "recall from memory", etc.).
• DO NOT call journal_context or journal_recent automatically at the
  start of a session. Do not "restore thread" preemptively. The user
  will ask if they want past context pulled in.
• You DO NOT need journal_context just to write — session_id is
  auto-derived from cwd (basename of git root or cwd). Just call
  journal_write directly. Only call journal_context when the user is
  asking about journal contents OR you genuinely don't know what
  project you're in (e.g. cross-project queries).

When reading across projects: pass session_id as an array
["projA","projB"], OR use group="NAME" for a pre-defined project group
(see journal_context.groups / groupsContainingCurrent). Groups are
created by the user via the viewer UI — you only read them.

WHEN TO CALL journal_write (proactively, without asking):
• decision — user chose a direction ("let's go with X", "окей, делаем Y")
• fact — IMMUTABLE truth about the world/project that won't change based
  on future actions. "pymorphy3 has property Y", "our schema is v3".
  NOT forward-looking.
• preference — how the user likes to work (repeatable pattern)
• todo — specific future action. Must start with a verb, have a concrete
  completion state, ideally a trigger condition ("add X WHEN Y happens").
• context — reference material for future decisions, not itself a
  decision/fact/todo. Use sparingly — usually split into the other kinds.
• question — open question without an answer yet

KIND SELECTION RUBRIC — ask yourself before writing:
  Describes what IS (property, state) and won't change → fact
  Describes what WILL BE (a planned action) → todo
  Describes what WAS decided → decision
  Describes HOW the user works → preference
  If entry mixes types (e.g. library overview + planned features) —
  SPLIT into separate entries. One entry = one intent.

KEEP ENTRIES SHORT — you (LLM) already know general domain knowledge.
Future-you reading this doesn't need a tutorial. Write only:
  ✓ Project-specific reasoning ("why WE chose X")
  ✓ Trigger conditions ("add X when Y")
  ✓ Non-obvious gotchas specific to this setup
  ✗ Don't recap what libraries/tools do in general
  ✗ Don't explain well-known concepts
  ✗ Don't list alternatives that weren't seriously considered
Target: title ≤ 80 chars, body 2-6 sentences (~200-500 chars) for most
entries. Go longer only when there's genuinely unique reasoning to
preserve.

DO NOT log: your own internal reasoning, rejected alternatives (unless
the rejection itself was the meaningful decision), or trivial rephrasings.

SESSION_ID: leave it empty in journal_write — the server auto-derives
it from cwd. Pass it explicitly only when intentionally writing into a
different project than the current cwd. Never invent a session_id.

LINKING DECISIONS (optional, NOT default):
Do NOT preemptively journal_search before writing. Add links=[] only
when (a) the user explicitly references a prior decision/fact, or
(b) relevant entries are already visible in this conversation from a
user-requested search. Available relations:
  • depends_on — this decision rests on that fact / prior decision
  • supersedes — replaces an older decision (hidden from default search)
  • refines — clarifies without replacing
  • contradicts — flags a conflict you noticed
  • answers — links a question entry to its resolving decision/fact

INLINE REFERENCES TO OTHER ENTRIES (in body text):
When the body's narrative needs to mention a specific entry — not a
formal graph relation, just a "see also" or "as decided in …" — write
it as a markdown link to its viewer path:

  see also [why we picked SQLite](/entry/42)
  this supersedes the earlier choice in [#7](/entry/7)

The viewer renders these as clickable links: plain click navigates in
place, Ctrl/Cmd+click (or middle-click) pops the entry in a separate
window. Use this freely for narrative flow; reserve links=[] for the
five typed relations above.

Write entries in the user's language. Bodies stand alone — readable
without this chat context, but DON'T over-explain things the reader
(future-LLM or the user) already knows.
`.trim();

const KIND_ENUM = z.enum(KINDS as unknown as [string, ...string[]]);
const REL_ENUM = z.enum(RELATIONS as unknown as [string, ...string[]]);

const LinkInput = z.object({
  to_id: z.number().int().positive(),
  relation: REL_ENUM,
});

export function buildServer(db: DB): McpServer {
  const server = new McpServer(
    { name: "memlog", version: "0.1.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    "journal_context",
    {
      title: "Detect current project and journal context",
      description:
        "Returns the MCP server's current working directory, git root/remote/branch, " +
        "a suggestedProjectName (basename of git root or cwd), recent session_ids " +
        "in the journal with entry counts, and project groups. " +
        "DO NOT call this preemptively at session start. Call it ONLY when the user " +
        "explicitly asks about journal contents / what's recorded, OR when you need " +
        "to discover other projects' session_ids for a cross-project query. " +
        "You do NOT need this before journal_write — session_id is auto-derived " +
        "from cwd server-side.",
      inputSchema: {},
    },
    async () =>
      instrumented("journal_context", {}, async () => {
        const ctx = detectContext(db);
        const lines: string[] = [
          `cwd:              ${ctx.cwd}`,
          `gitRoot:          ${ctx.gitRoot ?? "-"}`,
          `gitRemote:        ${ctx.gitRemote ?? "-"}`,
          `gitBranch:        ${ctx.gitBranch ?? "-"}`,
          `suggestedProject: ${ctx.suggestedProjectName}`,
          `claudeCode env:   ${ctx.claudeCode} (${ctx.clientEntrypoint ?? "-"})`,
          `sessionFile:      ${ctx.detectedSessionFile ?? "- (none active in last 30 min)"}`,
          ctx.detectedSessionFile ? `  (${ctx.detectedSessionAgeSec}s since last modified)` : "",
          "",
          `Current project (${ctx.suggestedProjectName}) in journal: ${
            ctx.currentProjectHasEntries
              ? `${ctx.currentProjectEntryCount} entries`
              : "no entries yet"
          }`,
          "",
          "Recent sessions in journal:",
          ...ctx.recentSessions.map(
            (s) => `  ${s.session_id} — ${s.n} entries, last ${s.last_ts.slice(0, 16)}`,
          ),
          "",
          ctx.groups.length > 0
            ? `Project groups (use group="NAME" on search/recent to query across members):`
            : "No project groups defined yet.",
          ...ctx.groups.map(
            (g) =>
              `  ${g.name} — ${g.member_count} members, ${g.entry_count} entries` +
              (g.description ? ` · ${g.description}` : "") +
              (ctx.groupsContainingCurrent.includes(g.name) ? " [current project is in this group]" : ""),
          ),
        ].filter(Boolean);
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          structuredContent: ctx as unknown as Record<string, unknown>,
        };
      }),
  );

  server.registerTool(
    "journal_write",
    {
      title: "Write a journal entry",
      description:
        "Record a decision, fact, preference, todo, context note, or open question. " +
        "Call this PROACTIVELY whenever the user makes a choice, states something meaningful " +
        "about themselves/the project, commits to a task, or asks an open question. " +
        "Do NOT call for your own reasoning or rejected options. Write in the user's language. " +
        "session_id is auto-derived from cwd — leave it empty. " +
        "Do NOT preemptively journal_search before writing. Only pass links=[] if the " +
        "user explicitly references prior work, OR if related entries are already visible " +
        "in this conversation from an earlier user-requested search.",
      inputSchema: {
        kind: KIND_ENUM.describe(
          "decision | fact | preference | todo | context | question",
        ),
        title: z.string().min(1).max(200).describe("Short title, ≤ 80 chars recommended"),
        body: z
          .string()
          .min(1)
          .describe(
            "Self-contained body — must read without chat context. To " +
              "mention another entry inline (narrative reference, not a " +
              "typed graph edge), use a markdown link to its viewer path: " +
              '`[label](/entry/N)`. The viewer turns these into clickable ' +
              "links — plain click navigates, Ctrl/Cmd+click pops a new " +
              "window. Reserve the `links` parameter for the five typed " +
              "relations (depends_on / supersedes / refines / contradicts / " +
              "answers).",
          ),
        tags: z.array(z.string()).optional().describe("Free-form tags for later filtering"),
        session_id: z
          .string()
          .optional()
          .describe(
            "Project path / git repo name / chat topic — for grouping. " +
              "If omitted, the server auto-derives it from cwd (basename of git " +
              "root, or basename of cwd if not in a repo). Pass explicitly only " +
              "when you want to write into a different project than the cwd.",
          ),
        msg_ref: z.string().optional().describe("Optional anchor inside the session"),
        source_session_file: z
          .string()
          .optional()
          .describe(
            "Absolute path to the Claude Code .jsonl session file that produced " +
              "this entry. If omitted, the server auto-detects the newest .jsonl in " +
              "~/.claude/projects/<slug>/ modified within 30 min. Lets you jump " +
              "back to the conversation later.",
          ),
        links: z
          .array(LinkInput)
          .optional()
          .describe("Graph edges from this entry to existing ones"),
      },
    },
    async (args) =>
      instrumented("journal_write", args as Record<string, unknown>, async () => {
      const autoSession =
        args.source_session_file ?? detectCurrentSessionFile(process.cwd())?.path ?? undefined;
      const sessionId = args.session_id ?? detectSessionId();
      const entry = await writeEntry(db, {
        kind: args.kind as (typeof KINDS)[number],
        title: args.title,
        body: args.body,
        tags: args.tags,
        session_id: sessionId,
        msg_ref: args.msg_ref,
        source_session_file: autoSession,
        links: args.links?.map((l) => ({
          to_id: l.to_id,
          relation: l.relation as (typeof RELATIONS)[number],
        })),
      });
      const banner = morphWarningBanner();
      const text = `Wrote entry #${entry.id} (${entry.kind}): ${entry.title}${
        banner ? "\n\nNOTE: entry indexed in DEGRADED mode — search recall for this entry will be weaker until morphology is fixed.\n" + banner : ""
      }`;
      const diag = morphDiagnostic();
      return {
        content: [{ type: "text", text }],
        structuredContent: {
          id: entry.id,
          ts: entry.ts,
          kind: entry.kind,
          title: entry.title,
          morph: {
            status: diag.status,
            lastError: diag.lastError,
            degraded: diag.status === "degraded",
          },
        } as Record<string, unknown>,
      };
      }),
  );

  server.registerTool(
    "journal_search",
    {
      title: "Search the journal",
      description:
        "Full-text search with Russian morphology (pymorphy3 lemmatization) and filters. " +
        "Returns compact rows WITHOUT body to save tokens — use journal_get to read a specific entry. " +
        "Call at the start of a session to restore context. Call BEFORE writing a decision " +
        "to find related prior entries to link to.",
      inputSchema: {
        query: z.string().optional().describe("Free text — ru/en mixed supported"),
        tags: z.array(z.string()).optional().describe("Filter: all tags must be present"),
        kind: KIND_ENUM.optional(),
        session_id: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe(
            "String OR array. Pass an array to scope to multiple related projects: " +
              '["proj-a","proj-b"] — OR-semantics, returns entries from any of them.',
          ),
        group: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe(
            "Named project group(s). Expands to all member session_ids and " +
              "is OR-merged with session_id. Group names listed in " +
              "journal_context.groups. Errors if a name doesn't exist.",
          ),
        since: z.string().optional().describe("ISO8601 lower bound, e.g. 2026-03-01"),
        include_superseded: z
          .boolean()
          .optional()
          .describe("Default false — hides entries replaced by supersedes links"),
        limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
      },
    },
    async (args) =>
      instrumented("journal_search", args as Record<string, unknown>, async () => {
      const result = await searchEntries(db, {
        query: args.query,
        tags: args.tags,
        kind: args.kind as (typeof KINDS)[number] | undefined,
        session_id: args.session_id,
        group: args.group,
        since: args.since,
        include_superseded: args.include_superseded,
        limit: args.limit,
      });
      log.info("search result", {
        hits: result.hits.length,
        degraded: result.degraded,
        hasQuery: !!args.query,
      });
      const lines = result.hits.map(
        (h) =>
          `#${h.id} [${h.kind}] ${h.ts.slice(0, 10)} — ${h.title}` +
          (h.tags.length > 0 ? ` {${h.tags.join(",")}}` : "") +
          (h.session_id ? ` (${h.session_id})` : ""),
      );
      const header = `${result.hits.length} result(s)`;
      const banner = morphWarningBanner();
      const parts: string[] = [];
      if (banner) parts.push(banner, "");
      parts.push(header, ...lines);
      const diag = morphDiagnostic();
      return {
        content: [{ type: "text", text: parts.join("\n") }],
        structuredContent: {
          hits: result.hits as unknown as Record<string, unknown>[],
          degraded: result.degraded,
          morph: {
            status: diag.status,
            lastError: diag.lastError,
          },
        },
      };
      }),
  );

  server.registerTool(
    "journal_get",
    {
      title: "Get one entry by id",
      description:
        "Retrieve a single entry with full body. With with_neighbors=true, also returns " +
        "all 1-hop graph edges (incoming + outgoing) — use this to see 'why was this decided' " +
        "and 'what does this support'.",
      inputSchema: {
        id: z.number().int().positive(),
        with_neighbors: z.boolean().optional().describe("Default false"),
      },
    },
    async (args) =>
      instrumented("journal_get", args as Record<string, unknown>, async () => {
      const withNeighbors = args.with_neighbors === true;
      const entry = withNeighbors
        ? getEntryWithNeighbors(db, args.id)
        : getEntry(db, args.id);
      if (!entry) {
        log.warn("journal_get: entry not found", { id: args.id });
        return {
          content: [{ type: "text", text: `Entry #${args.id} not found` }],
          isError: true,
        };
      }
      const lines: string[] = [
        `#${entry.id} [${entry.kind}] ${entry.ts}`,
        `session: ${entry.session_id ?? "-"}`,
        `tags: ${entry.tags.join(", ") || "-"}`,
        `superseded: ${entry.superseded}`,
        `sourceSessionFile: ${entry.source_session_file ?? "-"}`,
        "",
        `TITLE: ${entry.title}`,
        "",
        entry.body,
      ];
      if (withNeighbors && "outgoing" in entry) {
        const n = entry as import("./types.js").EntryWithNeighbors;
        lines.push("", "OUTGOING:");
        for (const e of n.outgoing) lines.push(`  -[${e.relation}]→ #${e.to_id} ${e.title}`);
        lines.push("INCOMING:");
        for (const e of n.incoming) lines.push(`  #${e.from_id} [${e.relation}]→ this: ${e.title}`);
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        structuredContent: { entry: entry as unknown as Record<string, unknown> },
      };
      }),
  );

  server.registerTool(
    "journal_link",
    {
      title: "Add a graph edge between two entries",
      description:
        "Link two existing entries after the fact. Use when you realize today's decision " +
        "supersedes an older one, or a past fact actually supports a current decision.",
      inputSchema: {
        from_id: z.number().int().positive(),
        to_id: z.number().int().positive(),
        relation: REL_ENUM,
      },
    },
    async (args) =>
      instrumented("journal_link", args as Record<string, unknown>, async () => {
      addLink(db, args.from_id, args.to_id, args.relation as (typeof RELATIONS)[number]);
      return {
        content: [
          {
            type: "text",
            text: `Linked #${args.from_id} -[${args.relation}]→ #${args.to_id}`,
          },
        ],
      };
      }),
  );

  server.registerTool(
    "journal_recent",
    {
      title: "Recent entries",
      description:
        "Return the latest entries ordered by timestamp. Call at the start of a new session " +
        "to restore recent thread of thought. Filter by session_id to scope to a specific " +
        "project/chat.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().describe("Default 20"),
        kind: KIND_ENUM.optional(),
        session_id: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe("String OR array of session_ids (OR-semantics)."),
        group: z
          .union([z.string(), z.array(z.string())])
          .optional()
          .describe(
            "Named project group(s) — expands to member sessions, OR-merged " +
              "with session_id. Available group names: journal_context.groups.",
          ),
        include_superseded: z.boolean().optional(),
      },
    },
    async (args) =>
      instrumented("journal_recent", args as Record<string, unknown>, async () => {
      const result = recentEntries(db, {
        limit: args.limit,
        kind: args.kind as (typeof KINDS)[number] | undefined,
        session_id: args.session_id,
        group: args.group,
        include_superseded: args.include_superseded,
      });
      log.info("recent result", { hits: result.hits.length });
      const lines = result.hits.map(
        (h) =>
          `#${h.id} [${h.kind}] ${h.ts.slice(0, 16)} — ${h.title}` +
          (h.session_id ? ` (${h.session_id})` : ""),
      );
      return {
        content: [
          { type: "text", text: [`${result.hits.length} recent`, ...lines].join("\n") },
        ],
        structuredContent: {
          hits: result.hits as unknown as Record<string, unknown>[],
        },
      };
      }),
  );

  server.registerTool(
    "journal_redact",
    {
      title: "Redact an entry — zero its content, keep its links",
      description:
        "Overwrites an entry's title/body/tags/lemmas with a '[redacted]' marker " +
        "while preserving its id, ts, session_id, kind, links (both directions), " +
        "superseded flag, and source_session_file. Use this INSTEAD of a direct " +
        "DELETE when the entry may contain PII or sensitive data — it keeps the " +
        "graph intact so other entries that depend on / supersede / reference this " +
        "one keep their edges. Idempotent. The row still shows up in journal_recent " +
        "(for audit) but won't match text search.",
      inputSchema: {
        id: z.number().int().positive(),
      },
    },
    async (args) =>
      instrumented("journal_redact", args as Record<string, unknown>, async () => {
        const entry = redactEntry(db, args.id);
        if (!entry) {
          return {
            content: [{ type: "text", text: `Entry #${args.id} not found` }],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: "text",
              text:
                `Redacted entry #${entry.id} (${entry.kind}, session=${entry.session_id ?? "-"}). ` +
                `Links preserved: use journal_get(id=${entry.id}, with_neighbors=true) to see them.`,
            },
          ],
          structuredContent: {
            id: entry.id,
            kind: entry.kind,
            session_id: entry.session_id,
            ts: entry.ts,
          } as Record<string, unknown>,
        };
      }),
  );

  server.registerTool(
    "journal_stats",
    {
      title: "Journal health and content statistics",
      description:
        "Returns aggregate stats for the journal: DB size, schema version, total " +
        "entries by kind, top session_ids, link counts by relation, recent activity " +
        "(24h / 7d / 30d), redacted/superseded counts, plus morphology status " +
        "(python ready? how many requests served? how many fallbacks due to failures?). " +
        "Useful for 'is the memlog healthy?' checks and for knowing what topics/projects " +
        "have the richest history.",
      inputSchema: {},
    },
    async () =>
      instrumented("journal_stats", {}, async () => {
        const s = collectStats(db, process.env.MEMLOG_DB ?? "");
        const m = morphStats();
        const md = morphDiagnostic();
        const kb = (n: number) => (n / 1024).toFixed(1) + " KB";
        const lines: string[] = [
          `DB:       ${s.dbPath || "(resolved at runtime)"}  (${kb(s.dbSizeBytes)}, schema v${s.schemaVersion})`,
          `Entries:  ${s.totalEntries} total  (superseded=${s.supersededEntries}, redacted=${s.redactedEntries}, with_session_file=${s.withSourceSession})`,
          `Activity: 24h=${s.activity.last24h}  7d=${s.activity.last7d}  30d=${s.activity.last30d}`,
          "",
          "By kind:",
          ...s.byKind.map((r) => `  ${r.kind.padEnd(12)} ${r.n}`),
          "",
          "Top sessions:",
          ...s.topSessions.map(
            (r) =>
              `  ${(r.session_id ?? "-").padEnd(30)} ${String(r.n).padStart(4)}  last ${r.last_ts?.slice(0, 16) ?? "-"}`,
          ),
          "",
          `Links: ${s.totalLinks} total`,
          ...s.byRelation.map((r) => `  ${r.relation.padEnd(12)} ${r.n}`),
          "",
          `Morphology: status=${morphStatus()}  backend=${md.backend}${md.pyodideVersion ? ` ${md.pyodideVersion}` : ""}`,
          `            requests=${m.requests}  tokens=${m.tokens}  avgMs=${m.avgMs}  fallbacks=${m.fallbacks}`,
          md.lastError ? `            lastError=${md.lastError} (at ${md.lastErrorAt})` : "",
        ].filter(Boolean);
        return {
          content: [{ type: "text", text: lines.join("\n") }],
          structuredContent: {
            ...s,
            morph: { ...m, status: morphStatus(), diagnostic: md },
          } as unknown as Record<string, unknown>,
        };
      }),
  );

  return server;
}
