import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { EntryCard } from "../components/EntryCard";
import { useLocale, useT } from "../i18n";
import { api } from "../lib/api";
import { fmtRelative, kindColor } from "../lib/format";
import type { SearchHit, Stats } from "../lib/types";

export function HomePage() {
  const t = useT();
  const [locale] = useLocale();
  const [stats, setStats] = useState<Stats | null>(null);
  const [recent, setRecent] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.stats(), api.recent({ limit: 20 })])
      .then(([s, r]) => {
        setStats(s);
        setRecent(r.hits);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="px-10 py-16">
        <div className="text-xs uppercase text-[var(--color-danger)]">
          {t("common.error")}
        </div>
        <pre className="mt-3 text-sm text-[var(--color-ink-dim)] whitespace-pre-wrap">
          {error}
        </pre>
      </div>
    );
  }

  return (
    <div className="px-10 py-10 max-w-5xl mx-auto">

      {stats && stats.byKind.length > 0 && (
        <section>
          <SectionTitle>{t("home.by_kind")}</SectionTitle>
          <div className="mt-4 flex flex-wrap gap-4 text-xs">
            {stats.byKind.map((r) => (
              <Link
                key={r.kind}
                to={`/search?kind=${r.kind}`}
                className="flex items-baseline gap-2 text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]"
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-[1px]"
                  style={{ background: kindColor(r.kind) }}
                />
                <span className="tabular">{r.n}</span>
                <span className="uppercase text-[10px] tracking-wider">
                  {t(`kind.${r.kind}`)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {stats && stats.topSessions.length > 0 && (
        <section className="mt-10">
          <div className="flex items-baseline justify-between">
            <SectionTitle>{t("home.projects")}</SectionTitle>
            <Link
              to="/projects"
              className="text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)] hover:text-[var(--color-accent)] transition-colors"
            >
              {t("home.all_projects")} →
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {stats.topSessions.map((s) => {
              const max = stats.topSessions[0]?.n || 1;
              const pct = Math.max(4, Math.round((s.n / max) * 100));
              const id = s.session_id ?? "_null";
              const label = s.session_id ?? t("home.no_session");
              return (
                <Link
                  key={id}
                  to={`/search?session_id=${encodeURIComponent(s.session_id ?? "")}`}
                  className="group relative flex flex-col justify-between border border-[var(--color-border)] rounded-[3px] p-3 min-h-[92px] hover:border-[var(--color-accent)] hover:bg-[var(--color-surface-elevated)] transition-colors"
                >
                  <div className="text-xs text-[var(--color-ink)] group-hover:text-[var(--color-accent)] leading-tight break-all line-clamp-2">
                    {label}
                  </div>
                  <div className="mt-3">
                    <div className="h-0.5 bg-[var(--color-surface-elevated)] group-hover:bg-[var(--color-bg)] rounded-[1px] overflow-hidden">
                      <div
                        className="h-full bg-[var(--color-accent)]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="mt-1.5 flex items-baseline justify-between text-[10px] tabular text-[var(--color-ink-faint)]">
                      <span>
                        <span className="text-[var(--color-ink-dim)]">{s.n}</span>{" "}
                        {t("home.entries_short")}
                      </span>
                      <span>{fmtRelative(s.last_ts, locale)}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="mt-12">
        <SectionTitle>{t("home.recent")}</SectionTitle>
        <div className="mt-2">
          {recent === null ? (
            <div className="text-xs text-[var(--color-ink-faint)]">
              {t("common.loading")}
            </div>
          ) : recent.length === 0 ? (
            <div className="text-xs text-[var(--color-ink-faint)]">
              {t("home.empty")}
            </div>
          ) : (
            recent.map((h) => <EntryCard key={h.id} hit={h} />)
          )}
        </div>
      </section>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]">
      {children}
    </div>
  );
}
