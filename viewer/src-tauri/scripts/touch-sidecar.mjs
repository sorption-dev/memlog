#!/usr/bin/env bun
/**
 * Lightweight placeholder for `tauri dev`: Tauri's build.rs validates that
 * every externalBin path exists, but in dev our Rust side never actually
 * spawns the sidecar (debug_assertions → Vite middleware serves /api/*).
 * So we just drop a 0-byte file with the expected triple-suffix name.
 *
 * prepare-sidecar.mjs (for `tauri build`) overwrites this with the real
 * compiled binary.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const tauriRoot = resolve(here, "..");
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

if (!existsSync(binDest)) {
  mkdirSync(binariesDir, { recursive: true });
  writeFileSync(binDest, "");
  chmodSync(binDest, 0o755);
  console.log(`touch-sidecar: placeholder ${binDest}`);
}

// The resources glob in tauri.conf.json (resources/pyodide/*) also has to
// match *something* for build.rs to stop complaining, even in dev.
const resDir = resolve(tauriRoot, "resources", "pyodide");
const marker = resolve(resDir, ".placeholder");
if (!existsSync(marker)) {
  mkdirSync(resDir, { recursive: true });
  writeFileSync(marker, "");
  console.log(`touch-sidecar: placeholder ${marker}`);
}
