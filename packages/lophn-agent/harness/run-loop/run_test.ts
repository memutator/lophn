import { assert, assertEquals } from "@std/assert";
import { createHash } from "node:crypto";
import { canonicalize, type Result } from "../../../base/mod.ts";
import type {
  AuthenticatedContext,
  SqlRow,
} from "../../../contracts/platform/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../../apps/core/testing/ledger.ts";
import {
  envelope as assignmentEnvelope,
  presetDefinitionJson,
} from "./testing/mod.ts";

// run ledger 테스트. 실제 등록 executor(harness)와 임시 ledger 파일을 쓴다.
// 재시작·kill 시험과 operator 회차는 apps/core/testing/lophn-agent-runs_test.ts에 있다.

const NOW = Date.UTC(2026, 0, 1);

const OPERATIONS = [
  "RegisterDefaultPreset",
  "CreateBuiltinAssignment",
  "PauseAssignment",
  "ResumeAssignment",
  "WithdrawAssignment",
  "AcceptRun",
  "StartRun",
  "CheckpointRun",
  "FinishRun",
  "StopRun",
  "ConfirmNextRun",
  "ReadRun",
  "ReadAssignment",
  "ListRuns",
  "ReadRunResult",
  "SeedSteeringFixture",
  "CommandResult",
];

const userCred: AuthenticatedContext = {
  actor: "user",
  principal: "user-1",
  credential_ref: "test:user-1:user",
  scope: { operations: OPERATIONS, targets: {} },
  conditions: {},
};

const machineCred: AuthenticatedContext = {
  actor: "machine",
  principal: "machine-1",
  credential_ref: "test:machine-1:machine",
  scope: { operations: OPERATIONS, targets: {} },
  conditions: {},
};

const ALPHA = "0123456789abcdefghjkmnpqrstvwxyz";
function id(prefix: string, n: number): string {
  return `${prefix}_01arz3ndektsv4rrffq69g5f${ALPHA[n >> 5]}${ALPHA[n & 31]}`;
}

const PRESET_LOPHN = id("pst", 1);
const PRESET_CE = id("pst", 2);
const ASG_LOPHN = id("asg", 1);
const ASG_CE = id("asg", 2);
const BASIS = "b".repeat(64);
const RESULT = "c".repeat(64);
const LIMITS = { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 };

function agentCred(assignment: string): AuthenticatedContext {
  return {
    actor: `agent:${assignment}`,
    principal: `agent:${assignment}`,
    credential_ref: `test:agent:${assignment}`,
    scope: { operations: OPERATIONS, targets: { assignment } },
    conditions: { assignment },
  };
}

function scopeOf(assignment: string, role: string) {
  return { role, assignment, apps: [] };
}

function hashOf(definition: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalize(definition), "utf8").digest(
    "hex",
  );
}

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function code(result: Result<unknown>, expected: string) {
  if (result.ok) {
    assert(false, "expected failure, got " + JSON.stringify(result.value));
  } else {
    assertEquals(result.error.code, expected);
  }
}

function rows(result: Result<SqlRow[]>): SqlRow[] {
  return value(result);
}

async function open(): Promise<LedgerHarness> {
  const opened = await createLedgerHarness({
    registrationModules: [new URL("./registration_test.ts", import.meta.url)],
    credentials: [userCred, machineCred, agentCred(ASG_LOPHN)],
    nowMs: NOW,
  });
  assert(opened.ok, opened.ok ? undefined : JSON.stringify(opened.error));
  return opened.value;
}

async function seed(h: LedgerHarness) {
  for (
    const [preset, kind, assignment] of [
      [PRESET_LOPHN, "lophn", ASG_LOPHN],
      [PRESET_CE, "context_engineer", ASG_CE],
    ] as const
  ) {
    const definition = presetDefinitionJson(kind);
    value(
      await h.command(
        machineCred,
        assignmentEnvelope("RegisterDefaultPreset", {
          id: preset,
          definition,
          definition_hash: hashOf(definition),
        }),
      ),
    );
    value(
      await h.command(
        machineCred,
        assignmentEnvelope("CreateBuiltinAssignment", {
          id: assignment,
          preset,
          preset_revision: 1,
          role: kind,
          scope: { kind: "all", id: null },
        }),
      ),
    );
  }
}

type Accept = {
  run: string;
  assignment?: string;
  message?: string;
  session?: string | null;
  source?: Record<string, unknown>;
  continued_from?: string | null;
  start_after?: string | null;
};

function accept(h: LedgerHarness, input: Accept, ctx = machineCred) {
  return h.command(
    ctx,
    assignmentEnvelope("AcceptRun", {
      id: input.run,
      assignment: input.assignment ?? ASG_LOPHN,
      session: input.session === undefined ? id("ses", 1) : input.session,
      source: input.source ?? { kind: "message", message: input.message },
      continued_from: input.continued_from ?? null,
      start_after: input.start_after ?? null,
    }, { assignment_revision: 1 }),
  );
}

async function stateSeq(h: LedgerHarness, run: string): Promise<string> {
  const read = value(
    await h.read({ resource: "runs", method: "read" }, userCred, { run }),
  ) as { run: { state_seq: string } };
  return read.run.state_seq;
}

async function start(h: LedgerHarness, run: string, assignment = ASG_LOPHN) {
  return h.command(
    machineCred,
    assignmentEnvelope("StartRun", {
      run,
      basis: BASIS,
      limits: LIMITS,
      scope: scopeOf(
        assignment,
        assignment === ASG_LOPHN ? "lophn" : "context_engineer",
      ),
    }, { state_seq: await stateSeq(h, run) }),
  );
}

async function finish(
  h: LedgerHarness,
  run: string,
  outcome: { kind: string; reason: string },
) {
  return h.command(
    machineCred,
    assignmentEnvelope("FinishRun", { run, outcome, result: RESULT }, {
      state_seq: await stateSeq(h, run),
    }),
  );
}

async function stop(
  h: LedgerHarness,
  run: string,
  key = "stop-1",
  ctx = userCred,
  reason = "user_stopped",
) {
  return h.command(
    ctx,
    assignmentEnvelope("StopRun", { run, request_key: key, reason }, {
      state_seq: await stateSeq(h, run),
    }),
  );
}

async function runOf(h: LedgerHarness, run: string) {
  return (value(
    await h.read({ resource: "runs", method: "read" }, userCred, { run }),
  ) as { run: Record<string, unknown> }).run;
}

async function runCount(h: LedgerHarness): Promise<bigint> {
  return rows(await h.inspect("select count(*) as n from runs", []))[0]![
    "n"
  ] as bigint;
}

const ok = { kind: "completed", reason: "answer_completed" };
const failed = { kind: "failed", reason: "model_error" };

Deno.test("lophn-agent/harness/run-loop#R1: only a person request, an operator round or a handoff makes a run, never data changes", async () => {
  const h = await open();
  try {
    await seed(h);
    // 자료·assignment 변경 event와 결과 도착만으로는 run이 없다.
    assertEquals(await runCount(h), 0n);
    // 사람 요청 하나.
    value(await accept(h, { run: id("run", 1), message: id("msg", 1) }));
    // 허용 계기가 아닌 출처는 입력 검사에서 거절된다.
    for (
      const source of [
        { kind: "document_changed", document: id("doc", 1) },
        { kind: "notification", notification: id("ntf", 1) },
        { kind: "result_arrived", run: id("run", 1) },
      ]
    ) {
      code(await accept(h, { run: id("run", 9), source }), "invalid_input");
    }
    // 사람(user)은 machine 접수를 흉내 낼 수 없다.
    code(
      await accept(h, { run: id("run", 9), message: id("msg", 9) }, userCred),
      "forbidden",
    );
    // 주기 회차는 operator만, session 없이 받는다.
    code(
      await accept(h, {
        run: id("run", 9),
        session: null,
        source: {
          kind: "schedule",
          assignment_revision: 1,
          scheduled_at: "2026-01-01T00:00:00.000Z",
        },
      }),
      "invalid_input",
    );
    // 원래 사람 요청에서 이어진 handoff 하나.
    const handoff = (run: string, original: string, key: string) =>
      accept(h, {
        run,
        assignment: ASG_CE,
        source: {
          kind: "handoff",
          sender_run: id("run", 1),
          original_message: original,
          body: "d".repeat(64),
          references: [],
          dedup_key: key,
        },
      });
    code(await handoff(id("run", 2), id("msg", 7), "k1"), "invalid_input");
    value(await handoff(id("run", 2), id("msg", 1), "k1"));
    // 같은 assignment 안 handoff는 거절이다.
    code(
      await accept(h, {
        run: id("run", 3),
        assignment: ASG_LOPHN,
        source: {
          kind: "handoff",
          sender_run: id("run", 1),
          original_message: id("msg", 1),
          body: "d".repeat(64),
          references: [],
          dedup_key: "k2",
        },
      }),
      "invalid_input",
    );
    // 받은 run에서 출처 네 가지가 보인다.
    const received = await runOf(h, id("run", 2));
    const source = received.source as Record<string, unknown>;
    assertEquals(source.sender_run, id("run", 1));
    assertEquals(source.original_message, id("msg", 1));
    assertEquals(source.body, "d".repeat(64));
    assertEquals(await runCount(h), 2n);
    // assignment 변경이나 결과 도착은 새 run을 만들지 않는다.
    value(
      await h.command(
        userCred,
        assignmentEnvelope("PauseAssignment", {
          assignment: ASG_CE,
          reason: { kind: "user", detail: "잠시", runs: [], target: null },
        }, { revision: 1, state: "enabled" }),
      ),
    );
    value(await start(h, id("run", 1)));
    value(await finish(h, id("run", 1), ok));
    assertEquals(await runCount(h), 2n);
    // paused assignment는 새 run을 받지 않는다.
    code(
      await accept(h, {
        run: id("run", 4),
        assignment: ASG_CE,
        message: id("msg", 4),
      }),
      "forbidden",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/run-loop#R2: acceptance is stored before the answer and a resent input returns the earlier result", async () => {
  const h = await open();
  try {
    await seed(h);
    const envelope = assignmentEnvelope("AcceptRun", {
      id: id("run", 1),
      assignment: ASG_LOPHN,
      session: id("ses", 1),
      source: { kind: "message", message: id("msg", 1) },
      continued_from: null,
      start_after: null,
    }, { assignment_revision: 1 });
    const first = value(await h.command(machineCred, envelope));
    // 답을 받은 시점에 이미 저장돼 있다.
    assertEquals(
      rows(
        await h.inspect("select state from runs where id = ?", [id("run", 1)]),
      )
        .length,
      1,
    );
    // 같은 transport key 재전송은 저장된 결과다.
    assertEquals(
      value(await h.command(machineCred, envelope)).result,
      first.result,
    );
    // 다른 key로 다시 와도 같은 요청은 같은 run 하나다.
    const again = value(
      await accept(h, { run: id("run", 1), message: id("msg", 1) }),
    ) as { output: { id: string } } | Record<string, unknown>;
    assert(JSON.stringify(again).includes(id("run", 1)));
    const otherId = value(
      await accept(h, { run: id("run", 2), message: id("msg", 1) }),
    );
    assert(JSON.stringify(otherId).includes(id("run", 1)));
    assertEquals(await runCount(h), 1n);
    // 같은 계기 key에 다른 내용은 conflict다.
    code(
      await accept(h, {
        run: id("run", 3),
        message: id("msg", 1),
        session: id("ses", 2),
      }),
      "conflict",
    );
    code(
      await accept(h, {
        run: id("run", 1),
        message: id("msg", 1),
        session: id("ses", 2),
      }),
      "conflict",
    );
    assertEquals(await runCount(h), 1n);
    // 접수 사실이 event로 남고 원문 위치와 순서(accepted_seq)가 보존된다.
    const record = await runOf(h, id("run", 1));
    assertEquals(record.state, "accepted");
    assertEquals(record.accepted_seq, record.state_seq);
    const events = rows(
      await h.inspect(
        "select payload from events where type = 'RunAccepted'",
        [],
      ),
    );
    assertEquals(events.length, 1);
    assertEquals(
      (JSON.parse(String(events[0]!["payload"])) as { accepted_seq: string })
        .accepted_seq,
      record.accepted_seq,
    );
    // assignment 판이 달라졌으면 접수하지 않는다.
    code(
      await h.command(
        machineCred,
        assignmentEnvelope("AcceptRun", {
          id: id("run", 5),
          assignment: ASG_LOPHN,
          session: null,
          source: { kind: "message", message: id("msg", 5) },
          continued_from: null,
          start_after: null,
        }, { assignment_revision: 2 }),
      ),
      "conflict",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/run-loop#R3 [agent-I40]: two sessions of one assignment run at once while a second run in the same session waits", async () => {
  const h = await open();
  try {
    await seed(h);
    const ses1 = id("ses", 1);
    const ses2 = id("ses", 2);
    value(
      await accept(h, {
        run: id("run", 1),
        message: id("msg", 1),
        session: ses1,
      }),
    );
    value(
      await accept(h, {
        run: id("run", 2),
        message: id("msg", 2),
        session: ses1,
      }),
    );
    value(
      await accept(h, {
        run: id("run", 3),
        message: id("msg", 3),
        session: ses2,
      }),
    );
    value(
      await accept(h, {
        run: id("run", 4),
        assignment: ASG_CE,
        message: id("msg", 4),
        session: id("ses", 3),
      }),
    );
    value(await start(h, id("run", 1)));
    // 같은 session의 둘째는 시작하지 못한다.
    code(await start(h, id("run", 2)), "conflict");
    // 같은 lophn assignment의 다른 session은 기다리지 않아 두 run이 함께 running이다.
    value(await start(h, id("run", 3)));
    assertEquals((await runOf(h, id("run", 1))).state, "running");
    assertEquals((await runOf(h, id("run", 3))).state, "running");
    // 무관한 assignment도 기다리지 않는다.
    value(await start(h, id("run", 4), ASG_CE));
    // 저장 계층의 partial unique도 session 단위로 같은 규칙을 지킨다.
    const probe = await h.probeWrite(
      "update runs set state = 'running', basis = ?, started_at = ?, limits = ? where id = ?",
      [BASIS, "2026-01-01T00:00:00.000Z", JSON.stringify(LIMITS), id("run", 2)],
    );
    assert(!probe.ok);
    // 끝난 session이 풀리면 그 session의 둘째가 시작한다. 다른 session은 영향이 없다.
    value(await finish(h, id("run", 1), ok));
    value(await start(h, id("run", 2)));
    assertEquals((await runOf(h, id("run", 3))).state, "running");
    // 진행 중인 run이 같은 assignment의 서로 다른 session임을 표에서도 확인한다.
    const live = rows(
      await h.inspect(
        "select session from runs where assignment = ? and state = 'running' order by session",
        [ASG_LOPHN],
      ),
    );
    assertEquals(live.map((row) => row["session"]), [ses1, ses2]);
    value(await finish(h, id("run", 2), ok));
    // scope가 다른 assignment·role이면 시작하지 못한다.
    value(
      await accept(h, {
        run: id("run", 5),
        message: id("msg", 5),
        session: ses1,
      }),
    );
    code(
      await h.command(
        machineCred,
        assignmentEnvelope("StartRun", {
          run: id("run", 5),
          basis: BASIS,
          limits: LIMITS,
          scope: scopeOf(ASG_CE, "context_engineer"),
        }, { state_seq: await stateSeq(h, id("run", 5)) }),
      ),
      "forbidden",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/run-loop#R3 [agent-I40]: runs without a session are held to one live run per assignment", async () => {
  const h = await open();
  try {
    await seed(h);
    // session 없는 run(handoff로 받은 일 등) 둘은 assignment 단위로 막힌다.
    value(
      await accept(h, {
        run: id("run", 1),
        message: id("msg", 1),
        session: null,
      }),
    );
    value(
      await accept(h, {
        run: id("run", 2),
        message: id("msg", 2),
        session: null,
      }),
    );
    value(
      await accept(h, {
        run: id("run", 3),
        assignment: ASG_CE,
        message: id("msg", 3),
        session: null,
      }),
    );
    value(await start(h, id("run", 1)));
    code(await start(h, id("run", 2)), "conflict");
    // 다른 assignment의 session 없는 run은 기다리지 않는다.
    value(await start(h, id("run", 3), ASG_CE));
    // 저장 계층의 partial unique도 같은 규칙을 지킨다.
    const probe = await h.probeWrite(
      "update runs set state = 'running', basis = ?, started_at = ?, limits = ? where id = ?",
      [BASIS, "2026-01-01T00:00:00.000Z", JSON.stringify(LIMITS), id("run", 2)],
    );
    assert(!probe.ok);
    value(await finish(h, id("run", 1), ok));
    value(await start(h, id("run", 2)));
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/run-loop#R5: a waiting accepted run keeps its place, ends only for a permanent reason and takes a stop", async () => {
  const h = await open();
  try {
    await seed(h);
    value(await accept(h, { run: id("run", 1), message: id("msg", 1) }));
    value(await accept(h, { run: id("run", 2), message: id("msg", 2) }));
    value(await accept(h, { run: id("run", 3), message: id("msg", 3) }));
    value(await start(h, id("run", 1)));
    // 10분을 넘겨 기다려도 둘째는 접수 상태로 남는다.
    value(
      await h.command(
        machineCred,
        assignmentEnvelope("CheckpointRun", {
          run: id("run", 1),
          elapsed: {
            active_ms: 11 * 60_000,
            stall_ms: 0,
            checkpoint_at: "2026-01-01T00:11:00.000Z",
          },
        }, { state_seq: await stateSeq(h, id("run", 1)) }),
      ),
    );
    assertEquals((await runOf(h, id("run", 2))).state, "accepted");
    // 접수 순서가 아닌 셋째는 먼저 시작하지 못한다.
    value(await finish(h, id("run", 1), ok));
    code(await start(h, id("run", 3)), "conflict");
    // 영구히 시작할 수 없으면 이유와 함께 끝나고 실제 시작 안 함이 남는다.
    code(
      await finish(h, id("run", 2), { kind: "failed", reason: "model_error" }),
      "invalid_input",
    );
    code(await finish(h, id("run", 2), ok), "invalid_input");
    value(
      await finish(h, id("run", 2), {
        kind: "failed",
        reason: "configuration_unavailable",
      }),
    );
    const ended = await runOf(h, id("run", 2));
    assertEquals(ended.outcome, {
      kind: "failed",
      reason: "configuration_unavailable",
    });
    assertEquals(ended.started_at, null);
    const finished = rows(
      await h.inspect(
        "select payload from events where type = 'RunFinished' and subject = ?",
        [id("run", 2)],
      ),
    );
    assertEquals(
      (JSON.parse(String(finished[0]!["payload"])) as { started: boolean })
        .started,
      false,
    );
    // 접수 상태에서도 사람 멈춤을 받는다.
    const stopped = value(await stop(h, id("run", 3))) as {
      output?: unknown;
    };
    assert(stopped !== undefined);
    const third = await runOf(h, id("run", 3));
    assertEquals(third.outcome, { kind: "stopped", reason: "user_stopped" });
    assertEquals(third.started_at, null);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/run-loop#R6: completed starts the next request, failed or stopped keeps it until a person confirms", async () => {
  const h = await open();
  try {
    await seed(h);
    // completed 뒤 다음 요청은 바로 시작한다.
    value(await accept(h, { run: id("run", 1), message: id("msg", 1) }));
    value(
      await accept(h, {
        run: id("run", 2),
        message: id("msg", 2),
        start_after: id("run", 1),
      }),
    );
    code(await start(h, id("run", 2)), "conflict");
    value(await start(h, id("run", 1)));
    code(await start(h, id("run", 2)), "conflict");
    value(await finish(h, id("run", 1), ok));
    value(await start(h, id("run", 2)));
    // failed 뒤: 보존되고 사람이 확인하기 전 시작하지 않는다.
    value(await finish(h, id("run", 2), failed));
    value(
      await accept(h, {
        run: id("run", 3),
        message: id("msg", 3),
        start_after: id("run", 2),
      }),
    );
    code(await start(h, id("run", 3)), "conflict");
    assertEquals((await runOf(h, id("run", 3))).state, "accepted");
    const confirm = async (
      run: string,
      predecessor: string,
      ctx = userCred,
      acceptedSeq?: string,
    ) =>
      h.command(
        ctx,
        assignmentEnvelope("ConfirmNextRun", { run, predecessor }, {
          accepted_seq: acceptedSeq ?? (await runOf(h, run)).accepted_seq,
          predecessor_state_seq: await stateSeq(h, predecessor),
        }),
      );
    // machine은 사람 확인을 대신할 수 없다.
    code(await confirm(id("run", 3), id("run", 2), machineCred), "forbidden");
    code(await confirm(id("run", 3), id("run", 1)), "invalid_input");
    code(await confirm(id("run", 3), id("run", 2), userCred, "1"), "conflict");
    const confirmed = value(
      await confirm(id("run", 3), id("run", 2)),
    ) as Record<
      string,
      unknown
    >;
    assert(JSON.stringify(confirmed).includes("start_confirmed_seq"));
    assertEquals(
      (await runOf(h, id("run", 3))).start_confirmed_seq !== null,
      true,
    );
    value(await start(h, id("run", 3)));
    // stopped 뒤도 같다.
    value(await stop(h, id("run", 3), "stop-a"));
    value(
      await accept(h, {
        run: id("run", 4),
        message: id("msg", 4),
        start_after: id("run", 3),
      }),
    );
    code(await start(h, id("run", 4)), "conflict");
    value(await confirm(id("run", 4), id("run", 3)));
    value(await start(h, id("run", 4)));
    // completed 선행에는 확인이 필요 없다.
    value(await finish(h, id("run", 4), ok));
    value(
      await accept(h, {
        run: id("run", 5),
        message: id("msg", 5),
        start_after: id("run", 4),
      }),
    );
    code(await confirm(id("run", 5), id("run", 4)), "conflict");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/run-loop#R14: a normal end needs no unapplied steering and later input gets a new run", async () => {
  const h = await open();
  try {
    await seed(h);
    value(await accept(h, { run: id("run", 1), message: id("msg", 1) }));
    value(await start(h, id("run", 1)));
    value(
      await h.command(
        machineCred,
        assignmentEnvelope("SeedSteeringFixture", {
          run: id("run", 1),
          applied: false,
        }),
      ),
    );
    // 미반영 steering이 있으면 정상 종료는 거절되고 run은 진행 중이다.
    code(await finish(h, id("run", 1), ok), "conflict");
    assertEquals((await runOf(h, id("run", 1))).state, "running");
    assertEquals(
      rows(
        await h.inspect(
          "select count(*) as n from events where type = 'RunFinished'",
          [],
        ),
      )[0]!["n"],
      0n,
    );
    // 실패 종료는 다음 일·steering이 막지 않는다.
    await h.probeWrite("update steering_inputs set applied = 1", []);
    value(
      await h.command(
        machineCred,
        assignmentEnvelope("SeedSteeringFixture", {
          run: id("run", 1),
          applied: true,
        }),
      ),
    );
    code(await finish(h, id("run", 1), ok), "conflict");
    value(await finish(h, id("run", 1), failed));
    // 종료 뒤 도착한 입력은 같은 assignment의 새 run으로 접수된다.
    value(await accept(h, { run: id("run", 2), message: id("msg", 2) }));
    // steering이 없으면 정상 종료가 확정된다. 다음 일 요청은 종료를 막지 않는다.
    value(await start(h, id("run", 2)));
    value(await accept(h, { run: id("run", 3), message: id("msg", 3) }));
    value(await finish(h, id("run", 2), ok));
    assertEquals((await runOf(h, id("run", 2))).outcome, ok);
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/run-loop#R16: a late result on a finished run changes nothing", async () => {
  const h = await open();
  try {
    await seed(h);
    value(await accept(h, { run: id("run", 1), message: id("msg", 1) }));
    value(await start(h, id("run", 1)));
    value(await stop(h, id("run", 1)));
    const before = await runOf(h, id("run", 1));
    // 1분 뒤 늦게 온 성공·진행·시작은 모두 거절된다.
    code(await finish(h, id("run", 1), ok), "conflict");
    code(
      await h.command(
        machineCred,
        assignmentEnvelope("CheckpointRun", {
          run: id("run", 1),
          elapsed: {
            active_ms: 90_000,
            stall_ms: 0,
            checkpoint_at: "2026-01-01T00:01:00.000Z",
          },
        }, { state_seq: before.state_seq }),
      ),
      "conflict",
    );
    code(await start(h, id("run", 1)), "conflict");
    assertEquals(await runOf(h, id("run", 1)), before);
    // 저장 계층도 끝난 행을 다시 열지 않는다.
    assert(
      !(await h.probeWrite(
        "update runs set state = 'running', finished_at = null, outcome_kind = null, outcome_reason = null, result = null where id = ?",
        [id("run", 1)],
      )).ok,
    );
    assertEquals(
      rows(
        await h.inspect(
          "select count(*) as n from events where type = 'RunFinished'",
          [],
        ),
      )[0]!["n"],
      1n,
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/run-loop#R17: a stopped run is never resumed and only an explicit new run carries on", async () => {
  const h = await open();
  try {
    await seed(h);
    value(await accept(h, { run: id("run", 1), message: id("msg", 1) }));
    value(await start(h, id("run", 1)));
    const stopped = value(await stop(h, id("run", 1), "stop-1")) as Record<
      string,
      unknown
    >;
    assert(JSON.stringify(stopped).includes('"replayed":false'));
    // 같은 멈춤 재전달은 기존 결과와 replayed다.
    const replay = value(await stop(h, id("run", 1), "stop-1"));
    assert(JSON.stringify(replay).includes('"replayed":true'));
    // 재시작·연결 회복·주기로 진행 중이 되는 run이 없다.
    const live = rows(
      await h.inspect(
        "select count(*) as n from runs where state in ('running', 'waiting_user')",
        [],
      ),
    );
    assertEquals(live[0]!["n"], 0n);
    // 사람이 명시로 다시 맡기면 이전 결과를 참조하는 새 run이다. 남은 입력은 확인 전 시작하지 않는다.
    value(
      await accept(h, {
        run: id("run", 2),
        message: id("msg", 2),
        continued_from: id("run", 1),
        start_after: id("run", 1),
      }),
    );
    code(await start(h, id("run", 2)), "conflict");
    const next = await runOf(h, id("run", 2));
    assertEquals(next.continued_from, id("run", 1));
    // machine의 멈춤은 assignment가 실제로 paused일 때만이다.
    code(
      await stop(h, id("run", 2), "stop-m", machineCred, "assignment_paused"),
      "forbidden",
    );
    value(
      await h.command(
        userCred,
        assignmentEnvelope("PauseAssignment", {
          assignment: ASG_LOPHN,
          reason: { kind: "user", detail: "잠시", runs: [], target: null },
        }, { revision: 1, state: "enabled" }),
      ),
    );
    value(
      await stop(h, id("run", 2), "stop-m", machineCred, "assignment_paused"),
    );
    assertEquals((await runOf(h, id("run", 2))).outcome, {
      kind: "stopped",
      reason: "assignment_paused",
    });
    // 사람은 user_stopped만 쓴다.
    code(
      await stop(h, id("run", 2), "stop-x", userCred, "assignment_paused"),
      "forbidden",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/run-loop#R18: outcome kinds, reasons and the started flag are settled once and the result read agrees", async () => {
  const h = await open();
  try {
    await seed(h);
    for (let n = 1; n <= 3; n++) {
      value(await accept(h, { run: id("run", n), message: id("msg", n) }));
    }
    // 같은 assignment는 하나씩이므로 하나씩 시작하고 끝낸다.
    value(await start(h, id("run", 1)));
    code(await start(h, id("run", 2)), "conflict");
    value(await finish(h, id("run", 1), ok));
    value(await start(h, id("run", 2)));
    value(await finish(h, id("run", 2), failed));
    value(await start(h, id("run", 3)));
    value(await stop(h, id("run", 3)));
    const result = async (run: string) =>
      value(
        await h.read({ resource: "runs", method: "result" }, userCred, { run }),
      ) as Record<string, unknown>;
    assertEquals((await result(id("run", 1))).outcome, ok);
    assertEquals((await result(id("run", 2))).outcome, failed);
    assertEquals((await result(id("run", 3))).outcome, {
      kind: "stopped",
      reason: "user_stopped",
    });
    assertEquals((await result(id("run", 1))).result, RESULT);
    assertEquals((await result(id("run", 3))).result !== null, true);
    // 확정 뒤 다른 결과로 덮이지 않는다.
    code(await finish(h, id("run", 1), failed), "conflict");
    code(await finish(h, id("run", 2), ok), "conflict");
    assertEquals((await result(id("run", 1))).outcome, ok);
    // 끝나지 않은 run은 결과와 outcome이 없다.
    value(await accept(h, { run: id("run", 4), message: id("msg", 4) }));
    const pending = await result(id("run", 4));
    assertEquals(pending.outcome, null);
    assertEquals(pending.result, null);
    // 각 RunFinished는 시작 여부와 이유를 한 번 담는다.
    const finished = rows(
      await h.inspect(
        "select subject, payload from events where type = 'RunFinished' order by seq",
        [],
      ),
    );
    assertEquals(finished.length, 3);
    for (const row of finished) {
      const payload = JSON.parse(String(row["payload"])) as {
        started: boolean;
        started_at: string | null;
        outcome: { kind: string };
      };
      assertEquals(payload.started, true);
      assert(payload.started_at !== null);
    }
    // 이미 저장한 변경은 되돌리지 않는다: 실패·멈춤 뒤에도 run 행만 확정된다.
    assertEquals((await runOf(h, id("run", 2))).state, "finished");
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/run-loop#R18 lophn-agent/assignments#R10: three started final failures from real FinishRun let the machine pause pass", async () => {
  const h = await open();
  try {
    await seed(h);
    const pause = async (runs: string[]) =>
      await h.command(
        machineCred,
        assignmentEnvelope("PauseAssignment", {
          assignment: ASG_LOPHN,
          reason: {
            kind: "consecutive_failures",
            detail: "최종 실패 3회",
            runs,
            target: null,
          },
        }, { revision: 1, state: "enabled" }),
      );
    // 시작한 최종 실패 두 번과 시작 못 한 실패 하나는 세 번이 아니다.
    for (const n of [1, 2]) {
      value(await accept(h, { run: id("run", n), message: id("msg", n) }));
      value(await start(h, id("run", n)));
      value(await finish(h, id("run", n), failed));
    }
    value(await accept(h, { run: id("run", 3), message: id("msg", 3) }));
    value(
      await finish(h, id("run", 3), {
        kind: "failed",
        reason: "target_unavailable",
      }),
    );
    code(await pause([id("run", 1), id("run", 2), id("run", 3)]), "forbidden");
    // 세 번째 시작한 최종 실패가 실제 command로 쌓이면 근거가 통과한다.
    value(await accept(h, { run: id("run", 4), message: id("msg", 4) }));
    value(await start(h, id("run", 4)));
    value(
      await finish(h, id("run", 4), { kind: "failed", reason: "tool_error" }),
    );
    // 근거로 신고한 run이 실제 묶음과 다르면 거절이다.
    code(await pause([id("run", 1), id("run", 2), id("run", 3)]), "forbidden");
    value(await pause([id("run", 1), id("run", 2), id("run", 4)]));
    const assignment = value(
      await h.read({ resource: "assignments", method: "read" }, userCred, {
        assignment: ASG_LOPHN,
      }),
    ) as { assignment: { state: string; pause_reason: { kind: string } } };
    assertEquals(assignment.assignment.state, "paused");
    assertEquals(
      assignment.assignment.pause_reason.kind,
      "consecutive_failures",
    );
  } finally {
    await h.close();
  }
});

Deno.test("lophn-agent/harness/run-loop#R3: reads list runs by assignment and state, and an agent sees only its own assignment", async () => {
  const h = await open();
  try {
    await seed(h);
    value(await accept(h, { run: id("run", 1), message: id("msg", 1) }));
    value(
      await accept(h, {
        run: id("run", 2),
        assignment: ASG_CE,
        message: id("msg", 2),
      }),
    );
    const list = async (input: Record<string, unknown>, ctx = userCred) =>
      (value(
        await h.read({ resource: "runs", method: "list" }, ctx, input),
      ) as { runs: { id: string }[] }).runs.map((run) => run.id);
    assertEquals(await list({}), [id("run", 1), id("run", 2)]);
    assertEquals(await list({ assignment: ASG_CE }), [id("run", 2)]);
    assertEquals(await list({ state: "running" }), []);
    // 다른 assignment의 run은 없는 run과 똑같이 답한다.
    const agent = agentCred(ASG_LOPHN);
    assertEquals(await list({}, agent), [id("run", 1)]);
    assertEquals(await list({ assignment: ASG_CE }, agent), []);
    const other = await h.read({ resource: "runs", method: "read" }, agent, {
      run: id("run", 2),
    });
    const absent = await h.read({ resource: "runs", method: "read" }, agent, {
      run: id("run", 77),
    });
    assert(!other.ok && !absent.ok);
    assertEquals(other.error, absent.error);
  } finally {
    await h.close();
  }
});
