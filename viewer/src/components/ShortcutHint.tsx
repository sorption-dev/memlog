import { useT } from "../i18n";
import { MOD_KEY } from "../lib/platform";

/**
 * Renders the "{cmd} {action} to submit" hint with each key wrapped in
 * a styled <kbd>. The modifier label adapts to the host platform
 * (⌘ on macOS, "Ctrl" elsewhere); the action key is whatever the caller
 * binds (e.g. "S", "↵").
 */
export function ShortcutHint({ action }: { action: string }) {
  const t = useT();
  const cmd = MOD_KEY;
  const text = t("write.shortcut_hint", { cmd, enter: action });
  // Build a regex that matches either the modifier label or the action
  // key as a standalone token. Escape regex metachars defensively in case
  // a caller ever passes something exotic.
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${esc(cmd)}|${esc(action)})`);
  return (
    <>
      {text.split(re).map((part, i) =>
        part === cmd || part === action ? (
          <kbd
            key={i}
            className="border border-[var(--color-border)] rounded px-1 mx-[1px]"
          >
            {part}
          </kbd>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
