import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  canonicalize,
  dueTimes,
  formatAt,
  type ManualClock,
  manualClock,
  type Result,
  sha256Hex,
} from "../../base/mod.ts";
import {
  type Assignment,
  assignmentRecordSchema,
  scheduleSchema,
} from "../../contracts/lophn-agent/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness as Harness,
} from "../../../apps/core/testing/ledger.ts";
import {
  envelope,
  presetDefinitionJson,
} from "../harness/run-loop/testing/mod.ts";
import {
  createOccurrenceClock,
  MAX_IDLE_MS,
  type ProcessOccurrence,
  roundFor,
} from "./mod.ts";
import {
  agentCredential,
  hashOf,
  HOUR_MS,
  id,
  type LedgerHarness,
  ledgerRead,
  machineCredential,
  must,
  START_MS,
  userCredential,
} from "./testing/mod.ts";

// 회차 테스트. 실제 등록 executor(harness)와 임시 ledger 파일을 쓰고 시계는 manual
// clock이다. 시각은 command로 앞으로 보내며 실제 시간을 기다리지 않는다. model·
// provider는 부르지 않는다.

const ASG_OP = id("asg", 1);
const ASG_LOPHN = id("asg", 2);
const PRESET_OP = id("pst", 1);
const PRESET_LOPHN = id("pst", 2);
const PROJECT = id("prj", 1);
const DOC = id("doc", 1);
const EVERY = HOUR_MS;
const FIRST = START_MS + HOUR_MS;

type Fixture = {
  h: Harness;
  // ledger 시계와 같은 시각을 보는 시험 쪽 시계. 회차 시계가 이것을 읽는다.
  clock: ManualClock;
  approvals: number;
  presetDefinition: string;
};

async function open(): Promise<Fixture> {
  const opened = await createLedgerHarness({
    registrationModules: [new URL("./registration_test.ts", import.meta.url)],
    credentials: [
      userCredential,
      machineCredential,
      agentCredential(ASG_OP),
      agentCredential(ASG_LOPHN),
    ],
    nowMs: START_MS,
  });
  assert(opened.ok, opened.ok ? undefined : JSON.stringify(opened.error));
  return {
    h: opened.value,
    clock: manualClock(START_MS),
    approvals: 0,
    presetDefinition: "",
  };
}

function code(result: Result<unknown>, expected: string) {
  if (result.ok) {
    assert(false, "expected failure, got " + JSON.stringify(result.value));
  } else {
    assertEquals(result.error.code, expected);
  }
}

async function sql(
  f: Fixture,
  query: string,
  params: (string | number)[] = [],
) {
  return must(await f.h.inspect(query, params)) as Record<string, unknown>[];
}

// ledger와 시험 시계를 같이 앞으로 보낸다.
async function goto(f: Fixture, ms: number) {
  f.clock.set(ms);
  must(
    await f.h.command(
      machineCredential,
      envelope("SetClockFixture", { at: formatAt(ms) }),
    ),
  );
}

function schedule(firstAt = FIRST, everyMs = EVERY) {
  return { first_at: formatAt(firstAt), every_ms: everyMs };
}

async function registerPresets(f: Fixture) {
  for (
    const [preset, kind] of [[PRESET_OP, "operator"], [
      PRESET_LOPHN,
      "lophn",
    ]] as const
  ) {
    const definition = presetDefinitionJson(kind);
    const hash = hashOf(definition);
    must(
      await f.h.command(
        machineCredential,
        envelope("RegisterDefaultPreset", {
          id: preset,
          definition,
          definition_hash: hash,
        }),
      ),
    );
    if (kind === "operator") f.presetDefinition = hash;
  }
}

async function readAssignment(f: Fixture, assignment = ASG_OP) {
  const read = must(
    await f.h.read(
      { resource: "assignments", method: "read" },
      userCredential,
      { assignment },
    ),
  ) as { assignment: Assignment };
  return read.assignment;
}

// 사람이 승인한 묶음을 적용한다. 승인 표는 platform 소유라 granted 행을 fixture로 둔다.
async function applyOperator(
  f: Fixture,
  input: {
    schedule?: { first_at: string; every_ms: number };
    content?: string;
    reason?: string;
  } = {},
): Promise<Result<unknown>> {
  const current = await sql(
    f,
    "select revision from assignments where id = ?",
    [ASG_OP],
  );
  const creating = current.length === 0;
  const approval = id("apr", ++f.approvals);
  must(
    await f.h.command(
      machineCredential,
      envelope("SeedApprovalFixture", { id: approval, status: "granted" }),
    ),
  );
  // 결정 seq(lophn-agent#T53의 decision_seq 맞춤)는 허락이 확정하는 값이라
  // 적용 입력에 넣지 않고, handler가 승인 기록의 결정 seq로 맞춘다.
  const applied = {
    approval,
    id: ASG_OP,
    bundle: {
      draft_version: id("ver", f.approvals),
      assignment: creating ? null : ASG_OP,
      expected_assignment_revision: creating
        ? null
        : Number(current[0]!["revision"]),
      preset: PRESET_OP,
      preset_revision: 1,
      preset_definition: f.presetDefinition,
      scope: { kind: "project", id: PROJECT },
      outputs: [{ document: DOC, content: input.content ?? "watch changes" }],
      read_apps: [],
      read_commands: [],
      schedule: input.schedule ?? schedule(),
      reason: input.reason ?? "approved by person",
    },
  };
  // 결정은 route가 선언한 binding field(approval·bundle)의 내용 기준으로 묶인다
  // (lophn-agent#T53의 decision_seq 맞춤). 이 테스트의 fixture 행은 결정 seq가
  // 없어 생략 입력은 승인 기록과 일치로 통과한다.
  const bound = {
    approval: applied.approval,
    bundle: applied.bundle,
  };
  const issued = must(
    await f.h.confirmation({
      action: "issue",
      request: {
        type: "confirmation_handle_register",
        window_id: "win-1",
        target_ref: approval,
        content_hash: await sha256Hex(canonicalize(bound)),
        allowed_decisions: ["ApplyOperatorAssignment"],
        expires_at: formatAt(f.clock.nowMs() + 600_000),
      },
    }),
  ) as { confirmation: string };
  return await f.h.command(machineCredential, {
    ...envelope("ApplyOperatorAssignment", applied),
    confirmation: issued.confirmation,
  });
}

async function seedOperator(
  f: Fixture,
  input: Parameters<typeof applyOperator>[1] = {},
) {
  await registerPresets(f);
  must(await applyOperator(f, input));
}

async function seedLophn(f: Fixture) {
  must(
    await f.h.command(
      machineCredential,
      envelope("CreateBuiltinAssignment", {
        id: ASG_LOPHN,
        preset: PRESET_LOPHN,
        preset_revision: 1,
        role: "lophn",
        scope: { kind: "all", id: null },
      }),
    ),
  );
}

type RoundInput = {
  due_at: string;
  missed_first_at: string | null;
  missed_last_at: string | null;
  missed_count: number;
};

function noMiss(dueMs: number): RoundInput {
  return {
    due_at: formatAt(dueMs),
    missed_first_at: null,
    missed_last_at: null,
    missed_count: 0,
  };
}

function processAssignment(
  f: Fixture,
  round: RoundInput,
  compare: { assignment_revision: number; previous_due_at: string | null },
  options: {
    key?: string;
    assignment?: string;
    as?: typeof machineCredential;
  } = {},
) {
  const request = envelope(
    "ProcessAssignmentOccurrence",
    { assignment: options.assignment ?? ASG_OP, ...round },
    compare,
  );
  return f.h.command(options.as ?? machineCredential, {
    ...request,
    idempotency_key: options.key ?? request.idempotency_key,
  });
}

// 회차 시계. 시각은 시험 시계이고 command는 실제 ledger로 간다.
function occurrenceClock(f: Fixture) {
  const process: ProcessOccurrence = (body) =>
    f.h.command(machineCredential, {
      command: "ProcessAssignmentOccurrence",
      ...body,
    }) as never;
  return createOccurrenceClock({
    clock: f.clock,
    read: ledgerRead(f.h as unknown as LedgerHarness),
    process,
  });
}

async function occurrences(f: Fixture, input: Record<string, unknown> = {}) {
  const read = must(
    await f.h.read(
      { resource: "assignment-occurrences", method: "list" },
      userCredential,
      { assignment: ASG_OP, ...input },
    ),
  ) as {
    occurrences: {
      occurrence: {
        outcome: string;
        run: string | null;
        due_at: string;
        skip_reason: string | null;
        blocking_runs: string[];
        missed_count: number;
        missed_first_at: string | null;
        missed_last_at: string | null;
        assignment_revision: number;
        previous_due_at: string | null;
      };
      event_seq: string;
    }[];
    next_cursor: string | null;
  };
  return read;
}

async function runRecord(f: Fixture, run: string) {
  return (must(
    await f.h.read({ resource: "runs", method: "read" }, userCredential, {
      run,
    }),
  ) as { run: Record<string, unknown> & { state_seq: string } }).run;
}

async function startRun(f: Fixture, run: string, role = "operator") {
  const record = await runRecord(f, run);
  return await f.h.command(
    machineCredential,
    envelope("StartRun", {
      run,
      basis: "b".repeat(64),
      limits: { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 },
      scope: {
        role,
        assignment: record["assignment"],
        apps: [],
      },
    }, { state_seq: record.state_seq }),
  );
}

async function finishRun(f: Fixture, run: string) {
  const record = await runRecord(f, run);
  return await f.h.command(
    machineCredential,
    envelope("FinishRun", {
      run,
      outcome: { kind: "completed", reason: "no_change" },
      result: "c".repeat(64),
    }, { state_seq: record.state_seq }),
  );
}

async function acceptHumanRequest(
  f: Fixture,
  run: string,
  assignment = ASG_OP,
) {
  const current = await readAssignment(f, assignment);
  return await f.h.command(
    machineCredential,
    envelope("AcceptRun", {
      id: run,
      assignment,
      session: id("ses", 1),
      source: { kind: "message", message: id("msg", 1) },
      continued_from: null,
      start_after: null,
    }, { assignment_revision: current.revision }),
  );
}

function resultOf<T>(value: unknown): T {
  return (value as { result: T }).result;
}

async function count(f: Fixture, table: string, where = "1 = 1") {
  const found = await sql(
    f,
    `select count(*) as n from ${table} where ${where}`,
  );
  return Number(found[0]!["n"]);
}

Deno.test("lophn-agent/scheduling#R1: only an enabled Operator takes a round, machine only, and the run is a background schedule request", async () => {
  const f = await open();
  try {
    await seedOperator(f);
    await seedLophn(f);
    await goto(f, FIRST + HOUR_MS / 2);
    const due = noMiss(FIRST);
    const compare = { assignment_revision: 1, previous_due_at: null };

    // lophn·Context Engineer·App Engineer에는 주기가 없다. 있는 것처럼 보내도 같은 회차가 아니다.
    code(
      await processAssignment(f, due, compare, { assignment: ASG_LOPHN }),
      "forbidden",
    );
    // 사람과 agent는 회차를 접수하지 못한다. machine이 계산해 배경 요청으로 접수한다.
    code(
      await processAssignment(f, due, compare, { as: userCredential }),
      "forbidden",
    );
    code(
      await processAssignment(f, due, compare, {
        as: agentCredential(ASG_OP),
      }),
      "forbidden",
    );
    assertEquals(await count(f, "runs"), 0);

    const accepted = resultOf<{ occurrence: { run: string; outcome: string } }>(
      must(await processAssignment(f, due, compare)),
    ).occurrence;
    assertEquals(accepted.outcome, "accepted");
    const run = await runRecord(f, accepted.run);
    assertEquals(run["source"], {
      kind: "schedule",
      assignment_revision: 1,
      scheduled_at: formatAt(FIRST),
    });
    assertEquals(run["session"], null);
    assertEquals(run["state"], "accepted");

    // 기본 세 역할 어디에도 주기 값이 없다. 값이 있으면 record 자체가 맞지 않는다.
    const lophn = await readAssignment(f, ASG_LOPHN);
    assertEquals(lophn.schedule, null);
    assertEquals(lophn.last_due_at, null);
    assert(
      !assignmentRecordSchema.safeParse({ ...lophn, schedule: schedule() })
        .success,
    );
    assert(
      !assignmentRecordSchema.safeParse({
        ...lophn,
        last_due_at: formatAt(FIRST),
      }).success,
    );
  } finally {
    await f.h.close();
  }
});

Deno.test("lophn-agent/scheduling#R1: a human request is a one-time run, does not move the next due time, and is told apart from a round by its run source", async () => {
  const f = await open();
  try {
    await seedOperator(f);
    const human = id("run", 1);
    await goto(f, FIRST - HOUR_MS / 2);
    must(await acceptHumanRequest(f, human));
    // 사람 요청은 last_due_at도 다음 예정 시점도 바꾸지 않는다.
    assertEquals((await readAssignment(f)).last_due_at, null);
    assertEquals(await count(f, "assignment_schedule_occurrences"), 0);

    // 사람의 일이 끝나지 않았으면 그 회차는 겹침으로 skip하고 진행 중 run에 합치지 않는다.
    await goto(f, FIRST + HOUR_MS / 2);
    const skipped = resultOf<{
      occurrence: { outcome: string; blocking_runs: string[]; run: null };
    }>(
      must(
        await processAssignment(f, noMiss(FIRST), {
          assignment_revision: 1,
          previous_due_at: null,
        }),
      ),
    ).occurrence;
    assertEquals(skipped.outcome, "skipped");
    assertEquals(skipped.blocking_runs, [human]);
    assertEquals(await count(f, "runs"), 1);

    must(await startRun(f, human));
    must(await finishRun(f, human));
    await goto(f, FIRST + HOUR_MS + HOUR_MS / 2);
    const next = resultOf<{ occurrence: { run: string; outcome: string } }>(
      must(
        await processAssignment(f, noMiss(FIRST + HOUR_MS), {
          assignment_revision: 1,
          previous_due_at: formatAt(FIRST),
        }),
      ),
    ).occurrence;
    assertEquals(next.outcome, "accepted");
    // run 출처로 사람 요청과 주기를 구별한다.
    assertEquals(
      ((await runRecord(f, human))["source"] as { kind: string }).kind,
      "message",
    );
    assertEquals(
      ((await runRecord(f, next.run))["source"] as { kind: string }).kind,
      "schedule",
    );
  } finally {
    await f.h.close();
  }
});

Deno.test("lophn-agent/scheduling#R1: a round calls no model, unlike a heartbeat", async () => {
  // 구조: 회차 모듈은 provider·model·usage·prompt·tool 모듈을 import하지 않는다.
  const dir = new URL(".", import.meta.url);
  const sources: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (
      entry.isFile && entry.name.endsWith(".ts") &&
      !entry.name.endsWith("_test.ts")
    ) {
      sources.push(await Deno.readTextFile(new URL(entry.name, dir)));
    }
  }
  assert(sources.length >= 6);
  for (const source of sources) {
    assert(
      !/from\s+"[^"]*harness\/(provider|model|usage|prompt-assemble|tools|tool-judgment)\//
        .test(source),
    );
  }

  // 동작: 여러 회차를 처리해도 ledger에는 model 호출 event가 하나도 없다.
  const f = await open();
  try {
    await seedOperator(f);
    const clock = occurrenceClock(f);
    for (let hour = 1; hour <= 3; hour++) {
      await goto(f, START_MS + hour * HOUR_MS + 1);
      const ticked = must(await clock.tick());
      assertEquals(ticked.advanced.length, 1);
    }
    const types = await sql(
      f,
      "select distinct type from events order by type",
    );
    for (const row of types) {
      assert(!String(row["type"]).startsWith("ModelCall"), String(row["type"]));
    }
    assert(types.some((row) => row["type"] === "AssignmentScheduleAdvanced"));
  } finally {
    await f.h.close();
  }
});

Deno.test("lophn-agent/scheduling#R2: round arithmetic is the shared base dueTimes and no second scheduler or timer exists", async () => {
  const dir = new URL(".", import.meta.url);
  let model = "";
  const product: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".ts")) continue;
    if (entry.name.endsWith("_test.ts")) continue;
    const text = await Deno.readTextFile(new URL(entry.name, dir));
    product.push(text);
    if (entry.name === "model.ts") model = text;
  }
  assert(/dueTimes[^;]*from\s+"\.\.\/\.\.\/base\/mod\.ts"/s.test(model));
  for (const source of product) {
    assert(!/\b(setInterval|setTimeout|Deno\.cron|new Worker)\b/.test(source));
  }

  // 같은 입력이면 base의 결과와 같다. 회차 모듈이 산술을 따로 갖지 않는다.
  const sched = schedule(FIRST, EVERY);
  for (
    const [last, nowMs] of [
      [null, FIRST - 1],
      [null, FIRST],
      [null, FIRST + 7 * EVERY + 5],
      [formatAt(FIRST + 2 * EVERY), FIRST + 2 * EVERY + 1],
      [formatAt(FIRST + 2 * EVERY), FIRST + 9 * EVERY],
    ] as const
  ) {
    const base = dueTimes({
      first_at: sched.first_at,
      every_ms: sched.every_ms,
      last_due_at: last,
      now: formatAt(nowMs),
    });
    const round = roundFor(sched, last, formatAt(nowMs));
    assert(base.ok && round.ok);
    assertEquals(round.value?.due_at ?? null, base.value.latest_due_at);
    assertEquals(round.value?.missed_count ?? 0, base.value.missed_count);
  }
});

Deno.test("lophn-agent/scheduling#R2: the occurrence loop sleeps through an injected wait, wakes at the next due time or after MAX_IDLE_MS and keeps no timer of its own", async () => {
  const f = await open();
  try {
    await seedOperator(f);
    const clock = occurrenceClock(f);
    const waits: number[] = [];
    let turns = 0;
    await clock.run({
      stopped: () => turns >= 4,
      async wait(ms) {
        turns++;
        waits.push(ms);
        await goto(f, f.clock.nowMs() + ms);
      },
    });
    // 첫 회차(01:00)까지 한 시간이지만 MAX_IDLE_MS로 끊어 절전 복귀와 새 승인을 알아챈다.
    assertEquals(waits[0], MAX_IDLE_MS);
    assertEquals(waits.length, 4);
    assertEquals(MAX_IDLE_MS, 60_000);
    // 시계가 한 시간을 흘렸어도 회차 시계는 시각을 주입받은 대로만 움직였다.
    assertEquals(f.clock.nowMs(), START_MS + 4 * MAX_IDLE_MS);
    assertEquals(await count(f, "assignment_schedule_occurrences"), 0);

    // 다음 예정 시점이 가까우면 그 시각에 깬다.
    await goto(f, FIRST - 1_000);
    const near: number[] = [];
    let once = false;
    await clock.run({
      stopped: () => once,
      async wait(ms) {
        once = true;
        near.push(ms);
        await goto(f, f.clock.nowMs() + ms);
      },
    });
    assertEquals(near, [1_000]);
    must(await clock.tick());
    assertEquals(await count(f, "assignment_schedule_occurrences"), 1);
  } finally {
    await f.h.close();
  }
});

Deno.test("lophn-agent/scheduling#R3: a schedule is a UTC first_at and a positive every_ms with no default, cron, timezone or calendar", async () => {
  const good = { first_at: "2026-01-01T09:00:00.000Z", every_ms: 86_400_000 };
  assert(scheduleSchema.safeParse(good).success);
  for (const every of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert(!scheduleSchema.safeParse({ ...good, every_ms: every }).success);
  }
  // 기본 간격이 없다.
  assert(!scheduleSchema.safeParse({ first_at: good.first_at }).success);
  assert(!scheduleSchema.safeParse({ every_ms: good.every_ms }).success);
  // UTC 시각만 받는다. 현지 시간대 표기나 cron·달력은 값 자체가 아니다.
  assert(
    !scheduleSchema.safeParse({
      ...good,
      first_at: "2026-01-01T09:00:00.000+09:00",
    }).success,
  );
  for (
    const extra of [
      { cron: "0 9 * * *" },
      { timezone: "Asia/Seoul" },
      { calendar: "weekdays" },
      { default_every_ms: 3_600_000 },
    ]
  ) {
    assert(!scheduleSchema.safeParse({ ...good, ...extra }).success);
  }

  const f = await open();
  try {
    await registerPresets(f);
    // 승인 적용 시각 이전 첫 시점과 0 간격은 적용되지 않는다.
    code(
      await applyOperator(f, { schedule: schedule(START_MS, EVERY) }),
      "invalid_input",
    );
    code(
      await applyOperator(f, { schedule: schedule(FIRST, 0) }),
      "invalid_input",
    );
    assertEquals(await count(f, "assignments"), 0);

    // 현지 시간대가 바뀌는 날을 지나도 UTC 간격은 정확히 하루다.
    const day = 86_400_000;
    const first = Date.UTC(2026, 2, 7, 12, 0, 0);
    must(await applyOperator(f, { schedule: schedule(first, day) }));
    const clock = occurrenceClock(f);
    for (let n = 0; n < 6; n++) {
      await goto(f, first + n * day + 30 * 60_000);
      must(await clock.tick());
    }
    const dues = (await occurrences(f)).occurrences.map((entry) =>
      Date.parse(entry.occurrence.due_at)
    );
    assertEquals(dues.length, 6);
    for (let n = 1; n < dues.length; n++) {
      assertEquals(dues[n]! - dues[n - 1]!, day);
    }
    assert(
      (await occurrences(f)).occurrences.every((entry) =>
        entry.occurrence.due_at.endsWith("T12:00:00.000Z")
      ),
    );
  } finally {
    await f.h.close();
  }
});

Deno.test("lophn-agent/scheduling#R3: a due time must lie on the approved schedule", async () => {
  const f = await open();
  try {
    await seedOperator(f);
    await goto(f, FIRST + 3 * HOUR_MS);
    const compare = { assignment_revision: 1, previous_due_at: null };
    // 간격 위에 있지 않은 시점, 아직 오지 않은 시점, 놓친 구간을 속인 입력은 모두 거절된다.
    code(
      await processAssignment(f, noMiss(FIRST + 1_000), compare),
      "invalid_input",
    );
    code(
      await processAssignment(f, noMiss(FIRST + 4 * HOUR_MS), compare),
      "invalid_input",
    );
    code(
      await processAssignment(f, noMiss(FIRST + 3 * HOUR_MS), compare),
      "invalid_input",
    );
    code(
      await processAssignment(f, {
        due_at: formatAt(FIRST + 3 * HOUR_MS),
        missed_first_at: formatAt(FIRST + HOUR_MS),
        missed_last_at: formatAt(FIRST + 2 * HOUR_MS),
        missed_count: 2,
      }, compare),
      "invalid_input",
    );
    // 주기 위의 올바른 회차라도 더 최근 회차가 와 있으면 낡은 입력이다.
    code(await processAssignment(f, noMiss(FIRST), compare), "conflict");
    assertEquals(await count(f, "runs"), 0);
    assertEquals(await count(f, "assignment_schedule_occurrences"), 0);
    assertEquals((await readAssignment(f)).last_due_at, null);
  } finally {
    await f.h.close();
  }
});

Deno.test("lophn-agent/scheduling#R4: the same round is never accepted twice and the record keeps outcome, time and reason", async () => {
  const f = await open();
  try {
    await seedOperator(f);
    await goto(f, FIRST + 10 * 60_000);
    const compare = { assignment_revision: 1, previous_due_at: null };
    const first = must(
      await processAssignment(f, noMiss(FIRST), compare, { key: "occ-1" }),
    );
    const occurrence = resultOf<{ occurrence: { run: string } }>(first)
      .occurrence;
    // 같은 key의 재전송은 이전 결과, 다른 key로 같은 회차를 다시 내도 새 run은 없다.
    const again = must(
      await processAssignment(f, noMiss(FIRST), compare, { key: "occ-1" }),
    );
    assertEquals((again as { replayed: boolean }).replayed, true);
    const other = must(
      await processAssignment(f, noMiss(FIRST), compare, { key: "occ-2" }),
    );
    assertEquals(resultOf(other), resultOf(first));
    // 같은 회차에 다른 판단(놓친 구간)을 내려는 입력은 거절이다.
    code(
      await processAssignment(f, {
        due_at: formatAt(FIRST),
        missed_first_at: formatAt(FIRST - 2 * HOUR_MS),
        missed_last_at: formatAt(FIRST - HOUR_MS),
        missed_count: 2,
      }, compare),
      "conflict",
    );
    assertEquals(await count(f, "runs"), 1);
    assertEquals(await count(f, "assignment_schedule_occurrences"), 1);
    assertEquals(
      await count(f, "events", "type = 'AssignmentScheduleAdvanced'"),
      1,
    );
    assertEquals(await count(f, "events", "type = 'RunAccepted'"), 1);

    // 접수와 같은 transaction에서 run·회차 기록·last_due_at이 함께 남는다.
    const listed = await occurrences(f);
    assertEquals(listed.occurrences.length, 1);
    const entry = listed.occurrences[0]!;
    assertEquals(entry.occurrence.run, occurrence.run);
    assertEquals(entry.occurrence.outcome, "accepted");
    assertEquals(entry.occurrence.previous_due_at, null);
    assertEquals((await readAssignment(f)).last_due_at, formatAt(FIRST));
    const event = (await sql(
      f,
      "select seq, at from events where type = 'AssignmentScheduleAdvanced'",
    ))[0]!;
    assertEquals(String(event["seq"]), entry.event_seq);
    // 기록 시각은 처리한 순간이고 예정 시점과 구별된다.
    assertEquals(event["at"], formatAt(FIRST + 10 * 60_000));
    assertNotEquals(event["at"], entry.occurrence.due_at);

    // 한 번 쓴 기록은 바꾸거나 지우지 못한다.
    const harmless = await f.h.probeWrite(
      "update assignments set last_due_at = last_due_at",
      [],
    );
    assert(harmless.ok);
    const tamper = await f.h.probeWrite(
      "update assignment_schedule_occurrences set outcome = 'skipped'",
      [],
    );
    assert(!tamper.ok);
    const erase = await f.h.probeWrite(
      "delete from assignment_schedule_occurrences",
      [],
    );
    assert(!erase.ok);
  } finally {
    await f.h.close();
  }
});

Deno.test("lophn-agent/scheduling#R4: occurrence list is ordered and paged, and out-of-scope assignments answer like absent ones", async () => {
  const f = await open();
  try {
    await seedOperator(f);
    const clock = occurrenceClock(f);
    for (let n = 1; n <= 5; n++) {
      await goto(f, START_MS + n * HOUR_MS + 5);
      must(await clock.tick());
    }
    const all = await occurrences(f);
    assertEquals(all.occurrences.length, 5);
    const dues = all.occurrences.map((entry) => entry.occurrence.due_at);
    assertEquals([...dues].sort(), dues);

    const page = await occurrences(f, { limit: 2 });
    assertEquals(page.occurrences.length, 2);
    assert(page.next_cursor !== null);
    const next = await occurrences(f, { limit: 2, cursor: page.next_cursor });
    assertEquals(next.occurrences[0]!.occurrence.due_at, dues[2]);
    const ranged = await occurrences(f, {
      after_due_at: dues[0],
      through_due_at: dues[3],
    });
    assertEquals(
      ranged.occurrences.map((entry) => entry.occurrence.due_at),
      [dues[1], dues[2], dues[3]],
    );
    assertEquals(
      (await occurrences(f, { assignment_revision: 2 })).occurrences,
      [],
    );

    // agent는 자기 assignment의 기록만 보고 다른 것은 없는 assignment와 똑같이 답한다.
    const absent = await f.h.read(
      { resource: "assignment-occurrences", method: "list" },
      userCredential,
      { assignment: id("asg", 99) },
    );
    code(absent, "not_found");
    const foreign = await f.h.read(
      { resource: "assignment-occurrences", method: "list" },
      agentCredential(ASG_LOPHN),
      { assignment: ASG_OP },
    );
    code(foreign, "not_found");
    assertEquals(
      !foreign.ok && !absent.ok && foreign.error.message,
      !absent.ok && absent.error.message,
    );
    const own = await f.h.read(
      { resource: "assignment-occurrences", method: "list" },
      agentCredential(ASG_OP),
      { assignment: ASG_OP },
    );
    assert(own.ok);
  } finally {
    await f.h.close();
  }
});

Deno.test("lophn-agent/scheduling#R5: an unfinished run (accepted, running, waiting_user) skips the round as unfinished_run, moves last_due_at and builds no queue", async () => {
  const f = await open();
  try {
    await seedOperator(f);
    const clock = occurrenceClock(f);
    // 01:00 회차가 run A를 접수한다.
    await goto(f, FIRST + 1);
    const accepted = must(await clock.tick()).advanced[0]!.occurrence;
    assertEquals(accepted.outcome, "accepted");
    const runA = accepted.run!;

    // A가 접수 상태인 02:00 회차.
    await goto(f, FIRST + HOUR_MS + 1);
    const second = must(await clock.tick()).advanced[0]!.occurrence;
    assertEquals(second.outcome, "skipped");
    assertEquals(second.skip_reason, "unfinished_run");
    assertEquals(second.blocking_runs, [runA]);
    assertEquals(second.run, null);

    // A가 진행 중인 03:00 회차.
    must(await startRun(f, runA));
    await goto(f, FIRST + 2 * HOUR_MS + 1);
    const third = must(await clock.tick()).advanced[0]!.occurrence;
    assertEquals(third.outcome, "skipped");
    assertEquals(third.blocking_runs, [runA]);

    // A가 질문 답을 기다리는 04:00 회차.
    must(
      await f.h.command(
        machineCredential,
        envelope("SetRunStateFixture", { run: runA, state: "waiting_user" }),
      ),
    );
    await goto(f, FIRST + 3 * HOUR_MS + 1);
    const fourth = must(await clock.tick()).advanced[0]!.occurrence;
    assertEquals(fourth.outcome, "skipped");
    assertEquals(fourth.blocking_runs, [runA]);

    // 건너뛴 회차마다 last_due_at이 옮겨 갔고 대기열도 새 run도 없다.
    assertEquals(await count(f, "runs"), 1);
    assertEquals((await readAssignment(f)).last_due_at, fourth.due_at);
    // 같은 tick을 다시 돌려도 due로 남은 회차가 없다.
    assertEquals(must(await clock.tick()).advanced, []);

    // A가 끝난 뒤 첫 회차는 건너뛴 02:00·03:00·04:00을 따라잡지 않고 05:00만 접수한다.
    must(
      await f.h.command(
        machineCredential,
        envelope("SetRunStateFixture", { run: runA, state: "running" }),
      ),
    );
    must(await finishRun(f, runA));
    assertEquals(must(await clock.tick()).advanced, []);
    await goto(f, FIRST + 4 * HOUR_MS + 1);
    const fifth = must(await clock.tick()).advanced[0]!.occurrence;
    assertEquals(fifth.outcome, "accepted");
    assertEquals(fifth.missed_count, 0);
    assertEquals(await count(f, "runs"), 2);

    // 모든 건너뜀의 근거와 이유가 기록에 남는다.
    const skipped = (await occurrences(f)).occurrences.filter((entry) =>
      entry.occurrence.outcome === "skipped"
    );
    assertEquals(skipped.length, 3);
    assert(
      skipped.every((entry) =>
        entry.occurrence.skip_reason === "unfinished_run" &&
        entry.occurrence.blocking_runs.length === 1
      ),
    );
  } finally {
    await f.h.close();
  }
});

Deno.test("lophn-agent/scheduling#R6: after startup, sleep or resume only the latest unprocessed round runs and earlier ones are recorded as a missed range", async () => {
  const f = await open();
  try {
    await seedOperator(f);
    const clock = occurrenceClock(f);
    // 10회(01:00~10:00)를 놓친 채 10:30에 깨어난다.
    await goto(f, START_MS + 10 * HOUR_MS + 30 * 60_000);
    const woke = must(await clock.tick());
    assertEquals(woke.advanced.length, 1);
    const round = woke.advanced[0]!.occurrence;
    assertEquals(round.due_at, formatAt(START_MS + 10 * HOUR_MS));
    assertEquals(round.outcome, "accepted");
    assertEquals(round.missed_count, 9);
    assertEquals(round.missed_first_at, formatAt(START_MS + HOUR_MS));
    assertEquals(round.missed_last_at, formatAt(START_MS + 9 * HOUR_MS));
    assertEquals(await count(f, "runs"), 1);
    assertEquals(await count(f, "assignment_schedule_occurrences"), 1);
    assertEquals(woke.next_due_at, formatAt(START_MS + 11 * HOUR_MS));
    // 같은 시각에 다시 깨어나도 처리할 회차가 없다.
    assertEquals(must(await clock.tick()).advanced, []);

    // 다시 절전하고 15:30에 복귀하면 앞 구간 11:00~14:00이 놓침이다.
    await goto(f, START_MS + 15 * HOUR_MS + 30 * 60_000);
    const resumed = must(await clock.tick()).advanced[0]!.occurrence;
    assertEquals(resumed.due_at, formatAt(START_MS + 15 * HOUR_MS));
    assertEquals(resumed.previous_due_at, formatAt(START_MS + 10 * HOUR_MS));
    assertEquals(resumed.missed_count, 4);
    assertEquals(resumed.missed_first_at, formatAt(START_MS + 11 * HOUR_MS));
    assertEquals(resumed.missed_last_at, formatAt(START_MS + 14 * HOUR_MS));
    // 과거 run을 몰아서 만들지 않는다. 앞의 run이 끝나지 않았으니 이 회차는 skip이고
    // 새 run은 없다. 놓친 구간은 skip 기록에도 그대로 남는다.
    assertEquals(resumed.outcome, "skipped");
    assertEquals(await count(f, "runs"), 1);
  } finally {
    await f.h.close();
  }
});

Deno.test("lophn-agent/scheduling#R6: a paused assignment takes no rounds and a person's resume handles only the latest one", async () => {
  const f = await open();
  try {
    await seedOperator(f);
    const clock = occurrenceClock(f);
    await goto(f, FIRST + 1);
    const first = must(await clock.tick()).advanced[0]!.occurrence;
    must(await startRun(f, first.run!));
    must(await finishRun(f, first.run!));

    const before = await readAssignment(f);
    must(
      await f.h.command(
        userCredential,
        envelope(
          "PauseAssignment",
          {
            assignment: ASG_OP,
            reason: { kind: "user", detail: "away", runs: [], target: null },
          },
          { revision: before.revision, state: "enabled" },
        ),
      ),
    );
    await goto(f, FIRST + 6 * HOUR_MS + 1);
    // 멈춘 동안은 어떤 회차도 접수하거나 skip하지 않는다. 명령도 거절이다.
    assertEquals(must(await clock.tick()).advanced, []);
    code(
      await processAssignment(f, noMiss(FIRST + 6 * HOUR_MS), {
        assignment_revision: before.revision + 1,
        previous_due_at: formatAt(FIRST),
      }),
      "forbidden",
    );
    assertEquals(await count(f, "assignment_schedule_occurrences"), 1);

    const paused = await readAssignment(f);
    must(
      await f.h.command(
        userCredential,
        envelope("ResumeAssignment", { assignment: ASG_OP }, {
          revision: paused.revision,
          state: "paused",
        }),
      ),
    );
    const resumed = must(await clock.tick()).advanced[0]!.occurrence;
    assertEquals(resumed.due_at, formatAt(FIRST + 6 * HOUR_MS));
    assertEquals(resumed.missed_count, 5);
    assertEquals(resumed.outcome, "accepted");
    assertEquals(await count(f, "runs"), 2);
  } finally {
    await f.h.close();
  }
});

Deno.test("lophn-agent/scheduling#R7: responsibility and state changes keep last_due_at so a processed round is never accepted again by a new revision", async () => {
  const f = await open();
  try {
    await seedOperator(f);
    const clock = occurrenceClock(f);
    await goto(f, FIRST + 1);
    const first = must(await clock.tick()).advanced[0]!.occurrence;
    must(await startRun(f, first.run!));
    must(await finishRun(f, first.run!));
    const processed = formatAt(FIRST);
    assertEquals((await readAssignment(f)).last_due_at, processed);

    // 책임(남길 문서의 내용·이유)만 바꾼 새 판. 주기가 같으므로 처리한 시점이 남는다.
    must(
      await applyOperator(f, {
        content: "watch every change",
        reason: "scope",
      }),
    );
    const changed = await readAssignment(f);
    assertEquals(changed.revision, 2);
    assertEquals(changed.last_due_at, processed);
    // 새 판의 키로도 같은 예정 시점을 다시 접수하지 못한다.
    for (const previous of [null, processed]) {
      const retry = await processAssignment(f, noMiss(FIRST), {
        assignment_revision: 2,
        previous_due_at: previous,
      });
      assert(!retry.ok);
      assert(["conflict", "invalid_input"].includes(retry.error.code));
    }
    assertEquals(must(await clock.tick()).advanced, []);
    assertEquals(await count(f, "runs"), 1);

    // 상태 변경(멈춤과 재개)도 마찬가지다.
    must(
      await f.h.command(
        userCredential,
        envelope(
          "PauseAssignment",
          {
            assignment: ASG_OP,
            reason: { kind: "user", detail: "break", runs: [], target: null },
          },
          { revision: 2, state: "enabled" },
        ),
      ),
    );
    must(
      await f.h.command(
        userCredential,
        envelope("ResumeAssignment", { assignment: ASG_OP }, {
          revision: 3,
          state: "paused",
        }),
      ),
    );
    const resumed = await readAssignment(f);
    assertEquals(resumed.revision, 4);
    assertEquals(resumed.last_due_at, processed);
    assertEquals(must(await clock.tick()).advanced, []);

    // 다음 회차는 새 판의 키로 접수된다.
    await goto(f, FIRST + HOUR_MS + 1);
    const next = must(await clock.tick()).advanced[0]!.occurrence;
    assertEquals(next.assignment_revision, 4);
    assertEquals(next.previous_due_at, processed);
    assertEquals(next.outcome, "accepted");
  } finally {
    await f.h.close();
  }
});

Deno.test("lophn-agent/scheduling#R7: only an approved schedule change restarts the calculation from a future first_at and a paused assignment is not resumed by it", async () => {
  const f = await open();
  try {
    await seedOperator(f);
    const clock = occurrenceClock(f);
    await goto(f, FIRST + 3 * HOUR_MS + 1);
    const before = must(await clock.tick()).advanced[0]!.occurrence;
    assertEquals(before.missed_count, 3);
    assertEquals(
      (await readAssignment(f)).last_due_at,
      formatAt(FIRST + 3 * HOUR_MS),
    );

    // 지난 시점에서 시작하는 새 주기는 승인 적용이 거절한다.
    const now = f.clock.nowMs();
    code(
      await applyOperator(f, { schedule: schedule(now - 2 * HOUR_MS, EVERY) }),
      "invalid_input",
    );
    assertEquals((await readAssignment(f)).revision, 1);

    // 멈춘 동안 주기를 승인해 바꾸면 새 계산이 시작되지만 상태는 멈춤 그대로다.
    must(
      await f.h.command(
        userCredential,
        envelope(
          "PauseAssignment",
          {
            assignment: ASG_OP,
            reason: { kind: "user", detail: "break", runs: [], target: null },
          },
          { revision: 1, state: "enabled" },
        ),
      ),
    );
    const newFirst = now + 5 * HOUR_MS;
    must(await applyOperator(f, { schedule: schedule(newFirst, 2 * HOUR_MS) }));
    const changed = await readAssignment(f);
    assertEquals(changed.state, "paused");
    assertEquals(changed.last_due_at, null);
    assertEquals(changed.schedule, schedule(newFirst, 2 * HOUR_MS));
    code(
      await processAssignment(f, noMiss(newFirst), {
        assignment_revision: changed.revision,
        previous_due_at: null,
      }),
      "forbidden",
    );

    // 사람이 재개해도 지난 회차를 되살리지 않는다. 새 첫 시점 전에는 처리할 것이 없다.
    must(
      await f.h.command(
        userCredential,
        envelope("ResumeAssignment", { assignment: ASG_OP }, {
          revision: changed.revision,
          state: "paused",
        }),
      ),
    );
    assertEquals(must(await clock.tick()).advanced, []);
    await goto(f, newFirst + 1);
    const started = must(await clock.tick()).advanced[0]!.occurrence;
    assertEquals(started.due_at, formatAt(newFirst));
    assertEquals(started.previous_due_at, null);
    assertEquals(started.missed_count, 0);
    // 앞 주기의 기록은 그대로 남는다.
    assertEquals((await occurrences(f)).occurrences.length, 2);
  } finally {
    await f.h.close();
  }
});
