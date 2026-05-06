import { lemmatizeRu, morphStatus } from "./morph.js";

const CYRILLIC = /\p{Script=Cyrillic}/u;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}_-]*/gu;

function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(WORD)) out.push(m[0]);
  return out;
}

function isCyrillic(token: string): boolean {
  return CYRILLIC.test(token);
}

/**
 * Lemmatize mixed ru+en text for FTS indexing.
 * - Cyrillic tokens → pymorphy3 normal_form (runs in Pyodide)
 * - Other tokens → lowercased
 * On morph failure: everything lowercased (degraded mode).
 */
export async function lemmatize(text: string): Promise<string> {
  const tokens = tokenize(text);
  if (tokens.length === 0) return "";

  const cyrIdx: number[] = [];
  const cyrTokens: string[] = [];
  const result: string[] = new Array(tokens.length);

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (isCyrillic(t)) {
      cyrIdx.push(i);
      cyrTokens.push(t);
    } else {
      result[i] = t.toLowerCase();
    }
  }

  if (cyrTokens.length > 0) {
    const lemmas = await lemmatizeRu(cyrTokens);
    for (let k = 0; k < cyrIdx.length; k++) {
      result[cyrIdx[k]!] = lemmas[k] ?? cyrTokens[k]!.toLowerCase();
    }
  }

  return result.join(" ");
}

export function isDegraded(): boolean {
  return morphStatus() === "degraded";
}
