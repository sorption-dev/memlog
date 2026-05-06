import { openDB } from "../src/db.js";
import {
  addLink,
  getEntry,
  getEntryWithNeighbors,
  recentEntries,
  searchEntries,
  writeEntry,
} from "../src/repo.js";
import { shutdownMorph } from "../src/morph.js";
import { unlinkSync, existsSync } from "node:fs";

const DB_PATH = "/tmp/memlog-smoke.sqlite";

async function main() {
  // Fresh DB each run
  for (const ext of ["", "-wal", "-shm"]) {
    const p = DB_PATH + ext;
    if (existsSync(p)) unlinkSync(p);
  }

  const db = openDB(DB_PATH);

  console.log("## writing entries");
  const a = await writeEntry(db, {
    kind: "decision",
    title: "Используем pymorphy3 для лемматизации",
    body: "Решили взять pymorphy3 вместо natasha — легче и быстрее для задачи поиска.",
    tags: ["arch", "morphology"],
    session_id: "memlog",
  });
  console.log("  a:", a.id, a.title);

  const b = await writeEntry(db, {
    kind: "fact",
    title: "SQLite FTS5 поддерживает unicode61 токенизатор",
    body: "unicode61 работает для кириллицы, удаляет диакритику, режет по юникод-категориям.",
    tags: ["sqlite", "fts"],
    session_id: "memlog",
  });
  console.log("  b:", b.id, b.title);

  const c = await writeEntry(db, {
    kind: "decision",
    title: "Архитектура: Node.js + Python-сайдкар",
    body: "Node держит MCP и SQLite, Python — лемматизацию через pymorphy3.",
    tags: ["arch"],
    session_id: "memlog",
    links: [
      { to_id: a.id, relation: "depends_on" },
      { to_id: b.id, relation: "depends_on" },
    ],
  });
  console.log("  c:", c.id, c.title, "(deps:", a.id, b.id, ")");

  console.log("\n## search by morphological variant");
  const r1 = await searchEntries(db, { query: "решение", limit: 10 });
  console.log("  query='решение' →", r1.hits.length, "hits, degraded=", r1.degraded);
  for (const h of r1.hits) console.log("    ", h.id, h.kind, h.title);

  const r2 = await searchEntries(db, { query: "лемматизация", limit: 10 });
  console.log("  query='лемматизация' →", r2.hits.length, "hits");
  for (const h of r2.hits) console.log("    ", h.id, h.kind, h.title);

  const r3 = await searchEntries(db, { query: "pymorphy3", limit: 10 });
  console.log("  query='pymorphy3' →", r3.hits.length, "hits");
  for (const h of r3.hits) console.log("    ", h.id, h.kind, h.title);

  console.log("\n## get with neighbors");
  const c_full = getEntryWithNeighbors(db, c.id);
  console.log("  entry:", c_full?.title);
  console.log("  outgoing:", c_full?.outgoing.length, "edges");
  for (const e of c_full?.outgoing ?? []) {
    console.log("    -[" + e.relation + "]→", e.to_id, e.kind, e.title);
  }

  console.log("\n## supersedes: write newer decision, link it to a, verify a hidden");
  const aPrime = await writeEntry(db, {
    kind: "decision",
    title: "Переходим с pymorphy3 на natasha (пересмотр)",
    body: "Нужны расширенные возможности: NER + Yargy. Заменяем предыдущее решение.",
    tags: ["arch", "morphology"],
    session_id: "memlog",
    links: [{ to_id: a.id, relation: "supersedes" }],
  });
  console.log("  a':", aPrime.id);

  const r4 = await searchEntries(db, { query: "pymorphy", limit: 10 });
  console.log("  query='pymorphy' (default, hide superseded) →", r4.hits.length, "hits");
  for (const h of r4.hits) console.log("    ", h.id, h.title);

  const r5 = await searchEntries(db, { query: "pymorphy", limit: 10, include_superseded: true });
  console.log("  query='pymorphy' (include_superseded) →", r5.hits.length, "hits");
  for (const h of r5.hits) console.log("    ", h.id, h.title);

  console.log("\n## recent");
  const rec = recentEntries(db, { limit: 5, session_id: "memlog" });
  console.log("  recent 5:", rec.hits.length);
  for (const h of rec.hits) console.log("    ", h.id, h.kind, h.title);

  console.log("\n## addLink postfactum");
  addLink(db, aPrime.id, b.id, "depends_on");
  const aPrimeFull = getEntryWithNeighbors(db, aPrime.id);
  console.log("  a' outgoing now:", aPrimeFull?.outgoing.length, "edges");

  console.log("\n## sanity: entry retrieval");
  const single = getEntry(db, b.id);
  console.log("  get(b):", single?.id, single?.title, "tags=", single?.tags);

  console.log("\nDONE");
  shutdownMorph();
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
