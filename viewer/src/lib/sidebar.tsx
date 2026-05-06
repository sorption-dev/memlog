/**
 * Sidebar collapse state, shared between Layout (the aside itself) and
 * TitleBar (the toggle button).
 *
 * Source-of-truth precedence on first mount:
 *   1. `?sidebar=collapsed|expanded` in the URL — used by `openInNewWindow`
 *      so detached windows always start collapsed regardless of what the
 *      main window's localStorage says. URL takes effect once and is NOT
 *      written back to localStorage.
 *   2. `localStorage["memlog.sidebar.collapsed"]` — last value the user
 *      toggled in any window.
 *   3. Default: expanded.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "memlog.sidebar.collapsed";
const URL_PARAM = "sidebar";

interface SidebarCtx {
  collapsed: boolean;
  toggle: () => void;
  setCollapsed: (next: boolean) => void;
}

const Ctx = createContext<SidebarCtx | null>(null);

function readInitial(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const url = new URL(window.location.href);
    const p = url.searchParams.get(URL_PARAM);
    if (p === "collapsed") return true;
    if (p === "expanded") return false;
  } catch {
    /* ignore — fall through to localStorage */
  }
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsedRaw] = useState<boolean>(readInitial);

  // After the first render, drop the ?sidebar= param from the visible URL
  // so a refresh / share inside the SPA isn't sticky to it. localStorage
  // (or the user's next toggle) becomes the source of truth from then on.
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has(URL_PARAM)) {
        url.searchParams.delete(URL_PARAM);
        window.history.replaceState(
          null,
          "",
          url.pathname + (url.search ? url.search : "") + url.hash,
        );
      }
    } catch {
      /* noop */
    }
  }, []);

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedRaw(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* noop */
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsedRaw((c) => {
      const next = !c;
      try {
        localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        /* noop */
      }
      return next;
    });
  }, []);

  const value = useMemo<SidebarCtx>(
    () => ({ collapsed, toggle, setCollapsed }),
    [collapsed, toggle, setCollapsed],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSidebar(): SidebarCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSidebar must be used inside <SidebarProvider>");
  return ctx;
}
