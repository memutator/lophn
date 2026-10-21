import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { createSql } from "../../storage/ledger/sqlite.ts";
import { codingSchemaSteps } from "./schema.ts";
import { loadSession, stateOf } from "./store.ts";

// createSql은 INTEGER를 bigint로 준다. 1n을 1과 비교해 flag가 모두 false로 읽히면 session이 영영 unknown이다
// (snapshot이 idle을 못 내 eval trial이 끝나지 않고, 메시지가 터미널에 안 들어간다).
Deno.test("coding session flags stored as 1 read back true through createSql", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(codingSchemaSteps[0]!.sql);
  const sql = createSql(db, () => true);
  sql.run(
    `INSERT INTO coding_sessions (session, app, prompt, call, harness, started, heard, running)
     VALUES ('s', 'a', 't', 'c', 'claude', 1, 1, 1)`,
    [],
  );
  const running = loadSession(sql, "s")!;
  assertEquals([running.started, running.heard, running.running], [
    true,
    true,
    true,
  ]);
  assertEquals(stateOf(running), "running");

  sql.run("UPDATE coding_sessions SET running = 0", []);
  assertEquals(stateOf(loadSession(sql, "s")!), "idle");
});
