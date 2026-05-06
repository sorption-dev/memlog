import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Theme = "dark" | "light";
export const THEMES: readonly Theme[] = ["dark", "light"] as const;

const STORAGE_KEY = "memlog.theme";

function detectInitial(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // localStorage unavailable
  }
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: light)").matches
  ) {
    return "light";
  }
  return "dark";
}

/**
 * Apply theme to the DOM *synchronously*. Must run before React setState so
 * that by the time children re-render, getComputedStyle sees the new CSS
 * variables. Otherwise canvas-based consumers (Graph) read stale colors for
 * one frame after each toggle.
 */
function applyThemeToDOM(t: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, t);
  } catch {
    // ignore
  }
  document.documentElement.setAttribute("data-theme", t);
  document.documentElement.style.colorScheme = t;
}

interface Ctx {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<Ctx | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(detectInitial);

  // Safety net on mount — in case the inline <script> in index.html failed
  // or detectInitial disagrees with what the inline script set. Also opts
  // the tree into color transitions (.theme-ready in styles.css) now that
  // we've painted once with the correct theme.
  useEffect(() => {
    applyThemeToDOM(theme);
    document.documentElement.classList.add("theme-ready");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setTheme = useCallback((t: Theme) => {
    applyThemeToDOM(t); // synchronous — DOM reflects new theme BEFORE re-render
    setThemeState(t);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      applyThemeToDOM(next);
      return next;
    });
  }, []);

  const value = useMemo<Ctx>(
    () => ({ theme, setTheme, toggle }),
    [theme, setTheme, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>");
  return ctx;
}
