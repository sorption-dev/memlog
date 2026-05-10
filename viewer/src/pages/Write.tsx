import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { KindBadge } from "../components/KindBadge";
import { useT } from "../i18n";
import { api } from "../lib/api";
import { KINDS } from "../lib/types";
import type { Kind, Relation, WriteLink } from "../lib/types";

const RELATIONS_FORM: Relation[] = [
  "supersedes",
  "depends_on",
  "refines",
  "contradicts",
  "answers",
];

export function WritePage() {
  const t = useT();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const [kind, setKind] = useState<Kind>(
    (params.get("kind") as Kind) || "decision",
  );
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [sessionId, setSessionId] = useState(params.get("session_id") ?? "");
  const [links, setLinks] = useState<WriteLink[]>(() => {
    const sup = params.get("supersedes");
    return sup ? [{ to_id: Number(sup), relation: "supersedes" }] : [];
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void submit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, title, body, tagsRaw, sessionId, links]);

  const submit = async () => {
    if (!title.trim() || !body.trim()) {
      setError(t("write.validation_required"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const entry = await api.write({
        kind,
        title: title.trim(),
        body: body.trim(),
        tags: tagsRaw
          .split(/[,\s]+/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        session_id: sessionId.trim() || undefined,
        links: links.filter((l) => l.to_id > 0),
      });
      navigate(`/entry/${entry.id}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-10 py-10 max-w-3xl mx-auto">
      <div className="text-[11px] uppercase tracking-wider text-[var(--color-ink-faint)]">
        {t("write.overline")}
      </div>
      <h1 className="mt-1 text-4xl font-sans tracking-tight display-rule">
        {t("write.title")}
      </h1>

      <div className="mt-8">
        <Label>{t("write.kind_label")}</Label>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={[
                "px-2 py-1 border rounded-[3px] transition-colors",
                kind === k
                  ? "border-[var(--color-accent)]"
                  : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]",
              ].join(" ")}
            >
              <KindBadge kind={k} />
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8">
        <Label>{t("write.title_field")}</Label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t("write.title_placeholder")}
          maxLength={200}
          autoFocus
          className="mt-2 w-full bg-transparent border-b-2 border-[var(--color-border-strong)] focus:border-[var(--color-accent)] outline-none text-xl py-2 placeholder:text-[var(--color-ink-faint)] tracking-tight"
        />
      </div>

      <div className="mt-6">
        <Label>{t("write.body_field")}</Label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("write.body_placeholder")}
          rows={10}
          className="mt-2 w-full bg-[var(--color-surface)] border border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none rounded-[3px] p-3 font-sans text-[15px] leading-relaxed resize-y"
        />
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <Label>{t("write.tags_field")}</Label>
          <input
            value={tagsRaw}
            onChange={(e) => setTagsRaw(e.target.value)}
            placeholder={t("write.tags_placeholder")}
            className="mt-2 w-full bg-transparent border-b border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none py-1 text-sm"
          />
        </div>
        <div>
          <Label>{t("write.session_field")}</Label>
          <input
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            placeholder={t("write.session_placeholder")}
            className="mt-2 w-full bg-transparent border-b border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none py-1 text-sm"
          />
        </div>
      </div>

      <div className="mt-8">
        <div className="flex items-baseline justify-between">
          <Label>{t("write.links_label")}</Label>
          <button
            type="button"
            onClick={() =>
              setLinks((ls) => [...ls, { to_id: 0, relation: "depends_on" }])
            }
            className="text-[11px] uppercase tracking-wider text-[var(--color-ink-dim)] hover:text-[var(--color-accent)]"
          >
            + {t("action.add")}
          </button>
        </div>
        {links.length === 0 ? (
          <div className="mt-2 text-[11px] text-[var(--color-ink-faint)]">
            {t("write.links_hint")}
          </div>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {links.map((l, i) => (
              <li key={i} className="flex items-center gap-2 text-xs">
                <span className="text-[var(--color-ink-faint)]">{t("write.this")}</span>
                <select
                  value={l.relation}
                  onChange={(e) =>
                    setLinks((ls) =>
                      ls.map((x, j) =>
                        j === i
                          ? { ...x, relation: e.target.value as Relation }
                          : x,
                      ),
                    )
                  }
                  className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[3px] px-1.5 py-1 text-[var(--color-ink)] uppercase tracking-wider"
                >
                  {RELATIONS_FORM.map((r) => (
                    <option key={r} value={r}>
                      {t(`relation.${r}`)}
                    </option>
                  ))}
                </select>
                <span className="text-[var(--color-ink-faint)]">#</span>
                <input
                  type="number"
                  min={1}
                  value={l.to_id || ""}
                  onChange={(e) =>
                    setLinks((ls) =>
                      ls.map((x, j) =>
                        j === i ? { ...x, to_id: Number(e.target.value) } : x,
                      ),
                    )
                  }
                  placeholder={t("write.id_placeholder")}
                  className="w-20 bg-transparent border-b border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none px-1 tabular"
                />
                <button
                  type="button"
                  onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))}
                  className="ml-auto text-[var(--color-ink-faint)] hover:text-[var(--color-danger)] uppercase tracking-wider"
                >
                  {t("action.remove")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {error && (
        <div className="mt-6 text-sm text-[var(--color-danger)] font-mono">
          {error}
        </div>
      )}

      <div className="mt-10 flex items-center gap-4 border-t border-[var(--color-border)] pt-6">
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="px-4 py-2 bg-[var(--color-accent)] text-[var(--color-bg)] text-xs uppercase tracking-widest rounded-[3px] hover:bg-[var(--color-accent-dim)] disabled:opacity-50 transition-colors"
        >
          {busy ? t("write.saving") : t("action.save")}
        </button>
        <span className="text-[11px] text-[var(--color-ink-faint)]">
          {t("write.shortcut_hint", { cmd: "⌘", enter: "↵" })
            .split(/(⌘|↵)/)
            .map((part, i) =>
              part === "⌘" || part === "↵" ? (
                <kbd
                  key={i}
                  className="border border-[var(--color-border)] rounded px-1"
                >
                  {part}
                </kbd>
              ) : (
                <span key={i}>{part}</span>
              ),
            )}
        </span>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]">
      {children}
    </label>
  );
}
