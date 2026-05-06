/**
 * Targeted test for journal_redact and journal_stats.
 * Uses a temp DB; does not touch production data.
 */
import { existsSync, unlinkSync } from "node:fs";
import { openDB } from "../src/db.js";
import { shutdownMorph } from "../src/morph.js";
import { addLink, collectStats, getEntry, redactEntry, writeEntry } from "../src/repo.js";

const DB_PATH = "/tmp/memlog-redact-stats.sqlite";

async function main() {
  for (const ext of ["", "-wal", "-shm"]) {
    const p = DB_PATH + ext;
    if (existsSync(p)) unlinkSync(p);
  }
  const db = openDB(DB_PATH);

  console.log("## seed a small graph");
  const fact = await writeEntry(db, {
    kind: "fact",
    title: "Моё имя — Игнат, я живу в Ереване",
    body: "Личные данные которые не должны попадать в поиск.",
    session_id: "test",
    tags: ["pii", "personal"],
  });
  const dec = await writeEntry(db, {
    kind: "decision",
    title: "Сейчас активно работаю над проектом memlog",
    body: "Решение базируется на факте #" + fact.id,
    session_id: "test",
    tags: ["work"],
    links: [{ to_id: fact.id, relation: "depends_on" }],
  });
  const todo = await writeEntry(db, {
    kind: "todo",
    title: "Дописать journal_redact + stats",
    body: "Текущая задача.",
    session_id: "test",
  });
  console.log("  ids:", fact.id, dec.id, todo.id);

  console.log("\n## stats before redact");
  const s1 = collectStats(db, DB_PATH);
  console.log("  entries:", s1.totalEntries, "links:", s1.totalLinks, "redacted:", s1.redactedEntries);
  console.log("  byKind:", s1.byKind);

  console.log("\n## redact the PII fact");
  const red = redactEntry(db, fact.id);
  console.log("  after redact:", red?.title, "| body:", red?.body, "| tags:", red?.tags);

  console.log("\n## graph preserved? decision should still link to fact");
  const decAfter = getEntry(db, dec.id);
  const factAfter = getEntry(db, fact.id);
  console.log("  dec still exists:", decAfter?.id, decAfter?.title);
  console.log("  fact still exists (redacted):", factAfter?.id, factAfter?.title);
  const linkRow = db
    .prepare(`SELECT * FROM links WHERE from_id = ? AND to_id = ?`)
    .get(dec.id, fact.id);
  console.log("  link preserved:", !!linkRow, linkRow);

  console.log("\n## idempotent — second redact is a no-op (same body)");
  const again = redactEntry(db, fact.id);
  console.log("  same?", again?.body === red?.body, again?.body);

  console.log("\n## redact non-existent id");
  const missing = redactEntry(db, 99999);
  console.log("  missing:", missing);

  console.log("\n## stats after redact");
  const s2 = collectStats(db, DB_PATH);
  console.log("  entries:", s2.totalEntries, "redacted:", s2.redactedEntries);
  console.log("  activity:", s2.activity);
  console.log("  topSessions:", s2.topSessions);
  console.log("  byRelation:", s2.byRelation);

  console.log("\nDONE");
  shutdownMorph();
  db.close();
}

main().catch((e) => {
  console.error(e);
  shutdownMorph();
  process.exit(1);
});
