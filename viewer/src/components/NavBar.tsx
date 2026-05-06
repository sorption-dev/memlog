/**
 * In-content back/forward bar.
 *
 * Lives at the top of <main>. Shows the two arrows only when they'd do
 * something (history idx > 0 / idx < length-1). Wires up the full set of
 * browser-like navigation inputs so the app behaves the same way as a
 * normal window:
 *
 *   · keyboard — ⌘[/⌘] (macOS), Alt+←/→ (everywhere)
 *   · mouse    — side buttons X1/X2 (button codes 3/4)
 *   · swipe    — horizontal wheel deltas from touchpads (macOS trackpad
 *                two-finger, Windows precision touchpad). Accumulated over
 *                a short window with a cooldown so a single gesture fires
 *                at most once.
 *
 * React Router v6's BrowserRouter stores a 0-based position at
 * `window.history.state.idx`, so we don't have to maintain a parallel
 * stack to know whether forward is available.
 */
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

const SWIPE_TRIGGER_PX = 80;
const SWIPE_COOLDOWN_MS = 600;
const SWIPE_IDLE_RESET_MS = 120;

function isEditable(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return (
    t?.tagName === "INPUT" ||
    t?.tagName === "TEXTAREA" ||
    !!t?.isContentEditable
  );
}

/** Climb from `el` to `stop`; return true if any ancestor can actually
 *  scroll horizontally (scrollWidth > clientWidth and overflow-x lets it).
 *  We use this to yield back/forward swipes to a horizontally-scrollable
 *  child (e.g. a wide code block or table) — the browser's default
 *  horizontal scroll happens first. */
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

export function NavBar({ scrollRoot }: { scrollRoot: HTMLElement | null }) {
  const navigate = useNavigate();
  const location = useLocation();

  // Re-read on every location change; reading inline keeps us in sync
  // with the actual window.history (state gets replaced on push/replace).
  void location;
  const idx = (window.history.state?.idx as number | undefined) ?? 0;
  const canGoBack = idx > 0;
  const canGoForward = idx < window.history.length - 1;

  // Keep handlers stable but read latest can-flags via ref, so adding an
  // event listener once is enough.
  const goRef = useRef({ canGoBack, canGoForward, navigate });
  goRef.current = { canGoBack, canGoForward, navigate };

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
        if (goRef.current.canGoBack) goRef.current.navigate(-1);
      } else if (fwd) {
        e.preventDefault();
        if (goRef.current.canGoForward) goRef.current.navigate(1);
      }
    };
    const onMouse = (e: MouseEvent) => {
      if (e.button === 3) {
        e.preventDefault();
        if (goRef.current.canGoBack) goRef.current.navigate(-1);
      } else if (e.button === 4) {
        e.preventDefault();
        if (goRef.current.canGoForward) goRef.current.navigate(1);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onMouse);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onMouse);
    };
  }, []);

  // Horizontal swipe. We attach to scrollRoot (the <main>) so the wheel
  // event only fires from the content pane, not the sidebar. Accumulate
  // deltaX while the gesture is active; fire once we cross the threshold,
  // then enter a cooldown so the momentum tail doesn't fire a second nav.
  useEffect(() => {
    if (!scrollRoot) return;
    let accum = 0;
    let cooldownUntil = 0;
    let lastEventAt = 0;

    const onWheel = (e: WheelEvent) => {
      // Only touchpad/continuous gestures produce sustained horizontal deltas.
      // If vertical movement dominates, this is a normal scroll — bail.
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) {
        accum = 0;
        return;
      }
      // Yield to content that actually wants horizontal scroll.
      if (hasHorizontalScrollAncestor(e.target as HTMLElement, scrollRoot)) {
        accum = 0;
        return;
      }

      const now = performance.now();
      if (now < cooldownUntil) return;
      // Reset accumulator if this delta arrived after a pause (new gesture).
      if (now - lastEventAt > SWIPE_IDLE_RESET_MS) accum = 0;
      lastEventAt = now;
      accum += e.deltaX;

      if (Math.abs(accum) < SWIPE_TRIGGER_PX) return;
      const direction = accum > 0 ? 1 : -1;
      accum = 0;
      cooldownUntil = now + SWIPE_COOLDOWN_MS;
      if (direction < 0 && goRef.current.canGoBack)
        goRef.current.navigate(-1);
      else if (direction > 0 && goRef.current.canGoForward)
        goRef.current.navigate(1);
    };

    scrollRoot.addEventListener("wheel", onWheel, { passive: true });
    return () => scrollRoot.removeEventListener("wheel", onWheel);
  }, [scrollRoot]);

  if (!canGoBack && !canGoForward) return null;

  const btn =
    "h-7 w-7 flex items-center justify-center rounded-[3px] text-[var(--color-ink-dim)] hover:text-[var(--color-ink)] hover:bg-[var(--color-surface-elevated)] transition-colors disabled:opacity-30 disabled:hover:text-[var(--color-ink-dim)] disabled:hover:bg-transparent disabled:cursor-default";

  return (
    <div className="sticky top-0 z-10 bg-[var(--color-bg)]/90 backdrop-blur-sm px-10 py-2 flex items-center gap-1">
      <button
        type="button"
        aria-label="back"
        onClick={() => navigate(-1)}
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
        onClick={() => navigate(1)}
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
