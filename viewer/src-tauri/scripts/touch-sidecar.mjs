#!/usr/bin/env bun
/**
 * Runs as Tauri's beforeDevCommand helper. Tauri's build.rs validates that
 * every externalBin path exists before compiling, AND lib.rs unconditionally
 * spawns the sidecar at startup (debug + release). So `tauri dev` needs a
 * real, runnable binary at binaries/memlog-<triple><exe>.
 *
 * If one is already present (and non-empty), keep it — recompiling on every
 * `tauri dev` would cost ~1s for no reason. Otherwise produce one with
 * `bun build --compile` against mcp/src/cli.ts. This is just the binary; the
 * Pyodide runtime (used by Russian morphology) is optional in dev — it loads
 * lazily on the first lemmatise call and silently degrades if absent.
 *
 * prepare-sidecar.mjs (for `tauri build`) is the heavy version that also
 * bundles Pyodide into resources/ so morphology works offline in the shipped
 * app.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tauriRoot = resolve(here, "..");
const repoRoot = resolve(tauriRoot, "..", "..");
const mcpRoot = resolve(repoRoot, "mcp");
const binariesDir = resolve(tauriRoot, "binaries");

function tripleFromRustc() {
  const out = spawnSync("rustc", ["-Vv"], { encoding: "utf8" });
  if (out.status !== 0) throw new Error("rustc -Vv failed — is Rust installed?");
  const m = out.stdout.match(/host:\s*(\S+)/);
  if (!m) throw new Error("could not parse host triple from rustc");
  return m[1];
}

const triple = tripleFromRustc();
const exeExt = process.platform === "win32" ? ".exe" : "";
const binDest = resolve(binariesDir, `memlog-${triple}${exeExt}`);

const needsBuild = !existsSync(binDest) || statSync(binDest).size === 0;

if (needsBuild) {
  mkdirSync(binariesDir, { recursive: true });
  // Make sure mcp deps are present — bun build needs them resolvable.
  if (!existsSync(resolve(mcpRoot, "node_modules"))) {
    console.log("touch-sidecar: bun install in mcp/");
    const inst = spawnSync("bun", ["install"], { cwd: mcpRoot, stdio: "inherit" });
    if (inst.status !== 0) process.exit(inst.status ?? 1);
  }
  console.log(`touch-sidecar: compiling sidecar → ${binDest}`);
  const r = spawnSync(
    "bun",
    ["build", "src/cli.ts", "--compile", "--target=bun", "--outfile", binDest],
    { cwd: mcpRoot, stdio: "inherit" },
  );
  if (r.status !== 0) {
    console.error("touch-sidecar: bun build --compile failed");
    process.exit(r.status ?? 1);
  }
}

// The resources glob in tauri.conf.json (resources/pyodide/*) also has to
// match *something* for build.rs to stop complaining, even in dev. The actual
// runtime files only get copied in for `tauri build` (see prepare-sidecar.mjs).
const resDir = resolve(tauriRoot, "resources", "pyodide");
const marker = resolve(resDir, ".placeholder");
if (!existsSync(marker)) {
  mkdirSync(resDir, { recursive: true });
  writeFileSync(marker, "");
  console.log(`touch-sidecar: placeholder ${marker}`);
}
