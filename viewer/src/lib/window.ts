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
import { IS_MAC } from "./platform";

export async function openInNewWindow(path: string): Promise<void> {
  if (!path.startsWith("/")) {
    throw new Error(`openInNewWindow: expected absolute path, got "${path}"`);
  }
  // Detached windows boot with the sidebar collapsed — read like a focused
  // article view, expand only if the user wants the navigation back.
  const sep = path.includes("?") ? "&" : "?";
  const url = `${path}${sep}sidebar=collapsed`;
  const label = `entry-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  // Match the main window's chrome strategy (see src-tauri/src/lib.rs):
  //   macOS — keep native traffic lights via Overlay + hiddenTitle so our
  //           React TitleBar paints through the same bar.
  //   Win/Linux — disable native decorations entirely; our TitleBar draws
  //           min/max/close. Leaving decorations:true here stacked a
  //           native bar on top of our custom one.
  const win = new WebviewWindow(label, {
    url,
    title: "memlog",
    width: 900,
    height: 700,
    minWidth: 720,
    minHeight: 480,
    resizable: true,
    center: true,
    ...(IS_MAC
      ? {
          decorations: true,
          titleBarStyle: "overlay",
          hiddenTitle: true,
        }
      : {
          decorations: false,
        }),
  });
  await new Promise<void>((resolve, reject) => {
    win.once("tauri://created", () => resolve());
    win.once("tauri://error", (e) => reject(new Error(String(e.payload))));
  });
}
