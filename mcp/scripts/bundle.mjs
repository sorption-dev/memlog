#!/usr/bin/env bun
/**
 * Produces a portable distribution of memlog in `dist/`:
 *
 *   dist/
 *     memlog           # Bun-compiled single-file executable
 *     pyodide/         # Pyodide runtime assets (WASM, stdlib, bundled wheels)
 *
 * Ship that folder as a zip — user unpacks anywhere, runs `./memlog`. No
 * installation, no writes outside the folder (Pyodide cache goes into the
 * same pyodide/ dir, which is writable).
 *
 * The layout matches what bin/memlog (the dev/prod shim) expects, so the
 * shim transparently picks up the compiled binary once it exists.
 *
 * Usage:
 *   bun run scripts/bundle.mjs
 */
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outDir = resolve(root, "dist");
const exeExt = process.platform === "win32" ? ".exe" : "";
const binOut = resolve(outDir, `memlog${exeExt}`);
const pyodideSrc = resolve(root, "node_modules", "pyodide");
const pyodideOut = resolve(outDir, "pyodide");

function step(label) {
  process.stdout.write(`\n→ ${label}\n`);
}

function fmt(bytes) {
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function du(path) {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

step("vendor wheels  →  node_modules/pyodide/");
const vendor = spawnSync("bun", ["run", "scripts/vendor-wheels.mjs"], {
  cwd: root,
  stdio: "inherit",
});
if (vendor.status !== 0) {
  console.error("vendor-wheels failed");
  process.exit(vendor.status ?? 1);
}

step("clean output");
// Surgical: only wipe what we re-emit. dist/ may also hold tsc output
// (dist/lib.js etc.) from `bun run build` — leave that alone.
rmSync(binOut, { force: true });
rmSync(pyodideOut, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

step("compile binary  →  dist/memlog");
const compile = spawnSync(
  "bun",
  [
    "build",
    "src/cli.ts",
    "--compile",
    "--target=bun",
    "--outfile",
    binOut,
  ],
  { cwd: root, stdio: "inherit" },
);
if (compile.status !== 0) {
  console.error("bun build failed");
  process.exit(compile.status ?? 1);
}

step("copy pyodide runtime  →  dist/pyodide/");
if (!existsSync(pyodideSrc)) {
  console.error(`missing ${pyodideSrc} — run \`bun install\` first`);
  process.exit(1);
}

// Only the files Pyodide actually loads at runtime. Skip docs, demos,
// type-defs, source maps — they bloat the zip without adding function.
const RUNTIME_FILES = [
  "package.json",
  "pyodide.asm.js",
  "pyodide.asm.wasm",
  "pyodide.mjs",
  "pyodide.js",
  "pyodide-lock.json",
  "python_stdlib.zip",
];

mkdirSync(pyodideOut, { recursive: true });
for (const f of RUNTIME_FILES) {
  const src = resolve(pyodideSrc, f);
  if (!existsSync(src)) {
    console.error(`missing ${src}`);
    process.exit(1);
  }
  cpSync(src, resolve(pyodideOut, f));
}

// Cached wheels micropip needs on first run. We copy every *.whl present in
// node_modules/pyodide — after a dev run these include pymorphy3 + deps, so
// shipping them avoids a CDN trip at first launch.
import { readdirSync } from "node:fs";
const wheels = readdirSync(pyodideSrc).filter((f) => f.endsWith(".whl"));
for (const w of wheels) {
  cpSync(resolve(pyodideSrc, w), resolve(pyodideOut, w));
}

step("summary");
const sizes = {
  binary: du(binOut),
  pyodide: wheels
    .map((w) => du(resolve(pyodideOut, w)))
    .concat(RUNTIME_FILES.map((f) => du(resolve(pyodideOut, f))))
    .reduce((a, b) => a + b, 0),
};
const total = sizes.binary + sizes.pyodide;

console.log(`  memlog binary    ${fmt(sizes.binary)}`);
console.log(`  pyodide/         ${fmt(sizes.pyodide)}`);
console.log(`  wheels bundled   ${wheels.length} (${wheels.join(", ") || "none"})`);
console.log(`  total            ${fmt(total)}`);
console.log(`\nReady: ${outDir}`);
console.log(`Run:   ${binOut}`);
