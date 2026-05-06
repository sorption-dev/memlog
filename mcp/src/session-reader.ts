/**
 * Parses a Claude Code session .jsonl and returns a window of messages around
 * a target timestamp — used by the /api/entry/:id/source endpoint to show
 * "the conversation that produced this journal entry" on the Entry page.
 *
 * Aggressive filtering: Claude Code sessions are mostly tool_use/tool_result
 * pairs with huge JSON blobs. Raw transcript is unreadable. We keep
 *   - user text messages (actual human prompts),
 *   - assistant text + thinking blocks,
 *   - condensed `journal_*` tool calls (they often ARE the cause of the entry),
 *   - a "(+N tool calls)" hint on mixed assistant messages.
 * Everything else (tool_result JSON, unrelated tool_use, sidechains, system
 * chatter) is dropped.
 *
 * Streams line-by-line so 300MB+ session files don't balloon memory.
 */
import { createReadStream, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

/**
 * Whitelist guard — only Claude Code transcripts are valid input here. The
 * file path is stored in the DB (and may originate from `journal_write` over
 * MCP), so without this check a malicious caller could write
 * `source_session_file: "/etc/passwd"` and then read arbitrary files via the
 * `entry_source` endpoint.
 *
 * Allowed locations: under `~/.claude/projects/` with a `.jsonl` extension.
 */
const SESSIONS_ROOT = join(homedir(), ".claude", "projects") + "/";
function isAllowedSessionPath(filePath: string): boolean {
  const abs = resolve(filePath);
  return abs.startsWith(SESSIONS_ROOT) && abs.endsWith(".jsonl");
}

export type MessageRole = "user" | "assistant" | "tool" | "system" | "unknown";

export interface SessionMessage {
  ts: string;
  role: MessageRole;
  type: string;
  preview: string;
  isTarget?: boolean;
}

export interface SessionView {
  path: string;
  fileExists: boolean;
  totalMessages: number;
  targetIndex: number | null;
  windowStart: number;
  windowEnd: number;
  messages: SessionMessage[];
}

const MAX_PREVIEW_LEN = 800;

type AnyRec = Record<string, unknown>;

function asRec(v: unknown): AnyRec | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as AnyRec) : null;
}

function firstString(...vals: unknown[]): string {
  for (const v of vals) if (typeof v === "string" && v.length > 0) return v;
  return "";
}

interface ToolUse {
  name: string;
  input: AnyRec | null;
}

interface Classified {
  text: string;
  toolUses: ToolUse[];
  hasToolResult: boolean;
  totalBlocks: number;
  toolUseBlocks: number;
  toolResultBlocks: number;
}

function classify(obj: AnyRec): Classified {
  const inner = asRec(obj.message) ?? obj;
  const content = inner.content ?? obj.content;

  if (typeof content === "string") {
    return {
      text: content,
      toolUses: [],
      hasToolResult: false,
      totalBlocks: 1,
      toolUseBlocks: 0,
      toolResultBlocks: 0,
    };
  }
  if (!Array.isArray(content)) {
    return {
      text: "",
      toolUses: [],
      hasToolResult: false,
      totalBlocks: 0,
      toolUseBlocks: 0,
      toolResultBlocks: 0,
    };
  }

  const textParts: string[] = [];
  const toolUses: ToolUse[] = [];
  let hasToolResult = false;
  let totalBlocks = 0;
  let toolUseBlocks = 0;
  let toolResultBlocks = 0;

  for (const raw of content) {
    if (typeof raw === "string") {
      totalBlocks++;
      textParts.push(raw);
      continue;
    }
    const b = asRec(raw);
    if (!b) continue;
    totalBlocks++;
    const type = firstString(b.type);
    if (type === "text" && typeof b.text === "string") {
      textParts.push(b.text);
    } else if (type === "thinking" && typeof b.thinking === "string") {
      textParts.push(`(thinking) ${b.thinking}`);
    } else if (type === "tool_use") {
      toolUseBlocks++;
      if (typeof b.name === "string") {
        toolUses.push({ name: b.name, input: asRec(b.input) });
      }
    } else if (type === "tool_result") {
      hasToolResult = true;
      toolResultBlocks++;
    }
  }

  return {
    text: textParts.join("\n\n"),
    toolUses,
    hasToolResult,
    totalBlocks,
    toolUseBlocks,
    toolResultBlocks,
  };
}

/**
 * Render a tool_use block as a short one-liner. For journal_* tools we dig
 * into input to show what the call was actually about — otherwise three
 * journal_write calls in a row look identical.
 */
function describeToolUse(t: ToolUse): string {
  const short = t.name.replace(/^mcp__[^_]+__/, ""); // strip "mcp__memlog__"
  const input = t.input;
  if (!input) return `→ ${short}`;

  if (short.includes("write")) {
    const title = firstString(input.title as string);
    const kind = firstString(input.kind as string);
    if (title) return `→ ${short}(${kind ? `[${kind}] ` : ""}"${truncate(title, 70)}")`;
  }
  if (short.includes("search")) {
    const q = firstString(input.query as string);
    if (q) return `→ ${short}(query="${truncate(q, 60)}")`;
  }
  if (short === "journal_get" || short === "journal_redact") {
    const id = input.id;
    if (id != null) return `→ ${short}(#${id})`;
  }
  if (short === "journal_link") {
    const from = input.from_id;
    const to = input.to_id;
    const rel = firstString(input.relation as string);
    if (from != null && to != null) return `→ ${short}(#${from} -${rel}→ #${to})`;
  }
  return `→ ${short}`;
}

function extractRole(obj: AnyRec): MessageRole {
  const inner = asRec(obj.message) ?? obj;
  const role = firstString(inner.role, obj.role);
  if (role === "user" || role === "assistant" || role === "system") return role;
  const type = firstString(obj.type);
  if (type === "queue-operation") return "user";
  if (type.includes("tool")) return "tool";
  return "unknown";
}

function extractTs(obj: AnyRec): string {
  return firstString(
    obj.timestamp as string,
    obj.ts as string,
    asRec(obj.message)?.timestamp as string,
  );
}

function shouldSkip(obj: AnyRec): boolean {
  const type = firstString(obj.type);
  if (type === "system") return true;
  if (type === "summary") return true;
  if (obj.isSidechain === true) return true;
  return false;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n) + "…";
}

/**
 * Reduce one raw jsonl object to a SessionMessage preview, or null to drop it.
 */
function toMessage(obj: AnyRec): { preview: string; role: MessageRole } | null {
  const c = classify(obj);
  const role = extractRole(obj);

  // Drop pure tool_result messages — huge JSON blobs with zero human value.
  const isOnlyToolResult =
    c.toolResultBlocks > 0 && c.toolResultBlocks === c.totalBlocks;
  if (isOnlyToolResult) return null;

  // Pure tool_use: keep only journal_* calls (they're often the entry's cause).
  const isOnlyToolUse = c.toolUseBlocks > 0 && c.toolUseBlocks === c.totalBlocks;
  if (isOnlyToolUse) {
    const journalUses = c.toolUses.filter((t) => t.name.includes("journal"));
    if (journalUses.length === 0) return null;
    return { preview: journalUses.map(describeToolUse).join("\n"), role };
  }

  // Mixed content: keep text, append a compact tool-call summary if any.
  let text = c.text.trim();
  if (!text) return null;
  if (c.toolUseBlocks > 0) {
    const described = c.toolUses.slice(0, 3).map(describeToolUse).join("\n  ");
    const more = c.toolUses.length > 3 ? `\n  … +${c.toolUses.length - 3} more` : "";
    text += `\n\n  ${described}${more}`;
  }
  return { preview: truncate(text, MAX_PREVIEW_LEN), role };
}

export async function readSessionAround(
  filePath: string,
  targetIso: string,
  windowSize = 3,
): Promise<SessionView> {
  if (!isAllowedSessionPath(filePath) || !existsSync(filePath)) {
    return {
      path: filePath,
      fileExists: false,
      totalMessages: 0,
      targetIndex: null,
      windowStart: 0,
      windowEnd: 0,
      messages: [],
    };
  }

  const messages: SessionMessage[] = [];
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: AnyRec | null;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      obj = asRec(parsed);
    } catch {
      continue;
    }
    if (!obj || shouldSkip(obj)) continue;
    const ts = extractTs(obj);
    if (!ts) continue;
    const msg = toMessage(obj);
    if (!msg) continue;
    messages.push({
      ts,
      role: msg.role,
      type: firstString(obj.type) || "message",
      preview: msg.preview,
    });
  }

  messages.sort((a, b) => a.ts.localeCompare(b.ts));

  const targetMs = new Date(targetIso).getTime();
  let targetIdx = -1;
  let smallestDiff = Infinity;
  for (let i = 0; i < messages.length; i++) {
    const diff = Math.abs(new Date(messages[i]!.ts).getTime() - targetMs);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      targetIdx = i;
    }
  }

  if (targetIdx < 0) {
    return {
      path: filePath,
      fileExists: true,
      totalMessages: messages.length,
      targetIndex: null,
      windowStart: 0,
      windowEnd: 0,
      messages: [],
    };
  }

  const start = Math.max(0, targetIdx - windowSize);
  const end = Math.min(messages.length, targetIdx + windowSize + 1);
  const window = messages.slice(start, end).map((m, i) => ({
    ...m,
    isTarget: start + i === targetIdx,
  }));

  return {
    path: filePath,
    fileExists: true,
    totalMessages: messages.length,
    targetIndex: targetIdx,
    windowStart: start,
    windowEnd: end,
    messages: window,
  };
}
