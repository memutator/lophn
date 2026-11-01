import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { invocationsSchemaSteps } from "./schema.ts";

// 옛 호출 기록의 대상(`tool`)을 command로 옮기고, 끝난 행을 잠그는 trigger를 되살린다.
test("operation-kinds step은 옛 tool 기록을 command로 옮기고 종료한 행의 잠금을 유지한다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(invocationsSchemaSteps[0].sql);
  const insert = db.prepare(
    `INSERT INTO invocations (id, app, release, mode, operation, effect, status, finished_at, summary)
     VALUES (?, 'app_1', 'rel_1', 'live', ?, 'write', 'succeeded', '2026-10-16T00:00:00.000Z', '{}')`,
  );
  insert.run("inv_1", JSON.stringify({ kind: "tool", tool: "items.add" }));
  insert.run("inv_2", JSON.stringify({ kind: "data_change", from: 1, to: 2 }));
  db.exec(invocationsSchemaSteps[1].sql);

  const rows = db
    .prepare("SELECT id, operation FROM invocations ORDER BY id")
    .all() as { id: string; operation: string }[];
  assert.deepStrictEqual(
    rows.map((row) => JSON.parse(row.operation)),
    [
      { kind: "command", name: "items.add" },
      { kind: "data_change", from: 1, to: 2 },
    ],
  );
  assert.throws(
    () => db.exec("UPDATE invocations SET effect = 'read' WHERE id = 'inv_1'"),
    /terminal invocation is immutable/,
  );
});
