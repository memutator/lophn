import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { manualClock } from "../../base/mod.ts";
import { instanceFromRow, lineFromRow } from "./rows.ts";
import { workflowsNoHarnessKindSteps, workflowsSchemaSteps } from "./schema.ts";
import { applyMigrations } from "../storage/migration/mod.ts";

const PRJ = "prj_01hzzzzzzzzzzzzzzzzzzzzzza";
const WFI = "wfi_01hzzzzzzzzzzzzzzzzzzzzzza";
const AT = "2026-11-01T00:00:00.000Z";

// 사람의 ledger에는 `{kind:"harness"}` 참가자와 reason `harness`인 not_handed 줄이 남아 있을 수 있다.
// 줄은 trigger가 고치기를 막으므로 step이 trigger를 잠시 내렸다 다시 세워도 새 schema로 읽혀야 하고 trigger는 서야 한다.
test("harness 참가자와 harness 이유가 저장된 행은 step 뒤 새 schema로 읽힌다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-workflows-schema-"));
  try {
    const path = join(root, "lophn.db");
    const deps = { clock: manualClock(Date.UTC(2026, 10, 1)) };
    assert.equal(
      (await applyMigrations(path, workflowsSchemaSteps, deps)).ok,
      true,
    );
    const db = new DatabaseSync(path);
    db.exec(`
      insert into workflow_instances (id, project, workflow, input, state, participants, steps, human_turn, started_by, created_at, finished_at, state_seq)
        values ('${WFI}', '${PRJ}', 'review', 'x', 'ended',
          '{"coder":{"kind":"harness"},"me":{"kind":"human"},"editor":{"agent":"lophn","workspace":{"app":"notes"}}}',
          '[]', 0, '{"kind":"user"}', '${AT}', '${AT}', 1);
      insert into workflow_lines (instance, seq, at, kind, by, step, data)
        values ('${WFI}', 1, '${AT}', 'not_handed', '{"kind":"lophn"}', 'code',
          '{"reason":"harness","message":"a harness participant is not handed a step"}');
    `);
    db.close();

    assert.equal(
      (
        await applyMigrations(
          path,
          [...workflowsSchemaSteps, ...workflowsNoHarnessKindSteps],
          deps,
        )
      ).ok,
      true,
    );
    const after = new DatabaseSync(path);
    try {
      const instance = instanceFromRow(
        after.prepare("select * from workflow_instances").get()!,
      );
      assert.ok(instance.ok);
      assert.deepEqual(instance.value.participants, {
        me: { kind: "human" },
        editor: { agent: "lophn", workspace: { app: "notes" } },
      });
      const line = lineFromRow(
        after.prepare("select * from workflow_lines").get()!,
      );
      assert.ok(line.ok);
      assert.equal(
        line.value.kind === "not_handed" && line.value.reason,
        "unresolved",
      );
      assert.throws(() => after.exec("update workflow_lines set step = 'x'"));
    } finally {
      after.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
