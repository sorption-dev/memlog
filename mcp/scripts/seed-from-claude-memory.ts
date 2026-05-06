/**
 * One-shot importer for Claude Code's per-project `.claude/memory/` folders.
 *
 * Usage:
 *   npm run seed -- /path/to/project1 /path/to/project2 ...
 *
 * For each project it reads `<project>/.claude/memory/*.md`, parses frontmatter,
 * and calls journal_write with:
 *   - session_id = basename(project)
 *   - tags = ["seeded", "memory-type:<type>"]
 *   - kind mapped from memory type
 *
 * MEMORY.md (index file without frontmatter) is skipped.
 * Rerunning on the same sources produces duplicates — this is a one-shot tool.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { openDB, resolveDBPath } from "../src/db.js";
import { writeEntry } from "../src/repo.js";
import { shutdownMorph } from "../src/morph.js";
import type { Kind } from "../src/types.js";

/**
 * Claude Code stores per-project auto-curated memory at
 *   ~/.claude/projects/<slug>/memory/
 * where <slug> is the absolute project path with '/' → '-' and a leading '-'.
 */
function userScopeMemoryDir(projectRoot: string): string {
  // Claude Code's slug replaces both '/' and '_' with '-'.
  // Example: /Users/zmnv/DEV/_Enapter/foo  →  -Users-zmnv-DEV--Enapter-foo
  // (the '//' from replacing '/' alone would already produce '-_' → needs both)
  const slug = resolve(projectRoot).replace(/[/_]/g, "-");
  return join(homedir(), ".claude", "projects", slug, "memory");
}

interface Frontmatter {
  name?: string;
  description?: string;
  type?: string;
}

function parseFrontmatter(raw: string): { meta: Frontmatter; body: string } {
  if (!raw.startsWith("---\n")) return { meta: {}, body: raw };
  const end = raw.indexOf("\n---\n", 4);
  if (end < 0) return { meta: {}, body: raw };
  const header = raw.slice(4, end);
  const body = raw.slice(end + 5).trim();
  const meta: Frontmatter = {};
  for (const line of header.split("\n")) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!.toLowerCase();
    const val = m[2]!.trim().replace(/^["'](.*)["']$/, "$1");
    if (key === "name" || key === "description" || key === "type") {
      (meta as Record<string, string>)[key] = val;
    }
  }
  return { meta, body };
}

function mapKind(type: string | undefined): Kind {
  switch ((type ?? "").toLowerCase()) {
    case "preference":
    case "feedback":
      return "preference";
    case "user":
    case "project":
    case "reference":
      return "fact";
    case "question":
      return "question";
    case "todo":
      return "todo";
    case "decision":
      return "decision";
    default:
      return "context";
  }
}

interface MemorySource {
  dir: string;
  origin: "user-scope" | "project-local";
}

async function seedProject(dbPath: string, projectRoot: string): Promise<number> {
  const sources: MemorySource[] = [];
  const userDir = userScopeMemoryDir(projectRoot);
  const localDir = join(projectRoot, ".claude", "memory");
  if (existsSync(userDir)) sources.push({ dir: userDir, origin: "user-scope" });
  if (existsSync(localDir)) sources.push({ dir: localDir, origin: "project-local" });

  if (sources.length === 0) {
    console.warn(`  skip: no memory/ found for ${projectRoot}`);
    console.warn(`        looked at: ${userDir}`);
    console.warn(`                   ${localDir}`);
    return 0;
  }

  for (const s of sources) console.log(`  source (${s.origin}): ${s.dir}`);

  const session = basename(projectRoot);
  const db = openDB(dbPath);
  let added = 0;
  const seenFiles = new Set<string>(); // dedupe across sources by filename

  for (const src of sources) {
    const files = readdirSync(src.dir).filter(
      (f) => f.endsWith(".md") && f.toLowerCase() !== "memory.md",
    );
    for (const file of files) {
      if (seenFiles.has(file)) {
        console.log(`    ~ skip dup: ${file} (already taken from user-scope)`);
        continue;
      }
      seenFiles.add(file);
      const full = join(src.dir, file);
      const raw = readFileSync(full, "utf8");
      const { meta, body } = parseFrontmatter(raw);
      if (!meta.name || body.length === 0) {
        console.warn(`    skip: ${file} — no name or empty body`);
        continue;
      }
      const kind = mapKind(meta.type);
      const tags = ["seeded", `memory-type:${meta.type ?? "unknown"}`, `origin:${src.origin}`];
      const title = meta.name.slice(0, 200);
      const bodyWithDesc = meta.description ? `${meta.description}\n\n${body}` : body;

      await writeEntry(db, {
        kind,
        title,
        body: bodyWithDesc,
        tags,
        session_id: session,
        msg_ref: `${src.origin}/${file}`,
      });
      added++;
      console.log(`    + [${kind}] ${title}  (${src.origin})`);
    }
  }

  db.close();
  return added;
}

async function main() {
  const projects = process.argv.slice(2);
  if (projects.length === 0) {
    console.error("usage: tsx scripts/seed-from-claude-memory.ts <project_root> [<project_root> ...]");
    process.exit(2);
  }
  const dbPath = resolveDBPath();
  console.log(`DB: ${dbPath}\n`);

  let total = 0;
  for (const p of projects) {
    const root = resolve(p);
    console.log(`# ${root}`);
    total += await seedProject(dbPath, root);
    console.log();
  }
  console.log(`Total entries added: ${total}`);
  shutdownMorph();
}

main().catch((err) => {
  console.error(err);
  shutdownMorph();
  process.exit(1);
});
