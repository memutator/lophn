import { assert, assertEquals } from "@std/assert";
import { formatAt, manualClock } from "../../../base/mod.ts";
import type { RunRecord } from "../../../contracts/lophn-agent/mod.ts";
import type { EffectiveSetting } from "../../../contracts/platform/mod.ts";
import {
  callWithinLimits,
  effectiveRunLimits,
  type LimitReason,
  limitResult,
  type ModelPurpose,
  resolveRunLimits,
  RUN_LIMIT_SETTING_KEYS,
  RunLimiter,
} from "./limits.ts";
import { runStatus } from "./status.ts";
import {
  acceptRun,
  ASG_LOPHN,
  envelope,
  finishRunFixture,
  machineCredential,
  must,
  readRunRecord,
  RUN_NOW,
  runId,
  seedAssignments,
  seedRunLimits,
  startRunFixture,
} from "./testing/runs.ts";
import { openRunLedger } from "./testing/open_test.ts";

// run 한도·진행 판정·보이는 상태 테스트(lophn-agent/harness/run-loop#R19–R22).
// 시계는 fake(manualClock)이고 ledger는 실제 임시 파일이다. model은 호출 횟수만 세는
// 함수이며 실제 provider를 부르지 않는다.

const LIMITS = { model_attempts: 3, stall_ms: 1_000, active_ms: 5_000 };

function limiterAt(
  clock: ReturnType<typeof manualClock>,
  init: Partial<ConstructorParameters<typeof RunLimiter>[0]> = {},
) {
  return new RunLimiter({
    limits: LIMITS,
    elapsed: { active_ms: 0, stall_ms: 0, checkpoint_at: null },
    attempts: 0,
    nowMs: () => clock.nowMs(),
    ...init,
  });
}

function setting(
  key: string,
  value: unknown,
  resolved = true,
): EffectiveSetting {
  return {
    key,
    resolved,
    value: resolved ? value : null,
    source_layer: resolved ? "builtin" : null,
    choices: [],
    revision: 0,
    apply_at: "next_run",
  } as EffectiveSetting;
}

function settingsOf(values: Record<string, unknown>): EffectiveSetting[] {
  return Object.entries(RUN_LIMIT_SETTING_KEYS).map(([name, key]) =>
    setting(key, values[name])
  );
}

Deno.test("lophn-agent/harness/run-loop#R20: 한도는 양의 정수 설정에서만 오고 0·무제한·빈 값을 기본값으로 대신하지 않는다", () => {
  const good = resolveRunLimits(
    settingsOf({ model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 }),
  );
  assert(good.ok);
  assertEquals(good.value, {
    model_attempts: 30,
    stall_ms: 300_000,
    active_ms: 1_800_000,
  });
  const base = { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 };
  for (const name of Object.keys(base) as (keyof typeof base)[]) {
    for (
      const bad of [0, -1, 1.5, "30", null, Infinity, Number.NaN, undefined]
    ) {
      const resolved = resolveRunLimits(settingsOf({ ...base, [name]: bad }));
      assert(!resolved.ok, `${name}=${String(bad)}`);
      assertEquals(resolved.error.code, "invalid_input");
    }
  }
  // 적용값이 풀리지 않은 항목이 있으면 몰래 기본값을 쓰지 않고 거절한다.
  const unresolved = settingsOf(base);
  unresolved[1] = setting(RUN_LIMIT_SETTING_KEYS.stall_ms, null, false);
  const refused = resolveRunLimits(unresolved);
  assert(!refused.ok);
  assertEquals(refused.error.code, "unavailable");
  assert(!resolveRunLimits([]).ok);
});

Deno.test("lophn-agent/harness/run-loop#R20: 세 한도는 각각 경계에서 닿고 retry·재시작은 횟수와 시간을 되돌리지 않으며 사람 기다림은 시간에서 빠진다", () => {
  // model 시도 3회: 넷째 시도는 허용하지 않는다.
  const clock = manualClock(RUN_NOW);
  const attempts = limiterAt(clock);
  for (let n = 1; n <= 3; n++) {
    assertEquals(attempts.startAttempt("judgment"), {
      allowed: true,
      attempt: n,
    });
    attempts.endAttempt("complete");
  }
  assertEquals(attempts.startAttempt("judgment"), {
    allowed: false,
    limit: "model_attempt_limit",
  });
  assertEquals(attempts.attempts, 3);

  // 무진행 시간 1000ms: 경계 하나 전은 통과, 경계에서 닿는다.
  const stallClock = manualClock(RUN_NOW);
  const stall = limiterAt(stallClock);
  stallClock.advance(999);
  assertEquals(stall.check(), null);
  stallClock.advance(1);
  assertEquals(stall.check(), "stall_limit");

  // 전체 시간 5000ms: 진행이 계속돼도 active 한도에서 닿는다.
  const activeClock = manualClock(RUN_NOW);
  const active = limiterAt(activeClock);
  for (let i = 0; i < 4; i++) {
    activeClock.advance(900);
    active.toolResult();
    assertEquals(active.check(), null);
  }
  activeClock.advance(1_400);
  active.toolResult();
  assertEquals(active.check(), "active_limit");

  // 재시작: 마지막 checkpoint와 센 횟수에서 이어 센다. 0에서 다시 시작하지 않는다.
  const first = manualClock(RUN_NOW);
  const before = limiterAt(first);
  before.startAttempt("judgment");
  before.endAttempt("failed");
  first.advance(600);
  const saved = before.snapshot();
  assertEquals(saved, {
    active_ms: 600,
    stall_ms: 600,
    checkpoint_at: formatAt(RUN_NOW + 600),
  });
  const second = manualClock(RUN_NOW + 60_000);
  const after = limiterAt(second, { elapsed: saved, attempts: 1 });
  assertEquals(after.attempts, 1);
  assertEquals(after.snapshot().active_ms, 600);
  second.advance(399);
  assertEquals(after.check(), null);
  second.advance(1);
  assertEquals(after.check(), "stall_limit");
  // retry(같은 입력의 다시 시도)도 새 시도로 센다.
  assertEquals(
    limiterAt(manualClock(RUN_NOW), { attempts: 2 }).startAttempt("judgment"),
    { allowed: true, attempt: 3 },
  );

  // 사람의 답을 기다리는 동안은 active·stall 모두 늘지 않는다.
  const waitClock = manualClock(RUN_NOW);
  const waiting = limiterAt(waitClock);
  waitClock.advance(400);
  waiting.enterWait();
  assert(waiting.waiting);
  assertEquals(waiting.nextDeadlineMs(), null);
  waitClock.advance(3_600_000);
  assertEquals(waiting.check(), null);
  assertEquals(waiting.snapshot().active_ms, 400);
  assertEquals(waiting.snapshot().stall_ms, 400);
  waiting.leaveWait();
  waitClock.advance(500);
  assertEquals(waiting.check(), null);
  assertEquals(waiting.snapshot().active_ms, 900);
  waitClock.advance(100);
  assertEquals(waiting.check(), "stall_limit");
  // 기다림 중에 이어 시작한 limiter도 같다.
  const resumed = limiterAt(manualClock(RUN_NOW), { waiting: true });
  assert(resumed.waiting);
  // 진행 중인 호출을 끊을 timer는 가장 가까운 시간 한도까지의 남은 ms다.
  const timer = manualClock(RUN_NOW);
  const near = limiterAt(timer);
  timer.advance(250);
  assertEquals(near.nextDeadlineMs(), 750);
});

Deno.test("lophn-agent/harness/run-loop#R20: 한도는 시작할 때 run에 고정되어 설정을 바꿔도 이미 시작한 run은 그대로고 다음 run부터 새 값이다", async () => {
  const h = await openRunLedger();
  try {
    await seedAssignments(h);
    const older = {
      model_attempts: 30,
      stall_ms: 300_000,
      active_ms: 1_800_000,
    };
    must(
      await acceptRun(h, {
        run: runId("run", 1),
        source: { kind: "message", message: runId("msg", 1) },
      }),
    );
    must(await startRunFixture(h, runId("run", 1), ASG_LOPHN, older));
    // 사람이 설정을 바꿔 다음 run의 한도가 달라진다.
    const next = resolveRunLimits(
      settingsOf({ model_attempts: 12, stall_ms: 60_000, active_ms: 600_000 }),
    );
    assert(next.ok);
    // 시작한 run의 한도는 그대로이고 ledger가 바꾸지 못하게 막는다.
    const record = await readRunRecord(h, runId("run", 1));
    assertEquals(record["limits"], older);
    const probe = await h.probeWrite(
      "update runs set limits = ? where id = ?",
      [JSON.stringify(next.value), runId("run", 1)],
    );
    assert(!probe.ok);
    assertEquals(
      (await readRunRecord(h, runId("run", 1)))["limits"],
      older,
    );
    // run의 limiter는 run에 고정한 값으로 만든다.
    const clock = manualClock(RUN_NOW);
    const limiter = new RunLimiter({
      limits: record["limits"] as typeof older,
      elapsed: { active_ms: 0, stall_ms: 0, checkpoint_at: null },
      attempts: 0,
      nowMs: () => clock.nowMs(),
    });
    clock.advance(301_000);
    assertEquals(limiter.check(), "stall_limit");
    must(
      await finishRunFixture(h, runId("run", 1), {
        kind: "completed",
        reason: "answer_completed",
      }),
    );
    // 다음 run은 새 값으로 시작한다. 설정이 바뀌기 전의 값으로는 시작하지 못한다.
    await seedRunLimits(h, next.value);
    must(
      await acceptRun(h, {
        run: runId("run", 2),
        source: { kind: "message", message: runId("msg", 2) },
      }),
    );
    const stale = await startRunFixture(h, runId("run", 2), ASG_LOPHN, older);
    assert(!stale.ok);
    assertEquals(stale.error.code, "invalid_input");
    must(await startRunFixture(h, runId("run", 2), ASG_LOPHN, next.value));
    assertEquals(
      (await readRunRecord(h, runId("run", 2)))["limits"],
      next.value,
    );
    assertEquals(
      (await readRunRecord(h, runId("run", 1)))["limits"],
      older,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/run-loop#R21: 완전한 응답과 확정 tool 결과만 진행이고 실패 시도도 센다", () => {
  const clock = manualClock(RUN_NOW);
  const limiter = limiterAt(clock, {
    limits: { model_attempts: 10, stall_ms: 1_000, active_ms: 100_000 },
  });
  // 완전한 응답은 무진행 시간을 되돌린다.
  clock.advance(800);
  limiter.startAttempt("judgment");
  limiter.endAttempt("complete");
  assertEquals(limiter.snapshot().stall_ms, 0);
  assertEquals(limiter.snapshot().active_ms, 800);
  // 확정한 tool 결과도 되돌린다.
  clock.advance(900);
  assertEquals(limiter.snapshot().stall_ms, 900);
  limiter.toolResult();
  assertEquals(limiter.snapshot().stall_ms, 0);
  // 실패·부분·취소 시도는 무진행을 되돌리지 않고 횟수에는 센다.
  clock.advance(200);
  for (const end of ["failed", "partial", "cancelled"] as const) {
    assert(limiter.startAttempt("judgment").allowed);
    limiter.endAttempt(end);
  }
  assertEquals(limiter.attempts, 4);
  assertEquals(limiter.snapshot().stall_ms, 200);
  // 부분 token은 계속 와도 무진행 시간을 되돌리지 않는다. 5분 상당(여기서는 1000ms)에 닿는다.
  const slow = manualClock(RUN_NOW);
  const stream = limiterAt(slow);
  stream.startAttempt("judgment");
  for (let i = 0; i < 9; i++) {
    slow.advance(100);
    stream.partialToken();
    assertEquals(stream.check(), null, `partial ${i}`);
  }
  slow.advance(100);
  stream.partialToken();
  assertEquals(stream.check(), "stall_limit");
  assertEquals(stream.snapshot().stall_ms, 1_000);
  // 닿은 호출이 결국 실패해도 시도 수는 줄지 않는다.
  stream.endAttempt("failed");
  assertEquals(stream.attempts, 1);
});

type Trip = {
  limit: LimitReason;
  drive: (clock: ReturnType<typeof manualClock>, limiter: RunLimiter) => void;
};

const TRIPS: Trip[] = [
  {
    limit: "model_attempt_limit",
    drive(_clock, limiter) {
      for (let n = 0; n < LIMITS.model_attempts; n++) {
        limiter.startAttempt("judgment");
        limiter.endAttempt(n % 2 === 0 ? "complete" : "failed");
      }
    },
  },
  {
    limit: "stall_limit",
    drive(clock, limiter) {
      limiter.startAttempt("judgment");
      clock.advance(LIMITS.stall_ms);
      limiter.partialToken();
    },
  },
  {
    limit: "active_limit",
    drive(clock, limiter) {
      for (let i = 0; i < 5; i++) {
        clock.advance(LIMITS.active_ms / 5);
        limiter.toolResult();
      }
    },
  },
];

Deno.test("lophn-agent/harness/run-loop#R22: 세 한도 각각에서 judgment·organizing·마무리 model 호출은 0건이고 machine이 확정 사실로 결과를 낸다", async () => {
  const h = await openRunLedger();
  try {
    await seedAssignments(h);
    await seedRunLimits(h, LIMITS);
    let n = 0;
    for (const trip of TRIPS) {
      n++;
      const run = runId("run", n);
      must(
        await acceptRun(h, {
          run,
          source: { kind: "message", message: runId("msg", n) },
        }),
      );
      must(await startRunFixture(h, run, ASG_LOPHN, LIMITS));
      const clock = manualClock(RUN_NOW);
      const limiter = limiterAt(clock);
      trip.drive(clock, limiter);
      const used = limiter.attempts;
      // 한도 뒤에는 어떤 용도의 model도 부르지 않는다.
      let calls = 0;
      for (
        const purpose of [
          "judgment",
          "organizing",
          "finalizing",
          "judgment",
        ] as ModelPurpose[]
      ) {
        const guarded = await callWithinLimits(limiter, purpose, () => {
          calls++;
          return Promise.resolve("model text");
        });
        assertEquals(guarded, { called: false, limit: trip.limit });
      }
      assertEquals(calls, 0, trip.limit);
      assertEquals(limiter.attempts, used);
      // 확정 tool 결과가 뒤늦게 와도 한도를 풀지 못한다.
      limiter.toolResult();
      assertEquals(limiter.check(), trip.limit);
      assertEquals(limiter.startAttempt("finalizing"), {
        allowed: false,
        limit: trip.limit,
      });
      // machine 결과: 확정 사실만 있고 model 본문이 없다.
      const elapsed = limiter.snapshot();
      const result = limitResult({
        run,
        reason: trip.limit,
        elapsed,
        attempts: limiter.attempts,
        limits: LIMITS,
        confirmed: {
          changes: [],
          unexecuted: ["tool call not started"],
          unknown_effects: [],
          unapplied_inputs: [],
        },
      });
      assertEquals(result.outcome, { kind: "failed", reason: trip.limit });
      assert(!JSON.stringify(result.facts).includes("model text"));
      assertEquals(
        limitResult({
          run,
          reason: trip.limit,
          elapsed,
          attempts: limiter.attempts,
          limits: LIMITS,
          confirmed: {
            changes: [],
            unexecuted: ["tool call not started"],
            unknown_effects: [],
            unapplied_inputs: [],
          },
        }).result,
        result.result,
      );
      // 시간 경계는 CheckpointRun으로 남기고 결과는 FinishRun으로 한 번 확정한다.
      const before = await readRunRecord(h, run);
      must(
        await h.command(
          machineCredential,
          envelope("CheckpointRun", { run, elapsed }, {
            state_seq: before.state_seq,
          }),
        ),
      );
      must(await finishRunFixture(h, run, result.outcome, result.result));
      const done = await readRunRecord(h, run);
      assertEquals(done["outcome"], { kind: "failed", reason: trip.limit });
      assertEquals(done["result"], result.result);
      assertEquals(
        (done["elapsed"] as { active_ms: number }).active_ms,
        elapsed.active_ms,
      );
    }
  } finally {
    await h.close();
  }
});

const BASE_RUN = {
  id: runId("run", 1),
  assignment: ASG_LOPHN,
  session: null,
  source: { kind: "message", message: runId("msg", 1) },
  continued_from: null,
  start_after: null,
  start_confirmed_seq: null,
  state: "accepted",
  basis: null,
  waiting_on: null,
  started_at: null,
  limits: { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 },
  elapsed: { active_ms: 0, stall_ms: 0, checkpoint_at: null },
  finished_at: null,
  outcome: null,
  result: null,
  state_seq: "5",
  accepted_seq: "5",
} as unknown as RunRecord;

Deno.test("lophn-agent/harness/run-loop#R19: 접수됨·진행 중·내 답 기다림·끝남과 현재 행동 한 줄·경과 시간·멈추기만 보이고 근거 없는 진척은 만들지 않는다", async () => {
  const keys = ["action", "can_stop", "elapsed_ms", "phase"];
  const now = RUN_NOW + 90_000;
  // 접수됨: 시작 전이라 경과가 없다.
  const accepted = runStatus(BASE_RUN, { nowMs: now });
  assertEquals(Object.keys(accepted).sort(), keys);
  assertEquals(accepted, {
    phase: "accepted",
    action: "Waiting to start",
    elapsed_ms: null,
    can_stop: true,
  });
  // 진행 중: 마지막 checkpoint까지의 경과에 그 뒤 흐른 시간을 더한다.
  const running = {
    ...BASE_RUN,
    state: "running",
    basis: "b".repeat(64),
    started_at: formatAt(RUN_NOW),
    elapsed: {
      active_ms: 30_000,
      stall_ms: 0,
      checkpoint_at: formatAt(RUN_NOW + 30_000),
    },
  } as unknown as RunRecord;
  assertEquals(runStatus(running, { nowMs: now }), {
    phase: "running",
    action: "Working",
    elapsed_ms: 90_000,
    can_stop: true,
  });
  assertEquals(
    runStatus(running, {
      nowMs: now,
      activity: { kind: "tool", tool: "doc.read" },
    }).action,
    "Using doc.read",
  );
  assertEquals(
    runStatus(running, { nowMs: now, activity: { kind: "model_call" } })
      .action,
    "Thinking",
  );
  // 내 답 기다림: 경과는 사람 기다림 동안 늘지 않는다.
  const waiting = {
    ...running,
    state: "waiting_user",
    waiting_on: "qst_01arz3ndektsv4rrffq69g5fav",
  } as unknown as RunRecord;
  assertEquals(runStatus(waiting, { nowMs: now + 3_600_000 }), {
    phase: "waiting_for_you",
    action: "Waiting for your answer",
    elapsed_ms: 30_000,
    can_stop: true,
  });
  // 끝남: 더 멈출 것이 없다.
  const finished = {
    ...running,
    state: "finished",
    finished_at: formatAt(RUN_NOW + 40_000),
    outcome: { kind: "failed", reason: "stall_limit" },
    result: "c".repeat(64),
  } as unknown as RunRecord;
  const done = runStatus(finished, { nowMs: now });
  assertEquals(done.phase, "finished");
  assertEquals(done.can_stop, false);
  assertEquals(done.elapsed_ms, 30_000);
  // 어느 상태에서도 퍼센트·예상 종료·추론 원문·장식 문구가 없다.
  for (const record of [BASE_RUN, running, waiting, finished]) {
    for (const activity of [null, { kind: "model_call" }, { kind: "saving" }]) {
      const view = runStatus(record, {
        nowMs: now,
        activity: activity as never,
      });
      assertEquals(Object.keys(view).sort(), keys);
      assert(
        !/%|eta|remaining|percent|progress|almost|hang tight/i.test(
          JSON.stringify(view),
        ),
      );
    }
  }
  // 실제 ledger의 run read가 준 기록으로 같은 모양이 나온다.
  const h = await openRunLedger();
  try {
    await seedAssignments(h);
    must(
      await acceptRun(h, {
        run: runId("run", 1),
        source: { kind: "message", message: runId("msg", 1) },
      }),
    );
    const read = await readRunRecord(h, runId("run", 1));
    assertEquals(
      runStatus(read as unknown as RunRecord, { nowMs: RUN_NOW }).phase,
      "accepted",
    );
    must(await startRunFixture(h, runId("run", 1), ASG_LOPHN));
    const started = await readRunRecord(h, runId("run", 1));
    const view = runStatus(started as unknown as RunRecord, {
      nowMs: RUN_NOW,
    });
    assertEquals(view.phase, "running");
    assertEquals(view.can_stop, true);
    assertEquals(view.elapsed_ms, 0);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/run-loop#R20: machine이 보낸 부풀린 한도는 StartRun이 받지 않고 현재 설정의 한도만 고정된다", async () => {
  const h = await openRunLedger();
  try {
    await seedAssignments(h);
    must(
      await acceptRun(h, {
        run: runId("run", 1),
        source: { kind: "message", message: runId("msg", 1) },
      }),
    );
    const before = await readRunRecord(h, runId("run", 1));
    // 설정에 없는 큰 값·무제한처럼 큰 값·0·더 작은 값 모두 현재 설정과 다르면 거절이다.
    for (
      const sent of [
        { model_attempts: 1000, stall_ms: 300_000, active_ms: 1_800_000 },
        { model_attempts: 30, stall_ms: 300_000, active_ms: 86_400_000 },
        { model_attempts: 30, stall_ms: Number.MAX_SAFE_INTEGER, active_ms: 1 },
        { model_attempts: 0, stall_ms: 300_000, active_ms: 1_800_000 },
        { model_attempts: 29, stall_ms: 300_000, active_ms: 1_800_000 },
      ]
    ) {
      const refused = await startRunFixture(
        h,
        runId("run", 1),
        ASG_LOPHN,
        sent,
      );
      assert(!refused.ok, JSON.stringify(sent));
      assert(
        refused.error.code === "invalid_input",
        `${JSON.stringify(sent)} ${refused.error.code}`,
      );
    }
    // 거절은 run을 바꾸지 않는다. 한도가 박힌 적도 없다.
    const after = await readRunRecord(h, runId("run", 1));
    assertEquals(after["state"], "accepted");
    assertEquals(after["state_seq"], before["state_seq"]);
    assertEquals(after["basis"], null);
    // 현재 설정과 같은 값만 시작한다. 사람이 설정을 바꾸면 그 값이 기준이다.
    await seedRunLimits(h, {
      model_attempts: 7,
      stall_ms: 9_000,
      active_ms: 90_000,
    });
    const old = await startRunFixture(h, runId("run", 1), ASG_LOPHN);
    assert(!old.ok);
    must(
      await startRunFixture(h, runId("run", 1), ASG_LOPHN, {
        model_attempts: 7,
        stall_ms: 9_000,
        active_ms: 90_000,
      }),
    );
    assertEquals((await readRunRecord(h, runId("run", 1)))["limits"], {
      model_attempts: 7,
      stall_ms: 9_000,
      active_ms: 90_000,
    });
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/run-loop#R20: 저장 선택이 없으면 내장 기본값이고 저장값이 양의 정수가 아니면 기본값으로 대신하지 않는다", () => {
  const defaults = effectiveRunLimits([]);
  assert(defaults.ok);
  assertEquals(defaults.value, {
    model_attempts: 30,
    stall_ms: 300_000,
    active_ms: 1_800_000,
  });
  const partial = effectiveRunLimits([
    { key: RUN_LIMIT_SETTING_KEYS.stall_ms, value: 60_000 },
    { key: "other.key", value: 1 },
  ]);
  assert(partial.ok);
  assertEquals(partial.value.stall_ms, 60_000);
  assertEquals(partial.value.model_attempts, 30);
  for (const bad of [0, -5, 2.5, "9", null]) {
    const refused = effectiveRunLimits([
      { key: RUN_LIMIT_SETTING_KEYS.model_attempts, value: bad },
    ]);
    assert(!refused.ok, String(bad));
  }
});
