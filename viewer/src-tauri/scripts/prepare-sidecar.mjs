#!/usr/bin/env bun
/**
 * Runs as Tauri's beforeBuildCommand helper. Produces the artefacts Tauri
 * expects before it packages:
 *
 *   src-tauri/binaries/memlog-<target-triple>   — compiled backend binary
 *                                                  (Tauri auto-injects the
 *                                                  triple suffix for sidecars)
 *   src-tauri/resources/pyodide/                — Pyodide runtime + vendored
 *                                                  wheels, shipped as a
 *                                                  Resource alongside the app
 *
 * Everything starts from `bun run bundle` in mcp/ (same script we use for
 * the plain portable zip) — the compiled binary and pyodide/ folder are
 * copied into the Tauri-expected layout.
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tauriRoot = resolve(here, "..");
const repoRoot = resolve(tauriRoot, "..", "..");
const mcpRoot = resolve(repoRoot, "mcp");
const distDir = resolve(mcpRoot, "dist");
const binariesDir = resolve(tauriRoot, "binaries");
const resourcesPyodide = resolve(tauriRoot, "resources", "pyodide");

function step(label) {
  process.stdout.write(`\n→ ${label}\n`);
}

function detectTargetTriple() {
  // Tauri's convention: the sidecar binary must end in the Rust host triple,
  // e.g. memlog-aarch64-apple-darwin. Rustc prints it on -Vv.
  const out = spawnSync("rustc", ["-Vv"], { encoding: "utf8" });
  if (out.status !== 0) {
    throw new Error("rustc -Vv failed — is Rust installed?");
  }
  const m = out.stdout.match(/host:\s*(\S+)/);
  if (!m) throw new Error("could not parse host triple from rustc");
  return m[1];
}

step("build portable bundle  →  mcp/dist/");
const bundle = spawnSync("bun", ["run", "scripts/bundle.mjs"], {
  cwd: mcpRoot,
  stdio: "inherit",
});
if (bundle.status !== 0) {
  console.error("mcp bundle failed");
  process.exit(bundle.status ?? 1);
}

const exeExt = process.platform === "win32" ? ".exe" : "";
const compiledBin = resolve(distDir, `memlog${exeExt}`);
const pyodideSrc = resolve(distDir, "pyodide");
if (!existsSync(compiledBin)) throw new Error(`missing ${compiledBin}`);
if (!existsSync(pyodideSrc)) throw new Error(`missing ${pyodideSrc}`);

step("place sidecar binary  →  src-tauri/binaries/");
const triple = detectTargetTriple();
mkdirSync(binariesDir, { recursive: true });
// Delete old triples so stale binaries from other hosts don't ship.
for (const f of readdirSync(binariesDir)) {
  if (f.startsWith("memlog-")) rmSync(resolve(binariesDir, f), { force: true });
}
const dest = resolve(binariesDir, `memlog-${triple}${exeExt}`);
cpSync(compiledBin, dest);
// cpSync preserves perms from source (0o755).
console.log(`  ${dest}`);

step("copy pyodide runtime  →  src-tauri/resources/pyodide/");
rmSync(resourcesPyodide, { recursive: true, force: true });
mkdirSync(resourcesPyodide, { recursive: true });
cpSync(pyodideSrc, resourcesPyodide, { recursive: true });
const pyodideBytes = readdirSync(resourcesPyodide).reduce(
  (sum, f) => sum + statSync(resolve(resourcesPyodide, f)).size,
  0,
);
console.log(`  ${resourcesPyodide} (${(pyodideBytes / 1024 / 1024).toFixed(1)} MB)`);

console.log("\nready for `tauri build`");
