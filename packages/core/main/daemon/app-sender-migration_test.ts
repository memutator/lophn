import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { manualClock } from "../../../base/mod.ts";
import { applyMigrations } from "../../storage/migration/mod.ts";
import { TEAMS, WIRINGS } from "./assembly.ts";
import { assemble } from "./registration.ts";

// 사람의 ledger는 messages에 checkpoints·reverts가 `on delete restrict`로 걸려 있다. 앱 보낸 쪽 step이 messages를 다시 짜도
// 행과 index·trigger와 FK 자식이 그대로여야 한다(데이터를 잃는 step이라 이 규칙만 지킨다).
test("messages를 다시 짜도 FK 자식이 걸린 행·index·trigger가 그대로다", async () => {
  const wirings = WIRINGS.map((make) => make());
  const assembled = assemble(TEAMS, {});
  assert.ok(assembled.ok);
  const steps = [
    ...wirings.flatMap((wiring) => wiring.schemaSteps ?? []),
    ...assembled.value.schemaSteps,
    ...wirings.flatMap((wiring) => wiring.schemaStepsAfterTeams ?? []),
  ];
  const mine = steps.findIndex(
    (step) => step.id === "router.app-sender.messages",
  );
  assert.ok(mine > 0);
  const root = await mkdtemp(join(tmpdir(), "app-sender-"));
  const path = join(root, "ledger.db");
  const clock = manualClock(Date.UTC(2026, 0, 1));
  try {
    const before = await applyMigrations(path, steps.slice(0, mine), { clock });
    assert.ok(before.ok);

    const db = new DatabaseSync(path);
    db.exec("pragma foreign_keys=ON");
    db.exec(
      `insert into sessions (id, agent, created_seq, state_seq) values ('ses_a', 'lophn', 1, 1)`,
    );
    db.exec(`insert into messages (id, session, from_kind, body, created_seq, created_at, state_seq)
      values ('msg_1', 'ses_a', 'human', '${"a".repeat(64)}', 1, 't', 1),
             ('msg_2', 'ses_a', 'human', '${"b".repeat(64)}', 2, 't', 2)`);
    db.exec(
      `insert into checkpoints (message, session) values ('msg_1', 'ses_a')`,
    );
    db.exec(`insert into reverts (id, session, choice, checkpoint, boundary_seq, outcome, preview_hash)
      values ('rev_1', 'ses_a', 'restore_all', 'msg_1', 1, 'applying', '${"c".repeat(64)}')`);
    db.exec(`insert into agent_calls (call, from_session, "to", receiver_session, reply, state, created_at, state_at)
      values ('cal_1', 'ses_a', '{}', 'ses_a', 'result', 'accepted', 't', 't')`);
    // index와 trigger는 이름뿐 아니라 SQL 글까지 같아야 한다(표를 다시 짜면 사라져 다시 만든 것이다).
    const objects = (conn: DatabaseSync, name: string) =>
      conn
        .prepare(
          "select type, name, sql from sqlite_master where tbl_name = ? and type in ('index', 'trigger') and name not like 'sqlite_%' order by type, name",
        )
        .all(name)
        .map((row) => ({ ...row }));
    const shape = {
      messages: objects(db, "messages"),
      agent_calls: objects(db, "agent_calls"),
    };
    const rows = db
      .prepare("select * from messages order by created_seq")
      .all();
    db.close();

    const after = await applyMigrations(path, steps, { clock });
    assert.ok(after.ok, JSON.stringify(after));

    const next = new DatabaseSync(path);
    next.exec("pragma foreign_keys=ON");
    // 옛 행은 새 표시 열(origin_app)만 null로 더 가질 뿐 그대로다.
    assert.deepStrictEqual(
      next
        .prepare("select * from messages order by created_seq")
        .all()
        .map(({ origin_app, ...rest }) => {
          assert.equal(origin_app, null);
          return rest;
        }),
      rows.map((row) => ({ ...row })),
    );
    assert.equal(
      next.prepare("select count(*) as n from checkpoints").get()?.["n"],
      1,
    );
    assert.equal(
      next.prepare("select count(*) as n from reverts").get()?.["n"],
      1,
    );
    assert.equal(
      next.prepare("select count(*) as n from agent_calls").get()?.["n"],
      1,
    );
    assert.deepStrictEqual(next.prepare("pragma foreign_key_check").all(), []);
    // 표시 열(origin_app)이 불변 trigger의 열 목록에 들어간 것 하나만 SQL이 다르고 나머지는 글까지 같다.
    assert.deepStrictEqual(
      objects(next, "messages"),
      shape.messages.map((one) =>
        one["name"] === "messages_content_immutable"
          ? {
              ...one,
              sql: String(one["sql"]).replace(
                "shell, created_at on messages",
                "shell, origin_app, created_at on messages",
              ),
            }
          : one,
      ),
    );
    // agent_calls는 앱 dedup index 하나만 늘고 나머지는 SQL까지 그대로다.
    const calls = objects(next, "agent_calls");
    assert.deepStrictEqual(
      calls.filter((one) => one["name"] !== "agent_calls_app_dedup"),
      shape.agent_calls,
    );
    assert.equal(calls.length, shape.agent_calls.length + 1);
    // FK 자식은 새 messages를 가리키고(지우면 막힌다), 앱 보낸 쪽이 들어가며, 옛 불변 trigger가 산다.
    assert.throws(() => next.exec("delete from messages where id = 'msg_1'"));
    next.exec(`insert into messages (id, session, from_kind, from_ref, call, body, created_seq, created_at, state_seq)
      values ('msg_3', 'ses_a', 'app', 'app_x|notes', 'cal_2', '${"d".repeat(64)}', 3, 't', 3)`);
    assert.throws(() =>
      next.exec("update messages set from_ref = 'app_y|z' where id = 'msg_3'"),
    );
    next.close();
  } finally {
    await rm(root, { recursive: true });
  }
});

// jobs 표를 다시 짜도(`jobs.trigger`) 이미 있는 주기 job과 그 기록은 그대로이고, event job은 every 없이 들어가며 때가 없는 job은 들어가지 못한다.
test("jobs를 다시 짜도 주기 job과 job run은 그대로다", async () => {
  const wirings = WIRINGS.map((make) => make());
  const assembled = assemble(TEAMS, {});
  assert.ok(assembled.ok);
  const steps = [
    ...wirings.flatMap((wiring) => wiring.schemaSteps ?? []),
    ...assembled.value.schemaSteps,
    ...wirings.flatMap((wiring) => wiring.schemaStepsAfterTeams ?? []),
  ];
  const mine = steps.findIndex((step) => step.id === "jobs.trigger");
  assert.ok(mine > 0);
  const root = await mkdtemp(join(tmpdir(), "jobs-trigger-"));
  const path = join(root, "ledger.db");
  const clock = manualClock(Date.UTC(2026, 0, 1));
  try {
    assert.ok(
      (await applyMigrations(path, steps.slice(0, mine), { clock })).ok,
    );
    const db = new DatabaseSync(path);
    db.exec(`insert into jobs (id, title, creator_agent, creator_workspace, every, at, action, missed_policy, enabled, next_due_at, created_at, updated_at, approved_at)
      values ('job_1', 'daily', 'lophn_home', null, '1d', '09:00', '{"kind":"agent_run"}', 'hold', 1, 'n', 'c', 'u', 'a')`);
    db.exec(`insert into job_runs (id, job, due_at, missed_count, state, created_at)
      values ('jbr_1', 'job_1', 'd', 2, 'skipped', 'c')`);
    const before = { ...db.prepare("select * from jobs").get() };
    const run = { ...db.prepare("select * from job_runs").get() };
    db.close();

    assert.ok((await applyMigrations(path, steps, { clock })).ok);
    const next = new DatabaseSync(path);
    const after = { ...next.prepare("select * from jobs").get() };
    assert.deepStrictEqual(
      {
        ...after,
        trigger: null,
        fired_count: 0,
        skipped_count: 0,
        last_fired_at: null,
        last_skipped_at: null,
        last_skip_reason: null,
      },
      {
        ...before,
        trigger: null,
        fired_count: 0,
        skipped_count: 0,
        last_fired_at: null,
        last_skipped_at: null,
        last_skip_reason: null,
        machine: null,
        approved_modes_json: null,
      },
    );
    assert.deepStrictEqual(after["trigger"], null);
    assert.deepStrictEqual(
      { ...next.prepare("select * from job_runs").get(), event: null },
      { ...run, event: null },
    );
    const insert = (every: string | null, trigger: string | null) =>
      next.exec(`insert into jobs (id, title, creator_agent, every, trigger, action, missed_policy, enabled, created_at, updated_at)
        values ('job_${every ?? "e"}${trigger === null ? "n" : "t"}', 't', 'a', ${every === null ? "null" : `'${every}'`}, ${trigger === null ? "null" : `'${trigger}'`}, '{}', 'run', 1, 'c', 'u')`);
    insert(null, '{"source":"lophn","event":"session.idle"}');
    assert.throws(() => insert(null, null));
    assert.throws(() => insert("1h", '{"source":"lophn"}'));
    next.close();
  } finally {
    await rm(root, { recursive: true });
  }
});
