/**
 * Re-export of mcp backend types. Avoids duplication: the same Kind/Relation/Entry
 * shapes flow between the sqlite row, the MCP tool responses, and the React UI.
 * tsc resolves this via the "@mcp/*" path alias in tsconfig.json.
 */
import type { Kind as _Kind } from "@mcp/types";

export type {
  Kind,
  Relation,
  Entry,
  EntryWithNeighbors,
  Link,
  SearchHit,
  SearchResult,
  SearchArgs,
  RecentArgs,
  WriteArgs,
  WriteLink,
} from "@mcp/types";

export { KINDS, RELATIONS } from "@mcp/types";

export type ActivityGranularity = "day" | "hour";

export interface ActivityBucket {
  /** UTC. day: "YYYY-MM-DD". hour: "YYYY-MM-DDTHH:00:00Z". */
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
  byKind: Array<{ kind: _Kind; n: number }>;
  topSessions: Array<{ session_id: string | null; n: number; chars: number }>;
}

export interface Stats {
  dbPath: string;
  dbSizeBytes: number;
  schemaVersion: number;
  totalEntries: number;
  supersededEntries: number;
  redactedEntries: number;
  withSourceSession: number;
  byKind: Array<{ kind: string; n: number }>;
  topSessions: Array<{ session_id: string | null; n: number; last_ts: string }>;
  totalLinks: number;
  byRelation: Array<{ relation: string; n: number }>;
  activity: { last24h: number; last7d: number; last30d: number; allTime: number };
  morphStatus: "uninitialized" | "starting" | "ready" | "degraded";
}

export type ConversationRole = "user" | "assistant" | "tool" | "system" | "unknown";

export interface ConversationMessage {
  ts: string;
  role: ConversationRole;
  type: string;
  preview: string;
  isTarget?: boolean;
}

export interface ConversationView {
  path: string | null;
  fileExists: boolean;
  totalMessages: number;
  targetIndex: number | null;
  windowStart: number;
  windowEnd: number;
  messages: ConversationMessage[];
}

export interface SessionSummary {
  session_id: string;
  entry_count: number;
  last_ts: string;
  groups: string[];
}

export interface ProjectGroup {
  id: number;
  name: string;
  description: string | null;
  color: string | null;
  ts: string;
}

export interface ProjectGroupWithMembers extends ProjectGroup {
  members: string[];
  member_count: number;
  entry_count: number;
}

export interface GraphNode {
  id: number;
  kind: string;
  title: string;
  session_id: string | null;
  ts: string;
  superseded: 0 | 1;
  redacted: 0 | 1;
}

export interface GraphEdge {
  from_id: number;
  to_id: number;
  relation: string;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphEdge[];
}
