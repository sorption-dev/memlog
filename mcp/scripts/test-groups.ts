/**
 * Targeted test for project groups + search-with-group.
 * Uses a temp DB; does not touch production data.
 */
import { existsSync, unlinkSync } from "node:fs";
import { openDB } from "../src/db.js";
import { shutdownMorph } from "../src/morph.js";
import {
  addGroupMember,
  createGroup,
  deleteGroup,
  expandGroupsToSessions,
  getGroupByName,
  groupsContainingSession,
  listGroups,
  removeGroupMember,
  updateGroup,
} from "../src/groups.js";
import { recentEntries, searchEntries, writeEntry } from "../src/repo.js";

const DB_PATH = "/tmp/memlog-groups-test.sqlite";

async function main() {
  for (const ext of ["", "-wal", "-shm"]) {
    const p = DB_PATH + ext;
    if (existsSync(p)) unlinkSync(p);
  }
  const db = openDB(DB_PATH);

  console.log("## seed 3 sessions");
  await writeEntry(db, {
    kind: "fact",
    title: "A1",
    body: "entry in project A",
    session_id: "proj-a",
  });
  await writeEntry(db, {
    kind: "fact",
    title: "B1",
    body: "entry in project B",
    session_id: "proj-b",
  });
  await writeEntry(db, {
    kind: "decision",
    title: "C1",
    body: "entry in project C",
    session_id: "proj-c",
  });
  await writeEntry(db, {
    kind: "fact",
    title: "B2",
    body: "another in B",
    session_id: "proj-b",
  });

  console.log("\n## create group 'enapter' with A+B");
  createGroup(db, "enapter", "All Enapter-related projects", "#e8b554");
  addGroupMember(db, "enapter", "proj-a");
  addGroupMember(db, "enapter", "proj-b");

  console.log("## listGroups()");
  for (const g of listGroups(db)) {
    console.log(
      `  ${g.name} (${g.member_count} members, ${g.entry_count} entries): ${g.members.join(", ")}`,
    );
  }

  console.log("\n## expandGroupsToSessions(['enapter'])");
  console.log("  ", expandGroupsToSessions(db, ["enapter"]));

  console.log("\n## searchEntries with group='enapter' → should return A1, B1, B2 (not C1)");
  const r1 = await searchEntries(db, { group: "enapter", limit: 10 });
  for (const h of r1.hits) console.log("  ", h.session_id, h.title);

  console.log("\n## recentEntries with group=['enapter']");
  const r2 = recentEntries(db, { group: ["enapter"], limit: 10 });
  for (const h of r2.hits) console.log("  ", h.session_id, h.title);

  console.log("\n## merge: session_id='proj-c' + group='enapter' → A+B+C");
  const r3 = recentEntries(db, { session_id: "proj-c", group: "enapter", limit: 10 });
  for (const h of r3.hits) console.log("  ", h.session_id, h.title);

  console.log("\n## groupsContainingSession('proj-a')");
  console.log("  ", groupsContainingSession(db, "proj-a").map((g) => g.name));
  console.log("## groupsContainingSession('proj-c')");
  console.log("  ", groupsContainingSession(db, "proj-c").map((g) => g.name));

  console.log("\n## non-existent group → should throw");
  try {
    await searchEntries(db, { group: "nonexistent" });
    console.log("  FAIL: didn't throw");
  } catch (e) {
    console.log("  ✓ threw:", (e as Error).message);
  }

  console.log("\n## updateGroup description");
  updateGroup(db, "enapter", { description: "updated desc" });
  console.log("  ", getGroupByName(db, "enapter")?.description);

  console.log("\n## removeGroupMember proj-b");
  removeGroupMember(db, "enapter", "proj-b");
  console.log("  expand now:", expandGroupsToSessions(db, ["enapter"]));

  console.log("\n## deleteGroup 'enapter' → cascades members");
  deleteGroup(db, "enapter");
  console.log("  groups after:", listGroups(db).length);
  console.log(
    "  orphan members?",
    (
      db.prepare(`SELECT count(*) AS n FROM project_group_members`).get() as {
        n: number;
      }
    ).n,
  );

  console.log("\n## entries untouched after group delete");
  const r4 = recentEntries(db, { limit: 10 });
  console.log("  entries still:", r4.hits.length);

  console.log("\nDONE");
  shutdownMorph();
  db.close();
}

main().catch((e) => {
  console.error(e);
  shutdownMorph();
  process.exit(1);
});
