import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { manualClock } from "../../../base/mod.ts";
import { applyMigrations } from "../../storage/migration/mod.ts";
import { modelCallsAnyProtocolSchemaSteps, usageSchemaSteps } from "./mod.ts";

const COLUMNS = `id, turn, session, model_use, agent_hash, purpose, attempt_kind, attempt_order, retry_of,
  provider, model_name, protocol, call_model, input, context_basis, state, state_seq, started_seq, started_at, usage, cost`;

function insertCall(
  db: DatabaseSync,
  id: string,
  protocol: string,
  order: number,
  retryOf: string | null = null,
) {
  db.prepare(
    `insert into model_calls (${COLUMNS})
     values (?, 'trn_1', 'ses_1', 'judgment', ?, 'judgment', ?, ?, ?, 'pvd_1', 'm', ?, '{}', 'i', 'c',
             'started', 1, 1, '2026-11-01T00:00:00.000Z', '{}', '{}')`,
  ).run(
    id,
    "a".repeat(64),
    retryOf === null ? "initial" : "retry",
    order,
    retryOf,
    protocol,
  );
}

// 표를 다시 짜도 적힌 call 기록과 그 보완·retry 연결은 그대로이고, 처음 표가 받지 못하던 Google wire call을 적을 수 있다.
test("model_calls를 다시 짜도 기록이 남고 Google wire call을 적을 수 있다", async () => {
  const root = await mkdtemp(join(tmpdir(), "lophn-model-calls-"));
  const path = join(root, "lophn.db");
  const deps = { clock: manualClock(Date.UTC(2026, 10, 1)) };
  try {
    assert.ok((await applyMigrations(path, usageSchemaSteps, deps)).ok);
    let db = new DatabaseSync(path);
    insertCall(db, "mcl_1", "anthropic-messages", 1);
    insertCall(db, "mcl_2", "anthropic-messages", 2, "mcl_1");
    db.prepare(
      "insert into model_call_supplements (call, supplement_key, seq, at) values ('mcl_1', 'k', 1, 'x')",
    ).run();
    assert.throws(
      () => insertCall(db, "mcl_x", "gemini-generate-content", 3),
      /CHECK constraint failed/,
    );
    db.close();

    const applied = await applyMigrations(
      path,
      [...usageSchemaSteps, ...modelCallsAnyProtocolSchemaSteps],
      deps,
    );
    assert.deepStrictEqual(applied, { ok: true, value: 1 });

    db = new DatabaseSync(path);
    assert.deepStrictEqual(
      db
        .prepare("select id, retry_of from model_calls order by id")
        .all()
        .map((row) => ({ ...row })),
      [
        { id: "mcl_1", retry_of: null },
        { id: "mcl_2", retry_of: "mcl_1" },
      ],
    );
    // 보완 기록과 retry가 새 표를 가리키고 깨진 연결이 없다.
    assert.deepStrictEqual(
      db
        .prepare("pragma foreign_key_list(model_call_supplements)")
        .all()
        .map((row) => row["table"]),
      ["model_calls"],
    );
    assert.deepStrictEqual(db.prepare("pragma foreign_key_check").all(), []);
    db.exec("pragma foreign_keys=ON");
    insertCall(db, "mcl_3", "gemini-generate-content", 3);
    insertCall(db, "mcl_4", "cloud-code-assist", 4);
    db.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
