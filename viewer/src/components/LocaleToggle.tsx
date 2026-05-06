import { LOCALES, useLocale } from "../i18n";

export function LocaleToggle() {
  const [locale, setLocale] = useLocale();
  return (
    <div
      className="flex items-center font-mono text-[10px] uppercase tracking-wider"
      role="radiogroup"
      aria-label="locale"
    >
      {LOCALES.map((l, i) => (
        <span key={l} className="flex items-center">
          {i > 0 && <span className="px-1 text-[var(--color-ink-faint)]">·</span>}
          <button
            type="button"
            role="radio"
            aria-checked={locale === l}
            onClick={() => setLocale(l)}
            className={
              locale === l
                ? "text-[var(--color-accent)]"
                : "text-[var(--color-ink-faint)] hover:text-[var(--color-ink)] transition-colors"
            }
          >
            {l}
          </button>
        </span>
      ))}
    </div>
  );
}
