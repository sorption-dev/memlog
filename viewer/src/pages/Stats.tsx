import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useLocale, useT } from "../i18n";
import { api } from "../lib/api";
import { fmtBytes, kindColor } from "../lib/format";
import type { ActivityReport, Stats } from "../lib/types";

type PeriodId = "today" | "7d" | "30d";
interface PeriodDef {
  id: PeriodId;
  key: string;
  args: { granularity?: "day" | "hour"; days?: number };
}
const PERIODS: PeriodDef[] = [
  { id: "today", key: "stats.period_today", args: { granularity: "hour" } },
  { id: "7d", key: "stats.period_7d", args: { granularity: "day", days: 7 } },
  { id: "30d", key: "stats.period_30d", args: { granularity: "day", days: 30 } },
];

type Metric = "chars" | "entries";

export function StatsPage() {
  const t = useT();
  const [stats, setStats] = useState<Stats | null>(null);
  const [activity, setActivity] = useState<ActivityReport | null>(null);
  const [period, setPeriod] = useState<PeriodId>("7d");
  const [metric, setMetric] = useState<Metric>("chars");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.stats().then(setStats).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    const def = PERIODS.find((p) => p.id === period) ?? PERIODS[1];
    setActivity(null);
    api
      .activity(def.args)
      .then(setActivity)
      .catch((e: Error) => setError(e.message));
  }, [period]);

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
      <header className="mb-10">
        <div className="text-[11px] uppercase tracking-wider text-[var(--color-ink-faint)]">
          {t("stats.overline")}
        </div>
        <h1 className="mt-1 text-4xl font-sans tracking-tight display-rule">
          {t("stats.title")}
        </h1>
      </header>

      {/* Global totals (from full db, not the period). */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-0 border-t border-[var(--color-border)]">
        <Summary
          label={t("stats.stat_entries")}
          value={stats?.totalEntries ?? "—"}
          sub={
            stats
              ? t("stats.superseded_redacted", {
                  superseded: stats.supersededEntries,
                  redacted: stats.redactedEntries,
                })
              : ""
          }
        />
        <Summary
          label={t("stats.stat_links")}
          value={stats?.totalLinks ?? "—"}
          sub={stats ? t("stats.rel_types", { n: stats.byRelation.length }) : ""}
        />
        <Summary
          label={t("stats.stat_activity")}
          value={stats ? stats.activity.last7d : "—"}
          sub={stats ? t("stats.activity_sub", { today: stats.activity.last24h }) : ""}
        />
        <Summary
          label={t("stats.stat_db")}
          value={stats ? fmtBytes(stats.dbSizeBytes) : "—"}
          sub={stats ? t("stats.schema_sub", { n: stats.schemaVersion }) : ""}
        />
      </section>

      {/* Period controls */}
      <section className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs">
        <Tabs
          label={t("stats.period_label")}
          value={period}
          options={PERIODS.map((p) => ({ value: p.id, label: t(p.key) }))}
          onChange={(v) => setPeriod(v as PeriodId)}
        />
        <Tabs
          label={t("stats.metric_label")}
          value={metric}
          options={[
            { value: "chars", label: t("stats.metric_chars") },
            { value: "entries", label: t("stats.metric_entries") },
          ]}
          onChange={(v) => setMetric(v as Metric)}
        />
      </section>

      {/* Activity chart */}
      <section className="mt-6">
        <SectionTitle>
          {activity?.granularity === "hour"
            ? t("stats.hourly_activity")
            : t("stats.daily_activity")}
        </SectionTitle>
        {activity ? (
          <ActivityChart report={activity} metric={metric} />
        ) : (
          <div className="mt-4 h-48 text-xs text-[var(--color-ink-faint)]">
            {t("common.loading")}
          </div>
        )}
      </section>

      {activity && (
        <section className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-x-12 gap-y-10">
          <KindDistribution activity={activity} />
          <TopSessions activity={activity} />
        </section>
      )}
    </div>
  );
}

function ActivityChart({
  report,
  metric,
}: {
  report: ActivityReport;
  metric: Metric;
}) {
  const t = useT();
  const [locale] = useLocale();

  const values = report.buckets.map((d) =>
    metric === "chars" ? d.chars : d.entries,
  );
  const max = Math.max(1, ...values);
  const total = values.reduce((a, b) => a + b, 0);
  const avg = Math.round(total / report.buckets.length);

  const dayFmt = new Intl.DateTimeFormat(
    locale === "ru" ? "ru-RU" : "en-US",
    { day: "2-digit", month: "short" },
  );

  const labelFor = (bucket: string): string => {
    if (report.granularity === "hour") {
      // "2026-04-22T14:00:00Z" → "14"
      return bucket.slice(11, 13);
    }
    return dayFmt.format(new Date(bucket + "T00:00:00Z"));
  };

  const tooltipFor = (bucket: string): string => {
    if (report.granularity === "hour") return `${bucket.slice(11, 13)}:00 UTC`;
    return bucket;
  };

  const avgUnit =
    report.granularity === "hour" ? t("stats.per_hour") : t("stats.per_day");

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between text-[11px] text-[var(--color-ink-faint)] tabular">
        <span>
          {t("stats.chart_total", {
            n: total,
            unit:
              metric === "chars"
                ? t("stats.unit_chars")
                : t("stats.unit_entries"),
          })}
        </span>
        <span>{t("stats.chart_avg", { n: avg, unit: avgUnit })}</span>
      </div>

      <div
        className="mt-4 flex items-end gap-1 border-b border-[var(--color-border)]"
        style={{ height: "220px" }}
      >
        {report.buckets.map((d, i) => {
          const v = metric === "chars" ? d.chars : d.entries;
          const pct = v === 0 ? 0 : Math.max(2, (v / max) * 100);
          return (
            <div
              key={d.bucket}
              className="flex-1 group relative flex flex-col justify-end min-w-0"
              style={{ height: "100%" }}
            >
              <div
                className={[
                  "w-full transition-colors rounded-t-[1px]",
                  v === 0
                    ? "bg-[var(--color-border)]"
                    : "bg-[var(--color-accent)] group-hover:bg-[var(--color-accent-dim)]",
                ].join(" ")}
                style={{ height: `${pct}%` }}
              />
              <div className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap bg-[var(--color-surface-solid)] border border-[var(--color-border-strong)] rounded-[3px] px-1.5 py-0.5 text-[10px] tabular opacity-0 group-hover:opacity-100 transition-opacity z-10">
                <span className="text-[var(--color-ink-faint)] mr-1">
                  {tooltipFor(d.bucket)}
                </span>
                <span className="text-[var(--color-ink)]">
                  {v.toLocaleString()}
                </span>
                <span className="text-[var(--color-ink-faint)] ml-1">
                  {metric === "chars"
                    ? t("stats.unit_chars")
                    : t("stats.unit_entries")}
                </span>
              </div>
              {shouldLabel(i, report.buckets.length, report.granularity) && (
                <div className="absolute top-full mt-1 left-1/2 -translate-x-1/2 text-[9px] text-[var(--color-ink-faint)] tabular whitespace-nowrap">
                  {labelFor(d.bucket)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ height: "18px" }} />
    </div>
  );
}

/** Decide whether to render the X-label — avoids overlap on dense axes. */
function shouldLabel(
  i: number,
  total: number,
  granularity: "day" | "hour",
): boolean {
  if (granularity === "hour") {
    // 24 hourly buckets — label every 3h (00, 03, 06, …, 21).
    return i % 3 === 0;
  }
  if (total <= 10) return true;
  if (total <= 15) return i % 2 === 0;
  const step = Math.ceil(total / 7);
  return i === total - 1 || i % step === 0;
}

function KindDistribution({ activity }: { activity: ActivityReport }) {
  const t = useT();
  const max = Math.max(1, ...activity.byKind.map((k) => k.n));
  return (
    <div>
      <SectionTitle>{t("stats.by_kind")}</SectionTitle>
      {activity.byKind.length === 0 ? (
        <div className="mt-4 text-xs text-[var(--color-ink-faint)]">
          {t("stats.empty_period")}
        </div>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {activity.byKind.map((k) => (
            <li key={k.kind} className="flex items-center gap-3">
              <Link
                to={`/search?kind=${k.kind}`}
                className="text-[11px] uppercase tracking-wider w-24 shrink-0 hover:text-[var(--color-accent)]"
                style={{ color: kindColor(k.kind) }}
              >
                {t(`kind.${k.kind}`)}
              </Link>
              <div className="flex-1 h-2 bg-[var(--color-surface-elevated)] rounded-[2px] overflow-hidden">
                <div
                  className="h-full"
                  style={{
                    width: `${(k.n / max) * 100}%`,
                    background: kindColor(k.kind),
                  }}
                />
              </div>
              <span className="text-[11px] tabular text-[var(--color-ink-dim)] w-8 text-right">
                {k.n}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TopSessions({ activity }: { activity: ActivityReport }) {
  const t = useT();
  const rows = activity.topSessions.filter((s) => s.session_id);
  return (
    <div>
      <SectionTitle>{t("stats.top_sessions")}</SectionTitle>
      {rows.length === 0 ? (
        <div className="mt-4 text-xs text-[var(--color-ink-faint)]">
          {t("stats.empty_period")}
        </div>
      ) : (
        <ul className="mt-4 flex flex-col border-t border-[var(--color-border)]">
          {rows.map((s) => (
            <li key={s.session_id} className="border-b border-[var(--color-border)]">
              <Link
                to={`/search?session_id=${encodeURIComponent(s.session_id ?? "")}`}
                className="group grid grid-cols-[1fr_auto_auto] gap-x-4 items-baseline py-1.5"
              >
                <span className="text-xs text-[var(--color-ink-dim)] group-hover:text-[var(--color-accent)] truncate">
                  {s.session_id}
                </span>
                <span className="text-[11px] tabular text-[var(--color-ink-faint)]">
                  {s.n} {t("stats.unit_entries")}
                </span>
                <span className="text-[11px] tabular text-[var(--color-ink-faint)]">
                  {s.chars.toLocaleString()} {t("stats.unit_chars")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Tabs({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="uppercase tracking-wider text-[var(--color-ink-faint)]">
        {label}
      </span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={[
            "px-2 py-0.5 rounded-[3px] border uppercase tracking-wider transition-colors",
            value === o.value
              ? "border-[var(--color-accent)] text-[var(--color-accent)]"
              : "border-[var(--color-border)] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]",
          ].join(" ")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Summary({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="border-b border-r last:border-r-0 border-[var(--color-border)] px-4 py-5 -ml-px first:ml-0">
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">
        {label}
      </div>
      <div className="mt-2 font-sans text-2xl tracking-tight tabular">{value}</div>
      {sub && (
        <div className="mt-1 text-[11px] text-[var(--color-ink-faint)] tabular">
          {sub}
        </div>
      )}
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
