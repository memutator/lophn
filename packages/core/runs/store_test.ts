import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { createSql } from "../storage/ledger/sqlite.ts";
import { runsSchemaSteps } from "./schema.ts";
import { insertRun, loadRun } from "./store.ts";

// createSql은 INTEGER를 bigint로 준다. 1n을 1과 비교하면 flag가 모두 false로 읽혀
// 화면이 run이 연 session을 run 아래에 하나도 묶지 못한다.
Deno.test("run이 연 session은 다시 읽어도 session_opened가 참이다(INTEGER는 bigint로 온다)", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(runsSchemaSteps[0]!.sql);
    const sql = createSql(db, () => true);
    const id = "run_01hzzzzzzzzzzzzzzzzzzzzzza";
    insertRun(sql, {
      id,
      kind: "agent",
      target: { agent: { role: "lophn" } },
      place: null,
      session: "ses_01hzzzzzzzzzzzzzzzzzzzzzza",
      session_opened: true,
      input_message: "msg_01hzzzzzzzzzzzzzzzzzzzzzza",
      schema: null,
      created_at: "2026-01-01T00:00:00.000Z",
    });
    const run = loadRun(sql, id);
    assertEquals(run.ok && run.value?.session_opened, true);
  } finally {
    db.close();
  }
});
