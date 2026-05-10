import type { MouseEvent } from "react";

interface Props {
  tag: string;
  active?: boolean;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
}

export function TagChip({ tag, active, onClick }: Props) {
  const clickable = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={[
        "inline-block text-[11px] px-1.5 py-0.5 rounded-[3px] border transition-colors",
        active
          ? "border-[var(--color-accent)] text-[var(--color-accent)]"
          : "border-[var(--color-border)] text-[var(--color-ink-dim)]",
        clickable
          ? "hover:border-[var(--color-border-strong)] hover:text-[var(--color-ink)]"
          : "",
      ].join(" ")}
    >
      {tag}
    </button>
  );
}
