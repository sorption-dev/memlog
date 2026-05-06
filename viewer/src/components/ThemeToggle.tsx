import { useTheme } from "../theme";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`switch to ${theme === "dark" ? "light" : "dark"} theme`}
      className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] transition-colors"
    >
      <span aria-hidden className="inline-block text-sm leading-none">
        {theme === "dark" ? "◐" : "◑"}
      </span>
      <span>{theme === "dark" ? "dark" : "light"}</span>
    </button>
  );
}
