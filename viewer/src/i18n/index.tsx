import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { en } from "./en";
import { ru } from "./ru";
import { LOCALES, type Dict, type Locale, type TVars } from "./types";

const DICTS: Record<Locale, Dict> = { en, ru };
const STORAGE_KEY = "memlog.locale";

/** English is the fallback — every key that exists in `ru` MUST exist in `en`. */
const FALLBACK_DICT = DICTS.en;

function detectInitial(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && (LOCALES as readonly string[]).includes(saved)) return saved as Locale;
  } catch {
    // localStorage unavailable
  }
  const nav = typeof navigator !== "undefined" ? navigator.language : "en";
  return nav.startsWith("ru") ? "ru" : "en";
}

function interpolate(raw: string, vars?: TVars): string {
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => {
    const v = vars[name];
    return v == null ? `{${name}}` : String(v);
  });
}

/**
 * Translator that is *not* React-aware. Useful for helpers (format.ts).
 * Components should prefer useT() so they re-render on locale change.
 */
export function makeT(locale: Locale) {
  const dict = DICTS[locale];
  const pr = new Intl.PluralRules(locale);
  return function t(key: string, vars?: TVars): string {
    let actual = key;
    if (typeof vars?.count === "number") {
      const cat = pr.select(vars.count);
      const candidate = `${key}_${cat}`;
      if (candidate in dict || candidate in FALLBACK_DICT) {
        actual = candidate;
      }
    }
    const raw = dict[actual] ?? FALLBACK_DICT[actual] ?? key;
    return interpolate(raw, vars);
  };
}

interface Ctx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, vars?: TVars) => string;
}

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitial);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
      document.documentElement.lang = locale;
    } catch {
      // ignore
    }
  }, [locale]);

  const t = useMemo(() => makeT(locale), [locale]);
  const setLocale = useCallback((l: Locale) => setLocaleState(l), []);
  const value = useMemo<Ctx>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used within <I18nProvider>");
  return ctx.t;
}

export function useLocale(): [Locale, (l: Locale) => void] {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useLocale must be used within <I18nProvider>");
  return [ctx.locale, ctx.setLocale];
}

export { LOCALES } from "./types";
export type { Locale } from "./types";
