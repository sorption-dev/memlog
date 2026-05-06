/**
 * End-to-end smoke for the MCP server: spawns `bin/memlog --mcp` as a child
 * and exchanges JSON-RPC messages over stdio, exactly like a real client would.
 */
import { spawn } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const DB_PATH = "/tmp/memlog-mcp-smoke.sqlite";
const BIN = resolve(new URL(".", import.meta.url).pathname, "..", "bin", "memlog");

for (const ext of ["", "-wal", "-shm"]) {
  const p = DB_PATH + ext;
  if (existsSync(p)) unlinkSync(p);
}

const child = spawn(BIN, ["--mcp"], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, MEMLOG_DB: DB_PATH },
});

child.stderr.on("data", (b: Buffer) => process.stderr.write(`[child] ${b.toString()}`));

let buf = "";
const pending = new Map<number, (msg: unknown) => void>();
let nextId = 1;

child.stdout.on("data", (b: Buffer) => {
  buf += b.toString();
  let i: number;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      console.log("  [non-json]", line);
      continue;
    }
    if (msg.id != null && pending.has(msg.id)) {
      const resolver = pending.get(msg.id)!;
      pending.delete(msg.id);
      resolver(msg);
    } else {
      console.log("  [notification]", msg.method ?? line.slice(0, 100));
    }
  }
});

function call(method: string, params?: unknown): Promise<any> {
  const id = nextId++;
  const msg = { jsonrpc: "2.0", id, method, params };
  return new Promise((resolve, reject) => {
    pending.set(id, (m: any) => {
      if (m.error) reject(new Error(`${method}: ${JSON.stringify(m.error)}`));
      else resolve(m.result);
    });
    child.stdin.write(JSON.stringify(msg) + "\n");
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`${method}: timeout`));
      }
    }, 10000);
  });
}

function notify(method: string, params?: unknown): void {
  const msg = { jsonrpc: "2.0", method, params };
  child.stdin.write(JSON.stringify(msg) + "\n");
}

async function main() {
  console.log("## initialize");
  const init = await call("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke", version: "0.1" },
  });
  console.log("  serverInfo:", init.serverInfo);
  console.log("  instructions present:", typeof init.instructions === "string");
  console.log("  instructions len:", init.instructions?.length ?? 0);

  notify("notifications/initialized");

  console.log("\n## tools/list");
  const tools = await call("tools/list", {});
  console.log("  tool count:", tools.tools.length);
  for (const t of tools.tools) console.log("    -", t.name, "—", t.description.slice(0, 80));

  console.log("\n## journal_write");
  const w1 = await call("tools/call", {
    name: "journal_write",
    arguments: {
      kind: "decision",
      title: "MCP-сервер работает через stdio",
      body: "Проверили реальный JSON-RPC обмен: initialize, tools/list, tools/call.",
      tags: ["mcp", "тест"],
      session_id: "smoke",
    },
  });
  console.log("  result:", w1.content[0].text);
  const id1 = w1.structuredContent.id;

  const w2 = await call("tools/call", {
    name: "journal_write",
    arguments: {
      kind: "fact",
      title: "FTS5 с unicode61 корректно режет кириллицу",
      body: "Проверили лемматизацию через pymorphy3 — лемматизация и решения нормализуются.",
      tags: ["fts"],
      session_id: "smoke",
      links: [{ to_id: id1, relation: "depends_on" }],
    },
  });
  console.log("  result:", w2.content[0].text);

  console.log("\n## journal_search — morphology query");
  const s1 = await call("tools/call", {
    name: "journal_search",
    arguments: { query: "лемматизация", limit: 5 },
  });
  console.log(s1.content[0].text.split("\n").map((l: string) => "  " + l).join("\n"));

  console.log("\n## journal_get with_neighbors");
  const g1 = await call("tools/call", {
    name: "journal_get",
    arguments: { id: id1, with_neighbors: true },
  });
  console.log(g1.content[0].text.split("\n").map((l: string) => "  " + l).join("\n"));

  console.log("\n## journal_recent");
  const r1 = await call("tools/call", {
    name: "journal_recent",
    arguments: { limit: 5, session_id: "smoke" },
  });
  console.log(r1.content[0].text.split("\n").map((l: string) => "  " + l).join("\n"));

  console.log("\nOK — MCP round-trip works");
  child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 200);
}

main().catch((e) => {
  console.error("FAIL:", e);
  child.kill("SIGKILL");
  process.exit(1);
});
