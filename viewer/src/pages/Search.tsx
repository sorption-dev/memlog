import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { EntryCard } from "../components/EntryCard";
import { KindBadge } from "../components/KindBadge";
import { SearchableSelect } from "../components/SearchableSelect";
import type { SelectOption } from "../components/SearchableSelect";
import { useT } from "../i18n";
import { api } from "../lib/api";
import { KINDS } from "../lib/types";
import type {
  Kind,
  ProjectGroupWithMembers,
  SearchHit,
  SearchResult,
  SessionSummary,
} from "../lib/types";

const DEBOUNCE_MS = 180;

/** URL ⇄ array: "a,b,c" ⇄ ["a","b","c"]. Empty string → []. */
function parseList(raw: string | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function SearchPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();

  // URL is the single source of truth for filters.
  const query = params.get("q") ?? "";
  const kinds = parseList(params.get("kind")) as Kind[];
  const sessionIds = parseList(params.get("session_id"));
  const groupNames = parseList(params.get("group"));
  const includeSuperseded = params.get("include_superseded") === "1";

  const patch = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  const setQuery = (v: string) => patch({ q: v });
  const setKinds = (vs: Kind[]) => patch({ kind: vs.join(",") || null });
  const setSessionIds = (vs: string[]) =>
    patch({ session_id: vs.join(",") || null });
  const setGroupNames = (vs: string[]) => patch({ group: vs.join(",") || null });
  const setIncludeSuperseded = (v: boolean) =>
    patch({ include_superseded: v ? "1" : "" });

  const [result, setResult] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [groups, setGroups] = useState<ProjectGroupWithMembers[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  useEffect(() => {
    api.sessions().then(setSessions).catch(() => setSessions([]));
    api.listGroups().then(setGroups).catch(() => setGroups([]));
  }, []);

  // Serialize the filter tuple into a stable string so useMemo deps are sound.
  const argsKey = `${query}|${kinds.join(",")}|${sessionIds.join(",")}|${groupNames.join(",")}|${includeSuperseded}`;

  const args = useMemo(
    () => ({
      query: query.trim() || undefined,
      kind:
        kinds.length === 0
          ? undefined
          : kinds.length === 1
            ? kinds[0]
            : kinds,
      session_id:
        sessionIds.length === 0
          ? undefined
          : sessionIds.length === 1
            ? sessionIds[0]
            : sessionIds,
      group:
        groupNames.length === 0
          ? undefined
          : groupNames.length === 1
            ? groupNames[0]
            : groupNames,
      include_superseded: includeSuperseded,
      limit: 50,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [argsKey],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      api
        .search(args)
        .then((r) => {
          if (!cancelled) {
            setResult(r);
            setError(null);
          }
        })
        .catch((e: Error) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [args]);

  const sessionOptions: SelectOption[] = useMemo(
    () =>
      sessions.map((s) => ({
        value: s.session_id,
        label: s.session_id,
        sub: s.entry_count,
      })),
    [sessions],
  );

  const groupOptions: SelectOption[] = useMemo(
    () =>
      groups.map((g) => ({
        value: g.name,
        label: g.name,
        sub: g.member_count,
        color: g.color,
      })),
    [groups],
  );

  return (
    <div className="px-10 py-10 max-w-5xl mx-auto">
      <div className="font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-faint)]">
        {t("search.overline")}
      </div>
      <h1 className="mt-1 text-4xl font-sans tracking-tight display-rule">
        {t("search.title")}
      </h1>

      <div className="mt-8 relative">
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("search.placeholder")}
          className="w-full bg-transparent border-b-2 border-[var(--color-border-strong)] focus:border-[var(--color-accent)] outline-none text-2xl py-3 font-sans placeholder:text-[var(--color-ink-faint)] tracking-tight"
        />
        {loading && (
          <span className="absolute right-0 top-1/2 -translate-y-1/2 font-mono text-[10px] text-[var(--color-ink-faint)]">
            …
          </span>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-mono">
        <KindFilter values={kinds} onChange={setKinds} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-mono">
        <SearchableSelect
          label={t("search.filter_session")}
          values={sessionIds}
          onChange={setSessionIds}
          options={sessionOptions}
          placeholder={t("search.filter_any")}
          emptyHint={t("search.no_sessions")}
          width="w-64"
        />
        <SearchableSelect
          label={t("search.filter_group")}
          values={groupNames}
          onChange={setGroupNames}
          options={groupOptions}
          placeholder={t("search.filter_any")}
          emptyHint={t("search.no_groups")}
          width="w-56"
        />
        <label className="flex items-center gap-2 text-[var(--color-ink-dim)] select-none text-xs">
          <input
            type="checkbox"
            checked={includeSuperseded}
            onChange={(e) => setIncludeSuperseded(e.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          <span className="uppercase tracking-wider">
            {t("search.show_superseded")}
          </span>
        </label>
      </div>

      <div className="mt-8 flex items-baseline justify-between font-mono text-[11px] text-[var(--color-ink-faint)] uppercase tracking-widest">
        <span>
          {result ? t("search.results", { count: result.hits.length }) : "—"}
        </span>
        {result?.degraded && (
          <span className="text-[var(--color-danger)]">{t("common.morph_degraded")}</span>
        )}
      </div>

      <div className="mt-2">
        {error && <div className="text-sm text-[var(--color-danger)] font-mono">{error}</div>}
        {result && result.hits.length === 0 && !loading && (
          <div className="mt-8 font-mono text-sm text-[var(--color-ink-faint)]">
            {t("search.empty_tip")}
          </div>
        )}
        {result?.hits.map((h: SearchHit) => <EntryCard key={h.id} hit={h} />)}
      </div>
    </div>
  );
}

function KindFilter({
  values,
  onChange,
}: {
  values: Kind[];
  onChange: (v: Kind[]) => void;
}) {
  const t = useT();
  const toggle = (k: Kind, e: MouseEvent<HTMLButtonElement>) => {
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      // Multi-select: toggle in/out.
      onChange(
        values.includes(k) ? values.filter((x) => x !== k) : [...values, k],
      );
    } else {
      // Single-select: replace, or clear if clicking the sole active one.
      if (values.length === 1 && values[0] === k) onChange([]);
      else onChange([k]);
    }
  };
  return (
    <div
      className="flex items-center gap-1.5"
      title={t("search.shift_multi_kind")}
    >
      <span className="uppercase tracking-wider text-[var(--color-ink-faint)]">
        {t("search.filter_kind")}
      </span>
      <button
        type="button"
        onClick={() => onChange([])}
        className={[
          "px-1.5 py-0.5 rounded-[3px] border uppercase tracking-wider transition-colors",
          values.length === 0
            ? "border-[var(--color-accent)] text-[var(--color-accent)]"
            : "border-[var(--color-border)] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]",
        ].join(" ")}
      >
        {t("common.all")}
      </button>
      {KINDS.map((k) => {
        const active = values.includes(k);
        return (
          <button
            key={k}
            type="button"
            onClick={(e) => toggle(k, e)}
            className={[
              "px-1.5 py-0.5 rounded-[3px] border transition-colors",
              active
                ? "border-[var(--color-accent)]"
                : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]",
            ].join(" ")}
          >
            <KindBadge kind={k} />
          </button>
        );
      })}
    </div>
  );
}
