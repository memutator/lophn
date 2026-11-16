// contract: core는 일(enabled job·열린 job run·running run·running workflow instance)도 붙은 client도 없이
// 10분이 이어질 때만 스스로 끝난다.
// 회귀: 일이 있는데 끝나 job 차례가 사라지거나, 일이 없는데 끝나지 않아 core가 영원히 남는다.
// 지금 test로 못 잡는 이유: 이 판정은 새 규칙이고 clock·timer를 port로 받아 수동으로 돌릴 수 있다.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  err,
  type Logger,
  manualClock,
  ok,
  type Result,
} from "../../../base/mod.ts";
import { type Sql } from "../../../protocol/server/mod.ts";
import { jobsTestSteps } from "../../jobs/test-steps.ts";
import { hasActivity as hasJobsActivity } from "../../jobs/store.ts";
import { runsSchemaSteps } from "../../runs/schema.ts";
import { hasActivity as runsActivity } from "../../runs/store.ts";
import { createSql } from "../../storage/ledger/sqlite.ts";
import { workflowsSchemaSteps } from "../../workflows/schema.ts";
import { hasActivity as workflowsActivity } from "../../workflows/store.ts";
import { createIdleMonitor } from "./idle.ts";

const START = Date.parse("2026-01-01T00:00:00.000Z");
const IDLE_MS = 600_000;

const silent: Logger = {
  log: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  flush: () => Promise.resolve(),
};

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

type Timer = { run: () => void; ms: number };

// 수동 clock과 timer 하나. monitor는 한 번에 timer 하나만 건다.
function harness(busy: () => Promise<Result<boolean>>) {
  const clock = manualClock(START);
  const timers: Timer[] = [];
  const state = { clients: 0, arrivals: 0 };
  let shutdowns = 0;
  const monitor = createIdleMonitor({
    clock,
    timers: {
      set(run, ms) {
        const timer = { run, ms };
        timers.push(timer);
        return timer;
      },
      clear(handle) {
        const index = timers.indexOf(handle as Timer);
        if (index >= 0) timers.splice(index, 1);
      },
    },
    activity: {
      busy,
      clients: () => state.clients,
      arrivals: () => state.arrivals,
    },
    shutdown: () => {
      shutdowns += 1;
    },
    logger: silent,
  });
  // 걸린 timer 하나를 그 시각에 울린다. 확인이 끝나기를 기다리지 않는다.
  const fire = () => {
    const timer = timers.shift();
    assert.ok(timer, "a timer is armed");
    clock.advance(timer.ms);
    timer.run();
  };
  // 목표 시각까지 걸린 timer를 차례로 울리고 확인을 끝낸다.
  const advance = async (ms: number) => {
    const until = clock.nowMs() + ms;
    for (;;) {
      const next = timers[0];
      if (next === undefined || clock.nowMs() + next.ms > until) break;
      fire();
      await flush();
    }
    clock.set(until);
  };
  return {
    state,
    count: () => shutdowns,
    fire,
    flush,
    advance,
    start: () => monitor.start(),
    stop: () => monitor.stop(),
  };
}

const rows: { name: string; run: () => Promise<void> }[] = [
  {
    name: "일도 client도 없이 10분이 지나면 끝난다",
    async run() {
      const h = harness(() => Promise.resolve(ok(false)));
      h.start();
      // 첫 유휴 관측 전에는 10분을 세지 않는다.
      await h.advance(IDLE_MS);
      assert.equal(h.count(), 0);
      await h.advance(60_000);
      assert.equal(h.count(), 1);
    },
  },
  {
    name: "마지막 client가 끝난 때부터 10분을 센다",
    async run() {
      const h = harness(() => Promise.resolve(ok(false)));
      h.state.clients = 1;
      h.start();
      await h.advance(120_000);
      assert.equal(h.count(), 0);
      h.state.clients = 0;
      await h.advance(IDLE_MS);
      assert.equal(h.count(), 0);
      await h.advance(60_000);
      assert.equal(h.count(), 1);
    },
  },
  {
    name: "마감 직전에 온 일은 종료를 미룬다",
    async run() {
      let busy = false;
      const h = harness(() => Promise.resolve(ok(busy)));
      h.start();
      await h.advance(IDLE_MS);
      busy = true;
      await h.advance(60_000);
      assert.equal(h.count(), 0);
      busy = false;
      // busy를 본 때부터 10분이 아직 지나지 않았다.
      await h.advance(IDLE_MS);
      assert.equal(h.count(), 0);
      await h.advance(60_000);
      assert.equal(h.count(), 1);
    },
  },
  {
    name: "일 읽기가 실패하면 유휴로 보지 않는다",
    async run() {
      let failing = true;
      const h = harness(() =>
        Promise.resolve(
          failing
            ? err({ code: "unavailable", message: "reader busy" })
            : ok(false),
        ),
      );
      h.start();
      await h.advance(900_000);
      assert.equal(h.count(), 0);
      failing = false;
      await h.advance(IDLE_MS);
      assert.equal(h.count(), 0);
      await h.advance(60_000);
      assert.equal(h.count(), 1);
    },
  },
  {
    name: "읽는 동안 들어온 새 request는 지난 결과로 끝내지 않는다",
    async run() {
      let pending = true;
      let release: (() => void) | undefined;
      const h = harness(() =>
        pending
          ? new Promise<Result<boolean>>((resolve) => {
              release = () => {
                pending = false;
                resolve(ok(false));
              };
            })
          : Promise.resolve(ok(false)),
      );
      h.start();
      h.fire();
      h.state.arrivals += 1;
      release!();
      await h.flush();
      assert.equal(h.count(), 0);
      // 새 유휴는 그 다음 확인부터 센다.
      await h.advance(IDLE_MS + 60_000);
      assert.equal(h.count(), 1);
    },
  },
  {
    name: "종료가 시작된 뒤에는 끝내지 않는다",
    async run() {
      const h = harness(() => Promise.resolve(ok(false)));
      h.start();
      h.stop();
      await h.advance(IDLE_MS * 2);
      assert.equal(h.count(), 0);
    },
  },
];

test("일이나 client가 없이 10분이 이어질 때만 core가 스스로 끝난다", async (t) => {
  for (const row of rows) await t.test(row.name, row.run);
});

// activity read가 첫 page나 project 하나만 보면 돌던 run·instance를 끊는다. 표를 직접 만든 SQLite로 본다.
const MACHINE = "mch_01hzzzzzzzzzzzzzzzzzzzzzza";
const jobsActivity = (sql: Sql) => hasJobsActivity(sql, MACHINE);

test("idle activity read는 다른 project의 running instance와 꺼진 job 뒤 열린 run을 본다", () => {
  const db = new DatabaseSync(":memory:");
  const activity = (read: (sql: Sql) => Result<boolean>) => {
    const found = read(sql);
    assert.equal(found.ok, true);
    return found.ok ? found.value : false;
  };
  let sql: Sql;
  try {
    for (const step of [
      ...jobsTestSteps,
      ...runsSchemaSteps,
      ...workflowsSchemaSteps,
    ]) {
      db.exec(step.sql);
    }
    const ledger = createSql(db, () => true) as Sql;
    sql = ledger;

    assert.deepEqual(
      [
        activity(jobsActivity),
        activity(runsActivity),
        activity(workflowsActivity),
      ],
      [false, false, false],
    );

    // 부르는 쪽이 이름을 주지 않는 다른 project의 instance도 일이다.
    db.exec(`
      INSERT INTO workflow_instances
        (id, project, workflow, input, state, participants, steps, human_turn,
         started_by, created_at, state_seq)
      VALUES ('wfi_01hzzzzzzzzzzzzzzzzzzzzzza', 'prj_01hzzzzzzzzzzzzzzzzzzzzzza',
        'review', 'x', 'running', '{}', '[]', 0, '{"kind":"user"}',
        '2026-01-01T00:00:00.000Z', 1);
    `);
    assert.equal(activity(workflowsActivity), true);
    assert.equal(activity(jobsActivity), false);

    // 꺼진 job만으로는 일이 아니다. 그 job의 차례가 열려 있으면(queued) 일이다.
    db.exec(`
      INSERT INTO jobs
        (id, title, creator_agent, creator_workspace, every, at, action,
         missed_policy, enabled, next_due_at, created_at, updated_at, approved_at, machine)
      VALUES ('job_01hzzzzzzzzzzzzzzzzzzzzzza', 'off', 'lophn', NULL, '10m', NULL,
        '{"kind":"agent_run"}', 'run', 0, NULL,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, '${MACHINE}');
    `);
    assert.equal(activity(jobsActivity), false);
    db.exec(`
      INSERT INTO job_runs (id, job, due_at, missed_count, state, created_at)
      VALUES ('jbr_01hzzzzzzzzzzzzzzzzzzzzzza', 'job_01hzzzzzzzzzzzzzzzzzzzzzza',
        '2026-01-01T00:00:00.000Z', 0, 'queued', '2026-01-01T00:00:00.000Z');
    `);
    assert.equal(activity(jobsActivity), true);

    // 승인을 기다리는 enabled job도 일이다.
    db.exec(`
      UPDATE job_runs SET state = 'done', ended_at = '2026-01-01T00:00:00.000Z'
      WHERE id = 'jbr_01hzzzzzzzzzzzzzzzzzzzzzza';
      INSERT INTO jobs
        (id, title, creator_agent, creator_workspace, every, at, action,
         missed_policy, enabled, next_due_at, created_at, updated_at, approved_at, machine)
      VALUES ('job_01hzzzzzzzzzzzzzzzzzzzzzzb', 'on', 'lophn', NULL, '10m', NULL,
        '{"kind":"agent_run"}', 'run', 1, NULL,
        '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, '${MACHINE}');
    `);
    assert.equal(activity(jobsActivity), true);

    // running인 run도 일이다.
    db.exec(`
      INSERT INTO runs (id, kind, target, session_opened, state, created_at, state_seq)
      VALUES ('run_01hzzzzzzzzzzzzzzzzzzzzzza', 'agent',
        '{"agent":{"agent":"lophn_home","workspace":null}}', 0, 'running',
        '2026-01-01T00:00:00.000Z', 1);
    `);
    assert.equal(activity(runsActivity), true);
  } finally {
    db.close();
  }
});
