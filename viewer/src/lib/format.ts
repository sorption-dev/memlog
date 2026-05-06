import { makeT } from "../i18n";
import type { Locale } from "../i18n";

const INTL_LOCALE: Record<Locale, string> = {
  en: "en-US",
  ru: "ru-RU",
};

function dateFormatter(locale: Locale) {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function timeFormatter(locale: Locale) {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDate(iso: string, locale: Locale = "en"): string {
  try {
    return dateFormatter(locale).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export function fmtDateTime(iso: string, locale: Locale = "en"): string {
  try {
    const d = new Date(iso);
    return `${dateFormatter(locale).format(d)} · ${timeFormatter(locale).format(d)}`;
  } catch {
    return iso.slice(0, 16);
  }
}

/**
 * Relative formatter — we reach into the i18n dict for "N minutes ago" plural
 * forms. Can't use useT() here because this is a pure helper, so we rebuild a
 * one-shot translator for the given locale. Cheap — just a dict lookup.
 */
export function fmtRelative(iso: string, locale: Locale, now: number = Date.now()): string {
  const t = makeT(locale);
  const then = new Date(iso).getTime();
  const ms = now - then;
  if (ms < 60_000) return t("time.just_now");
  if (ms < 3600_000) {
    const n = Math.floor(ms / 60_000);
    return t("time.minutes_ago", { count: n, n });
  }
  if (ms < 86400_000) {
    const n = Math.floor(ms / 3600_000);
    return t("time.hours_ago", { count: n, n });
  }
  const days = Math.floor(ms / 86400_000);
  if (days < 7) return t("time.days_ago", { count: days, n: days });
  return fmtDate(iso, locale);
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function kindColor(kind: string): string {
  return `var(--color-kind-${kind})`;
}
