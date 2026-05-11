/**
 * Backend RPC client. All calls go through a single Tauri command,
 * `memlog_rpc`, which forwards to the Bun sidecar over stdio JSON-RPC.
 * No HTTP, no ports — just Tauri IPC.
 *
 * Matches method names in mcp/src/ipc/stdio.ts (buildHandlers()). If a
 * method name changes there, update it here too — TypeScript can't catch
 * the mismatch because the wire protocol is unstructured `(string, any)`.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  ActivityReport,
  ConversationView,
  Entry,
  EntryWithNeighbors,
  GraphData,
  ProjectGroup,
  ProjectGroupWithMembers,
  RecentArgs,
  Relation,
  SearchArgs,
  SearchResult,
  SessionSummary,
  Stats,
  WriteArgs,
} from "./types";

function call<T>(method: string, params: unknown = {}): Promise<T> {
  return invoke<T>("memlog_rpc", { method, params });
}

export const api = {
  stats: () => call<Stats & { morphStatus: string }>("stats"),
  activity: (args: { granularity?: "day" | "hour"; days?: number } = {}) =>
    call<ActivityReport>("activity", {
      granularity: args.granularity,
      days: args.days,
    }),
  recent: (args?: RecentArgs) => call<SearchResult>("recent", args ?? {}),
  search: (args: SearchArgs) => call<SearchResult>("search", args),
  entry: (id: number, with_neighbors = false) =>
    call<EntryWithNeighbors | Entry>("entry", { id, with_neighbors }),
  write: (args: WriteArgs) => call<Entry>("write", args),
  update: (
    id: number,
    patch: {
      kind?: Entry["kind"];
      title?: string;
      body?: string;
      tags?: string[];
    },
  ) => call<Entry>("update", { id, patch }),
  redact: (id: number) => call<Entry>("redact", { id }),
  delete: (id: number) => call<{ ok: true }>("delete", { id }),
  entrySource: (id: number) => call<ConversationView>("entry_source", { id }),
  link: (from_id: number, to_id: number, relation: Relation) =>
    call<{ ok: true }>("link", { from_id, to_id, relation }),
  graph: (opts?: { include_superseded?: boolean; include_redacted?: boolean }) =>
    call<GraphData>("graph", {
      include_superseded: opts?.include_superseded ?? false,
      include_redacted: opts?.include_redacted ?? true,
    }),

  // Projects & Groups
  sessions: () => call<SessionSummary[]>("sessions"),
  listGroups: () => call<ProjectGroupWithMembers[]>("groups_list"),
  getGroup: (name: string) =>
    call<ProjectGroupWithMembers>("groups_get", { name }),
  createGroup: (args: {
    name: string;
    description?: string | null;
    color?: string | null;
  }) => call<ProjectGroup>("groups_create", args),
  updateGroup: (
    name: string,
    patch: {
      name?: string;
      description?: string | null;
      color?: string | null;
    },
  ) => call<ProjectGroup>("groups_update", { name, patch }),
  deleteGroup: (name: string) => call<{ ok: true }>("groups_delete", { name }),
  addGroupMember: (name: string, session_id: string) =>
    call<{ added: boolean }>("group_add_member", { name, session_id }),
  removeGroupMember: (name: string, session_id: string) =>
    call<{ removed: boolean }>("group_remove_member", { name, session_id }),
};
