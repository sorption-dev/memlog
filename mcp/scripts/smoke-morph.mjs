#!/usr/bin/env node
// One-off smoke test for the Pyodide-backed morph module:
//   bun run scripts/smoke-morph.mjs
import { lemmatizeRu, morphStatus, morphDiagnostic } from "../src/morph.ts";

const cases = [
  ["решения", "тестирую", "программирование"],
  ["котиков", "быстро", "бегущих"],
  ["memlog", "is", "good"], // non-cyrillic should pass through our tokenizer, but lemmatizeRu gets cyr only
];

const t0 = Date.now();
for (const batch of cases) {
  const out = await lemmatizeRu(batch);
  console.log(batch.join(" ") + "  →  " + out.join(" "));
}
console.log("---");
console.log("status:", morphStatus());
console.log("diagnostic:", morphDiagnostic());
console.log("total elapsed:", Date.now() - t0, "ms");
process.exit(0);
