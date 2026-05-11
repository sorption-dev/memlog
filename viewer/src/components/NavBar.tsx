/**
 * Browser-like back/forward for the app.
 *
 *   · keyboard — ⌘[/⌘] (macOS), Alt+←/→ (everywhere)
 *   · mouse    — side buttons X1/X2 (button codes 3/4)
 *   · swipe    — horizontal wheel deltas from touchpads. Accumulated over
 *                a short window; once a gesture fires, further fires are
 *                suppressed until the deltaX stream pauses (the user lifts
 *                their fingers) — a fixed cooldown doesn't beat the inertia
 *                tail of a fast flick.
 *
 * React Router v6+'s BrowserRouter stores a 0-based position at
 * `window.history.state.idx`, so we don't have to maintain a parallel
 * stack to know whether forward is available.
 *
 * The visible buttons live in the TitleBar (see HistoryNavButtons below).
 * All global listeners are owned by `useHistoryNavListeners`, attached
 * once from Layout — the buttons are pure UI.
 */
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const SWIPE_TRIGGER_PX = 80;
const SWIPE_IDLE_RESET_MS = 120;

function isEditable(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return (
    t?.tagName === "INPUT" ||
    t?.tagName === "TEXTAREA" ||
    !!t?.isContentEditable
  );
}

function hasHorizontalScrollAncestor(
  el: HTMLElement | null,
  stop: HTMLElement,
): boolean {
  let cur: HTMLElement | null = el;
  while (cur && cur !== stop) {
    if (cur.scrollWidth > cur.clientWidth) {
      const overflow = getComputedStyle(cur).overflowX;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
    cur = cur.parentElement;
  }
  return false;
}

function readCans(): { canGoBack: boolean; canGoForward: boolean } {
  const idx = (window.history.state?.idx as number | undefined) ?? 0;
  return {
    canGoBack: idx > 0,
    canGoForward: idx < window.history.length - 1,
  };
}

/** Returns current can-flags; re-renders on location changes. */
export function useHistoryNav() {
  const location = useLocation();
  void location;
  const navigate = useNavigate();
  const { canGoBack, canGoForward } = readCans();
  return {
    canGoBack,
    canGoForward,
    goBack: () => {
      if (readCans().canGoBack) navigate(-1);
    },
    goForward: () => {
      if (readCans().canGoForward) navigate(1);
    },
  };
}

/**
 * Attach window-level keyboard + mouse-button + wheel handlers that drive
 * back/forward. Call once from a stable parent (Layout). Reads the latest
 * can-flags from `window.history.state` at fire time so we don't need to
 * subscribe.
 */
export function useHistoryNavListeners(scrollRoot: HTMLElement | null): void {
  const navigate = useNavigate();
  const navRef = useRef(navigate);
  navRef.current = navigate;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const back =
        (e.metaKey && e.code === "BracketLeft") ||
        (e.altKey && e.code === "ArrowLeft");
      const fwd =
        (e.metaKey && e.code === "BracketRight") ||
        (e.altKey && e.code === "ArrowRight");
      if (back) {
        e.preventDefault();
        if (readCans().canGoBack) navRef.current(-1);
      } else if (fwd) {
        e.preventDefault();
        if (readCans().canGoForward) navRef.current(1);
      }
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        if (readCans().canGoBack) navRef.current(-1);
      } else if (e.button === 4) {
        e.preventDefault();
        if (readCans().canGoForward) navRef.current(1);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onMouse);
    };
  }, []);

  useEffect(() => {
    if (!scrollRoot) return;
    let accum = 0;
    let lastEventAt = 0;
    // Latched after a successful fire — cleared only after a real pause
    // in the deltaX stream (user lifted fingers). A time-based cooldown
    // wasn't enough: on a fast flick the inertia tail keeps producing
    // deltaX well past the cooldown and triggered a second nav.
    let firedInGesture = false;

    const onWheel = (e: WheelEvent) => {
      const now = performance.now();
      // A gap between events ≥ idle threshold ends the current gesture.
      if (now - lastEventAt > SWIPE_IDLE_RESET_MS) {
        accum = 0;
        firedInGesture = false;
      }
      lastEventAt = now;

      // Vertical-dominant motion is a normal scroll — leave it alone.
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) {
        accum = 0;
        return;
      }
      // Yield to content that wants horizontal scroll (wide tables / pre).
      if (hasHorizontalScrollAncestor(e.target as HTMLElement, scrollRoot)) {
        accum = 0;
        return;
      }
      if (firedInGesture) return;

      accum += e.deltaX;
      if (Math.abs(accum) < SWIPE_TRIGGER_PX) return;

      const direction = accum > 0 ? 1 : -1;
      firedInGesture = true;
      accum = 0;
      if (direction < 0 && readCans().canGoBack) navRef.current(-1);
      else if (direction > 0 && readCans().canGoForward) navRef.current(1);
    };

    scrollRoot.addEventListener("wheel", onWheel, { passive: true });
    return () => scrollRoot.removeEventListener("wheel", onWheel);
  }, [scrollRoot]);
}

/** Compact back/forward button pair. Designed to live in the title bar. */
export function HistoryNavButtons() {
  const { canGoBack, canGoForward, goBack, goForward } = useHistoryNav();
  if (!canGoBack && !canGoForward) return null;

  const btn =
    "h-full w-7 flex items-center justify-center text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-elevated)] hover:text-[var(--color-ink)] transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-[var(--color-ink-faint)] disabled:cursor-default";

  return (
    <div className="flex items-stretch border-l border-[var(--color-border)]">
      <button
        type="button"
        aria-label="back"
        title="back"
        onClick={goBack}
        disabled={!canGoBack}
        className={btn}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M8.5 3.5 L5 7 L8.5 10.5"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <button
        type="button"
        aria-label="forward"
        title="forward"
        onClick={goForward}
        disabled={!canGoForward}
        className={btn}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path
            d="M5.5 3.5 L9 7 L5.5 10.5"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
