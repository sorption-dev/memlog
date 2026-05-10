import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useT, useLocale } from "../i18n";
import { api } from "../lib/api";
import { fmtRelative } from "../lib/format";
import type { ProjectGroupWithMembers, SessionSummary } from "../lib/types";

export function ProjectsPage() {
  const t = useT();
  const [locale] = useLocale();

  const [groups, setGroups] = useState<ProjectGroupWithMembers[] | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const refresh = useCallback(() => {
    Promise.all([api.listGroups(), api.sessions()])
      .then(([g, s]) => {
        setGroups(g);
        setSessions(s);
        setError(null);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

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

  const loading = groups === null || sessions === null;

  return (
    <div className="px-10 py-10 max-w-5xl mx-auto">
      <header className="mb-10">
        <div className="text-[11px] uppercase tracking-wider text-[var(--color-ink-faint)]">
          {t("projects.overline")}
        </div>
        <h1 className="mt-1 text-4xl font-sans tracking-tight display-rule">
          {t("projects.title")}
        </h1>
      </header>

      {/* Groups */}
      <section>
        <div className="flex items-baseline justify-between">
          <div className="text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]">
            {t("projects.groups_section")}
          </div>
          {!creating && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="text-[11px] uppercase tracking-wider text-[var(--color-accent)] hover:text-[var(--color-ink)] transition-colors"
            >
              + {t("projects.new_group")}
            </button>
          )}
        </div>

        {creating && (
          <NewGroupForm
            onCancel={() => setCreating(false)}
            onCreated={() => {
              setCreating(false);
              refresh();
            }}
          />
        )}

        <div className="mt-4">
          {loading ? (
            <div className="text-xs text-[var(--color-ink-faint)]">
              {t("common.loading")}
            </div>
          ) : (groups?.length ?? 0) === 0 && !creating ? (
            <div className="text-xs text-[var(--color-ink-faint)] py-3">
              {t("projects.no_groups")}
            </div>
          ) : (
            <ul className="flex flex-col">
              {groups!.map((g) => (
                <GroupRow
                  key={g.id}
                  group={g}
                  allSessions={sessions ?? []}
                  expanded={expandedGroup === g.name}
                  onToggle={() =>
                    setExpandedGroup(expandedGroup === g.name ? null : g.name)
                  }
                  onChange={refresh}
                />
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* All projects */}
      <section className="mt-14">
        <div className="text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]">
          {t("projects.sessions_section")}
        </div>
        <div className="mt-4">
          {loading ? (
            <div className="text-xs text-[var(--color-ink-faint)]">
              {t("common.loading")}
            </div>
          ) : (sessions?.length ?? 0) === 0 ? (
            <div className="text-xs text-[var(--color-ink-faint)]">
              {t("projects.sessions_empty")}
            </div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)] border-y border-[var(--color-border)]">
                  <th className="text-left font-normal px-2 py-2">
                    {t("projects.col_session")}
                  </th>
                  <th className="text-right font-normal px-2 py-2 whitespace-nowrap">
                    {t("projects.col_entries")}
                  </th>
                  <th className="text-right font-normal px-2 py-2 whitespace-nowrap">
                    {t("projects.col_last")}
                  </th>
                  <th className="text-left font-normal px-2 py-2 whitespace-nowrap">
                    {t("projects.col_in_groups")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sessions!.map((s) => (
                  <tr
                    key={s.session_id}
                    className="border-b border-[var(--color-border)] group hover:bg-[var(--color-surface)]/30 transition-colors"
                  >
                    <td className="px-2 py-2 min-w-0">
                      <Link
                        to={`/search?session_id=${encodeURIComponent(s.session_id)}`}
                        className="text-sm text-[var(--color-ink)] group-hover:text-[var(--color-accent)] truncate block"
                      >
                        {s.session_id}
                      </Link>
                    </td>
                    <td className="px-2 py-2 text-xs tabular text-[var(--color-ink-dim)] text-right whitespace-nowrap">
                      {s.entry_count}
                    </td>
                    <td className="px-2 py-2 text-xs tabular text-[var(--color-ink-faint)] text-right whitespace-nowrap">
                      {fmtRelative(s.last_ts, locale)}
                    </td>
                    <td className="px-2 py-2">
                      {s.groups.length === 0 ? (
                        <span className="text-[11px] text-[var(--color-ink-faint)] opacity-50">
                          —
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {s.groups.map((g) => (
                            <span
                              key={g}
                              className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 border border-[var(--color-border)] rounded-[3px] text-[var(--color-ink-dim)] whitespace-nowrap"
                            >
                              {g}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}

function NewGroupForm({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: () => void;
}) {
  const t = useT();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [color, setColor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createGroup({
        name: name.trim(),
        description: desc.trim() || null,
        color: color.trim() || null,
      });
      onCreated();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 border border-[var(--color-border)] rounded-[3px] p-4 flex flex-col gap-3">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-3">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value.replace(/\s+/g, "-"))}
          placeholder={t("projects.new_group_name")}
          className="bg-transparent border-b border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none py-1 text-sm"
        />
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder={t("projects.new_group_desc")}
          className="bg-transparent border-b border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none py-1 text-sm"
        />
        <input
          value={color}
          onChange={(e) => setColor(e.target.value)}
          placeholder="#f08c4d"
          maxLength={7}
          className="bg-transparent border-b border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none py-1 text-sm w-24"
          style={{ color: color || undefined }}
        />
      </div>
      {error && (
        <div className="text-xs text-[var(--color-danger)] font-mono">{error}</div>
      )}
      <div className="flex items-center gap-2 text-[11px]">
        <button
          type="button"
          disabled={busy || !name.trim()}
          onClick={() => void submit()}
          className="px-3 py-1 bg-[var(--color-accent)] text-[var(--color-bg)] uppercase tracking-widest rounded-[3px] hover:bg-[var(--color-accent-dim)] disabled:opacity-50 transition-colors"
        >
          {t("action.create")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1 border border-[var(--color-border)] uppercase tracking-widest rounded-[3px] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] hover:border-[var(--color-border-strong)] transition-colors"
        >
          {t("action.cancel")}
        </button>
      </div>
    </div>
  );
}

function EditGroupForm({
  group,
  onCancel,
  onSaved,
}: {
  group: ProjectGroupWithMembers;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(group.name);
  const [desc, setDesc] = useState(group.description ?? "");
  const [color, setColor] = useState(group.color ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    name.trim() !== group.name ||
    (desc.trim() || null) !== (group.description ?? null) ||
    (color.trim() || null) !== (group.color ?? null);

  const submit = async () => {
    if (!name.trim() || !dirty) return;
    setBusy(true);
    setError(null);
    try {
      await api.updateGroup(group.name, {
        name: name.trim() !== group.name ? name.trim() : undefined,
        description: desc.trim() || null,
        color: color.trim() || null,
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 border border-[var(--color-border)] rounded-[3px] p-4 flex flex-col gap-3">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-3">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value.replace(/\s+/g, "-"))}
          placeholder={t("projects.new_group_name")}
          className="bg-transparent border-b border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none py-1 text-sm"
        />
        <input
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          placeholder={t("projects.new_group_desc")}
          className="bg-transparent border-b border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none py-1 text-sm"
        />
        <div className="flex items-center gap-2">
          <input
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="#f08c4d"
            maxLength={7}
            className="bg-transparent border-b border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none py-1 text-sm w-24"
            style={{ color: color || undefined }}
          />
          <input
            type="color"
            value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#f08c4d"}
            onChange={(e) => setColor(e.target.value)}
            className="w-6 h-6 bg-transparent border border-[var(--color-border)] rounded-[3px] cursor-pointer p-0"
            title={t("projects.new_group_color")}
          />
        </div>
      </div>
      {error && (
        <div className="text-xs text-[var(--color-danger)] font-mono">{error}</div>
      )}
      <div className="flex items-center gap-2 text-[11px]">
        <button
          type="button"
          disabled={busy || !name.trim() || !dirty}
          onClick={() => void submit()}
          className="px-3 py-1 bg-[var(--color-accent)] text-[var(--color-bg)] uppercase tracking-widest rounded-[3px] hover:bg-[var(--color-accent-dim)] disabled:opacity-50 transition-colors"
        >
          {t("action.save")}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1 border border-[var(--color-border)] uppercase tracking-widest rounded-[3px] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] hover:border-[var(--color-border-strong)] transition-colors"
        >
          {t("action.cancel")}
        </button>
      </div>
    </div>
  );
}

function GroupRow({
  group,
  allSessions,
  expanded,
  onToggle,
  onChange,
}: {
  group: ProjectGroupWithMembers;
  allSessions: SessionSummary[];
  expanded: boolean;
  onToggle: () => void;
  onChange: () => void;
}) {
  const t = useT();
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const candidates = useMemo(
    () =>
      allSessions
        .filter((s) => !group.members.includes(s.session_id))
        .map((s) => s.session_id),
    [allSessions, group.members],
  );

  const addMember = async (sid: string) => {
    setBusy(true);
    try {
      await api.addGroupMember(group.name, sid);
      setAdding("");
      onChange();
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (sid: string) => {
    setBusy(true);
    try {
      await api.removeGroupMember(group.name, sid);
      onChange();
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    setConfirmDelete(false);
    setBusy(true);
    try {
      await api.deleteGroup(group.name);
      onChange();
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="border-t border-[var(--color-border)] py-3">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex-1 text-left group min-w-0"
        >
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="text-base leading-none text-[var(--color-ink-faint)] group-hover:text-[var(--color-accent)] w-4 inline-flex justify-center shrink-0"
            >
              {expanded ? "▾" : "▸"}
            </span>
            <span
              aria-hidden
              className="inline-block w-2.5 h-2.5 rounded-[1px] shrink-0"
              style={{ background: group.color || "var(--color-border-strong)" }}
            />
            <span className="text-sm text-[var(--color-ink)] group-hover:text-[var(--color-accent)]">
              {group.name}
            </span>
            <span className="text-[11px] text-[var(--color-ink-faint)] tabular">
              {t("projects.member_count", { count: group.member_count })} ·{" "}
              {t("projects.entry_count", { count: group.entry_count })}
            </span>
          </div>
          {group.description && (
            <div className="mt-0.5 text-xs text-[var(--color-ink-dim)] truncate pl-[30px]">
              {group.description}
            </div>
          )}
        </button>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            disabled={busy}
            className="text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)] hover:text-[var(--color-accent)] transition-colors"
          >
            {editing ? t("action.cancel") : t("action.edit")}
          </button>
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={busy}
            className="text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)] hover:text-[var(--color-danger)] transition-colors"
          >
            {t("action.delete")}
          </button>

          <ConfirmDialog
            open={confirmDelete}
            variant="danger"
            title={t("projects.confirm_delete", { name: group.name })}
            confirmLabel={t("action.delete")}
            onConfirm={() => void doDelete()}
            onCancel={() => setConfirmDelete(false)}
          />
        </div>

        <Link
          to={`/search?group=${encodeURIComponent(group.name)}`}
          className="ml-4 text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)] hover:text-[var(--color-accent)] transition-colors"
        >
          {t("action.search_in")}
        </Link>
      </div>

      {editing && (
        <EditGroupForm
          group={group}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChange();
          }}
        />
      )}

      {expanded && (
        <div className="mt-3 ml-5 flex flex-col gap-2">
          <div className="text-[10px] uppercase tracking-widest text-[var(--color-ink-faint)]">
            {t("projects.members")}
          </div>
          {group.members.length === 0 ? (
            <div className="text-xs text-[var(--color-ink-faint)]">
              {t("projects.no_members")}
            </div>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {group.members.map((m) => (
                <li
                  key={m}
                  className="inline-flex items-center gap-1.5 text-xs border border-[var(--color-border)] rounded-[3px] pl-2 pr-1 py-0.5"
                >
                  <Link
                    to={`/search?session_id=${encodeURIComponent(m)}`}
                    className="text-[var(--color-ink-dim)] hover:text-[var(--color-accent)]"
                  >
                    {m}
                  </Link>
                  <button
                    type="button"
                    onClick={() => void removeMember(m)}
                    disabled={busy}
                    aria-label={`remove ${m}`}
                    className="text-[var(--color-ink-faint)] hover:text-[var(--color-danger)] w-4 h-4 leading-none"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-1 flex items-center gap-2">
            <select
              value={adding}
              onChange={(e) => {
                const v = e.target.value;
                if (v) void addMember(v);
              }}
              disabled={busy || candidates.length === 0}
              className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-[3px] px-2 py-1 text-[var(--color-ink)] text-xs outline-none focus:border-[var(--color-accent)]"
            >
              <option value="">
                {candidates.length === 0
                  ? "—"
                  : t("projects.select_project")}
              </option>
              {candidates.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </li>
  );
}
