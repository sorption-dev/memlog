export type Kind =
  | "decision"
  | "fact"
  | "preference"
  | "todo"
  | "context"
  | "question";

export type Relation =
  | "supersedes"
  | "depends_on"
  | "contradicts"
  | "refines"
  | "answers";

export const KINDS: readonly Kind[] = [
  "decision",
  "fact",
  "preference",
  "todo",
  "context",
  "question",
] as const;

export const RELATIONS: readonly Relation[] = [
  "supersedes",
  "depends_on",
  "contradicts",
  "refines",
  "answers",
] as const;

export interface Entry {
  id: number;
  ts: string;
  session_id: string | null;
  msg_ref: string | null;
  kind: Kind;
  title: string;
  body: string;
  tags: string[];
  superseded: boolean;
  source_session_file: string | null;
}

export interface Link {
  from_id: number;
  to_id: number;
  relation: Relation;
  ts: string;
}

export interface EntryWithNeighbors extends Entry {
  outgoing: Array<{ to_id: number; relation: Relation; title: string; kind: Kind }>;
  incoming: Array<{ from_id: number; relation: Relation; title: string; kind: Kind }>;
}

export interface SearchHit {
  id: number;
  ts: string;
  kind: Kind;
  title: string;
  tags: string[];
  score: number;
  session_id: string | null;
}

export interface SearchResult {
  hits: SearchHit[];
  degraded: boolean;
  total: number;
}

export interface WriteLink {
  to_id: number;
  relation: Relation;
}

export interface WriteArgs {
  kind: Kind;
  title: string;
  body: string;
  tags?: string[];
  session_id?: string;
  msg_ref?: string;
  source_session_file?: string;
  links?: WriteLink[];
}

export interface SearchArgs {
  query?: string;
  tags?: string[];
  /** Single kind or array — array means OR (any of these kinds). */
  kind?: Kind | Kind[];
  session_id?: string | string[];
  /** Named project group(s). Expands to member session_ids, OR-merged with session_id. */
  group?: string | string[];
  since?: string;
  include_superseded?: boolean;
  limit?: number;
}

export interface RecentArgs {
  limit?: number;
  kind?: Kind;
  session_id?: string | string[];
  group?: string | string[];
  include_superseded?: boolean;
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
