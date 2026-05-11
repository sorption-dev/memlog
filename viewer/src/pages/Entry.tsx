import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ConversationView } from "../components/ConversationView";
import { KindBadge } from "../components/KindBadge";
import { MarkdownView } from "../components/MarkdownView";
import { ShortcutHint } from "../components/ShortcutHint";
import { TagChip } from "../components/TagChip";
import { useT, useLocale } from "../i18n";
import { api } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { KINDS } from "../lib/types";
import type { EntryWithNeighbors, Kind, Relation } from "../lib/types";

interface EditDraft {
  kind: Kind;
  title: string;
  body: string;
  tagsRaw: string;
}

function draftFrom(entry: EntryWithNeighbors): EditDraft {
  return {
    kind: entry.kind,
    title: entry.title,
    body: entry.body,
    tagsRaw: entry.tags.join(", "),
  };
}

function parseTags(raw: string): string[] {
  return raw
    .split(/[,\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isDirty(draft: EditDraft, entry: EntryWithNeighbors): boolean {
  if (draft.kind !== entry.kind) return true;
  if (draft.title !== entry.title) return true;
  if (draft.body !== entry.body) return true;
  const normalised = parseTags(draft.tagsRaw).join("\0");
  if (normalised !== entry.tags.join("\0")) return true;
  return false;
}

export function EntryPage() {
  const t = useT();
  const [locale] = useLocale();
  const { id: idStr } = useParams();
  const navigate = useNavigate();
  const id = Number(idStr);

  const [entry, setEntry] = useState<EntryWithNeighbors | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft | null>(null);

  const load = useCallback(async () => {
    try {
      const e = (await api.entry(id, true)) as EntryWithNeighbors;
      setEntry(e);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // Leaving the entry (nav away or id change) discards unsaved edits silently —
  // nothing here hits the network, so there's nothing to preserve.
  useEffect(() => {
    setDraft(null);
    setActionError(null);
  }, [id]);

  const doRedact = async () => {
    if (!entry) return;
    setConfirmOpen(false);
    setBusy(true);
    setActionError(null);
    try {
      await api.redact(entry.id);
      await load();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (!entry) return;
    setConfirmDeleteOpen(false);
    setBusy(true);
    setActionError(null);
    try {
      await api.delete(entry.id);
      navigate("/", { replace: true });
    } catch (err) {
      setActionError((err as Error).message);
      setBusy(false);
    }
  };

  const beginEdit = () => {
    if (!entry) return;
    setDraft(draftFrom(entry));
    setActionError(null);
  };

  const cancelEdit = () => setDraft(null);

  const saveEdit = async () => {
    if (!entry || !draft) return;
    const title = draft.title.trim();
    const body = draft.body.trim();
    if (!title || !body) {
      setActionError(t("write.validation_required"));
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await api.update(entry.id, {
        kind: draft.kind,
        title,
        body,
        tags: parseTags(draft.tagsRaw),
      });
      setDraft(null);
      await load();
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // ⌘S while editing → save, Esc → cancel. Use e.code (physical key) so
  // the shortcut works on any keyboard layout — on a Russian layout
  // pressing S would emit "ы" via e.key, but the physical key still
  // reports "KeyS".
  useEffect(() => {
    if (!draft) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyS") {
        e.preventDefault();
        void saveEdit();
      } else if (e.key === "Escape") {
        const target = e.target as HTMLElement | null;
        if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") {
          (target as HTMLInputElement | HTMLTextAreaElement).blur();
        }
        cancelEdit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, entry]);

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
  if (!entry) {
    return (
      <div className="px-10 py-16 text-xs text-[var(--color-ink-faint)]">
        {t("common.loading")}
      </div>
    );
  }

  const isRedacted = entry.body === "[redacted]";
  const editing = draft !== null;
  const dirty = editing && isDirty(draft!, entry);

  return (
    <div className="px-10 py-10 max-w-3xl mx-auto">
      <div className="flex items-baseline gap-3 text-[11px] text-[var(--color-ink-faint)]">
        <Link to="/" className="hover:text-[var(--color-ink)] uppercase">
          {t("nav.home")}
        </Link>
        <span>/</span>
        <span>#{entry.id}</span>
        <span>·</span>
        {editing ? (
          <div className="flex flex-wrap gap-1">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() =>
                  setDraft((d) => (d ? { ...d, kind: k } : d))
                }
                className={[
                  "px-1.5 py-0.5 border rounded-[3px] transition-colors",
                  draft!.kind === k
                    ? "border-[var(--color-accent)]"
                    : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]",
                ].join(" ")}
              >
                <KindBadge kind={k} />
              </button>
            ))}
          </div>
        ) : (
          <KindBadge kind={entry.kind} />
        )}
        {entry.superseded && (
          <span className="uppercase tracking-widest text-[var(--color-ink-faint)] border border-[var(--color-border)] rounded-[3px] px-1.5 py-0.5 text-[10px]">
            {t("entry.superseded")}
          </span>
        )}
        {isRedacted && (
          <span className="uppercase tracking-widest text-[var(--color-danger)] border border-[var(--color-danger)] rounded-[3px] px-1.5 py-0.5 text-[10px]">
            {t("entry.redacted")}
          </span>
        )}
      </div>

      {!editing && (
        <section className="mt-5 flex items-center flex-wrap gap-2 text-xs">
          <button
            type="button"
            onClick={beginEdit}
            disabled={busy || isRedacted}
            title={t("entry.tip_edit")}
            className="px-3 py-1.5 border border-[var(--color-border)] hover:border-[var(--color-accent)] text-[var(--color-ink-dim)] hover:text-[var(--color-accent)] disabled:opacity-30 disabled:hover:border-[var(--color-border)] disabled:hover:text-[var(--color-ink-dim)] uppercase tracking-wider transition-colors rounded-[3px]"
          >
            {t("action.edit")}
          </button>
          <Link
            to={`/write?supersedes=${entry.id}`}
            title={t("entry.tip_supersede")}
            className="px-3 py-1.5 border border-[var(--color-border)] hover:border-[var(--color-accent)] text-[var(--color-ink-dim)] hover:text-[var(--color-accent)] uppercase tracking-wider transition-colors rounded-[3px]"
          >
            {t("action.supersede")}
          </Link>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={busy || isRedacted}
            title={isRedacted ? t("entry.already_redacted") : t("entry.tip_redact")}
            className="px-3 py-1.5 border border-[var(--color-border)] hover:border-[var(--color-danger)] text-[var(--color-ink-dim)] hover:text-[var(--color-danger)] disabled:opacity-30 disabled:hover:border-[var(--color-border)] disabled:hover:text-[var(--color-ink-dim)] uppercase tracking-wider transition-colors rounded-[3px]"
          >
            {isRedacted ? t("entry.already_redacted") : t("action.redact")}
          </button>
          <button
            type="button"
            onClick={() => setConfirmDeleteOpen(true)}
            disabled={busy}
            title={t("entry.tip_delete")}
            className="ml-auto px-3 py-1.5 border border-[var(--color-border)] hover:border-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-[var(--color-bg)] text-[var(--color-ink-faint)] disabled:opacity-30 uppercase tracking-wider transition-colors rounded-[3px]"
          >
            {t("action.delete")}
          </button>
          {actionError && (
            <span className="text-[var(--color-danger)] normal-case tracking-normal basis-full">
              {actionError}
            </span>
          )}
        </section>
      )}

      {editing ? (
        <input
          value={draft!.title}
          onChange={(e) =>
            setDraft((d) => (d ? { ...d, title: e.target.value } : d))
          }
          maxLength={200}
          className="mt-4 w-full bg-transparent border-b-2 border-[var(--color-border-strong)] focus:border-[var(--color-accent)] outline-none text-3xl font-sans tracking-tight leading-tight py-1"
        />
      ) : (
        <h1 className="mt-4 text-3xl font-sans tracking-tight leading-tight">
          {entry.title}
        </h1>
      )}

      <article className="mt-8">
        {isRedacted ? (
          <div
            className="text-[var(--color-ink-faint)] italic"
            style={{ maxWidth: "68ch" }}
          >
            {entry.body}
          </div>
        ) : editing ? (
          <textarea
            value={draft!.body}
            onChange={(e) =>
              setDraft((d) => (d ? { ...d, body: e.target.value } : d))
            }
            rows={Math.min(30, Math.max(10, draft!.body.split("\n").length + 2))}
            className="w-full bg-[var(--color-surface)] border border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none rounded-[3px] p-3 font-sans text-[15px] leading-relaxed resize-y"
            style={{ maxWidth: "68ch" }}
          />
        ) : (
          <MarkdownView source={entry.body} />
        )}
      </article>

      <dl className="mt-10 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[11px] border-t border-[var(--color-border)] pt-5">
        <dt className="uppercase tracking-wider text-[var(--color-ink-faint)]">
          {t("entry.when")}
        </dt>
        <dd className="tabular">{fmtDateTime(entry.ts, locale)}</dd>

        <dt className="uppercase tracking-wider text-[var(--color-ink-faint)]">
          {t("entry.session")}
        </dt>
        <dd>{entry.session_id ?? "—"}</dd>

        {(editing || entry.tags.length > 0) && (
          <>
            <dt className="uppercase tracking-wider text-[var(--color-ink-faint)]">
              {t("entry.tags")}
            </dt>
            <dd className="flex flex-wrap gap-1.5">
              {editing ? (
                <input
                  value={draft!.tagsRaw}
                  onChange={(e) =>
                    setDraft((d) => (d ? { ...d, tagsRaw: e.target.value } : d))
                  }
                  placeholder={t("write.tags_placeholder")}
                  className="w-full bg-transparent border-b border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none py-1 text-[11px]"
                />
              ) : (
                entry.tags.map((tag) => (
                  <TagChip
                    key={tag}
                    tag={tag}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/search?q=${encodeURIComponent(tag)}`);
                    }}
                  />
                ))
              )}
            </dd>
          </>
        )}

        {entry.source_session_file && (
          <>
            <dt className="uppercase tracking-wider text-[var(--color-ink-faint)]">
              {t("entry.conversation")}
            </dt>
            <dd
              className="truncate text-[var(--color-ink-dim)]"
              title={entry.source_session_file}
            >
              {entry.source_session_file.split("/").slice(-2).join("/")}
            </dd>
          </>
        )}
      </dl>

      {(entry.outgoing.length > 0 || entry.incoming.length > 0) && (
        <section className="mt-10">
          <div className="text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]">
            {t("entry.relations")}
          </div>

          {entry.outgoing.length > 0 && (
            <NeighborList
              title={t("entry.outgoing")}
              rows={entry.outgoing.map((o) => ({
                id: o.to_id,
                relation: o.relation,
                title: o.title,
                kind: o.kind,
                dir: "out" as const,
              }))}
            />
          )}
          {entry.incoming.length > 0 && (
            <NeighborList
              title={t("entry.incoming")}
              rows={entry.incoming.map((o) => ({
                id: o.from_id,
                relation: o.relation,
                title: o.title,
                kind: o.kind,
                dir: "in" as const,
              }))}
            />
          )}
        </section>
      )}

      {editing && (
        <section className="sticky bottom-0 -mx-10 px-10 mt-12 flex items-center flex-wrap gap-3 border-t border-[var(--color-border-strong)] py-3 text-xs bg-[var(--color-bg)]/95 backdrop-blur-sm z-10 shadow-[0_-8px_16px_-12px_rgba(0,0,0,0.4)]">
          <button
            type="button"
            onClick={() => void saveEdit()}
            disabled={busy || !dirty}
            className="px-3 py-1.5 bg-[var(--color-accent)] text-[var(--color-bg)] uppercase tracking-wider rounded-[3px] disabled:opacity-30 transition-colors"
          >
            {busy ? t("write.saving") : t("action.save")}
          </button>
          <button
            type="button"
            onClick={cancelEdit}
            disabled={busy}
            className="px-3 py-1.5 border border-[var(--color-border)] hover:border-[var(--color-border-strong)] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] uppercase tracking-wider transition-colors rounded-[3px]"
          >
            {t("action.cancel")}
          </button>
          <span className="ml-auto text-[var(--color-ink-faint)] normal-case tracking-normal">
            <ShortcutHint action="S" />
          </span>
          {actionError && (
            <span className="text-[var(--color-danger)] normal-case tracking-normal basis-full">
              {actionError}
            </span>
          )}
        </section>
      )}

      <ConversationView
        entryId={entry.id}
        hasSource={!!entry.source_session_file}
        sourcePath={entry.source_session_file}
      />

      <ConfirmDialog
        open={confirmOpen}
        variant="danger"
        title={t("entry.confirm_redact_title", { id: entry.id })}
        body={t("entry.confirm_redact_body")}
        confirmLabel={t("action.redact")}
        onConfirm={() => void doRedact()}
        onCancel={() => setConfirmOpen(false)}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        variant="danger"
        title={t("entry.confirm_delete_title", { id: entry.id })}
        body={t("entry.confirm_delete_body")}
        confirmLabel={t("action.delete")}
        onConfirm={() => void doDelete()}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </div>
  );
}

function NeighborList({
  title,
  rows,
}: {
  title: string;
  rows: Array<{
    id: number;
    relation: Relation;
    title: string;
    kind: string;
    dir: "in" | "out";
  }>;
}) {
  const t = useT();
  return (
    <div className="mt-4">
      <div className="text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]">
        {title}
      </div>
      <ul className="mt-1">
        {rows.map((r) => (
          <li key={`${r.dir}-${r.id}-${r.relation}`}>
            <Link
              to={`/entry/${r.id}`}
              className="group flex items-baseline gap-3 bg-[var(--color-surface)] py-2 hover:bg-[var(--color-surface-elevated)] -mx-2 px-2 transition-colors"
            >
              <span className="text-[11px] text-[var(--color-ink-faint)] tabular w-10">
                #{r.id}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)] w-28 shrink-0">
                {t(`relation.${r.relation}`)}
              </span>
              <KindBadge kind={r.kind} />
              <span className="text-sm text-[var(--color-ink)] truncate">
                {r.title}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
