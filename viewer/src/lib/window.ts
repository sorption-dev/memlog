/**
 * Open a memlog SPA route in a fresh detached window. Tauri appends the
 * `url` to the app's base URL (devUrl in dev, tauri://localhost in prod),
 * so a relative path like "/entry/42" lands directly on the right route
 * — no event bus or pending-route handoff needed.
 *
 * Each call gets a unique label (entry-<timestamp>); the capabilities
 * file matches the `entry-*` glob so window controls work in the popup.
 */
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";

export async function openInNewWindow(path: string): Promise<void> {
  if (!path.startsWith("/")) {
    throw new Error(`openInNewWindow: expected absolute path, got "${path}"`);
  }
  // Detached windows boot with the sidebar collapsed — read like a focused
  // article view, expand only if the user wants the navigation back.
  const sep = path.includes("?") ? "&" : "?";
  const url = `${path}${sep}sidebar=collapsed`;
  const label = `entry-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const win = new WebviewWindow(label, {
    url,
    title: "memlog",
    width: 900,
    height: 700,
    minWidth: 720,
    minHeight: 480,
    resizable: true,
    titleBarStyle: "overlay",
    hiddenTitle: true,
    decorations: true,
  });
  await new Promise<void>((resolve, reject) => {
    win.once("tauri://created", () => resolve());
    win.once("tauri://error", (e) => reject(new Error(String(e.payload))));
  });
}
