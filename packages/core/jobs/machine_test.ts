import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ok } from "../../base/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import { createSql } from "../storage/ledger/sqlite.ts";
import { createJobCommands } from "./commands.ts";
import { createDueCommands } from "./due.ts";
import { createEventCommands } from "./events.ts";
import { jobEventPolicyPort, jobMachinePort, jobZonePort } from "./ports.ts";
import { jobMachineSchemaSteps } from "./machine-schema.ts";
import { jobsSchemaSteps } from "./schema.ts";
import { hasActivity, loadHolds, loadJob, loadPendingJobs } from "./store.ts";
import { OTHER_MACHINE, THIS_MACHINE } from "./test-steps.ts";
import { jobTriggerSchemaSteps } from "./trigger-schema.ts";

const T = (hour: number, minute = 0) =>
  `2026-10-22T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`;
const MACHINE = { actor: "machine" } as never;
const USER = { actor: "user" } as never;
const AGENT = { actor: "agent:ses_01hzzzzzzzzzzzzzzzzzzzzzza" } as never;
const ACTION =
  '{"kind":"tool_run","app":"app_01hzzzzzzzzzzzzzzzzzzzzzza","tool":"t"}';
const TRIGGER =
  '{"source":"lophn","app":null,"event":"session.opened","min_interval":"5m","pass_event":false}';

function open(steps: readonly { sql: string }[]) {
  const db = new DatabaseSync(":memory:");
  for (const step of steps) db.exec(step.sql);
  return db;
}

function txOf(db: DatabaseSync, now: () => string): Tx {
  const sql = createSql(db, () => true);
  let seq = 0;
  const ports = new Map<unknown, unknown>([
    [jobZonePort, { zone: () => "UTC" }],
    [jobMachinePort, { id: () => ok(THIS_MACHINE) }],
    [
      jobEventPolicyPort,
      {
        reaches: () => true,
        drivenSession: () => false,
        declares: () => true,
      },
    ],
  ]);
  return {
    sql,
    now,
    newId: (prefix: string) =>
      `${prefix}_01hzzzzzzzzzzzzzzzzzzzz${String(seq++).padStart(3, "0")}`,
    port: (key: unknown) => ports.get(key) ?? { push: () => {} },
  } as unknown as Tx;
}

const JOB_COLUMNS =
  "(id, title, creator_agent, creator_workspace, every, at, trigger, action, missed_policy, enabled, next_due_at, created_at, updated_at, approved_at)";
function insertJobRow(
  db: DatabaseSync,
  job: {
    id: string;
    every?: string | null;
    trigger?: string | null;
    enabled?: 0 | 1;
    next?: string | null;
    approved?: string | null;
    policy?: "run" | "hold";
    machine?: string | null;
  },
) {
  db.prepare(
    `INSERT INTO jobs ${JOB_COLUMNS} VALUES (?, 't', 'lophn_home', NULL, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    job.id,
    job.trigger === undefined || job.trigger === null
      ? (job.every ?? "1h")
      : null,
    job.trigger ?? null,
    ACTION,
    job.policy ?? "run",
    job.enabled ?? 1,
    job.next ?? null,
    T(0),
    T(0),
    job.approved === undefined ? T(0) : job.approved,
  );
  // 옛 schema에는 이 칸이 없다.
  if (job.machine !== undefined) {
    db.prepare("UPDATE jobs SET machine = ? WHERE id = ?").run(
      job.machine,
      job.id,
    );
  }
}

const jobId = (n: number) => `job_01hzzzzzzzzzzzzzzzzzzzzzz${n}`;
const runId = (n: number) => `jbr_01hzzzzzzzzzzzzzzzzzzzzzz${n}`;
function insertRun(
  db: DatabaseSync,
  id: string,
  job: string,
  state: string,
  claimed: string | null = null,
) {
  db.prepare(
    `INSERT INTO job_runs (id, job, due_at, missed_count, state, claimed_at, created_at)
     VALUES (?, ?, ?, 0, ?, ?, ?)`,
  ).run(id, job, T(1), state, claimed, T(1));
}

const dump = (db: DatabaseSync, table: string) =>
  db
    .prepare(`SELECT * FROM ${table} ORDER BY id`)
    .all()
    .map((row) => {
      const { machine: _machine, ...rest } = row as Record<string, unknown>;
      return rest;
    });

// 이 판 이전의 사람 data(~/.lophn)가 새 step을 지나고 첫 기동을 해도 job과 job run이 하나도 빠지거나 바뀌지 않아야 한다.
test("jobs.machine keeps every job and job run as they were and the first startup claim stamps all jobs with this machine", () => {
  const db = open([...jobsSchemaSteps, ...jobTriggerSchemaSteps]);
  try {
    // 차례가 오지 않은 모양들이다(오는 차례와 도는 줄을 claim이 바꾸는 것은 due_test가 본다).
    insertJobRow(db, { id: jobId(1), next: T(9) });
    insertJobRow(db, { id: jobId(2), every: "1d", next: T(9), policy: "hold" });
    insertJobRow(db, { id: jobId(3), trigger: TRIGGER });
    insertJobRow(db, { id: jobId(4), enabled: 0 });
    insertJobRow(db, { id: jobId(5), approved: null });
    insertRun(db, runId(1), jobId(1), "done");
    insertRun(db, runId(2), jobId(2), "held");
    insertRun(db, runId(3), jobId(4), "skipped");
    const before = [dump(db, "jobs"), dump(db, "job_runs")];

    for (const step of jobMachineSchemaSteps) db.exec(step.sql);
    const tx = txOf(db, () => T(2));
    const claimed = createDueCommands().claimDue.handle(
      tx,
      MACHINE,
      { startup: true },
      {} as never,
    );
    assert.ok(claimed.ok);

    assert.deepStrictEqual([dump(db, "jobs"), dump(db, "job_runs")], before);
    const machines = db
      .prepare("SELECT DISTINCT machine FROM jobs")
      .all()
      .map((row) => row.machine);
    assert.deepStrictEqual(machines, [THIS_MACHINE]);
  } finally {
    db.close();
  }
});

// 복사된 data root의 job이 이 기계에서 돌면 두 기계가 같은 일을 한다(주인이 아닌 쪽은 보이기만 한다).
test("a job of another machine makes no turn, is not opened by events, cannot be started from a hold, is not activity, and runs here after take over", () => {
  const db = open([
    ...jobsSchemaSteps,
    ...jobTriggerSchemaSteps,
    ...jobMachineSchemaSteps,
  ]);
  try {
    let now = T(5);
    const tx = txOf(db, () => now);
    const due = createDueCommands();
    const jobs = createJobCommands();
    const events = createEventCommands();
    const claim = (startup: boolean) => {
      const done = due.claimDue.handle(tx, MACHINE, { startup }, {} as never);
      assert.ok(done.ok);
      return done.value;
    };
    const states = (job: string) =>
      db
        .prepare(
          "SELECT state, claimed_at FROM job_runs WHERE job = ? ORDER BY id",
        )
        .all(job)
        .map((row) => [row.state, row.claimed_at]);

    const other = { machine: OTHER_MACHINE };
    // 때가 온 주기 job(run·hold), 남은 queued 줄이 있는 job, 열려 있는 held 줄이 있는 job, event job.
    insertJobRow(db, { id: jobId(1), next: T(1), ...other });
    insertJobRow(db, { id: jobId(2), next: T(1), policy: "hold", ...other });
    insertJobRow(db, { id: jobId(3), next: T(9), ...other });
    insertRun(db, runId(1), jobId(3), "queued");
    insertJobRow(db, { id: jobId(4), every: "1d", next: T(9), ...other });
    insertRun(db, runId(2), jobId(4), "held");
    insertJobRow(db, { id: jobId(5), trigger: TRIGGER, ...other });
    insertJobRow(db, { id: jobId(6), approved: null, ...other });

    for (const startup of [true, false]) {
      assert.deepStrictEqual(claim(startup).start, []);
    }
    assert.deepStrictEqual(claim(false).next_due_at, null);
    for (const job of [1, 2]) assert.deepStrictEqual(states(jobId(job)), []);
    assert.deepStrictEqual(states(jobId(3)), [["queued", null]]);

    const fired = events.fire.handle(
      tx,
      MACHINE,
      {
        publisher: "lophn",
        event: "session.opened",
        payload: {},
        chain: [],
        session: { id: "ses_01hzzzzzzzzzzzzzzzzzzzzzza", workspace: null },
      },
      {} as never,
    );
    assert.deepStrictEqual(fired.ok && fired.value, { fired: 0, skipped: 0 });

    const sql = tx.sql;
    const decide = (choice: "run_now" | "skip", run: string) => {
      const done = due.decideHold.handle(
        tx,
        USER,
        { job_run: run as never, choice },
        {} as never,
      );
      return done.ok ? "ok" : done.error.code;
    };
    assert.deepStrictEqual(decide("run_now", runId(2)), "conflict");
    assert.deepStrictEqual(states(jobId(4)), [["held", null]]);

    // 주인이 다른 job만 있으면 idle-exit의 일이 아니고, 대기 목록에도 없다.
    const busy = hasActivity(sql, THIS_MACHINE);
    assert.ok(busy.ok && busy.value === false);
    const pending = loadPendingJobs(sql, THIS_MACHINE);
    assert.ok(pending.ok && pending.value.length === 0);
    const holds = loadHolds(sql, THIS_MACHINE);
    assert.ok(holds.ok && holds.value.length === 0);
    const seen = loadJob(sql, jobId(1), THIS_MACHINE);
    assert.ok(seen.ok && seen.value?.runs_here === false);

    // user만 가져오고, 이미 이 기계 것이면 conflict다.
    const take = (who: never, job: string) => {
      const done = jobs.takeOver.handle(
        tx,
        who,
        { job: job as never },
        {} as never,
      );
      return done.ok ? "ok" : done.error.code;
    };
    assert.deepStrictEqual(take(AGENT, jobId(1)), "forbidden");
    assert.deepStrictEqual(
      take(USER, "job_01hzzzzzzzzzzzzzzzzzzzzzzz"),
      "not_found",
    );
    assert.deepStrictEqual(take(USER, jobId(1)), "ok");
    assert.deepStrictEqual(take(USER, jobId(1)), "conflict");
    assert.deepStrictEqual(take(USER, jobId(4)), "ok");

    // 다른 기계에 있던 동안은 놓친 것으로 치지 않고 지금부터 센다. 그 뒤 차례가 돈다.
    const taken = loadJob(sql, jobId(1), THIS_MACHINE);
    assert.ok(taken.ok && taken.value?.runs_here === true);
    assert.deepStrictEqual(taken.ok && taken.value?.machine, THIS_MACHINE);
    assert.deepStrictEqual(taken.ok && taken.value?.next_due_at, T(6));
    assert.deepStrictEqual(claim(false).start, []);
    now = T(6);
    const started = claim(false);
    assert.deepStrictEqual(
      started.start.map((turn) => turn.job.id),
      [jobId(1)],
    );
    // 가져온 job의 열린 held 줄은 그대로고 이제 [Start now]가 된다.
    assert.deepStrictEqual(states(jobId(4)), [["held", null]]);
    assert.deepStrictEqual(decide("run_now", runId(2)), "ok");
    assert.deepStrictEqual(
      claim(false).start.map((turn) => turn.job.id),
      [jobId(4)],
    );
  } finally {
    db.close();
  }
});
