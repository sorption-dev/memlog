import { useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useT, useLocale } from "../i18n";
import { fmtRelative } from "../lib/format";
import type { SearchHit } from "../lib/types";
import { openInNewWindow } from "../lib/window";
import { ContextMenu } from "./ContextMenu";
import { KindBadge } from "./KindBadge";
import { TagChip } from "./TagChip";

interface Props {
  hit: SearchHit;
  dense?: boolean;
}

export function EntryCard({ hit, dense }: Props) {
  const t = useT();
  const [locale] = useLocale();
  const navigate = useNavigate();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const path = `/entry/${hit.id}`;
  // Ctrl/Cmd-click and middle-click open in a new window — same convention
  // as a browser. Plain click navigates in place.
  const openEntry = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.button === 1) {
      e.preventDefault();
      void openInNewWindow(path);
      return;
    }
    navigate(path);
  };
  const handleAuxClick = (e: MouseEvent) => {
    if (e.button === 1) {
      e.preventDefault();
      void openInNewWindow(path);
    }
  };
  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      navigate(path);
    }
  };
  const handleContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
  };
  const goToTag = (tag: string) => (e: MouseEvent) => {
    e.stopPropagation();
    navigate(`/search?q=${encodeURIComponent(tag)}`);
  };
  const goToSession = (e: MouseEvent) => {
    if (!hit.session_id) return;
    e.stopPropagation();
    navigate(`/search?session_id=${encodeURIComponent(hit.session_id)}`);
  };

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={openEntry}
      onAuxClick={handleAuxClick}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKey}
      className="group block border-t border-[var(--color-border)] py-3 -mx-2 px-2 hover:bg-[var(--color-surface)]/40 transition-colors"
    >
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-[11px] text-[var(--color-ink-faint)] tabular w-10">
          #{hit.id}
        </span>
        <KindBadge kind={hit.kind} />
        <span className="font-mono text-[11px] text-[var(--color-ink-faint)] tabular ml-auto">
          {fmtRelative(hit.ts, locale)}
        </span>
      </div>
      <div
        className={[
          "mt-1 text-[var(--color-ink)] leading-snug group-hover:text-[var(--color-accent)] transition-colors",
          dense ? "text-sm" : "text-base",
        ].join(" ")}
      >
        {hit.title}
      </div>
      {(hit.session_id || (hit.tags && hit.tags.length > 0)) && !dense && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {hit.session_id && (
            <button
              type="button"
              onClick={goToSession}
              className="font-mono text-[11px] text-[var(--color-ink-faint)] hover:text-[var(--color-accent)] transition-colors"
            >
              {hit.session_id}
            </button>
          )}
          {hit.session_id && hit.tags && hit.tags.length > 0 && (
            <span className="text-[var(--color-ink-faint)]">·</span>
          )}
          {hit.tags &&
            hit.tags
              .slice(0, 5)
              .map((tag) => (
                <TagChip key={tag} tag={tag} onClick={goToTag(tag)} />
              ))}
        </div>
      )}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              label: t("action.open"),
              onSelect: () => navigate(path),
            },
            {
              label: t("action.open_in_new_window"),
              onSelect: () => void openInNewWindow(path),
            },
          ]}
        />
      )}
    </div>
  );
}
