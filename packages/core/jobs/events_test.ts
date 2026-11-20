import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  createIdSource,
  manualClock,
  ok,
  seededRandom,
} from "../../base/mod.ts";
import type { JobTrigger } from "../../protocol/jobs/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import {
  createEventDelivery,
  receivedAppEvent,
} from "../apps/events/publish.ts";
import { createSql } from "../storage/ledger/sqlite.ts";
import { createJobCommands } from "./commands.ts";
import { createJobReads } from "./reads.ts";
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
const PRIVATE_PRJ = "prj_01hzzzzzzzzzzzzzzzzzzzzzzp";
const OTHER_APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzq";
const PRIVATE_APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzp";
const DRIVEN = "ses_01hzzzzzzzzzzzzzzzzzzzzzzd";
const PRIVATE_SESSION = "ses_01hzzzzzzzzzzzzzzzzzzzzzzp";
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
        isPrivate: (
          workspace: { kind: "project" | "app"; id: string } | null,
        ) =>
          workspace !== null &&
          (workspace.id === PRIVATE_PRJ || workspace.id === PRIVATE_APP),
        // 사람이 연 것이 아닌 session(팀의 자식, run·workflow step이 연 것).
        drivenSession: (session: string) => session === DRIVEN,
      },
    ],
    [
      jobTargetsPort,
      {
        creatorOf: (session: string) =>
          session === PRIVATE_SESSION
            ? {
                agent: "lophn_home",
                workspace: { kind: "project", id: PRIVATE_PRJ },
              }
            : { agent: "lophn_home", workspace: null },
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
    sourceMachine?: string,
  ): JobTrigger => ({
    source,
    app: app as never,
    event,
    min_interval: "5m",
    pass_event: false,
    ...(sourceMachine === undefined
      ? {}
      : { source_machine: sourceMachine as never }),
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
    machine?: string;
    remote?: true;
    skipWorkspaces?: string[];
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
        ...(input.machine === undefined
          ? {}
          : { machine: input.machine as never }),
        ...(input.remote === true ? { remote: true as const } : {}),
        ...(input.skipWorkspaces === undefined
          ? {}
          : { skip_workspaces: input.skipWorkspaces }),
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
  return {
    db,
    sql,
    tx,
    job,
    trigger,
    fire,
    runs,
    advance: (ms: number) => (now += ms),
  };
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
    // 다른 컴퓨터의 앱 event: 그 컴퓨터의 앱 id로 받고(slug는 그 컴퓨터에서만 풀린다) 이 기계의 선언은 보지 않으며, lophn event에는 쓰지 못한다.
    const remote = (trigger: object) => toolRun(trigger as never);
    const REMOTE_APP = "app_01hzzzzzzzzzzzzzzzzzzzzzzr";
    assert.equal(
      code(
        remote({
          source: REMOTE_APP,
          event: "whatever",
          machine: "mch_01hzzzzzzzzzzzzzzzzzzzzzzm",
        }),
      ),
      "ok",
    );
    assert.equal(
      code(
        remote({
          source: "masup",
          event: "usage.limit",
          machine: "mch_01hzzzzzzzzzzzzzzzzzzzzzzm",
        }),
      ),
      "invalid_input",
    );
    assert.equal(
      code(
        remote({
          source: "lophn",
          event: "session.idle",
          machine: "mch_01hzzzzzzzzzzzzzzzzzzzzzzm",
        }),
      ),
      "invalid_input",
    );
    // private workspace의 agent는 다른 컴퓨터의 event를 trigger로 하는 job을 만들지 못한다(구독이 걸리지 않아 절대 돌지 않는다).
    const privateAgent = { actor: `agent:${PRIVATE_SESSION}` } as never;
    const denied = commands.create.handle(
      tx,
      privateAgent,
      {
        title: "remote from private",
        trigger: {
          source: REMOTE_APP,
          event: "whatever",
          machine: "mch_01hzzzzzzzzzzzzzzzzzzzzzzm",
        },
        action: { kind: "tool_run", app: "other", tool: "x" },
      },
      {} as never,
    );
    assert.equal(code(denied), "forbidden");
  } finally {
    db.close();
  }
});

const LAPTOP = "mch_01hzzzzzzzzzzzzzzzzzzzzzzm";
const DESK = "mch_01hzzzzzzzzzzzzzzzzzzzzzzd";

// 다른 컴퓨터의 event를 때로 가진 job은 그 컴퓨터에서 온 event로만 돈다. 이 기계의 event나 다른 컴퓨터의 같은 앱 id·이름 event가 열면
// 엉뚱한 job이 돈다(앱 id는 기계 사이 같다).
test("다른 컴퓨터의 event는 그 컴퓨터를 때로 가진 job만 열고, 이 기계의 event는 기계를 적지 않은 job만 연다", () => {
  const { db, job, trigger, fire, runs, sql } = setup();
  try {
    const mine = "job_01hzzzzzzzzzzzzzzzzzzzzzza";
    const laptop = "job_01hzzzzzzzzzzzzzzzzzzzzzzb";
    const desk = "job_01hzzzzzzzzzzzzzzzzzzzzzzc";
    job(mine, trigger("masup", APP, "usage.limit"));
    job(laptop, trigger(APP, APP, "usage.limit", LAPTOP));
    job(desk, trigger(APP, APP, "usage.limit", DESK));
    const opened = (id: string) => runs(id).length;

    assert.deepStrictEqual(fire({ publisher: APP, event: "usage.limit" }), {
      fired: 1,
      skipped: 0,
    });
    assert.deepStrictEqual([mine, laptop, desk].map(opened), [1, 0, 0]);

    assert.deepStrictEqual(
      fire({ publisher: APP, event: "usage.limit", machine: LAPTOP }),
      { fired: 1, skipped: 0 },
    );
    assert.deepStrictEqual([mine, laptop, desk].map(opened), [1, 1, 0]);
    // job의 차례를 연 event는 난 기계를 싣는다.
    assert.equal(
      (JSON.parse(String(runs(laptop)[0]!.event)) as { machine: string })
        .machine,
      LAPTOP,
    );

    // 구독을 거는 core가 읽는 표는 기계와 job을 만든 workspace를 싣는다.
    const triggers = createEventCommands().triggers.handle(
      {
        sql,
        port: (key: unknown) =>
          key === jobMachinePort ? { id: () => ok(THIS_MACHINE) } : undefined,
      } as never,
      machine,
      {},
    );
    assert.ok(triggers.ok);
    assert.deepStrictEqual(
      triggers.value.triggers
        .map((one) => ({
          machine: one.machine,
          workspace: one.workspace,
        }))
        .sort((a, b) => (a.machine ?? "").localeCompare(b.machine ?? "")),
      [
        { machine: null, workspace: { kind: "project", id: PRJ_A } },
        { machine: DESK, workspace: { kind: "project", id: PRJ_A } },
        { machine: LAPTOP, workspace: { kind: "project", id: PRJ_A } },
      ],
    );
  } finally {
    db.close();
  }
});

// 다른 컴퓨터의 link가 보낸 `AppEventPublished`가 입구(읽기, `receive`)에서 job 실행기(`fire`)까지 이어진다. 안 구독자의 연결(jobs wiring의
// `deliver`)은 event의 난 기계를 그대로 `fire`에 넘기는 한 줄이라 여기서 같게 짠다.
test("다른 컴퓨터가 link로 보낸 앱 event는 receive를 지나 그 컴퓨터를 때로 가진 job만 연다", async () => {
  const { db, job, trigger, fire, runs } = setup();
  const apps = new DatabaseSync(":memory:");
  apps.exec(
    `CREATE TABLE apps (id TEXT PRIMARY KEY, status TEXT);
     CREATE TABLE releases (id TEXT PRIMARY KEY, app TEXT, status TEXT, declaration TEXT);`,
  );
  try {
    const mine = "job_01hzzzzzzzzzzzzzzzzzzzzzza";
    const laptop = "job_01hzzzzzzzzzzzzzzzzzzzzzzb";
    const desk = "job_01hzzzzzzzzzzzzzzzzzzzzzzc";
    job(mine, trigger("masup", APP, "usage.limit"));
    job(laptop, trigger(APP, APP, "usage.limit", LAPTOP));
    job(desk, trigger(APP, APP, "usage.limit", DESK));
    const clock = manualClock(Date.parse("2026-11-10T00:00:00.000Z"));
    const delivery = createEventDelivery({
      clock,
      ids: createIdSource({ clock, random: seededRandom(1) }),
      random: seededRandom(2),
      activeTraceId: () => undefined,
      sql: {
        get: (query, params = []) =>
          apps.prepare(query).get(...(params as never[])) as never,
        all: (query, params = []) =>
          apps.prepare(query).all(...(params as never[])) as never,
      },
      transaction: () => {
        throw new Error("received events are not recorded here");
      },
      running: async () => "down",
      deliver: async () => {
        throw new Error("no app subscribes");
      },
      announce() {},
      failed() {},
      isPrivate: () => false,
      machineOf: () => null,
      crossSeen: () => ok(true),
      crossPublisher: () => null,
    });
    delivery.addInternal({
      wantsSource: () => false,
      deliver: (event) =>
        void fire({
          publisher: event.publisher,
          event: event.event,
          chain: [...event.chain],
          ...(event.machine === undefined ? {} : { machine: event.machine }),
        }),
    });
    const frame = {
      type: "AppEventPublished",
      subject: APP,
      at: "2026-11-10T00:00:00.000Z",
      payload: {
        source: "masup",
        event: "usage.limit",
        payload: { percent: 91 },
        audience: null,
        publication: "pub_01hzzzzzzzzzzzzzzzzzzzzzza",
        trace_id: "a".repeat(32),
        chain: [APP],
      },
    };
    const received = receivedAppEvent(frame);
    assert.ok(received !== null);
    await delivery.receive(LAPTOP as never, received);
    assert.deepStrictEqual(
      [mine, laptop, desk].map((id) => runs(id).length),
      [0, 1, 0],
    );
  } finally {
    db.close();
    apps.close();
  }
});

// 감시는 컴퓨터마다 걸려 있어 같은 컴퓨터를 보는 다른 job이 있으면 private workspace의 job도 그 event를 받는다. core가 알린 private workspace의 job은 열지 않는다.
test("다른 컴퓨터의 event는 core가 private이라고 알린 workspace에서 만든 job을 열지 않고 같은 컴퓨터를 때로 가진 다른 job은 연다", () => {
  const { db, job, trigger, fire, runs } = setup();
  try {
    const open = "job_01hzzzzzzzzzzzzzzzzzzzzzza";
    const secret = "job_01hzzzzzzzzzzzzzzzzzzzzzzb";
    job(open, trigger(APP, APP, "usage.limit", LAPTOP));
    job(secret, trigger(APP, APP, "usage.limit", LAPTOP));
    // setup의 job은 모두 PRJ_A에서 만들었다: 둘이 같은 workspace라 둘 다 빠진다.
    assert.deepStrictEqual(
      fire({
        publisher: APP,
        event: "usage.limit",
        machine: LAPTOP,
        skipWorkspaces: [PRJ_A],
      }),
      { fired: 0, skipped: 0 },
    );
    assert.deepStrictEqual(
      [open, secret].map((id) => runs(id).length),
      [0, 0],
    );
    assert.deepStrictEqual(
      fire({
        publisher: APP,
        event: "usage.limit",
        machine: LAPTOP,
        skipWorkspaces: [PRJ_B],
      }),
      { fired: 2, skipped: 0 },
    );
  } finally {
    db.close();
  }
});

// 다른 컴퓨터의 앱 event로 도는 job은 이 컴퓨터의 선언으로 "그 event를 안 낸다"를 알 수 없다. 안 가리면 모든 그런 job이 source gone으로 보인다.
test("job.list는 이 기계의 앱이 event를 내지 않는 job만 source_gone으로 표시하고 다른 컴퓨터의 앱 event로 도는 job은 표시하지 않는다", () => {
  const { db, tx, job, trigger } = setup();
  try {
    const local = "job_01hzzzzzzzzzzzzzzzzzzzzzza";
    const remote = "job_01hzzzzzzzzzzzzzzzzzzzzzzb";
    job(local, trigger("masup", APP, "gone.event"));
    job(remote, trigger(APP, APP, "gone.event", LAPTOP));
    const listed = createJobReads().list.handle(
      { ...tx, as_of_seq: "1" } as never,
      { actor: "user" } as never,
      {},
    );
    assert.ok(listed.ok);
    assert.deepStrictEqual(
      listed.value.jobs.map((one) => [one.id, one.source_gone]).sort(),
      [
        [local, true],
        [remote, false],
      ],
    );
  } finally {
    db.close();
  }
});

// 다른 컴퓨터의 event나 받은 호출이 낳은 이 컴퓨터의 event로 연 job run은 remote 표시를 담아야 그 run이 세 번째 컴퓨터를 부르지 못한다.
test("다른 컴퓨터의 event와 remote 표시가 붙은 이 기계의 event는 job run에 remote를 남기고 일반 event는 남기지 않는다", () => {
  const { db, job, trigger, fire, runs } = setup();
  try {
    const fromMachine = "job_01hzzzzzzzzzzzzzzzzzzzzzza";
    const fromLocalRemote = "job_01hzzzzzzzzzzzzzzzzzzzzzzb";
    const fromLocal = "job_01hzzzzzzzzzzzzzzzzzzzzzzc";
    job(fromMachine, trigger(APP, APP, "usage.limit", LAPTOP));
    job(fromLocalRemote, trigger("masup", APP, "usage.limit"));
    job(fromLocal, trigger("masup", APP, "other.event"));

    assert.deepStrictEqual(
      fire({ publisher: APP, event: "usage.limit", machine: LAPTOP }),
      { fired: 1, skipped: 0 },
    );
    assert.deepStrictEqual(
      fire({ publisher: APP, event: "usage.limit", remote: true }),
      { fired: 1, skipped: 0 },
    );
    assert.deepStrictEqual(fire({ publisher: APP, event: "other.event" }), {
      fired: 1,
      skipped: 0,
    });

    const eventOf = (id: string) => JSON.parse(String(runs(id)[0]["event"]));
    assert.equal(eventOf(fromMachine).remote, true);
    assert.equal(eventOf(fromMachine).machine, LAPTOP);
    assert.equal(eventOf(fromLocalRemote).remote, true);
    assert.equal(eventOf(fromLocalRemote).machine, undefined);
    assert.equal(eventOf(fromLocal).remote, undefined);
  } finally {
    db.close();
  }
});
