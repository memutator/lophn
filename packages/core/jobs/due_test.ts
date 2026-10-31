import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import type { JobAction, MissedPolicy } from "../../protocol/jobs/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import { createSql } from "../storage/ledger/sqlite.ts";
import { createDueCommands } from "./due.ts";
import { jobZonePort } from "./ports.ts";
import { jobsSchemaSteps } from "./schema.ts";
import { approveJob, insertJob, insertJobRun, loadJobRuns } from "./store.ts";

const T = (hour: number, minute = 0) =>
  `2026-10-22T${String(hour).padStart(2, "0")}:${String(minute).padStart(
    2,
    "0",
  )}:00.000Z`;
const MACHINE = { actor: "machine" } as never;
const USER = { actor: "user" } as never;
const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const PRJ = "prj_01hzzzzzzzzzzzzzzzzzzzzzza";
const TOOL: JobAction = { kind: "tool_run", app: APP as never, tool: "sweep" };
const WORKFLOW: JobAction = {
  kind: "workflow_start",
  project: PRJ as never,
  workflow: "flow",
  text: "go",
};

// 시각은 변수 하나다. 실제로 기다리지 않는다.
function setup() {
  const db = new DatabaseSync(":memory:");
  for (const step of jobsSchemaSteps) db.exec(step.sql);
  const sql = createSql(db, () => true);
  let now = T(0);
  let seq = 0;
  const ports = new Map<unknown, unknown>([
    [jobZonePort, { zone: () => "UTC" }],
  ]);
  const tx = {
    sql,
    now: () => now,
    newId: (prefix: string) =>
      `${prefix}_01h${"z".repeat(21)}${String(seq++).padStart(2, "0")}`,
    port: (key: unknown) => ports.get(key) ?? { push: () => {} },
  } as unknown as Tx;
  const commands = createDueCommands();
  // approved가 false면 사람의 승인을 기다리는 job이다.
  const job = (
    action: JobAction,
    policy: MissedPolicy,
    next: string,
    approved = true,
  ) => {
    const id = tx.newId("job");
    insertJob(sql, {
      id,
      title: "t",
      creator: { agent: "lophn", place: null },
      every: "1h",
      at: null,
      action,
      missed_policy: policy,
      enabled: true,
      created_at: T(0),
    });
    if (approved) approveJob(sql, id, { approved_at: T(0), next_due_at: next });
    return id;
  };
  const runRow = (jobId: string, state: "running" | "held", dueAt: string) => {
    const id = tx.newId("jbr");
    insertJobRun(sql, {
      id,
      job: jobId,
      due_at: dueAt,
      missed_count: 0,
      state,
      reason: null,
      created_at: dueAt,
    });
    return id;
  };
  const claim = (startup: boolean) => {
    const result = commands.claimDue.handle(
      tx,
      MACHINE,
      { startup },
      {} as never,
    );
    assert.ok(result.ok);
    return result.value;
  };
  const runs = (jobId: string) => {
    const loaded = loadJobRuns(sql, jobId, { limit: 20 });
    assert.ok(loaded.ok);
    return loaded.value.reverse();
  };
  return {
    db,
    commands,
    tx,
    job,
    runRow,
    claim,
    runs,
    setNow: (at: string) => (now = at),
  };
}

// 사람이 승인하지 않은 job이 돌면 agent가 혼자 정한 일이 사람 없이 바깥 효과를 낸다.
test("a job waiting for approval never runs: no turn on claim, and its held run cannot start", () => {
  const t = setup();
  try {
    const pending = t.job(TOOL, "hold", T(1), false);
    // next_due_at이 남아 있어도(옛 data) 승인 전이면 돌지 않는다.
    t.db
      .prepare("UPDATE jobs SET next_due_at = ? WHERE id = ?")
      .run(T(1), pending);
    const held = t.runRow(pending, "held", T(1));
    t.setNow(T(5));
    for (const startup of [true, false]) {
      assert.deepStrictEqual(t.claim(startup).start, []);
    }
    assert.deepStrictEqual(
      t.runs(pending).map((run) => run.state),
      ["held"],
    );
    const decided = t.commands.decideHold.handle(
      t.tx,
      USER,
      { job_run: held as never, choice: "run_now" },
      {} as never,
    );
    assert.deepStrictEqual(decided.ok ? "ok" : decided.error.code, "conflict");
    assert.deepStrictEqual(t.claim(false).start, []);
  } finally {
    t.db.close();
  }
});

// 놓친 차례를 줄마다 돌리면 lophn을 켤 때마다 job이 여러 번 돈다.
test("missed turns fold into one job run and the job runs once", () => {
  const t = setup();
  try {
    t.setNow(T(5, 30));
    const run = t.job(TOOL, "run", T(1));
    const first = t.claim(true);
    assert.deepStrictEqual(
      first.start.map((turn) => turn.job.id),
      [run],
    );
    assert.deepStrictEqual(first.start[0]!.job_run.state, "queued");
    assert.deepStrictEqual(first.start[0]!.job_run.missed_count, 5);
    assert.deepStrictEqual(first.next_due_at, T(6));
    const again = t.claim(false);
    assert.deepStrictEqual(again.start, []);
    assert.deepStrictEqual(t.runs(run).length, 1);
  } finally {
    t.db.close();
  }

  const h = setup();
  try {
    h.setNow(T(5, 30));
    const hold = h.job(TOOL, "hold", T(1));
    assert.deepStrictEqual(h.claim(true).start, []);
    assert.deepStrictEqual(
      h.runs(hold).map((r) => r.state),
      ["held"],
    );
    h.setNow(T(8, 30));
    h.claim(true);
    const rows = h.runs(hold);
    assert.deepStrictEqual(
      rows.map((r) => r.state),
      ["held"],
    );
    assert.deepStrictEqual(rows[0]!.missed_count, 8);
  } finally {
    h.db.close();
  }

  const c = setup();
  try {
    c.setNow(T(5, 30));
    const cut = c.job(TOOL, "run", T(6));
    c.runRow(cut, "running", T(5));
    const claimed = c.claim(true);
    assert.deepStrictEqual(claimed.start.length, 1);
    assert.deepStrictEqual(claimed.start[0]!.job_run.missed_count, 1);
    assert.deepStrictEqual(
      c.runs(cut).map((r) => r.state),
      ["interrupted", "queued"],
    );
  } finally {
    c.db.close();
  }
});

// 앞 차례가 도는데 또 돌면 한 job이 겹쳐 돈다.
test("a job does not run again while its previous turn is running", () => {
  for (const action of [TOOL, WORKFLOW]) {
    const t = setup();
    try {
      t.setNow(T(1, 30));
      const job = t.job(action, "run", T(1));
      t.runRow(job, "running", T(0));
      const live = t.claim(false);
      assert.deepStrictEqual(live.start, []);
      assert.deepStrictEqual(
        t.runs(job).map((r) => [r.state, r.reason]),
        [
          ["running", null],
          ["skipped", "overlap"],
        ],
      );

      // 켤 때: agent_run·tool_run의 줄만 닫힌다. workflow_start는 instance가 계속 돈다.
      t.setNow(T(3, 30));
      const boot = t.claim(true);
      const states = t.runs(job).map((r) => r.state);
      if (action.kind === "workflow_start") {
        assert.deepStrictEqual(boot.start, []);
        assert.deepStrictEqual(states, ["running", "skipped", "skipped"]);
        assert.deepStrictEqual(t.runs(job)[2]!.missed_count, 2);
      } else {
        assert.deepStrictEqual(boot.start.length, 1);
        assert.deepStrictEqual(states, ["interrupted", "skipped", "queued"]);
      }
    } finally {
      t.db.close();
    }
  }

  const t = setup();
  try {
    const job = t.job(TOOL, "hold", T(9));
    const held = t.runRow(job, "held", T(1));
    t.runRow(job, "running", T(2));
    const result = t.commands.decideHold.handle(
      t.tx,
      USER,
      { job_run: held as never, choice: "run_now" },
      {} as never,
    );
    assert.ok(!result.ok && result.error.code === "conflict");
    assert.ok(t.runs(job).some((r) => r.id === held && r.state === "held"));
  } finally {
    t.db.close();
  }
});

// 컴퓨터가 잠든 사이 timer가 늦으면 hold job이 묻지 않고 돌아 버린다.
test("a turn handled over 10 minutes late counts as missed and hold asks", () => {
  const t = setup();
  try {
    const hold = t.job(TOOL, "hold", T(9));
    t.setNow(T(9, 10));
    assert.deepStrictEqual(t.claim(false).start.length, 1);
    assert.deepStrictEqual(
      t.runs(hold).map((r) => r.state),
      ["queued"],
    );
  } finally {
    t.db.close();
  }

  const h = setup();
  try {
    const hold = h.job(TOOL, "hold", T(9));
    h.setNow(T(13, 5));
    assert.deepStrictEqual(h.claim(false).start, []);
    const rows = h.runs(hold);
    assert.deepStrictEqual(
      rows.map((r) => r.state),
      ["held"],
    );
    assert.deepStrictEqual(rows[0]!.missed_count, 5);
  } finally {
    h.db.close();
  }

  const r = setup();
  try {
    const run = r.job(TOOL, "run", T(9));
    r.setNow(T(13, 5));
    const claimed = r.claim(false);
    assert.deepStrictEqual(claimed.start.length, 1);
    assert.deepStrictEqual(claimed.start[0]!.job_run.missed_count, 5);
    assert.deepStrictEqual(
      r.runs(run).map((x) => x.state),
      ["queued"],
    );
  } finally {
    r.db.close();
  }
});
