import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ok } from "../../base/mod.ts";
import type { JobTrigger } from "../../protocol/jobs/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import { createSql } from "../storage/ledger/sqlite.ts";
import { createJobCommands } from "./commands.ts";
import { createEventCommands } from "./events.ts";
import {
  jobEventPolicyPort,
  jobMachinePort,
  jobTargetsPort,
  jobZonePort,
} from "./ports.ts";
import { approveJob, insertJob, loadJob, replaceJobRun } from "./store.ts";
import { jobsTestSteps, THIS_MACHINE } from "./test-steps.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
const PRJ_A = "prj_01hzzzzzzzzzzzzzzzzzzzzzza";
const PRJ_B = "prj_01hzzzzzzzzzzzzzzzzzzzzzzb";
const OTHER_APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzq";
const PRIVATE_APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzp";
const DRIVEN = "ses_01hzzzzzzzzzzzzzzzzzzzzzzd";
const machine = { actor: "machine" } as never;

// event를 때로 가진 job은 사람이 승인하고 켜져 있을 때만 돈다. 같은 job이 겹치거나 너무 가깝게 도는 것(event 폭풍)을 막고, 자기가 연 session의 event와
// 닿을 수 없는 workspace의 session event는 보지 않는다.
function setup() {
  const db = new DatabaseSync(":memory:");
  for (const step of jobsTestSteps) db.exec(step.sql);
  const sql = createSql(db, () => true);
  let now = Date.parse("2026-11-11T00:00:00.000Z");
  let seq = 0;
  const ports = new Map<unknown, unknown>([
    [jobZonePort, { zone: () => "UTC" }],
    [jobMachinePort, { id: () => ok(THIS_MACHINE) }],
    [
      jobEventPolicyPort,
      {
        resolveSource: () => ok({ app: APP, slug: "masup" }),
        declares: (_app: string, event: string) => event === "usage.limit",
        // job의 workspace(project A)는 A와 home에는 닿고 B에는 닿지 못한다.
        // 앱 PRIVATE_APP workspace에는 어느 workspace의 job도 닿지 못한다.
        reaches: (_from: unknown, to: { id: string } | null) =>
          to === null || (to.id !== PRJ_B && to.id !== PRIVATE_APP),
        // 사람이 연 것이 아닌 session(팀의 자식, run·workflow step이 연 것).
        drivenSession: (session: string) => session === DRIVEN,
      },
    ],
    [
      jobTargetsPort,
      {
        creatorOf: () => ({ agent: "lophn_home", workspace: null }),
        resolveApp: (ref: string) => ok(ref === "other" ? OTHER_APP : APP),
      },
    ],
  ]);
  const tx = {
    sql,
    now: () => new Date(now).toISOString(),
    newId: (prefix: string) =>
      `${prefix}_01hzzzzzzzzzzzzzzzzzzzz${String(seq++).padStart(3, "0")}`,
    port: (key: unknown) => ports.get(key) ?? { push: () => {} },
  } as unknown as Tx;
  const events = createEventCommands();
  const trigger = (
    source: string,
    app: string | null,
    event: string,
  ): JobTrigger => ({
    source,
    app: app as never,
    event,
    min_interval: "5m",
    pass_event: false,
  });
  const job = (
    id: string,
    t: JobTrigger,
    options: { approved?: boolean; enabled?: boolean } = {},
  ) => {
    insertJob(sql, {
      id,
      title: id,
      creator: {
        agent: "lophn_home",
        workspace: { kind: "project", id: PRJ_A },
      },
      every: null,
      at: null,
      trigger: t,
      action: {
        kind: "agent_run",
        agent: "lophn_home",
        agent_workspace: null,
        prompt: "wrap up",
      },
      missed_policy: "run",
      enabled: options.enabled ?? true,
      machine: THIS_MACHINE,
      created_at: "2026-11-10T00:00:00.000Z",
    });
    if (options.approved !== false) {
      approveJob(sql, id, {
        approved_at: "2026-11-10T00:00:00.000Z",
        next_due_at: null,
      });
    }
  };
  const fire = (input: {
    publisher: string;
    event: string;
    session?: { id: string; workspace: { kind: "project"; id: string } | null };
    chain?: string[];
  }) => {
    const done = events.fire.handle(
      tx,
      machine,
      {
        publisher: input.publisher,
        event: input.event,
        payload: { percent: 91 },
        chain: (input.chain ?? []) as never,
        session: (input.session ?? null) as never,
      },
      {} as never,
    );
    assert.ok(done.ok, done.ok ? "" : JSON.stringify(done.error));
    return done.value;
  };
  const runs = (id: string) =>
    sql
      .all("SELECT id, state, event FROM job_runs WHERE job = ? ORDER BY id", [
        id,
      ])
      .map((row) => ({ ...row }));
  return { db, sql, tx, job, fire, runs, advance: (ms: number) => (now += ms) };
}

test("승인 전이거나 꺼진 event job은 event가 와도 돌지 않고, 켜진 승인한 job은 event를 data로 달고 한 번 돈다", () => {
  const { db, sql, job, fire, runs } = setup();
  try {
    job(
      "job_01hzzzzzzzzzzzzzzzzzzzzzza",
      {
        source: "masup",
        app: APP,
        event: "usage.limit",
        min_interval: "5m",
        pass_event: false,
      },
      { approved: false },
    );
    job(
      "job_01hzzzzzzzzzzzzzzzzzzzzzzb",
      {
        source: "masup",
        app: APP,
        event: "usage.limit",
        min_interval: "5m",
        pass_event: false,
      },
      { enabled: false },
    );
    assert.deepStrictEqual(fire({ publisher: APP, event: "usage.limit" }), {
      fired: 0,
      skipped: 0,
    });
    assert.equal(
      runs("job_01hzzzzzzzzzzzzzzzzzzzzzza").length +
        runs("job_01hzzzzzzzzzzzzzzzzzzzzzzb").length,
      0,
    );

    job("job_01hzzzzzzzzzzzzzzzzzzzzzzc", {
      source: "masup",
      app: APP,
      event: "usage.limit",
      min_interval: "5m",
      pass_event: false,
    });
    assert.deepStrictEqual(fire({ publisher: APP, event: "usage.limit" }), {
      fired: 1,
      skipped: 0,
    });
    const made = runs("job_01hzzzzzzzzzzzzzzzzzzzzzzc");
    assert.equal(made.length, 1);
    assert.equal(made[0]!.state, "queued");
    assert.deepStrictEqual(JSON.parse(String(made[0]!.event)), {
      source: "masup",
      event: "usage.limit",
      payload: { percent: 91 },
    });
    // 다른 event나 다른 앱의 같은 이름 event는 이 job의 것이 아니다.
    assert.deepStrictEqual(fire({ publisher: APP, event: "other" }), {
      fired: 0,
      skipped: 0,
    });
    assert.deepStrictEqual(
      fire({
        publisher: "app_01hzzzzzzzzzzzzzzzzzzzzzzb",
        event: "usage.limit",
      }),
      { fired: 0, skipped: 0 },
    );
    assert.equal(
      loadJob(sql, "job_01hzzzzzzzzzzzzzzzzzzzzzzc", THIS_MACHINE).ok,
      true,
    );
  } finally {
    db.close();
  }
});

test("앞 차례가 도는 중이면 busy, 끝났어도 최소 간격 안이면 too_soon으로 건너뛰고 세며, 간격이 지나면 다시 돈다", () => {
  const { db, sql, job, fire, runs, advance } = setup();
  try {
    job("job_01hzzzzzzzzzzzzzzzzzzzzzzc", {
      source: "masup",
      app: APP,
      event: "usage.limit",
      min_interval: "5m",
      pass_event: false,
    });
    assert.deepStrictEqual(fire({ publisher: APP, event: "usage.limit" }), {
      fired: 1,
      skipped: 0,
    });
    advance(1000);
    assert.deepStrictEqual(fire({ publisher: APP, event: "usage.limit" }), {
      fired: 0,
      skipped: 1,
    });
    let loaded = loadJob(sql, "job_01hzzzzzzzzzzzzzzzzzzzzzzc", THIS_MACHINE);
    assert.ok(loaded.ok && loaded.value !== null);
    assert.equal(loaded.value.last_skip_reason, "busy");

    // 끝나도 5분 안이면 너무 가깝다.
    replaceJobRun(
      sql,
      runs("job_01hzzzzzzzzzzzzzzzzzzzzzzc")[0]!.id as string,
      {
        state: "done",
        ended_at: "2026-11-11T00:00:02.000Z",
      },
    );
    advance(60_000);
    assert.deepStrictEqual(fire({ publisher: APP, event: "usage.limit" }), {
      fired: 0,
      skipped: 1,
    });
    loaded = loadJob(sql, "job_01hzzzzzzzzzzzzzzzzzzzzzzc", THIS_MACHINE);
    assert.ok(loaded.ok && loaded.value !== null);
    assert.deepStrictEqual(
      [
        loaded.value.fired_count,
        loaded.value.skipped_count,
        loaded.value.last_skip_reason,
      ],
      [1, 2, "too_soon"],
    );
    assert.equal(runs("job_01hzzzzzzzzzzzzzzzzzzzzzzc").length, 1);

    advance(5 * 60_000);
    assert.deepStrictEqual(fire({ publisher: APP, event: "usage.limit" }), {
      fired: 1,
      skipped: 0,
    });
    assert.equal(runs("job_01hzzzzzzzzzzzzzzzzzzzzzzc").length, 2);
  } finally {
    db.close();
  }
});

test("lophn의 session event는 사람이 연 session만 job을 깨운다: 어느 job의 run이 연 session, 팀·run·step으로 열린 session, 닿을 수 없는 workspace의 session은 열지도 건너뛰지도 않는다", () => {
  const { db, sql, job, fire, runs, advance } = setup();
  try {
    const idle = {
      source: "lophn",
      app: null,
      event: "session.idle",
      min_interval: "5m",
      pass_event: false,
    };
    job("job_01hzzzzzzzzzzzzzzzzzzzzzzd", idle);
    job("job_01hzzzzzzzzzzzzzzzzzzzzzze", idle);
    const person = {
      id: "ses_01hzzzzzzzzzzzzzzzzzzzzzzo",
      workspace: { kind: "project" as const, id: PRJ_A },
    };
    // 사람이 연 session의 event는 두 job을 연다.
    assert.deepStrictEqual(
      fire({ publisher: "lophn", event: "session.idle", session: person }),
      { fired: 2, skipped: 0 },
    );
    // 한 job의 run이 연 session(started 때 적힌다)의 event는 그 job도 다른 job도 깨우지 않는다.
    const first = runs("job_01hzzzzzzzzzzzzzzzzzzzzzzd")[0]!.id as string;
    replaceJobRun(sql, first, {
      state: "done",
      session: "ses_01hzzzzzzzzzzzzzzzzzzzzzzm",
      ended_at: "2026-11-11T00:00:05.000Z",
    });
    for (const job of [
      "job_01hzzzzzzzzzzzzzzzzzzzzzzd",
      "job_01hzzzzzzzzzzzzzzzzzzzzzze",
    ]) {
      const open = runs(job)[0]!.id as string;
      replaceJobRun(sql, open, {
        state: "done",
        ended_at: "2026-11-11T00:00:06.000Z",
      });
    }
    advance(10 * 60_000);
    const none = { fired: 0, skipped: 0 };
    const ofSession = (id: string, workspace = person.workspace) => ({
      id,
      workspace,
    });
    assert.deepStrictEqual(
      fire({
        publisher: "lophn",
        event: "session.idle",
        session: ofSession("ses_01hzzzzzzzzzzzzzzzzzzzzzzm"),
      }),
      none,
    );
    // 팀·run·workflow step으로 열린 session이다.
    assert.deepStrictEqual(
      fire({
        publisher: "lophn",
        event: "session.idle",
        session: ofSession(DRIVEN),
      }),
      none,
    );
    // job의 workspace가 닿을 수 없는 workspace의 session이다.
    assert.deepStrictEqual(
      fire({
        publisher: "lophn",
        event: "session.idle",
        session: ofSession("ses_01hzzzzzzzzzzzzzzzzzzzzzzf", {
          kind: "project",
          id: PRJ_B,
        }),
      }),
      none,
    );
    // 터미널 탭이나 앱 화면이 연 session처럼 사람이 연 session은 다시 연다.
    assert.deepStrictEqual(
      fire({ publisher: "lophn", event: "session.idle", session: person }),
      { fired: 2, skipped: 0 },
    );
    const loaded = loadJob(sql, "job_01hzzzzzzzzzzzzzzzzzzzzzzd", THIS_MACHINE);
    assert.ok(
      loaded.ok && loaded.value !== null && loaded.value.skipped_count === 0,
    );
  } finally {
    db.close();
  }
});

test("앱 event는 job의 workspace가 그 앱 workspace에 닿을 때만 job을 깨우고, 같은 앱의 tool을 부르는 job은 만들 수 없다", () => {
  const { db, tx, job, fire, runs } = setup();
  try {
    job("job_01hzzzzzzzzzzzzzzzzzzzzzzp", {
      source: "hidden",
      app: PRIVATE_APP,
      event: "usage.limit",
      min_interval: "5m",
      pass_event: false,
    });
    // private 앱 workspace의 event는 다른 workspace의 job을 깨우지 않는다(건너뛰지도 세지도 않는다).
    assert.deepStrictEqual(
      fire({ publisher: PRIVATE_APP, event: "usage.limit" }),
      {
        fired: 0,
        skipped: 0,
      },
    );
    assert.equal(runs("job_01hzzzzzzzzzzzzzzzzzzzzzzp").length, 0);

    // 등록할 때도 같은 규칙이다. 같은 앱의 tool을 부르는 job은 사슬에 그 앱이 늘 있어 영영 돌지 않아 만들지 못한다.
    const commands = createJobCommands();
    const agent = { actor: "agent:ses_01hzzzzzzzzzzzzzzzzzzzzzza" } as never;
    const code = (r: { ok: boolean; error?: { code: string } }) =>
      r.ok ? "ok" : r.error!.code;
    const make = (action: unknown) =>
      commands.create.handle(
        tx,
        agent,
        {
          title: "t",
          trigger: { source: "masup", event: "usage.limit" },
          action,
        } as never,
        {} as never,
      );
    // resolveApp(masup 이름)은 APP이고 trigger의 source도 APP이라 같은 앱이다.
    assert.equal(
      code(make({ kind: "tool_run", app: "masup", tool: "x" })),
      "invalid_input",
    );
  } finally {
    db.close();
  }
});

test("event 때는 앱이 그 release에서 선언한 event나 lophn의 session event만 받고, 한 앱에만 가는 call.settled는 받지 못한다", () => {
  const { db, tx } = setup();
  try {
    const commands = createJobCommands();
    const agent = { actor: "agent:ses_01hzzzzzzzzzzzzzzzzzzzzzza" } as never;
    const code = (r: { ok: boolean; error?: { code: string } }) =>
      r.ok ? "ok" : r.error!.code;
    const toolRun = (trigger: { source: string; event: string }) =>
      commands.create.handle(
        tx,
        agent,
        {
          title: "t",
          trigger,
          action: { kind: "tool_run", app: "other", tool: "x" },
        },
        {} as never,
      );
    assert.equal(
      code(toolRun({ source: "masup", event: "usage.limit" })),
      "ok",
    );
    assert.equal(
      code(toolRun({ source: "masup", event: "not.declared" })),
      "invalid_input",
    );
    assert.equal(
      code(toolRun({ source: "lophn", event: "session.idle" })),
      "ok",
    );
    assert.equal(
      code(toolRun({ source: "lophn", event: "call.settled" })),
      "invalid_input",
    );
  } finally {
    db.close();
  }
});
