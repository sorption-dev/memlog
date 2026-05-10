import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";

export interface SelectOption {
  value: string;
  label: string;
  sub?: string | number;
  color?: string | null;
}

interface Props {
  label: string;
  /** Selected values. Empty array = "any". */
  values: string[];
  onChange: (v: string[]) => void;
  options: SelectOption[];
  placeholder?: string;
  emptyHint?: string;
  width?: string;
}

export function SearchableSelect({
  label,
  values,
  onChange,
  options,
  placeholder = "any",
  emptyHint = "—",
  width = "w-52",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const active = values.length > 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.value.toLowerCase().includes(q) ||
        o.label.toLowerCase().includes(q),
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: globalThis.MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHighlight(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.children[highlight] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  const selectSingle = (v: string) => {
    onChange([v]);
    setOpen(false);
  };

  const toggleOne = (v: string) => {
    onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = filtered[highlight];
      if (!hit) return;
      // Shift+Enter → toggle (add to/remove from selection).
      if (e.shiftKey) toggleOne(hit.value);
      else selectSingle(hit.value);
    }
  };

  const headLabel = () => {
    if (!active) return placeholder;
    if (values.length === 1) {
      const current = options.find((o) => o.value === values[0]);
      return current?.label ?? values[0];
    }
    return `${values.length} selected`;
  };

  const headDot = () => {
    if (values.length === 1) {
      const current = options.find((o) => o.value === values[0]);
      return current?.color;
    }
    return null;
  };

  return (
    <div ref={wrapRef} className="relative inline-flex items-center gap-1.5">
      <span className="uppercase tracking-wider text-[var(--color-ink-faint)]">
        {label}
      </span>
      <div
        className={[
          "inline-flex items-center gap-1 border-b px-1 h-6 transition-colors",
          width,
          active
            ? "border-[var(--color-accent)] text-[var(--color-accent)]"
            : "border-[var(--color-border)] text-[var(--color-ink)]",
          open ? "border-[var(--color-accent)]" : "",
        ].join(" ")}
      >
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex-1 truncate text-left font-mono"
          title={active ? values.join(", ") : placeholder}
        >
          {active ? (
            <span className="flex items-center gap-1.5 min-w-0">
              {headDot() && (
                <span
                  aria-hidden
                  className="inline-block w-1.5 h-1.5 rounded-[1px] shrink-0"
                  style={{ background: headDot() as string }}
                />
              )}
              <span className="truncate">{headLabel()}</span>
            </span>
          ) : (
            <span className="text-[var(--color-ink-faint)]">{placeholder}</span>
          )}
        </button>
        {active ? (
          <button
            type="button"
            aria-label="clear"
            onClick={(e) => {
              e.stopPropagation();
              onChange([]);
              setOpen(false);
            }}
            className="text-[var(--color-ink-faint)] hover:text-[var(--color-danger)] leading-none text-sm px-0.5"
          >
            ×
          </button>
        ) : (
          <button
            type="button"
            aria-label="open"
            onClick={() => setOpen((o) => !o)}
            className="text-[var(--color-ink-faint)] leading-none text-[10px]"
          >
            ▾
          </button>
        )}
      </div>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-20 min-w-full bg-[var(--color-surface-solid)] border border-[var(--color-border-strong)] rounded-[3px] shadow-lg flex flex-col"
          style={{ width: "max(100%, 24rem)" }}
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={onKey}
            placeholder="filter…"
            className="bg-transparent border-b border-[var(--color-border)] outline-none px-2 py-1.5 text-xs placeholder:text-[var(--color-ink-faint)]"
          />
          <div
            ref={listRef}
            className="max-h-72 overflow-auto py-1"
            role="listbox"
            aria-multiselectable
          >
            {filtered.length === 0 ? (
              <div className="px-2 py-2 text-[11px] text-[var(--color-ink-faint)]">
                {emptyHint}
              </div>
            ) : (
              filtered.map((o, i) => {
                const selected = values.includes(o.value);
                const isHighlighted = i === highlight;
                const onCheckClick = (e: MouseEvent<HTMLButtonElement>) => {
                  // Checkbox → toggle without closing.
                  e.stopPropagation();
                  toggleOne(o.value);
                };
                return (
                  <div
                    key={o.value}
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setHighlight(i)}
                    className={[
                      "group flex items-center gap-2 px-2 py-1.5 text-xs",
                      isHighlighted
                        ? "bg-[var(--color-surface-elevated)]"
                        : "",
                    ].join(" ")}
                  >
                    <button
                      type="button"
                      onClick={onCheckClick}
                      aria-label={selected ? "deselect" : "select"}
                      className={[
                        "shrink-0 w-3.5 h-3.5 rounded-[2px] border flex items-center justify-center transition-colors",
                        selected
                          ? "border-[var(--color-accent)] bg-[var(--color-accent)]"
                          : "border-[var(--color-border-strong)] hover:border-[var(--color-accent)]",
                      ].join(" ")}
                    >
                      {selected && (
                        <span className="text-[var(--color-bg)] text-[10px] leading-none">
                          ✓
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => selectSingle(o.value)}
                      className={[
                        "flex-1 flex items-center gap-2 min-w-0 text-left",
                        selected
                          ? "text-[var(--color-accent)]"
                          : "text-[var(--color-ink-dim)] hover:text-[var(--color-ink)]",
                      ].join(" ")}
                    >
                      {o.color && (
                        <span
                          aria-hidden
                          className="inline-block w-1.5 h-1.5 rounded-[1px] shrink-0"
                          style={{ background: o.color }}
                        />
                      )}
                      <span className="truncate flex-1">{o.label}</span>
                      {o.sub !== undefined && o.sub !== "" && (
                        <span className="text-[10px] text-[var(--color-ink-faint)] tabular shrink-0">
                          {o.sub}
                        </span>
                      )}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
