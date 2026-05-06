#!/usr/bin/env bun
/**
 * Pre-downloads Russian-morphology wheels from PyPI into node_modules/pyodide/
 * so they ship inside the portable bundle — no network at first Russian query.
 *
 * Run as part of `bun run bundle`; skip by setting MEMLOG_SKIP_WHEELS=1.
 *
 * What gets vendored:
 *   pymorphy3            morphological analyzer (pure Python)
 *   dawg2-python         DAWG reader (pymorphy3 runtime dep)
 *   pymorphy3-dicts-ru   OpenCorpora dictionary (~10 MB)
 *
 * The bulk (~10 MB) is the dictionary, but that's the point — without it
 * the whole morphology story is useless.
 */
import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const pyodideDir = resolve(here, "..", "node_modules", "pyodide");

if (!existsSync(pyodideDir)) {
  console.error(`pyodide not installed at ${pyodideDir} — run \`bun install\``);
  process.exit(1);
}

/** Each PyPI package we need, in install order (dawg2 before pymorphy3). */
const PACKAGES = ["dawg2-python", "pymorphy3-dicts-ru", "pymorphy3"];

/** Clean out any older versions of these wheels — PyPI may have bumped
 * patch numbers since the last bundle. Keeps pyodide/ tidy. */
function pruneStaleWheels() {
  const prefixes = PACKAGES.map((p) => p.replace(/-/g, "_") + "-");
  for (const f of readdirSync(pyodideDir)) {
    if (!f.endsWith(".whl")) continue;
    if (!prefixes.some((p) => f.startsWith(p))) continue;
    unlinkSync(resolve(pyodideDir, f));
  }
}

async function resolveWheelUrl(pkg) {
  const res = await fetch(`https://pypi.org/pypi/${pkg}/json`);
  if (!res.ok) throw new Error(`PyPI ${pkg}: HTTP ${res.status}`);
  const data = await res.json();
  const version = data.info.version;
  const wheel = data.urls.find(
    (u) => u.packagetype === "bdist_wheel" && u.filename.endsWith(".whl"),
  );
  if (!wheel) throw new Error(`${pkg} has no wheel on PyPI`);
  return { version, filename: wheel.filename, url: wheel.url };
}

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url}: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  writeFileSync(dest, buf);
  return buf.byteLength;
}

function fmt(bytes) {
  return bytes > 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${(bytes / 1024).toFixed(1)} KB`;
}

async function main() {
  if (process.env.MEMLOG_SKIP_WHEELS === "1") {
    console.log("vendor-wheels: MEMLOG_SKIP_WHEELS=1, skipping");
    return;
  }
  console.log(`vendor-wheels → ${pyodideDir}`);
  pruneStaleWheels();

  for (const pkg of PACKAGES) {
    const info = await resolveWheelUrl(pkg);
    const dest = resolve(pyodideDir, info.filename);
    const bytes = await download(info.url, dest);
    console.log(`  ${pkg.padEnd(22)} ${info.version.padEnd(22)} ${fmt(bytes)}`);
  }
  console.log("done.");
}

main().catch((err) => {
  console.error("vendor-wheels failed:", err.message);
  process.exit(1);
});
