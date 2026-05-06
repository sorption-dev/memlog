import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Claude Code stores each chat session as a JSONL file under
 *   ~/.claude/projects/<slug>/<uuid>.jsonl
 * where <slug> is the project root path with '/' and '_' replaced by '-'.
 *
 * We heuristically detect the "current" session as the most recently
 * modified .jsonl in that directory. Good enough for single-session
 * workflows; multi-session-in-parallel picks the most active one.
 */

export function projectSlug(projectRoot: string): string {
  return resolve(projectRoot).replace(/[/_]/g, "-");
}

export function claudeProjectDir(projectRoot: string): string {
  return join(homedir(), ".claude", "projects", projectSlug(projectRoot));
}

export interface SessionFileCandidate {
  path: string;
  mtime: number; // epoch ms
  ageMs: number;
  sizeBytes: number;
}

export function detectCurrentSessionFile(
  projectRoot: string,
  maxAgeMs = 30 * 60 * 1000, // 30 min window
): SessionFileCandidate | null {
  const dir = claudeProjectDir(projectRoot);
  if (!existsSync(dir)) return null;

  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return null;
  }
  if (files.length === 0) return null;

  const now = Date.now();
  const candidates: SessionFileCandidate[] = [];
  for (const f of files) {
    const full = join(dir, f);
    try {
      const st = statSync(full);
      const mtime = st.mtimeMs;
      candidates.push({
        path: full,
        mtime,
        ageMs: now - mtime,
        sizeBytes: st.size,
      });
    } catch {
      // ignore
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  const top = candidates[0];
  if (!top) return null;
  if (top.ageMs > maxAgeMs) return null; // stale — probably not the active session
  return top;
}
