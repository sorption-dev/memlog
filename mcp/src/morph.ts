import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { makeLogger } from "./log.js";

const log = makeLogger("morph");

type Status = "uninitialized" | "starting" | "ready" | "degraded";

export interface MorphDiagnostic {
  status: Status;
  lastError: string | null;
  lastErrorAt: string | null;
  backend: "pyodide";
  pyodideVersion?: string;
}

// External API is preserved from the old Python-sidecar implementation:
// - lemmatizeRu(tokens)
// - morphStatus() / morphDiagnostic() / morphStats()
// - shutdownMorph()
//
// What changed: instead of spawning a Python child process, we run
// pymorphy3 inside Pyodide (Python → WebAssembly) right here in the Node
// process. Zero IPC, zero Python runtime on the host, one module for mcp
// and viewer alike. First call incurs a ~1–3s cold start (Pyodide boot +
// pymorphy3 install + dict load); subsequent calls are in-process.

let status: Status = "uninitialized";
let lastError: string | null = null;
let lastErrorAt: string | null = null;
let pyodideVersion: string | undefined;
let lemmatizePy: ((tokens: string[]) => unknown) | null = null;
let initPromise: Promise<void> | null = null;

let totalRequests = 0;
let totalTokens = 0;
let totalMs = 0;
let totalFallbacks = 0;

function recordError(reason: string): void {
  lastError = reason;
  lastErrorAt = new Date().toISOString();
  log.error(reason);
}

/** Detect whether we're running as a Bun single-file executable (vs. `bun run`
 * or `node` in dev). In SEA `process.execPath` is the compiled binary itself,
 * not the bun/node interpreter. */
function isCompiled(): boolean {
  const name = basename(process.execPath).toLowerCase();
  return name !== "bun" && name !== "bun-debug" && name !== "node";
}

/** Resolve the pyodide package install path so Pyodide can locate its
 * WASM/stdlib assets without relying on CDN.
 *
 * Layouts (checked in order):
 *   - env override        MEMLOG_PYODIDE_DIR             (explicit path wins;
 *                                                         set by Tauri shell)
 *   - portable bundle     <dir of binary>/pyodide/       (`bun run bundle`)
 *   - Tauri install       <dir of binary>/resources/pyodide/
 *                                                        (sidecar run directly,
 *                                                         e.g. as Claude Code
 *                                                         MCP server, without
 *                                                         the Tauri shell)
 *   - dev                 node_modules/pyodide/          (via require.resolve)
 */
function pyodideIndexURL(): string {
  const envOverride = process.env.MEMLOG_PYODIDE_DIR;
  if (envOverride) return envOverride;

  if (isCompiled()) {
    const exeDir = dirname(process.execPath);
    const candidates = [
      join(exeDir, "pyodide"),
      join(exeDir, "resources", "pyodide"),
    ];
    for (const dir of candidates) {
      if (existsSync(join(dir, "pyodide.asm.js"))) return dir;
    }
    throw new Error(
      `pyodide/ folder missing — looked in ${candidates.join(" and ")}. ` +
        `Ship the binary and the pyodide/ folder together (see ` +
        `scripts/bundle.mjs), or set MEMLOG_PYODIDE_DIR to its location.`,
    );
  }

  // Dev / bun run — let Node resolver find node_modules/pyodide.
  const require = createRequire(import.meta.url);
  const pkgPath = require.resolve("pyodide/package.json");
  return dirname(pkgPath);
}

/** Find pymorphy3 + deps wheels in indexURL so we can install them offline
 * (`bun run vendor-wheels` puts them there). Returns [] if any is missing —
 * caller falls back to CDN. */
function findLocalWheels(indexURL: string): string[] {
  const wantedPrefixes = ["pymorphy3-", "pymorphy3_dicts_ru-", "dawg2_python-"];
  const found: Record<string, string> = {};
  try {
    for (const f of readdirSync(indexURL)) {
      if (!f.endsWith(".whl")) continue;
      const prefix = wantedPrefixes.find((p) => f.startsWith(p));
      if (prefix && !found[prefix]) found[prefix] = f;
    }
  } catch {
    return [];
  }
  if (wantedPrefixes.some((p) => !found[p])) return [];
  // Dependency order: dawg2 → dicts → pymorphy3
  return [
    found["dawg2_python-"]!,
    found["pymorphy3_dicts_ru-"]!,
    found["pymorphy3-"]!,
  ];
}

async function init(): Promise<void> {
  if (status === "ready" || status === "starting") return;
  if (initPromise) return initPromise;
  status = "starting";
  const t0 = Date.now();

  initPromise = (async () => {
    try {
      const { loadPyodide } = await import("pyodide");
      const indexURL = pyodideIndexURL();
      log.info("booting pyodide", { indexURL });
      // Route Pyodide's own logs to stderr so they don't collide with the
      // ipc-stdio JSON-RPC frames we write on stdout.
      const pyodide = await loadPyodide({
        indexURL,
        stdout: (msg) => process.stderr.write(`[pyodide] ${msg}\n`),
        stderr: (msg) => process.stderr.write(`[pyodide] ${msg}\n`),
      });
      pyodideVersion = pyodide.version;

      await pyodide.loadPackage("micropip");
      const micropip = pyodide.pyimport("micropip");

      // Prefer locally-vendored wheels — zero network, instant install.
      // If they're missing (dev before `bun run vendor-wheels`), fall back
      // to PyPI via micropip's default resolver.
      const localWheels = findLocalWheels(indexURL);
      if (localWheels.length === 3) {
        // Copy wheel bytes into pyodide's in-memory FS, then install via
        // emfs:/// URLs. This avoids a CDN round-trip and works offline.
        const emfsUrls: string[] = [];
        for (const name of localWheels) {
          const bytes = readFileSync(join(indexURL, name));
          const emfsPath = `/tmp/${name}`;
          pyodide.FS.writeFile(emfsPath, new Uint8Array(bytes));
          emfsUrls.push(`emfs://${emfsPath}`);
        }
        log.info("installing vendored wheels", { wheels: localWheels });
        await micropip.install(emfsUrls);
      } else {
        log.info("installing pymorphy3 via micropip (from PyPI)");
        await micropip.install("pymorphy3");
      }

      // Initialize the analyzer once; wrap it in a tiny Python function that
      // maps an iterable of tokens → list of normal_form strings.
      await pyodide.runPythonAsync(`
import pymorphy3
_morph = pymorphy3.MorphAnalyzer()
def _lemmatize(tokens):
    out = []
    for t in tokens:
        parses = _morph.parse(t)
        out.append(parses[0].normal_form if parses else t.lower())
    return out
`);

      const fn = pyodide.globals.get("_lemmatize");
      if (!fn) throw new Error("failed to bind _lemmatize");
      lemmatizePy = fn as (tokens: string[]) => unknown;
      status = "ready";
      lastError = null;
      lastErrorAt = null;
      log.info("pyodide morph ready", {
        startupMs: Date.now() - t0,
        pyodide: pyodideVersion,
      });
    } catch (err) {
      status = "degraded";
      recordError(`pyodide init failed: ${(err as Error).message}`);
    } finally {
      initPromise = null;
    }
  })();

  return initPromise;
}

export async function lemmatizeRu(tokens: string[]): Promise<string[]> {
  if (tokens.length === 0) return [];
  if (status === "uninitialized" || status === "starting") {
    await init();
  }
  if (status === "degraded" || !lemmatizePy) {
    totalFallbacks++;
    return tokens.map((t) => t.toLowerCase());
  }
  const t0 = Date.now();
  try {
    const pyResult = lemmatizePy(tokens) as {
      toJs: () => string[];
      destroy: () => void;
    };
    const lemmas = pyResult.toJs();
    pyResult.destroy();
    const ms = Date.now() - t0;
    totalRequests++;
    totalTokens += tokens.length;
    totalMs += ms;
    if (ms > 200) log.warn("slow lemmatize", { ms, tokens: tokens.length });
    return lemmas.length === tokens.length
      ? lemmas
      : tokens.map((t) => t.toLowerCase());
  } catch (err) {
    totalFallbacks++;
    recordError(`lemmatize call failed: ${(err as Error).message}`);
    return tokens.map((t) => t.toLowerCase());
  }
}

export function morphStatus(): Status {
  return status;
}

export function morphStats(): {
  requests: number;
  tokens: number;
  avgMs: number;
  fallbacks: number;
} {
  return {
    requests: totalRequests,
    tokens: totalTokens,
    avgMs:
      totalRequests > 0
        ? Math.round((totalMs / totalRequests) * 10) / 10
        : 0,
    fallbacks: totalFallbacks,
  };
}

export function morphDiagnostic(): MorphDiagnostic {
  return {
    status,
    lastError,
    lastErrorAt,
    backend: "pyodide",
    pyodideVersion,
  };
}

export function shutdownMorph(): void {
  // Pyodide doesn't expose an explicit teardown for the runtime — the WASM
  // instance lives until the Node process dies. We just drop our references
  // so tests / callers that poll morphStatus() see "uninitialized" again.
  lemmatizePy = null;
  status = "uninitialized";
}
