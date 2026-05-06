import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useT } from "../i18n";
import { SidebarProvider, useSidebar } from "../lib/sidebar";
import { LocaleToggle } from "./LocaleToggle";
import { NavBar } from "./NavBar";
import { ThemeToggle } from "./ThemeToggle";
import { TitleBar } from "./TitleBar";

const NAV = [
  { to: "/", key: "nav.home", end: true },
  { to: "/search", key: "nav.search", end: false },
  { to: "/projects", key: "nav.projects", end: false },
  { to: "/graph", key: "nav.graph", end: false },
] as const;

const META_NAV = [
  { to: "/stats", key: "nav.stats", end: false },
] as const;

const ZOOM_MIN = 0.6;
const ZOOM_MAX = 2.0;
const ROOT_FONT_BASE_PX = 16;

// We scale the whole UI by changing :root's font-size; rem-based widths
// (Tailwind's `w-48`, `max-w-3xl`, padding, etc.) then scale together
// with text. `body.style.zoom` looked simpler but it leaves rem layout
// constraints frozen, so post pages got wider text in a same-width
// container — the container read as 48rem of pre-zoom pixels.
function currentZoom(): number {
  const saved = Number(localStorage.getItem("memlog.zoom"));
  return Number.isFinite(saved) && saved > 0 ? saved : 1;
}

function applyZoom(next: number): void {
  const clamped = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.round(next * 10) / 10));
  document.documentElement.style.fontSize = `${clamped * ROOT_FONT_BASE_PX}px`;
  localStorage.setItem("memlog.zoom", String(clamped));
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  [
    "relative px-3 py-1.5 font-mono text-xs uppercase tracking-wider rounded-[3px] transition-colors",
    isActive
      ? "text-[var(--color-accent)]"
      : "text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] hover:bg-[var(--color-surface-elevated)]",
  ].join(" ");

export function Layout() {
  return (
    <SidebarProvider>
      <LayoutInner />
    </SidebarProvider>
  );
}

function LayoutInner() {
  const navigate = useNavigate();
  const t = useT();
  const { collapsed: sidebarCollapsed, toggle: toggleSidebar } = useSidebar();
  const [mainEl, setMainEl] = useState<HTMLElement | null>(null);

  useEffect(() => {
    // Restore saved zoom on mount. Tauri's webview has no built-in ⌘+/⌘-
    // so we drive it from JS by scaling the root font-size; persist the
    // multiplier across sessions in localStorage.
    applyZoom(currentZoom());

    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      // Browser-style zoom: ⌘=/⌘+, ⌘-, ⌘0 (works on any keyboard layout
      // because e.code reports the physical key).
      if (mod && (e.code === "Equal" || e.code === "NumpadAdd")) {
        e.preventDefault();
        applyZoom(currentZoom() + 0.1);
        return;
      }
      if (mod && (e.code === "Minus" || e.code === "NumpadSubtract")) {
        e.preventDefault();
        applyZoom(currentZoom() - 0.1);
        return;
      }
      if (mod && (e.code === "Digit0" || e.code === "Numpad0")) {
        e.preventDefault();
        applyZoom(1);
        return;
      }

      // Browser-style sidebar toggle (⌘B / Ctrl+B), matching VS Code, Notion, etc.
      if (mod && e.code === "KeyB" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      const el = e.target as HTMLElement | null;
      const inInput =
        el?.tagName === "INPUT" ||
        el?.tagName === "TEXTAREA" ||
        el?.isContentEditable;
      if (inInput) return;
      // Use e.code (physical key) instead of e.key so the shortcut works on
      // any keyboard layout — on a Russian layout "/" prints "." but the
      // physical key still reports "Slash".
      if (
        (e.code === "Slash" || e.code === "NumpadDivide") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      ) {
        e.preventDefault();
        navigate("/search");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, toggleSidebar]);

  // Tray menu ("Search…", "New entry") emits navigation events; honour them.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<string>("memlog://navigate", (e) => {
      navigate(e.payload);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [navigate]);

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <TitleBar />
      <div className="flex-1 flex overflow-hidden">
      <aside
        aria-hidden={sidebarCollapsed}
        className={[
          "shrink-0 overflow-hidden transition-[width,border-right-width] duration-200 ease-out",
          sidebarCollapsed
            ? "w-0 border-r-0"
            : "w-48 border-r border-[var(--color-border)]",
        ].join(" ")}
      >
        <div className="w-48 h-full px-5 py-6 flex flex-col gap-8 overflow-y-auto">
        <NavLink to="/" className="block leading-none">
          <div className="font-sans text-xl tracking-tight">memlog</div>
          <div className="font-mono text-[10px] text-[var(--color-ink-faint)] mt-1">
            {t("layout.tagline")}
          </div>
        </NavLink>

        <nav className="flex flex-col">
          <NavLink
            to="/write"
            className={({ isActive }) =>
              [
                "flex items-center gap-2 px-2.5 py-1.5 font-mono text-xs uppercase tracking-wider rounded-[3px] transition-colors border",
                isActive
                  ? "bg-[var(--color-accent)] border-[var(--color-accent)] text-[var(--color-bg)]"
                  : "border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-bg)]",
              ].join(" ")
            }
          >
            <span aria-hidden className="text-sm leading-none">
              +
            </span>
            <span>{t("nav.write")}</span>
          </NavLink>

          <div className="flex flex-col gap-0.5 -mx-2 mt-6">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={navLinkClass}>
                {t(n.key)}
              </NavLink>
            ))}
          </div>

          <div className="flex flex-col gap-0.5 -mx-2 mt-6">
            {META_NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={navLinkClass}>
                {t(n.key)}
              </NavLink>
            ))}
          </div>
        </nav>

        <div className="mt-auto flex flex-col gap-4 text-[var(--color-ink-faint)]">
          <div className="font-mono text-[10px] text-[var(--color-ink-faint)]">
            {t("layout.kbd_search", {
              key: "⟨/⟩",
            })
              .split("⟨/⟩")
              .flatMap((part, i, arr) => [
                part,
                i < arr.length - 1 ? (
                  <kbd
                    key={i}
                    className="border border-[var(--color-border)] rounded px-1 font-mono"
                  >
                    /
                  </kbd>
                ) : null,
              ])}
          </div>
          <div className="flex items-center justify-between gap-3">
            <LocaleToggle />
            <ThemeToggle />
          </div>
        </div>
        </div>
      </aside>

      <main
        ref={setMainEl}
        className="flex-1 min-w-0 overflow-y-auto overscroll-none"
      >
        <NavBar scrollRoot={mainEl} />
        <Outlet />
      </main>
      </div>
    </div>
  );
}
