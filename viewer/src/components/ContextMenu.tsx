import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onScroll = () => onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  // Keep menu inside viewport.
  const vw = typeof window !== "undefined" ? window.innerWidth : 0;
  const vh = typeof window !== "undefined" ? window.innerHeight : 0;
  const W = 220;
  const H = items.length * 32 + 8;
  const left = vw && x + W > vw ? Math.max(8, vw - W - 8) : x;
  const top = vh && y + H > vh ? Math.max(8, vh - H - 8) : y;

  // The menu is rendered through a portal into document.body, but React's
  // synthetic event system still bubbles events through the *component*
  // tree — so a click on a menu item would reach the EntryCard's onClick
  // and navigate the parent window. Stop both onClick and onMouseDown
  // at the menu root.
  return createPortal(
    <div
      ref={ref}
      role="menu"
      style={{ position: "fixed", left, top, minWidth: W, zIndex: 1000 }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      className="rounded-[3px] border border-[var(--color-border-strong)] bg-[var(--color-surface-elevated)] py-1 shadow-lg"
    >
      {items.map((it) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          disabled={it.disabled}
          onClick={(e) => {
            e.stopPropagation();
            if (!it.disabled) {
              it.onSelect();
              onClose();
            }
          }}
          className="block w-full text-left px-3 py-1.5 text-xs uppercase tracking-wider text-[var(--color-ink-dim)] hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)] disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--color-ink-dim)] transition-colors"
        >
          {it.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
