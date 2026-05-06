#!/usr/bin/env node
// Rebuild title_lemmas / body_lemmas for every entry using the current
// lemmatizer. Run once after switching morphology backends.
//
// Usage:
//   bun run scripts/reindex-fts.mjs [path/to/db.sqlite]
//
// Defaults to <repo>/mcp/data/db.sqlite.
//
// Triggers on `entries` (entries_au) will re-populate entries_fts
// automatically when we UPDATE title_lemmas/body_lemmas.
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const defaultDb = resolve(here, "..", "data", "db.sqlite");
const dbPath = process.argv[2] || defaultDb;

const { openDB } = await import("../src/db.ts");
const { lemmatize } = await import("../src/tokens.ts");
const { shutdownMorph, morphStatus } = await import("../src/morph.ts");

const db = openDB(dbPath);
const rows = db
  .prepare("SELECT id, title, body FROM entries ORDER BY id")
  .all();
console.log(`Reindexing ${rows.length} entries in ${dbPath}…`);

const update = db.prepare(
  "UPDATE entries SET title_lemmas = ?, body_lemmas = ? WHERE id = ?",
);

const t0 = Date.now();
let i = 0;
for (const row of rows) {
  const titleL = await lemmatize(row.title);
  const bodyL = await lemmatize(row.body);
  update.run(titleL, bodyL, row.id);
  i++;
  if (i % 10 === 0 || i === rows.length) {
    console.log(`  ${i}/${rows.length}`);
  }
}

console.log(
  `Done. ${rows.length} entries reindexed in ${Date.now() - t0}ms  (morph=${morphStatus()})`,
);
shutdownMorph();
process.exit(0);
