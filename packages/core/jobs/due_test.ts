import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import type { JobAction, MissedPolicy } from "../../protocol/jobs/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import { createSql } from "../storage/ledger/sqlite.ts";
import { createDueCommands } from "./due.ts";
import { jobZonePort } from "./ports.ts";
import { jobsSchemaSteps } from "./schema.ts";
import { insertJob, insertJobRun, loadJobRuns } from "./store.ts";

const T = (hour: number, minute = 0) =>
  `2026-10-22T${String(hour).padStart(2, "0")}:${
    String(minute).padStart(2, "0")
  }:00.000Z`;
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
  db.exec(jobsSchemaSteps[0]!.sql);
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
  const job = (action: JobAction, policy: MissedPolicy, next: string) => {
    const id = tx.newId("job");
    insertJob(sql, {
      id,
      title: "t",
      creator: { role: "lophn" },
      every: "1h",
      at: null,
      action,
      missed_policy: policy,
      enabled: true,
      next_due_at: next,
      created_at: T(0),
    });
    return id;
  };
  const runRow = (
    jobId: string,
    state: "running" | "held",
    dueAt: string,
  ) => {
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
    assert(result.ok);
    return result.value;
  };
  const runs = (jobId: string) => {
    const loaded = loadJobRuns(sql, jobId, { limit: 20 });
    assert(loaded.ok);
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
    setNow: (at: string) => now = at,
  };
}

// 놓친 차례를 줄마다 돌리면 lophn을 켤 때마다 job이 여러 번 돈다.
Deno.test("missed turns fold into one job run and the job runs once", () => {
  const t = setup();
  try {
    t.setNow(T(5, 30));
    const run = t.job(TOOL, "run", T(1));
    const first = t.claim(true);
    assertEquals(first.start.map((turn) => turn.job.id), [run]);
    assertEquals(first.start[0]!.job_run.state, "queued");
    assertEquals(first.start[0]!.job_run.missed_count, 5);
    assertEquals(first.next_due_at, T(6));
    const again = t.claim(false);
    assertEquals(again.start, []);
    assertEquals(t.runs(run).length, 1);
  } finally {
    t.db.close();
  }

  const h = setup();
  try {
    h.setNow(T(5, 30));
    const hold = h.job(TOOL, "hold", T(1));
    assertEquals(h.claim(true).start, []);
    assertEquals(h.runs(hold).map((r) => r.state), ["held"]);
    h.setNow(T(8, 30));
    h.claim(true);
    const rows = h.runs(hold);
    assertEquals(rows.map((r) => r.state), ["held"]);
    assertEquals(rows[0]!.missed_count, 8);
  } finally {
    h.db.close();
  }

  const c = setup();
  try {
    c.setNow(T(5, 30));
    const cut = c.job(TOOL, "run", T(6));
    c.runRow(cut, "running", T(5));
    const claimed = c.claim(true);
    assertEquals(claimed.start.length, 1);
    assertEquals(claimed.start[0]!.job_run.missed_count, 1);
    assertEquals(c.runs(cut).map((r) => r.state), ["interrupted", "queued"]);
  } finally {
    c.db.close();
  }
});

// 앞 차례가 도는데 또 돌면 한 job이 겹쳐 돈다.
Deno.test("a job does not run again while its previous turn is running", () => {
  for (const action of [TOOL, WORKFLOW]) {
    const t = setup();
    try {
      t.setNow(T(1, 30));
      const job = t.job(action, "run", T(1));
      t.runRow(job, "running", T(0));
      const live = t.claim(false);
      assertEquals(live.start, []);
      assertEquals(t.runs(job).map((r) => [r.state, r.reason]), [
        ["running", null],
        ["skipped", "overlap"],
      ]);

      // 켤 때: agent_run·tool_run의 줄만 닫힌다. workflow_start는 instance가 계속 돈다.
      t.setNow(T(3, 30));
      const boot = t.claim(true);
      const states = t.runs(job).map((r) => r.state);
      if (action.kind === "workflow_start") {
        assertEquals(boot.start, []);
        assertEquals(states, ["running", "skipped", "skipped"]);
        assertEquals(t.runs(job)[2]!.missed_count, 2);
      } else {
        assertEquals(boot.start.length, 1);
        assertEquals(states, ["interrupted", "skipped", "queued"]);
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
    assert(!result.ok && result.error.code === "conflict");
    assert(t.runs(job).some((r) => r.id === held && r.state === "held"));
  } finally {
    t.db.close();
  }
});
