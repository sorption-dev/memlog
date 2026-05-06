import { useCallback, useEffect, useState } from "react";
import { useLocale, useT } from "../i18n";
import { api } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import type { ConversationRole, ConversationView as ConvView } from "../lib/types";

interface Props {
  entryId: number;
  hasSource: boolean;
  sourcePath: string | null;
}

const ROLE_COLOR: Record<ConversationRole, string> = {
  user: "var(--color-accent)",
  assistant: "var(--color-kind-fact)",
  tool: "var(--color-kind-context)",
  system: "var(--color-ink-faint)",
  unknown: "var(--color-ink-faint)",
};

export function ConversationView({ entryId, hasSource, sourcePath }: Props) {
  const t = useT();
  const [locale] = useLocale();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ConvView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const v = await api.entrySource(entryId);
      setData(v);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [entryId]);

  useEffect(() => {
    if (open && !data && !loading) void load();
  }, [open, data, loading, load]);

  if (!hasSource) {
    return (
      <section className="mt-10 border-t border-[var(--color-border)] pt-5">
        <div className="font-mono text-[11px] text-[var(--color-ink-faint)]">
          {t("conv.unavailable")}
        </div>
      </section>
    );
  }

  return (
    <section className="mt-10 border-t border-[var(--color-border)] pt-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="font-mono text-[11px] uppercase tracking-widest text-[var(--color-ink-dim)] hover:text-[var(--color-accent)] transition-colors"
      >
        {open ? "▾" : "▸"} {open ? t("conv.hide") : t("conv.show")}
      </button>

      {open && (
        <div className="mt-4">
          {loading && (
            <div className="font-mono text-xs text-[var(--color-ink-faint)]">
              {t("conv.loading")}
            </div>
          )}

          {error && (
            <div className="font-mono text-xs text-[var(--color-danger)]">{error}</div>
          )}

          {data && !loading && !data.fileExists && (
            <div className="font-mono text-xs text-[var(--color-danger)]">
              {t("conv.file_missing", { path: data.path ?? "" })}
            </div>
          )}

          {data && data.fileExists && data.messages.length === 0 && (
            <div className="font-mono text-xs text-[var(--color-ink-faint)]">
              {t("conv.no_messages")}
            </div>
          )}

          {data && data.fileExists && data.messages.length > 0 && (
            <>
              <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]">
                <span>
                  {t("conv.around", {
                    total: data.totalMessages,
                    start: data.windowStart,
                    end: data.windowEnd - 1,
                  })}
                </span>
                {sourcePath && (
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard.writeText(sourcePath).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      });
                    }}
                    className="hover:text-[var(--color-accent)] transition-colors normal-case tracking-normal"
                    title={sourcePath}
                  >
                    {copied ? t("conv.copied") : t("conv.copy_path")}
                  </button>
                )}
              </div>

              <ul className="mt-3 flex flex-col gap-3">
                {data.messages.map((m, i) => (
                  <li
                    key={`${m.ts}-${i}`}
                    className={[
                      "border-l-2 pl-3 py-1",
                      m.isTarget
                        ? "border-[var(--color-accent)] bg-[var(--color-surface)]/40"
                        : "border-[var(--color-border)]",
                    ].join(" ")}
                  >
                    <div className="flex items-baseline gap-2 font-mono text-[10px] uppercase tracking-wider">
                      <span style={{ color: ROLE_COLOR[m.role] }}>
                        {t(`conv.role_${m.role}`)}
                      </span>
                      <span className="text-[var(--color-ink-faint)] tabular">
                        {fmtDateTime(m.ts, locale)}
                      </span>
                      {m.isTarget && (
                        <span className="text-[var(--color-accent)] normal-case tracking-normal">
                          ← {t("conv.target_marker")}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-sm text-[var(--color-ink)] leading-relaxed">
                      {m.preview}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
