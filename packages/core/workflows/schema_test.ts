import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { manualClock } from "../../base/mod.ts";
import { instanceFromRow, lineFromRow } from "./rows.ts";
import { WORKFLOW_CHECKPOINTS_SCHEMA_STEP } from "./checkpoint-schema.ts";
import { WORKFLOW_INPUTS_SCHEMA_STEP } from "./inputs-schema.ts";
import { workflowLinesSchemaSteps } from "./lines-schema.ts";
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
          [
            ...workflowsSchemaSteps,
            ...workflowsNoHarnessKindSteps,
            ...workflowLinesSchemaSteps,
          ],
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
      // 표를 다시 짠 뒤에도 줄은 그대로고 새 kind 넷이 들어가며 append-only trigger 둘이 선다.
      for (const [i, kind] of [
        "step_stalled",
        "retried",
        "escalated",
        "code_updated",
      ].entries()) {
        after.exec(
          `insert into workflow_lines (instance, seq, at, kind, by) values ('${WFI}', ${i + 2}, '${AT}', '${kind}', '{"kind":"lophn"}')`,
        );
      }
      assert.throws(() => after.exec("update workflow_lines set step = 'x'"));
      assert.throws(() => after.exec("delete from workflow_lines"));
    } finally {
      after.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("기존 workflow_instances 행은 workflows.instances-inputs step 뒤 inputs_json이 NULL이고 valid JSON만 받는다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-workflows-inputs-schema-"));
  try {
    const path = join(root, "lophn.db");
    const deps = { clock: manualClock(Date.UTC(2026, 10, 1)) };
    const beforeSteps = [
      ...workflowsSchemaSteps,
      ...workflowsNoHarnessKindSteps,
      ...workflowLinesSchemaSteps,
    ];
    assert.equal((await applyMigrations(path, beforeSteps, deps)).ok, true);

    const db = new DatabaseSync(path);
    db.exec(`
      insert into workflow_instances (id, project, workflow, input, state, participants, steps, human_turn, started_by, created_at, finished_at, state_seq)
        values ('${WFI}', '${PRJ}', 'review', 'hello', 'running',
          '{"me":{"kind":"human"}}', '[]', 0, '{"kind":"user"}', '${AT}', NULL, 1);
    `);
    db.close();

    assert.equal(
      (
        await applyMigrations(
          path,
          [...beforeSteps, WORKFLOW_INPUTS_SCHEMA_STEP],
          deps,
        )
      ).ok,
      true,
    );

    const after = new DatabaseSync(path);
    try {
      const existing = after
        .prepare("select inputs_json from workflow_instances where id = ?")
        .get(WFI) as { inputs_json: unknown };
      assert.equal(existing.inputs_json, null);

      const second = "wfi_01hzzzzzzzzzzzzzzzzzzzzzzb";
      after.exec(`
        insert into workflow_instances (id, project, workflow, input, inputs_json, state, participants, steps, human_turn, started_by, created_at, finished_at, state_seq)
          values ('${second}', '${PRJ}', 'review', 'hello', '{"env":"prod","limit":3}', 'running',
            '{"me":{"kind":"human"}}', '[]', 0, '{"kind":"user"}', '${AT}', NULL, 1);
      `);
      const inserted = after
        .prepare("select inputs_json from workflow_instances where id = ?")
        .get(second) as { inputs_json: string };
      assert.deepEqual(JSON.parse(inserted.inputs_json), {
        env: "prod",
        limit: 3,
      });

      assert.throws(() =>
        after.exec(`
          update workflow_instances set inputs_json = '{not json' where id = '${WFI}';
        `),
      );
    } finally {
      after.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("기존 workflow_instances 행은 workflows.checkpoints-and-snapshot step 뒤 code_snapshot이 NULL이고 workflow_checkpoints 제약을 지킨다", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "lophn-workflows-checkpoints-schema-"),
  );
  try {
    const path = join(root, "lophn.db");
    const deps = { clock: manualClock(Date.UTC(2026, 10, 1)) };
    const beforeSteps = [
      ...workflowsSchemaSteps,
      ...workflowsNoHarnessKindSteps,
      ...workflowLinesSchemaSteps,
      WORKFLOW_INPUTS_SCHEMA_STEP,
    ];
    assert.equal((await applyMigrations(path, beforeSteps, deps)).ok, true);

    const db = new DatabaseSync(path);
    db.exec(`
      insert into workflow_instances (id, project, workflow, input, state, participants, steps, human_turn, started_by, created_at, finished_at, state_seq)
        values ('${WFI}', '${PRJ}', 'review', 'hello', 'running',
          '{"me":{"kind":"human"}}', '[]', 0, '{"kind":"user"}', '${AT}', NULL, 1);
    `);
    db.close();

    assert.equal(
      (
        await applyMigrations(
          path,
          [...beforeSteps, WORKFLOW_CHECKPOINTS_SCHEMA_STEP],
          deps,
        )
      ).ok,
      true,
    );

    const after = new DatabaseSync(path);
    try {
      after.exec("PRAGMA foreign_keys = ON;");
      const existing = after
        .prepare("select code_snapshot from workflow_instances where id = ?")
        .get(WFI) as { code_snapshot: unknown };
      assert.equal(existing.code_snapshot, null);

      // 유효한 checkpoint 삽입 (모든 kind/state 조합 검증)
      after.exec(`
        insert into workflow_checkpoints (instance, key, kind, state, handle_ref, output_json, error_json, started_at, finished_at)
          values
            ('${WFI}', 's1', 'step', 'completed', NULL, '{"summary":"ok"}', NULL, '${AT}', '${AT}'),
            ('${WFI}', 's1/agent#1', 'agent', 'failed', 'ses_01hzzzzzzzzzzzzzzzzzzzzzza', NULL, '{"reason":"stalled","message":"stopped"}', '${AT}', '${AT}'),
            ('${WFI}', 's1/human#1', 'human', 'started', 'ses_01hzzzzzzzzzzzzzzzzzzzzzzb', NULL, NULL, '${AT}', NULL),
            ('${WFI}', 's1/workflow#1', 'workflow', 'interrupted', 'wfi_01hzzzzzzzzzzzzzzzzzzzzzzb', NULL, NULL, '${AT}', '${AT}'),
            ('${WFI}', 's1/tool#1', 'tool', 'completed', 'inv_01hzzzzzzzzzzzzzzzzzzzzzza', '{"ok":true}', NULL, '${AT}', '${AT}');
      `);

      // 복합 PK (instance, key) 중복 금지
      assert.throws(() =>
        after.exec(`
          insert into workflow_checkpoints (instance, key, kind, state, started_at)
            values ('${WFI}', 's1', 'step', 'started', '${AT}');
        `),
      );

      // kind CHECK 제약
      assert.throws(() =>
        after.exec(`
          insert into workflow_checkpoints (instance, key, kind, state, started_at)
            values ('${WFI}', 'bad-kind', 'other', 'started', '${AT}');
        `),
      );

      // state CHECK 제약
      assert.throws(() =>
        after.exec(`
          insert into workflow_checkpoints (instance, key, kind, state, started_at)
            values ('${WFI}', 'bad-state', 'step', 'pending', '${AT}');
        `),
      );

      // output_json / error_json json_valid 제약
      assert.throws(() =>
        after.exec(`
          insert into workflow_checkpoints (instance, key, kind, state, output_json, started_at)
            values ('${WFI}', 'bad-output', 'step', 'completed', '{not json', '${AT}');
        `),
      );
      assert.throws(() =>
        after.exec(`
          insert into workflow_checkpoints (instance, key, kind, state, error_json, started_at)
            values ('${WFI}', 'bad-error', 'step', 'failed', '[bad', '${AT}');
        `),
      );

      // ON DELETE CASCADE 검증
      after.exec(`delete from workflow_instances where id = '${WFI}';`);
      const left = after
        .prepare("select count(*) as n from workflow_checkpoints")
        .get() as { n: number };
      assert.equal(left.n, 0);
    } finally {
      after.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
