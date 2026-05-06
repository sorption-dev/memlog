export const LOCALES = ["en", "ru"] as const;
export type Locale = (typeof LOCALES)[number];

export type Dict = Record<string, string>;

/**
 * Variables for interpolation. `count` is special — when provided, lookup
 * prefers key_<pluralCategory> (one | few | many | other) based on
 * Intl.PluralRules for the active locale, falling back to the plain key.
 */
export type TVars = { count?: number } & Record<string, string | number>;
