import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vite is now frontend-only — the API moved to Tauri IPC
// (window `invoke("memlog_rpc", ...)` → Rust → Bun sidecar over stdio).
// Run the app with `bun run tauri:dev`; `vite dev` alone has no backend.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@mcp": path.resolve(__dirname, "..", "mcp", "src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  // Tauri expects a predictable output directory.
  build: {
    target: "es2022",
  },
});
