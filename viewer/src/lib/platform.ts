/**
 * Platform detection for keyboard hints. Tauri's webview exposes the host
 * OS via `navigator.platform` / `userAgent` — sufficient for picking the
 * right modifier glyph (⌘ on macOS, Ctrl elsewhere). We never branch on
 * platform for actual behavior; hotkey handlers already accept both
 * `metaKey` and `ctrlKey`.
 */
function detectMac(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const plat = navigator.platform || "";
  return /Mac|iPad|iPhone|iPod/.test(plat) || /Macintosh/.test(ua);
}

export const IS_MAC = detectMac();

/** Modifier glyph used in keyboard hint UI. ⌘ on macOS, "Ctrl" elsewhere. */
export const MOD_KEY = IS_MAC ? "⌘" : "Ctrl";
