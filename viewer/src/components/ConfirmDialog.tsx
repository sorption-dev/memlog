/**
 * Themed confirm dialog.
 *
 * Tauri v2's WKWebView on macOS silently drops `window.confirm()` /
 * `window.alert()` (WebKit blocks them when the webview has no JS
 * prompt delegate wired up), so we render our own modal instead.
 * Keeps full control over typography + matches the editorial style.
 */
import { useEffect, useRef } from "react";
import { useT } from "../i18n";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  variant?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel,
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const t = useT();
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const prevFocus = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onConfirm();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prevFocus?.focus?.();
    };
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  const confirmBtn =
    variant === "danger"
      ? "border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-[var(--color-bg)]"
      : "border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)]";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-bg)]/70 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-[min(26rem,90vw)] bg-[var(--color-bg)] border border-[var(--color-border-strong)] rounded-[3px] p-6 shadow-2xl">
        <h2 className="font-sans text-lg tracking-tight leading-tight">
          {title}
        </h2>
        {body && (
          <p className="mt-3 text-sm text-[var(--color-ink-dim)] leading-relaxed whitespace-pre-wrap">
            {body}
          </p>
        )}
        <div className="mt-6 flex items-center justify-end gap-2 font-mono text-xs uppercase tracking-wider">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 border border-[var(--color-border)] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] hover:border-[var(--color-border-strong)] rounded-[3px] transition-colors"
          >
            {cancelLabel ?? t("action.cancel")}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className={`px-3 py-1.5 border rounded-[3px] transition-colors ${confirmBtn}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
