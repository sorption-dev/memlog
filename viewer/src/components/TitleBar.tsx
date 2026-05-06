/**
 * Custom title bar (Docker Desktop-style).
 *
 * macOS — native traffic lights stay (titleBarStyle: Overlay), we leave a
 *         ~72px gap on the left so our content doesn't overlap them. No
 *         min/max/close buttons — the native ones already work.
 * Win/Linux — full custom chrome. We draw min/max/close on the right.
 *
 * Drag is done via `data-tauri-drag-region` (the CSS `-webkit-app-region`
 * trick is Electron-only; Tauri's webview ignores it). The attribute does
 * not inherit, so every drag-eligible child must carry it too. Interactive
 * elements (buttons) simply omit it.
 */
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSidebar } from "../lib/sidebar";
import { useT } from "../i18n";

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function TitleBar() {
  const [maximized, setMaximized] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const { collapsed, toggle } = useSidebar();
  const t = useT();

  useEffect(() => {
    const w = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    const refresh = () => {
      void w.isMaximized().then(setMaximized);
      void w.isFullscreen().then(setFullscreen);
    };
    refresh();
    void w.onResized(refresh).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  // In macOS fullscreen the native menu bar + traffic lights auto-hide; our
  // React chrome would look asymmetric if it stayed, so we collapse it too.
  // Back/forward + drag are reachable via keyboard and the in-content NavBar.
  if (fullscreen) return null;

  return (
    <div
      data-tauri-drag-region
      className="relative flex items-stretch h-8 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-bg)] select-none"
    >
      {/* Reserve room for macOS traffic lights so the sidebar toggle doesn't
          overlap them. On Win/Linux we draw our own controls on the right. */}
      {isMac && <div data-tauri-drag-region className="w-[72px]" />}
      <SidebarToggle
        collapsed={collapsed}
        onToggle={toggle}
        title={
          collapsed ? t("sidebar.expand") : t("sidebar.collapse")
        }
      />
      <div data-tauri-drag-region className="flex-1" />
      {!isMac && <WindowControls maximized={maximized} />}
    </div>
  );
}

function SidebarToggle({
  collapsed,
  onToggle,
  title,
}: {
  collapsed: boolean;
  onToggle: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      onClick={onToggle}
      className="h-full px-2.5 flex items-center justify-center text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-ink)] transition-colors"
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
        <rect
          x="2"
          y="3"
          width="12"
          height="10"
          rx="1"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
        <line
          x1="6.25"
          y1="3"
          x2="6.25"
          y2="13"
          stroke="currentColor"
          strokeWidth="1"
        />
        {collapsed ? (
          // small caret inside the rail, hinting "expand"
          <path
            d="M3.5 6.5 L4.75 8 L3.5 9.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : (
          <path
            d="M4.75 6.5 L3.5 8 L4.75 9.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </button>
  );
}

function WindowControls({ maximized }: { maximized: boolean }) {
  const win = getCurrentWindow();
  const btn =
    "h-full px-3 flex items-center justify-center text-[var(--color-ink-dim)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-ink)] transition-colors";

  return (
    <div className="flex items-stretch">
      <button
        type="button"
        aria-label="minimize"
        onClick={() => void win.minimize()}
        className={btn}
      >
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect x="2" y="5.5" width="8" height="1" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        aria-label={maximized ? "restore" : "maximize"}
        onClick={() => void win.toggleMaximize()}
        className={btn}
      >
        <svg width="12" height="12" viewBox="0 0 12 12">
          <rect
            x="2.5"
            y="2.5"
            width="7"
            height="7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
          />
        </svg>
      </button>
      <button
        type="button"
        aria-label="close"
        onClick={() => void win.close()}
        className={`${btn} hover:!bg-[var(--color-danger)] hover:!text-[var(--color-bg)]`}
      >
        <svg width="12" height="12" viewBox="0 0 12 12">
          <path
            d="M2.5 2.5 L9.5 9.5 M9.5 2.5 L2.5 9.5"
            stroke="currentColor"
            strokeWidth="1"
          />
        </svg>
      </button>
    </div>
  );
}
