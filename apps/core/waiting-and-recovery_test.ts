// lophn-agent/harness/waiting-and-recovery: 실제 core(임시 LOPHN_HOME, 실제 ledger)에서 run이 사람의
// 답·허락을 기다리고 결정으로 재개하거나 끝나는 흐름을 본다. 질문과 approval은 core의 실제 command다
// (질문 lophn-agent/questions, approval platform/approvals). model은 부르지 않고(고정 call의 입력은
// 시험이 준다) 실제 provider와 사람 데이터 root는 열지 않는다. 판정표·보이는 기다림·retry 대기의 순수
// 규칙은 packages/lophn-agent/harness/waiting-and-recovery/waiting_test.ts가 본다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { answerQuestionAction } from "../../packages/protocol/lophn-agent/mod.ts";
import { settingsOptionAction } from "../../packages/core/lophn-agent/tools/questions/mod.ts";
import {
  actionOf,
  call,
  codeOf,
  command,
  createInput,
} from "./testing/approvals-fixture.ts";
import {
  approvalOf,
  type CallRequest,
  count,
  humanDecides,
  inspect,
  issueConfirmation,
  judgmentFor,
  MACHINE_TOKEN,
  openWaitingWorld,
  requestTool,
  resolverFor,
  type Seat,
  TARGET,
  type ToolBinding,
  USER_TOKEN,
  type WaitingWorld,
} from "./testing/waiting-world.ts";
import { binding, id, tool } from "./testing/tool-judgment-world.ts";

const NOTES =
  "select count(*) as n from events where type = 'OwnedNoteRecorded'";
const RESUMED = "select count(*) as n from events where type = 'RunResumed'";
const WAITED = "select count(*) as n from events where type = 'RunWaited'";
const RESOLUTIONS = "select count(*) as n from run_wait_resolutions";

function runRow(world: WaitingWorld, run: string) {
  return inspect(
    world.server,
    "select state, waiting_on, outcome_kind, outcome_reason from runs where id = ?",
    [run],
  )[0]!;
}

async function stateSeqOf(world: WaitingWorld, run: string): Promise<string> {
  const read = await world.read("runs/read", MACHINE_TOKEN, { run });
  assertEquals(read.status, 200, JSON.stringify(read.body));
  return (read.body["run"] as { state_seq: string }).state_seq;
}

let questionCounter = 0;

// 묶음 하나는 질문 하나를 담는다. 같은 번호의 질문 ID를 묶음 ID에서 얻는다.
function questionOf(group: string): string {
  return group.replace("qgr_", "qst_");
}

// 질문 묶음을 만들어 run을 기다리게 한다. 글은 값으로 싣는다(core가 blob으로 준비한다).
// over의 expires_at은 묶음의 기한이고 나머지는 묶음 안 질문의 값이다.
async function askQuestionWith(
  world: WaitingWorld,
  seat: Seat,
  group: string,
  over: Record<string, unknown> = {},
) {
  const { expires_at = null, ...asked } = over;
  return await world.post("runs/wait", MACHINE_TOKEN, {
    run: seat.run,
    request: {
      kind: "question",
      input: {
        id: group,
        run: seat.run,
        session: null,
        expires_at,
        questions: [{
          id: questionOf(group),
          prompt: "어느 쪽으로 정리할까요?",
          reason: "두 방향이 모두 가능해서 정해야 합니다",
          options: [],
          recommendation: null,
          ...asked,
        }],
      },
    },
    call: null,
  }, { state_seq: await stateSeqOf(world, seat.run) });
}

async function askQuestion(
  world: WaitingWorld,
  seat: Seat,
  over: Record<string, unknown> = {},
) {
  questionCounter += 1;
  const group = id("qgr", questionCounter);
  return {
    group,
    waited: await askQuestionWith(world, seat, group, over),
  };
}

async function createdSeq(world: WaitingWorld, group: string) {
  const read = await world.read("questions/read", MACHINE_TOKEN, { group });
  assertEquals(read.status, 200, JSON.stringify(read.body));
  return (read.body["group"] as { created_seq: string }).created_seq;
}

async function answer(world: WaitingWorld, group: string, text: string) {
  return await world.post("questions/answer", USER_TOKEN, {
    group,
    created_seq: await createdSeq(world, group),
    answers: [{
      question: questionOf(group),
      answer: { kind: "text", text },
    }],
  }, { created_seq: await createdSeq(world, group) });
}

function resolver(world: WaitingWorld, seat: Seat) {
  const judgment = judgmentFor(world, seat, []);
  return resolverFor(world, judgment, new Map());
}

Deno.test("lophn-agent/harness/waiting-and-recovery#R1: 질문을 기다리는 run은 사람이 답하기 전에는 재개하지 않고 답하면 같은 run이 재개된다", async () => {
  const world = await openWaitingWorld();
  try {
    const { group, waited } = await askQuestion(world, world.lophn);
    assertEquals(waited.status, 200, JSON.stringify(waited.body));
    const body = waited.body as {
      state: string;
      waiting_on: string;
      request: { kind: string };
    };
    assertEquals(body.state, "waiting_user");
    assertEquals(body.waiting_on, group);
    assertEquals(body.request.kind, "question");
    assertEquals(runRow(world, world.lophn.run)["state"], "waiting_user");
    assertEquals(runRow(world, world.lophn.run)["waiting_on"], group);
    assertEquals(count(world.server, WAITED), 1);

    // 질문 글은 값으로 실려 왔고 core가 blob으로 준비해 읽을 수 있다.
    const text = await world.read("questions/text", USER_TOKEN, { group });
    assertEquals(text.status, 200, JSON.stringify(text.body));
    assertEquals(
      (text.body["questions"] as { prompt: string }[])[0].prompt,
      "어느 쪽으로 정리할까요?",
    );

    const step = resolver(world, world.lophn);
    // 답이 없으면 추정 답으로 진행하지 않고 그대로 기다린다.
    const before = await step.settle(world.lophn.run);
    assert(before.ok);
    assertEquals(before.value, { kind: "pending", request: group });
    assertEquals(runRow(world, world.lophn.run)["state"], "waiting_user");
    assertEquals(count(world.server, RESUMED), 0);

    // 사람이 답하면 같은 run이 재개된다.
    const given = await answer(world, group, "첫 번째 방향으로 정리하세요");
    assertEquals(given.status, 200, JSON.stringify(given.body));
    const after = await step.settle(world.lophn.run);
    assert(after.ok, after.ok ? "" : JSON.stringify(after.error));
    assert(after.value.kind === "resolved");
    assertEquals(after.value.state, "running");
    assertEquals(after.value.resolution.result, "resumed");
    assertEquals(after.value.resolution.reason, "question_answered");
    const row = runRow(world, world.lophn.run);
    assertEquals(row["state"], "running");
    assertEquals(row["waiting_on"], null);
    assertEquals(count(world.server, RESUMED), 1);
    assertEquals(count(world.server, RESOLUTIONS), 1);
  } finally {
    await world.dispose();
  }
});

// 질문이 닫히는 방법마다 답 없음 이유의 stopped로 끝난다(R1). 미루기·취소는 사람이, 만료는 기한이 지난 뒤
// machine이 닫는다. 어느 것도 답이 아니므로 재개하지 않고 run은 같은 결과로 끝난다.
for (const way of ["defer", "cancel", "expire"] as const) {
  Deno.test(`lophn-agent/harness/waiting-and-recovery#R1: 질문 ${way}은 답이 아니라 답 없음 이유의 stopped로 끝낸다`, async () => {
    const world = await openWaitingWorld();
    try {
      const expiry = new Date(world.clock.nowMs() + 60_000).toISOString();
      const { group, waited } = await askQuestion(
        world,
        world.lophn,
        way === "expire" ? { expires_at: expiry } : {},
      );
      assertEquals(waited.status, 200, JSON.stringify(waited.body));
      const created = await createdSeq(world, group);
      const compare = { created_seq: created };
      let closed;
      if (way === "defer") {
        closed = await world.post("questions/defer", USER_TOKEN, {
          group,
          created_seq: created,
        }, compare);
      } else if (way === "cancel") {
        closed = await world.post("questions/cancel", USER_TOKEN, {
          group,
          created_seq: created,
          closed_reason: "cancelled",
          closed_reason_text: "더는 필요하지 않습니다",
        }, compare);
      } else {
        await world.advance(60_000);
        closed = await world.post("questions/expire", MACHINE_TOKEN, {
          group,
          created_seq: created,
        }, compare);
      }
      assertEquals(closed.status, 200, JSON.stringify(closed.body));
      const step = resolver(world, world.lophn);
      const done = await step.settle(world.lophn.run);
      assert(done.ok, done.ok ? "" : JSON.stringify(done.error));
      assert(done.value.kind === "resolved");
      assertEquals(done.value.state, "finished");
      assertEquals(done.value.resolution.result, "stopped_no_answer");
      const row = runRow(world, world.lophn.run);
      assertEquals(row["state"], "finished");
      assertEquals(row["outcome_kind"], "stopped");
      assertEquals(row["outcome_reason"], "no_answer");
      // 같은 run이 다시 열리지 않고 재개 event도 없다.
      assertEquals(count(world.server, RESUMED), 0);
      assertEquals(count(world.server, RESOLUTIONS), 1);
    } finally {
      await world.dispose();
    }
  });
}

// ---------------------------------------------------------------------------
// approval
// ---------------------------------------------------------------------------

const noteRecord = {
  definition: tool("note.record"),
  binding: binding([{ id: TARGET, reversibility: "irreversible" }]),
};

type Asked = {
  request: CallRequest;
  approval: string;
  waited: Awaited<ReturnType<WaitingWorld["post"]>>;
  judgment: ReturnType<typeof judgmentFor>;
};

let noteCounter = 0;

// 판정이 ask로 approval을 만들고(T22), 같은 정확한 동작을 WaitRun이 잇는다. 설명 글은 값으로 다시
// 싣는다: 저장된 글을 읽어 그대로 보낸다.
async function askApproval(
  world: WaitingWorld,
  seat: Seat,
  over: { binding?: ToolBinding } = {},
): Promise<Asked> {
  noteCounter += 1;
  const note = `note-${noteCounter}`;
  const judgment = judgmentFor(world, seat, [
    over.binding === undefined
      ? noteRecord
      : { definition: noteRecord.definition, binding: over.binding },
  ]);
  const request = await requestTool(
    world,
    seat,
    noteRecord.definition,
    { note },
  );
  const decided = await judgment.decide(request);
  assert(decided.ok, decided.ok ? "" : JSON.stringify(decided.error));
  assertEquals(decided.value.decision.decision, "ask");
  const approval = decided.value.decision.approval;
  assert(approval !== null);
  const stored = await approvalOf(world, approval);
  const text = await world.read("approvals/text", USER_TOKEN, { approval });
  assertEquals(text.status, 200, JSON.stringify(text.body));
  const waited = await world.post("runs/wait", MACHINE_TOKEN, {
    run: seat.run,
    request: {
      kind: "approval",
      tool_call: request.toolCall,
      input: {
        id: approval,
        requester: stored.requester,
        run: seat.run,
        reason: text.body["reason"],
        effect: {
          changes: text.body["changes"],
          external: text.body["external"],
          reversible: stored.effect.reversible,
          reversibility: text.body["reversibility"],
        },
        action: stored.action,
        expires_at: stored.expires_at,
      },
    },
    call: request.toolCall,
  }, { state_seq: await stateSeqOf(world, seat.run) });
  return {
    request: { ...request, stateSeq: "1" },
    approval,
    waited,
    judgment,
  };
}

function callRow(world: WaitingWorld, toolCall: string) {
  return inspect(
    world.server,
    "select state, started_at, outcome from tool_calls where id = ?",
    [toolCall],
  )[0]!;
}

function requestsOf(asked: Asked): ReadonlyMap<string, CallRequest> {
  return new Map([[asked.request.toolCall, asked.request]]);
}

Deno.test("lophn-agent/harness/waiting-and-recovery#R2 #R11: approval 허락은 재검사를 통과한 그 call 하나만 시작하고 같은 run이 재개되며 같은 결정은 한 번만 반영된다", async () => {
  const world = await openWaitingWorld();
  try {
    const asked = await askApproval(world, world.lophn);
    assertEquals(asked.waited.status, 200, JSON.stringify(asked.waited.body));
    assertEquals(runRow(world, world.lophn.run)["state"], "waiting_user");
    assertEquals(runRow(world, world.lophn.run)["waiting_on"], asked.approval);
    const step = resolverFor(world, asked.judgment, requestsOf(asked));
    // 사람이 정하기 전에는 시작하지 않는다.
    const early = await step.settle(world.lophn.run);
    assert(early.ok);
    assertEquals(early.value, { kind: "pending", request: asked.approval });
    assertEquals(callRow(world, asked.request.toolCall)["state"], "requested");

    await humanDecides(world, asked.approval, "grant");
    // 허락은 시작이 아니다: 재검사를 거친 뒤에야 call이 시작된다.
    assertEquals(callRow(world, asked.request.toolCall)["state"], "requested");
    const done = await step.settle(world.lophn.run);
    assert(done.ok, done.ok ? "" : JSON.stringify(done.error));
    assert(done.value.kind === "resolved");
    assertEquals(done.value.state, "running");
    assertEquals(done.value.resolution.result, "call_started");
    assertEquals(done.value.resolution.reason, "approval_allowed");
    assertEquals(done.value.resolution.tool_call, asked.request.toolCall);
    assertEquals(callRow(world, asked.request.toolCall)["state"], "started");
    assertEquals(runRow(world, world.lophn.run)["state"], "running");
    // 결정 접수와 적용은 다르다: 아직 소유 변경이 없다.
    assertEquals(count(world.server, NOTES), 0);

    // 같은 허락은 그 call 하나에 한 번만 쓰인다.
    const admission = { kind: "enter" as const, approval: asked.approval };
    const applied = await asked.judgment.apply(asked.request, admission);
    assert(applied.ok, applied.ok ? "" : JSON.stringify(applied.error));
    const again = await asked.judgment.apply(asked.request, admission);
    assert(again.ok);
    assertEquals(again.value.use, applied.value.use);
    assertEquals(count(world.server, NOTES), 1);

    // 같은 결정을 다시 전달해도(event 재전달) 새 시작이나 재개가 없고 처음 결과가 돌아온다.
    const replayed = await step.settle(world.lophn.run);
    assert(replayed.ok);
    assertEquals(replayed.value, { kind: "idle" });
    const decisionSeq = String(
      inspect(
        world.server,
        "select closed_seq as s from approval_requests where id = ?",
        [asked.approval],
      )[0]!["s"],
    );
    const direct = await world.post("runs/resolve-wait", MACHINE_TOKEN, {
      run: world.lophn.run,
      request: asked.approval,
      decision_seq: decisionSeq,
    }, {
      state_seq: await stateSeqOf(world, world.lophn.run),
      waiting_on: asked.approval,
    });
    assertEquals(direct.status, 200, JSON.stringify(direct.body));
    assertEquals(
      (direct.body["resolution"] as { result: string }).result,
      "call_started",
    );
    assertEquals(count(world.server, RESUMED), 1);
    assertEquals(count(world.server, RESOLUTIONS), 1);
    assertEquals(count(world.server, NOTES), 1);
  } finally {
    await world.dispose();
  }
});

function outcomeOf(world: WaitingWorld, toolCall: string) {
  return JSON.parse(String(callRow(world, toolCall)["outcome"])) as {
    kind: string;
    code: string;
  };
}

function useCount(world: WaitingWorld): number {
  return count(world.server, "select count(*) as n from approval_uses");
}

// 거절·만료·취소는 모두 고정 call을 미실행으로 남기고 같은 run이 새 판단으로 이어진다. 실패로 세지
// 않으므로 run은 running이고 끝난 결과가 없다(R2, R3).
for (const way of ["reject", "expire", "cancel"] as const) {
  Deno.test(`lophn-agent/harness/waiting-and-recovery#R2 #R3: approval ${way}은 call을 미실행으로 남기고 같은 run이 새 판단으로 이어지며 실패로 세지 않는다`, async () => {
    const world = await openWaitingWorld();
    try {
      const asked = await askApproval(world, world.lophn);
      assertEquals(asked.waited.status, 200, JSON.stringify(asked.waited.body));
      const stored = await approvalOf(world, asked.approval);
      if (way === "reject") {
        await humanDecides(
          world,
          asked.approval,
          "reject",
          "허락하지 않습니다",
        );
      } else if (way === "cancel") {
        const cancelled = await world.post("approvals/cancel", USER_TOKEN, {
          approval: asked.approval,
          created_seq: stored.created_seq,
          closed_reason: null,
        }, { created_seq: stored.created_seq });
        assertEquals(cancelled.status, 200, JSON.stringify(cancelled.body));
      } else {
        await world.advance(600_001);
        await world.core.sweepApprovalExpiry();
      }
      assertEquals(
        (await approvalOf(world, asked.approval)).status,
        way === "reject"
          ? "rejected"
          : way === "cancel"
          ? "cancelled"
          : "expired",
      );
      const step = resolverFor(world, asked.judgment, requestsOf(asked));
      const done = await step.settle(world.lophn.run);
      assert(done.ok, done.ok ? "" : JSON.stringify(done.error));
      assert(done.value.kind === "resolved");
      assertEquals(done.value.state, "running");
      assertEquals(done.value.resolution.result, "call_not_executed");
      assertEquals(done.value.resolution.reason, "human_decision");
      // 미실행이다: 시작도 소유 변경도 approval 사용도 없다.
      const row = callRow(world, asked.request.toolCall);
      assertEquals(row["state"], "finished");
      assertEquals(row["started_at"], null);
      assertEquals(outcomeOf(world, asked.request.toolCall), {
        kind: "not_executed",
        code: "human_decision",
      });
      assertEquals(count(world.server, NOTES), 0);
      assertEquals(useCount(world), 0);
      // 같은 run의 새 판단으로 이어진다. 끝난 결과나 실패가 없다.
      const run = runRow(world, world.lophn.run);
      assertEquals(run["state"], "running");
      assertEquals(run["outcome_kind"], null);
    } finally {
      await world.dispose();
    }
  });
}

Deno.test("lophn-agent/harness/waiting-and-recovery#R2: 허락 뒤 재검사에서 기준이 달라졌으면 허락을 쓰지 않고 미실행으로 남긴 뒤 같은 run이 새 판단으로 이어진다", async () => {
  const world = await openWaitingWorld();
  try {
    const asked = await askApproval(world, world.lophn);
    assertEquals(asked.waited.status, 200, JSON.stringify(asked.waited.body));
    await humanDecides(world, asked.approval, "grant");
    // 허락 뒤 소유 계약의 비교 기준이 바뀌었다: 같은 입력이어도 낡은 허락이다.
    const changed = judgmentFor(world, world.lophn, [{
      definition: noteRecord.definition,
      binding: binding([{ id: TARGET, reversibility: "irreversible" }], {
        comparison: { basis: "moved" },
      }),
    }]);
    const step = resolverFor(world, changed, requestsOf(asked));
    const done = await step.settle(world.lophn.run);
    assert(done.ok, done.ok ? "" : JSON.stringify(done.error));
    assert(done.value.kind === "resolved");
    assertEquals(done.value.state, "running");
    assertEquals(done.value.resolution.result, "call_not_executed");
    assertEquals(done.value.resolution.reason, "recheck_failed");
    assertEquals(callRow(world, asked.request.toolCall)["started_at"], null);
    assertEquals(count(world.server, NOTES), 0);
    // 쓰지 않은 허락은 남아 있지만 그 call로는 이미 닫혔다.
    assertEquals(useCount(world), 0);
    assertEquals(runRow(world, world.lophn.run)["state"], "running");
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R11: 결정 전달 직후 중단돼 event를 잃어도 재시작이 현재 결정을 조회해 한 번만 반영하고 미시작을 확인하지 못한 approval은 쓰지 않는다", async () => {
  const world = await openWaitingWorld();
  try {
    const asked = await askApproval(world, world.lophn);
    assertEquals(asked.waited.status, 200, JSON.stringify(asked.waited.body));
    await humanDecides(world, asked.approval, "grant");
    // 고정 call의 입력을 모르면 재검사를 할 수 없으므로 허락을 쓰지 않는다.
    const blind = resolverFor(world, asked.judgment, new Map());
    const held = await blind.recover();
    assert(held.ok, held.ok ? "" : JSON.stringify(held.error));
    assertEquals(held.value.length, 1);
    assertEquals(held.value[0]!.step.kind, "unverified");
    assertEquals(callRow(world, asked.request.toolCall)["state"], "requested");
    assertEquals(runRow(world, world.lophn.run)["state"], "waiting_user");
    assertEquals(useCount(world), 0);

    // 새 프로세스(재시작)의 해소기는 event 없이 ledger의 현재 결정으로 이어 간다.
    const restarted = resolverFor(world, asked.judgment, requestsOf(asked));
    const first = await restarted.recover();
    assert(first.ok, first.ok ? "" : JSON.stringify(first.error));
    assertEquals(first.value.length, 1);
    assert(first.value[0]!.step.kind === "resolved");
    assertEquals(first.value[0]!.step.resolution.result, "call_started");
    // 한 번 더 재시작해도 기다리는 run이 없고 시작도 반영도 늘지 않는다.
    const second = await restarted.recover();
    assert(second.ok);
    assertEquals(second.value, []);
    assertEquals(count(world.server, RESUMED), 1);
    assertEquals(count(world.server, RESOLUTIONS), 1);
    const startedCalls = count(
      world.server,
      "select count(*) as n from events where type = 'ToolCallStarted'",
    );
    assertEquals(startedCalls, 1);
    // 같은 승인으로 두 번 시작·적용되지 않는다.
    const admission = { kind: "enter" as const, approval: asked.approval };
    assert((await asked.judgment.apply(asked.request, admission)).ok);
    assert((await asked.judgment.apply(asked.request, admission)).ok);
    assertEquals(count(world.server, NOTES), 1);
  } finally {
    await world.dispose();
  }
});

// ---------------------------------------------------------------------------
// 대기 중 입력: 일반 메시지·수정·멈춤
// ---------------------------------------------------------------------------

let messageCounter = 100;

// 사람이 세션에 메시지를 보낸다. 수정(correction)은 기다리는 run을 가리킨다.
async function send(
  world: WaitingWorld,
  seat: Seat,
  mode: "request" | "correction",
  text: string,
) {
  messageCounter += 1;
  const message = id("msg", messageCounter);
  const state = await world.read("sessions/read", USER_TOKEN, {
    session: seat.session,
  });
  assertEquals(state.status, 200, JSON.stringify(state.body));
  const sent = await world.post("messages/receive", USER_TOKEN, {
    id: message,
    session: seat.session,
    content: { schema_version: 1, parts: [{ kind: "text", text }] },
    mode,
    ...(mode === "correction" ? { run: seat.run } : {}),
  }, {
    session_state: "open",
    session_state_seq:
      (state.body["session"] as { state_seq: string }).state_seq,
    assignment_revision: seat.assignment.revision,
    assignment_state: "enabled",
  });
  assertEquals(sent.status, 200, JSON.stringify(sent.body));
  return message;
}

function messageRow(world: WaitingWorld, message: string) {
  return inspect(
    world.server,
    "select run, mode, applied_at_call from messages where id = ?",
    [message],
  )[0]!;
}

Deno.test("lophn-agent/harness/waiting-and-recovery#R4: 대기 중 일반 메시지는 답이 아니고 기다림을 풀지 않으며 새 일은 다음 접수로 보존된다", async () => {
  const world = await openWaitingWorld();
  try {
    const { group, waited } = await askQuestion(world, world.lophn);
    assertEquals(waited.status, 200, JSON.stringify(waited.body));
    const message = await send(world, world.lophn, "request", "그냥 다른 말");
    // 새 요청은 다른 담당 run에 접수되지만 이 run의 질문은 그대로 답을 기다린다.
    const other = String(messageRow(world, message)["run"]);
    assertNotEquals(other, world.lophn.run);
    assertEquals(runRow(world, other)["state"], "accepted");
    const step = resolver(world, world.lophn);
    const waiting = await step.settle(world.lophn.run);
    assert(waiting.ok);
    assertEquals(waiting.value, { kind: "pending", request: group });
    assertEquals(runRow(world, world.lophn.run)["state"], "waiting_user");
    assertEquals(
      inspect(world.server, "select status from question_groups where id = ?", [
        group,
      ])[0]!["status"],
      "pending",
    );
    // 진행 중인 run이 있는 동안 다음 run은 시작하지 못한다(assignment당 진행 하나).
    const start = await world.post("runs/start", MACHINE_TOKEN, {
      run: other,
      basis: "b".repeat(64),
      limits: { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 },
      scope: {
        role: world.lophn.assignment.role,
        assignment: world.lophn.assignment.id,
        apps: [],
      },
    }, { state_seq: await stateSeqOf(world, other) });
    assertEquals(codeOf(start), "conflict");
    assertEquals(count(world.server, RESUMED), 0);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R4: 명시 수정이 옛 질문을 취소하면 답 없음으로 끝나고 수정 입력은 새 담당 run에 보존된다", async () => {
  const world = await openWaitingWorld();
  try {
    const { group, waited } = await askQuestion(world, world.lophn);
    assertEquals(waited.status, 200, JSON.stringify(waited.body));
    const correction = await send(
      world,
      world.lophn,
      "correction",
      "그 질문은 필요 없고 이렇게 하세요",
    );
    assertEquals(messageRow(world, correction)["run"], world.lophn.run);
    // 옛 요청을 먼저 취소하지 않고는 수정으로 기다림을 풀지 못한다.
    const early = await world.post("runs/correct-waiting", MACHINE_TOKEN, {
      run: world.lophn.run,
      message: correction,
      request: group,
    }, {
      state_seq: await stateSeqOf(world, world.lophn.run),
      waiting_on: group,
    });
    assertEquals(codeOf(early), "conflict");
    assertEquals(runRow(world, world.lophn.run)["state"], "waiting_user");

    const step = resolver(world, world.lophn);
    const corrected = await step.correct(world.lophn.run, correction);
    assert(corrected.ok, corrected.ok ? "" : JSON.stringify(corrected.error));
    assertEquals(corrected.value, { kind: "corrected", state: "finished" });
    const old = runRow(world, world.lophn.run);
    assertEquals(old["state"], "finished");
    assertEquals(old["outcome_kind"], "stopped");
    assertEquals(old["outcome_reason"], "no_answer");
    const asked = inspect(
      world.server,
      "select status, closed_reason from question_groups where id = ?",
      [group],
    )[0]!;
    assertEquals(asked["status"], "cancelled");
    assertEquals(asked["closed_reason"], "superseded");
    // 수정은 같은 transaction에서 새 담당 run으로 옮겨졌고 아직 반영되지 않았다.
    const kept = messageRow(world, correction);
    const next = String(kept["run"]);
    assertNotEquals(next, world.lophn.run);
    assertEquals(kept["applied_at_call"], null);
    const fresh = inspect(
      world.server,
      "select state, source_message, start_after from runs where id = ?",
      [next],
    )[0]!;
    assertEquals(fresh["state"], "accepted");
    assertEquals(fresh["source_message"], correction);
    assertEquals(fresh["start_after"], world.lophn.run);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R4: 명시 수정이 옛 approval을 취소하면 call은 미실행으로 남고 같은 run이 수정과 함께 새 판단으로 이어진다", async () => {
  const world = await openWaitingWorld();
  try {
    const asked = await askApproval(world, world.lophn);
    assertEquals(asked.waited.status, 200, JSON.stringify(asked.waited.body));
    const correction = await send(
      world,
      world.lophn,
      "correction",
      "그 기록은 하지 말고 다른 방식으로 하세요",
    );
    const step = resolverFor(world, asked.judgment, requestsOf(asked));
    const corrected = await step.correct(world.lophn.run, correction);
    assert(corrected.ok, corrected.ok ? "" : JSON.stringify(corrected.error));
    assertEquals(corrected.value, { kind: "corrected", state: "running" });
    assertEquals((await approvalOf(world, asked.approval)).status, "cancelled");
    const row = callRow(world, asked.request.toolCall);
    assertEquals(row["state"], "finished");
    assertEquals(row["started_at"], null);
    assertEquals(outcomeOf(world, asked.request.toolCall), {
      kind: "not_executed",
      code: "superseded",
    });
    assertEquals(count(world.server, NOTES), 0);
    assertEquals(useCount(world), 0);
    // 같은 run이 새 판단으로 이어지고 수정은 그 run에 남아 다음 model call에 반영된다.
    assertEquals(runRow(world, world.lophn.run)["state"], "running");
    assertEquals(messageRow(world, correction)["run"], world.lophn.run);
    assertEquals(messageRow(world, correction)["applied_at_call"], null);
    assertEquals(
      inspect(
        world.server,
        "select reason from run_wait_resolutions where request = ?",
        [asked.approval],
      )[0]!["reason"],
      "superseded",
    );
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R4: 사람이 이미 답한 질문은 수정이 덮지 않고 그 답을 먼저 반영한다", async () => {
  const world = await openWaitingWorld();
  try {
    const { group } = await askQuestion(world, world.lophn);
    const given = await answer(world, group, "이 방향으로 하세요");
    assertEquals(given.status, 200, JSON.stringify(given.body));
    const correction = await send(
      world,
      world.lophn,
      "correction",
      "아니 잠깐",
    );
    const step = resolver(world, world.lophn);
    const result = await step.correct(world.lophn.run, correction);
    assert(result.ok, result.ok ? "" : JSON.stringify(result.error));
    assert(result.value.kind === "resolved");
    assertEquals(result.value.resolution.result, "resumed");
    assertEquals(runRow(world, world.lophn.run)["state"], "running");
    // 수정은 같은 run에 남아 다음 판단에 반영된다.
    assertEquals(messageRow(world, correction)["run"], world.lophn.run);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R4: 기다리는 run은 다시 기다리지 않고 기다릴 수 없는 run과 machine이 아닌 호출은 거절한다", async () => {
  const world = await openWaitingWorld();
  try {
    const first = await askQuestion(world, world.lophn);
    assertEquals(first.waited.status, 200, JSON.stringify(first.waited.body));
    // 이미 기다리는 run은 두 번째 요청을 받지 않는다.
    const second = await askQuestion(world, world.lophn);
    assertEquals(codeOf(second.waited), "conflict");
    assertEquals(count(world.server, WAITED), 1);
    assertEquals(count(world.server, "select count(*) as n from questions"), 1);
    // 사람 자격은 기다림을 연결하지 못한다.
    const asUser = await world.post("runs/wait", USER_TOKEN, {
      run: world.editor.run,
      request: {
        kind: "question",
        input: {
          id: id("qgr", 90),
          run: world.editor.run,
          session: null,
          expires_at: null,
          questions: [{
            id: id("qst", 90),
            prompt: "p",
            reason: "r",
            options: [],
            recommendation: null,
          }],
        },
      },
      call: null,
    }, { state_seq: await stateSeqOf(world, world.editor.run) });
    assertNotEquals(asUser.status, 200);
    assertEquals(runRow(world, world.editor.run)["state"], "running");
    // 기다리지 않는 run의 결정 반영은 대상이 없다.
    const none = await world.post("runs/resolve-wait", MACHINE_TOKEN, {
      run: world.editor.run,
      request: first.group,
      decision_seq: "1",
    }, {
      state_seq: await stateSeqOf(world, world.editor.run),
      waiting_on: first.group,
    });
    assertEquals(codeOf(none), "not_found");
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R4 #R5: 기다리는 중 멈추면 늦은 결정은 새 동작에 쓰이지 않고 접수와 미적용이 구별된다", async () => {
  const world = await openWaitingWorld();
  try {
    const asked = await askApproval(world, world.lophn);
    assertEquals(asked.waited.status, 200, JSON.stringify(asked.waited.body));
    const { group, waited } = await askQuestion(world, world.editor);
    assertEquals(waited.status, 200, JSON.stringify(waited.body));
    for (const seat of [world.lophn, world.editor]) {
      const stopped = await world.post("runs/stop", USER_TOKEN, {
        run: seat.run,
        request_key: `stop-${seat.run}`,
        reason: "user_stopped",
      }, { state_seq: await stateSeqOf(world, seat.run) });
      assertEquals(stopped.status, 200, JSON.stringify(stopped.body));
      assertEquals(runRow(world, seat.run)["state"], "finished");
    }
    // 끝난 run의 질문은 답을 받지 않는다.
    const late = await answer(world, group, "늦은 답");
    assertEquals(codeOf(late), "conflict");
    // approval 허락은 접수되지만 끝난 run에는 새 동작이 없다.
    await humanDecides(world, asked.approval, "grant");
    const step = resolverFor(world, asked.judgment, requestsOf(asked));
    const idle = await step.settle(world.lophn.run);
    assert(idle.ok);
    assertEquals(idle.value, { kind: "idle" });
    const decisionSeq = String(
      inspect(
        world.server,
        "select closed_seq as s from approval_requests where id = ?",
        [asked.approval],
      )[0]!["s"],
    );
    const ignored = await world.post("runs/resolve-wait", MACHINE_TOKEN, {
      run: world.lophn.run,
      request: asked.approval,
      decision_seq: decisionSeq,
    }, {
      state_seq: await stateSeqOf(world, world.lophn.run),
      waiting_on: asked.approval,
    });
    assertEquals(ignored.status, 200, JSON.stringify(ignored.body));
    assertEquals(ignored.body["state"], "finished");
    assertEquals(
      (ignored.body["resolution"] as { result: string }).result,
      "ignored_finished",
    );
    assertEquals(
      ignored.body["outcome"] as { kind: string; reason: string },
      { kind: "stopped", reason: "user_stopped" },
    );
    // call은 시작되지 않았고 소유 변경도 approval 사용도 없다.
    assertEquals(callRow(world, asked.request.toolCall)["state"], "requested");
    assertEquals(count(world.server, NOTES), 0);
    assertEquals(useCount(world), 0);
    assertEquals(count(world.server, RESUMED), 0);
    // 같은 늦은 결정을 다시 보내도 처음 접수 결과다.
    const again = await world.post("runs/resolve-wait", MACHINE_TOKEN, {
      run: world.lophn.run,
      request: asked.approval,
      decision_seq: decisionSeq,
    }, {
      state_seq: await stateSeqOf(world, world.lophn.run),
      waiting_on: asked.approval,
    });
    assertEquals(again.status, 200, JSON.stringify(again.body));
    assertEquals(count(world.server, RESOLUTIONS), 1);
  } finally {
    await world.dispose();
  }
});

// ---------------------------------------------------------------------------
// WaitRun이 approval을 만든다(글은 값으로 싣고 core가 redaction·blob 준비)
// ---------------------------------------------------------------------------

const SECRET = "ghp_abcdefghijklmnopqrstuvwxyz0123";

Deno.test("lophn-agent/harness/waiting-and-recovery#R2: WaitRun이 approval 요청 생성과 대기 연결을 한 번에 확정하고 설명 글은 값으로 실려 core가 redaction을 거쳐 준비한다", async () => {
  const world = await openWaitingWorld();
  try {
    const seat = world.lophn;
    const request = await requestTool(
      world,
      seat,
      noteRecord.definition,
      { note: "created-by-wait" },
    );
    const approval = world.ids.newId("apr");
    // 판정이 먼저 이 approval을 가리키는 ask를 남기고, 같은 id로 WaitRun이 요청을 만든다.
    const decided = await world.post("tool-calls/decide", MACHINE_TOKEN, {
      tool_call: request.toolCall,
      decision: {
        decision: "ask",
        reason: "needs a person",
        effect: "irreversible",
        assignment_revision: seat.assignment.revision,
        agent_hash: "ab".repeat(32),
        contract_revision: "1",
        comparison_basis: { basis: "current" },
        approval,
        session_grant: null,
      },
    }, { state_seq: "0" });
    assertEquals(decided.status, 200, JSON.stringify(decided.body));
    const action = await actionOf({
      command: "record_owned_note",
      caller: `agent:${seat.assignment.id}`,
      targets: [TARGET],
      value: { note: "created-by-wait" },
      comparison: { basis: "current" },
    });
    const body = createInput(approval, `agent:${seat.assignment.id}`, action, {
      run: seat.run,
      expiresAt: new Date(world.clock.nowMs() + 600_000).toISOString(),
      reason: `기록을 남겨야 합니다. 토큰 ${SECRET}`,
    });
    const compare = { state_seq: await stateSeqOf(world, seat.run) };
    // 다른 자격의 요청을 대신 만들지 못한다.
    const forged = await world.post("runs/wait", MACHINE_TOKEN, {
      run: seat.run,
      request: {
        kind: "approval",
        tool_call: request.toolCall,
        input: { ...body, requester: "user" },
      },
      call: request.toolCall,
    }, compare);
    assertNotEquals(forged.status, 200, JSON.stringify(forged.body));
    assertEquals(runRow(world, seat.run)["state"], "running");
    assertEquals(
      count(world.server, "select count(*) as n from approval_requests"),
      0,
    );

    const waited = await world.post("runs/wait", MACHINE_TOKEN, {
      run: seat.run,
      request: { kind: "approval", tool_call: request.toolCall, input: body },
      call: request.toolCall,
    }, compare);
    assertEquals(waited.status, 200, JSON.stringify(waited.body));
    assertEquals(waited.body["waiting_on"], approval);
    assertEquals(runRow(world, seat.run)["state"], "waiting_user");
    assertEquals(runRow(world, seat.run)["waiting_on"], approval);
    assertEquals(
      count(world.server, "select count(*) as n from approval_requests"),
      1,
    );
    // 글은 값으로 실려 왔고 secret은 준비 전에 가려졌다. 응답과 저장은 blob hash만 가진다.
    const text = await world.read("approvals/text", USER_TOKEN, { approval });
    assertEquals(text.status, 200, JSON.stringify(text.body));
    const reason = String(text.body["reason"]);
    assert(reason.startsWith("기록을 남겨야 합니다."));
    assert(!reason.includes(SECRET));
    assert(!JSON.stringify(waited.body).includes(SECRET));
    assertEquals(text.body["changes"], "노트 하나를 남긴다");

    // 사람이 거절하면 그 call은 미실행이고 같은 run이 이어진다.
    await humanDecides(world, approval, "reject");
    const step = resolverFor(
      world,
      judgmentFor(world, seat, [noteRecord]),
      new Map(),
    );
    const done = await step.settle(seat.run);
    assert(done.ok, done.ok ? "" : JSON.stringify(done.error));
    assert(done.value.kind === "resolved");
    assertEquals(done.value.resolution.result, "call_not_executed");
    assertEquals(done.value.resolution.reason, "human_decision");
    assertEquals(runRow(world, seat.run)["state"], "running");
    assertEquals(count(world.server, NOTES), 0);
  } finally {
    await world.dispose();
  }
});

// ---------------------------------------------------------------------------
// 결정 접수와 적용, 재시작
// ---------------------------------------------------------------------------

function settingsAction(question: string) {
  return settingsOptionAction({
    question,
    changes: [{
      layer: "common",
      key: "shell.reading_width",
      action: "set",
      value: "wide",
    }],
    revision: 0,
    defaults_revision: "defaults-1",
  });
}

function option(key: string, action: unknown = null) {
  return {
    key,
    label: `Option ${key}`,
    description: `Description of ${key}`,
    evidence: [],
    adoption: null,
    action,
  };
}

Deno.test("lophn-agent/harness/waiting-and-recovery#R5: 고정 action이 있는 선택지의 답은 접수돼도 적용을 확인하기 전에는 재개하지 않는다", async () => {
  const world = await openWaitingWorld();
  try {
    questionCounter += 1;
    const group = id("qgr", questionCounter);
    const question = questionOf(group);
    const waited = await askQuestionWith(world, world.lophn, group, {
      options: [option("plain"), option("apply", settingsAction(question))],
    });
    assertEquals(waited.status, 200, JSON.stringify(waited.body));
    const created = await createdSeq(world, group);
    const input = {
      group,
      created_seq: created,
      answer: { kind: "option", option_key: "apply" },
      binding_hash: settingsAction(question).binding_hash,
      evidence: { question, option: "apply" },
    };
    const reply = await call(
      world.server,
      "questions/answer-action",
      USER_TOKEN,
      command(input, {
        compare: { created_seq: created },
        confirmation: await issueConfirmation(
          world,
          answerQuestionAction,
          input,
        ),
      }),
    );
    assertEquals(reply.status, 200, JSON.stringify(reply.body));
    // 답은 접수됐다(질문은 answered). 그러나 action은 적용되지 않았다.
    const read = await world.read("questions/read", MACHINE_TOKEN, { group });
    const record = read.body["group"] as {
      status: string;
      questions: { applied: boolean }[];
    };
    assertEquals(record.status, "answered");
    assertEquals(record.questions[0].applied, false);
    // 적용 전에 결정을 반영하라고 해도 재개하지 않는다.
    const decisionSeq = String(
      inspect(
        world.server,
        "select closed_seq as s from question_groups where id = ?",
        [group],
      )[0]!["s"],
    );
    const early = await world.post("runs/resolve-wait", MACHINE_TOKEN, {
      run: world.lophn.run,
      request: group,
      decision_seq: decisionSeq,
    }, {
      state_seq: await stateSeqOf(world, world.lophn.run),
      waiting_on: group,
    });
    assertEquals(early.status, 409, JSON.stringify(early.body));
    // 해소기는 적용을 시도하지만 설정 판이 질문을 만든 때와 달라져(기준 불일치) 적용하지 못한다.
    // 답은 보존되고 이유가 남으며 재개하지 않는다(questions#R14).
    const step = resolver(world, world.lophn);
    const held = await step.settle(world.lophn.run);
    assert(held.ok, held.ok ? "" : JSON.stringify(held.error));
    assert(held.value.kind === "action_pending");
    assertEquals(held.value.request, group);
    assert(held.value.why !== undefined && held.value.why.length > 0);
    assertEquals(runRow(world, world.lophn.run)["state"], "waiting_user");
    assertEquals(count(world.server, RESUMED), 0);
    assertEquals(count(world.server, RESOLUTIONS), 0);
    const kept = await world.read("questions/read", MACHINE_TOKEN, { group });
    assertEquals(
      (kept.body["group"] as { status: string }).status,
      "answered",
    );
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R11: 답을 저장한 직후 중단돼도 재시작이 현재 결정을 조회해 같은 run을 한 번만 재개한다", async () => {
  const world = await openWaitingWorld();
  try {
    const { group } = await askQuestion(world, world.lophn);
    const given = await answer(world, group, "이 방향으로 하세요");
    assertEquals(given.status, 200, JSON.stringify(given.body));
    // 결정 전달(event)을 처리하기 전에 죽었다. 재시작한 해소기가 ledger를 직접 읽는다.
    const restarted = resolver(world, world.lophn);
    const first = await restarted.recover();
    assert(first.ok, first.ok ? "" : JSON.stringify(first.error));
    assertEquals(first.value.length, 1);
    assert(first.value[0]!.step.kind === "resolved");
    assertEquals(first.value[0]!.step.resolution.result, "resumed");
    // 다시 재시작해도, 같은 결정을 직접 다시 반영해도 재개는 한 번이다.
    const second = await restarted.recover();
    assert(second.ok);
    assertEquals(second.value, []);
    const decisionSeq = String(
      inspect(
        world.server,
        "select closed_seq as s from question_groups where id = ?",
        [group],
      )[0]!["s"],
    );
    const again = await world.post("runs/resolve-wait", MACHINE_TOKEN, {
      run: world.lophn.run,
      request: group,
      decision_seq: decisionSeq,
    }, {
      state_seq: await stateSeqOf(world, world.lophn.run),
      waiting_on: group,
    });
    assertEquals(again.status, 200, JSON.stringify(again.body));
    assertEquals(
      (again.body["resolution"] as { result: string }).result,
      "resumed",
    );
    assertEquals(count(world.server, RESUMED), 1);
    assertEquals(count(world.server, RESOLUTIONS), 1);
    assertEquals(runRow(world, world.lophn.run)["state"], "running");
  } finally {
    await world.dispose();
  }
});

// ---------------------------------------------------------------------------
// option action 적용(lophn-agent/questions#R13–R16): 답 저장 → 적용 → ResolveRunWait
// ---------------------------------------------------------------------------

const APPLIED = "select count(*) as n from question_evidence";
const SETTINGS_CHANGED =
  "select count(*) as n from events where type = 'SettingsChanged'";

async function readingWidth(world: WaitingWorld) {
  const read = await world.read("settings/get", USER_TOKEN, {
    keys: ["shell.reading_width"],
  });
  assertEquals(read.status, 200, JSON.stringify(read.body));
  return read.body as {
    revision: number;
    defaults_revision: string;
    settings: { value: unknown }[];
  };
}

// 설정 판을 실제로 읽은 기준으로 고정한 선택지를 만들어 질문을 하고 사람이 그 선택지를 고른다.
async function askAndChoose(
  world: WaitingWorld,
  seat: Seat,
  value: string,
  stale = false,
) {
  const basis = await readingWidth(world);
  questionCounter += 1;
  const group = id("qgr", questionCounter);
  const question = questionOf(group);
  const action = settingsOptionAction({
    question,
    changes: [{
      layer: "common",
      key: "shell.reading_width",
      action: "set",
      value,
    }],
    revision: stale ? basis.revision + 5 : basis.revision,
    defaults_revision: basis.defaults_revision,
  });
  const waited = await askQuestionWith(world, seat, group, {
    prompt: `Which reading width? (${question})`,
    options: [option("plain"), option("apply", action)],
    recommendation: { option_key: "apply", explanation: "It reads better." },
  });
  assertEquals(waited.status, 200, JSON.stringify(waited.body));
  const created = await createdSeq(world, group);
  const input = {
    group,
    created_seq: created,
    answer: { kind: "option", option_key: "apply" },
    binding_hash: action.binding_hash,
    evidence: { question, option: "apply" },
  };
  const reply = await call(
    world.server,
    "questions/answer-action",
    USER_TOKEN,
    command(input, {
      compare: { created_seq: created },
      confirmation: await issueConfirmation(world, answerQuestionAction, input),
    }),
  );
  assertEquals(reply.status, 200, JSON.stringify(reply.body));
  return { group, question, action };
}

function applyBody(
  question: string,
  action: unknown,
  answeredSeq: string,
  option = "apply",
) {
  return {
    question,
    answered_seq: answeredSeq,
    option_key: option,
    action,
    evidence: { question, option },
  };
}

function answeredSeqOf(world: WaitingWorld, question: string): string {
  return String(
    inspect(
      world.server,
      `select g.closed_seq as s from questions q
       join question_groups g on g.id = q."group" where q.id = ?`,
      [question],
    )[0]!["s"],
  );
}

Deno.test("lophn-agent/questions#R13: 선택 전에는 적용이 없고 고른 뒤 고정한 설정 변경만 한 번 적용되며 재개도 한 번이다", async () => {
  const world = await openWaitingWorld();
  try {
    const before = await readingWidth(world);
    const { group } = await askAndChoose(world, world.lophn, "wide");
    // 답을 접수했을 뿐 변경은 없다.
    assertEquals((await readingWidth(world)).revision, before.revision);
    assertEquals(count(world.server, SETTINGS_CHANGED), 0);
    assertEquals(count(world.server, APPLIED), 0);
    const step = resolver(world, world.lophn);
    const done = await step.settle(world.lophn.run);
    assert(done.ok, done.ok ? "" : JSON.stringify(done.error));
    assert(done.value.kind === "resolved");
    assertEquals(done.value.resolution.result, "resumed");
    const after = await readingWidth(world);
    assertEquals(after.settings[0]!.value, "wide");
    assertEquals(after.revision, before.revision + 1);
    assertEquals(count(world.server, SETTINGS_CHANGED), 1);
    assertEquals(count(world.server, APPLIED), 1);
    assertEquals(count(world.server, RESUMED), 1);
    // 적용은 질문 읽기에 적용 결과로 드러나고 사람의 답과 구별된다.
    const read = await world.read("questions/read", MACHINE_TOKEN, { group });
    assertEquals(
      (read.body["group"] as { questions: { applied: boolean }[] })
        .questions[0].applied,
      true,
    );
    // 근거를 검증한 적용은 사람 결정이라 actor=user, run=null로 남는다(identity R14).
    const events = inspect(
      world.server,
      "select actor, run from events where type = 'SettingsChanged'",
    );
    assertEquals(events[0]!["actor"], "user");
    assertEquals(events[0]!["run"], null);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/questions#R13: 답 저장 직후와 적용 직후에 죽어도 설정은 한 번만 바뀌고 run은 한 번만 재개한다", async () => {
  const world = await openWaitingWorld();
  try {
    const before = await readingWidth(world);
    // (1) 답을 저장한 직후 죽었다. 재시작한 해소기가 현재 사실에서 적용하고 재개한다.
    const first = await askAndChoose(world, world.lophn, "wide");
    const restarted = resolver(world, world.lophn);
    const recovered = await restarted.recover();
    assert(recovered.ok, recovered.ok ? "" : JSON.stringify(recovered.error));
    assertEquals(recovered.value.length, 1);
    assert(recovered.value[0]!.step.kind === "resolved");
    assertEquals(count(world.server, APPLIED), 1);
    assertEquals(count(world.server, SETTINGS_CHANGED), 1);
    assertEquals(count(world.server, RESUMED), 1);
    // 다시 재시작해도 더 하지 않는다.
    const again = await resolver(world, world.lophn).recover();
    assert(again.ok);
    assertEquals(again.value, []);
    assertEquals(count(world.server, SETTINGS_CHANGED), 1);
    // (2) 적용은 끝났고 ResolveRunWait 전에 죽었다. 적용을 다시 하지 않고 결정만 반영한다.
    const second = await askAndChoose(world, world.lophn, "narrow");
    const applied = await world.post(
      "questions/apply-option",
      MACHINE_TOKEN,
      applyBody(
        second.question,
        second.action,
        answeredSeqOf(world, second.question),
      ),
    );
    assertEquals(applied.status, 200, JSON.stringify(applied.body));
    assertEquals((applied.body as { applied: boolean }).applied, true);
    assertEquals(count(world.server, SETTINGS_CHANGED), 2);
    const settled = await resolver(world, world.lophn).recover();
    assert(settled.ok, settled.ok ? "" : JSON.stringify(settled.error));
    assertEquals(settled.value.length, 1);
    assert(settled.value[0]!.step.kind === "resolved");
    assertEquals(count(world.server, SETTINGS_CHANGED), 2);
    assertEquals(count(world.server, APPLIED), 2);
    assertEquals(count(world.server, RESUMED), 2);
    assertEquals((await readingWidth(world)).settings[0]!.value, "narrow");
    assertEquals(
      (await readingWidth(world)).revision,
      before.revision + 2,
    );
    // 같은 선택지의 두 번째 적용은 conflict이고 아무것도 더하지 않는다.
    const twice = await world.post(
      "questions/apply-option",
      MACHINE_TOKEN,
      applyBody(
        first.question,
        first.action,
        answeredSeqOf(world, first.question),
      ),
    );
    assertEquals(twice.status, 409, JSON.stringify(twice.body));
    assertEquals(count(world.server, SETTINGS_CHANGED), 2);
    assertEquals(count(world.server, APPLIED), 2);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/questions#R14: 질문 뒤 설정이 바뀌면 답은 남고 적용은 일어나지 않으며 달라진 대상과 이유를 알리고 재개하지 않는다", async () => {
  const world = await openWaitingWorld();
  try {
    const { group, question, action } = await askAndChoose(
      world,
      world.lophn,
      "wide",
      true,
    );
    const before = await readingWidth(world);
    const held = await resolver(world, world.lophn).settle(world.lophn.run);
    assert(held.ok, held.ok ? "" : JSON.stringify(held.error));
    assert(held.value.kind === "action_pending");
    assert(held.value.why !== undefined);
    // 적용 시도는 transaction 통째로 되돌아가 변경도 일회 기록도 없다.
    assertEquals((await readingWidth(world)).revision, before.revision);
    assertEquals(count(world.server, SETTINGS_CHANGED), 0);
    assertEquals(count(world.server, APPLIED), 0);
    assertEquals(count(world.server, RESUMED), 0);
    assertEquals(runRow(world, world.lophn.run)["state"], "waiting_user");
    // 답은 그대로이고 적용 안 됨으로 읽힌다.
    const read = await world.read("questions/read", MACHINE_TOKEN, { group });
    const record = read.body["group"] as {
      status: string;
      questions: { applied: boolean; answer: { option_key: string } }[];
    };
    assertEquals(record.status, "answered");
    assertEquals(record.questions[0].answer.option_key, "apply");
    assertEquals(record.questions[0].applied, false);
    // 직접 적용해도 같다: 달라진 대상(질문 ID)과 이유를 오류가 알린다.
    const direct = await world.post(
      "questions/apply-option",
      MACHINE_TOKEN,
      applyBody(question, action, answeredSeqOf(world, question)),
    );
    assertEquals(direct.status, 409, JSON.stringify(direct.body));
    const details = (direct.body["error"] as {
      details?: { targets: string[]; reason: string };
    }).details;
    assertEquals(details?.targets, [question]);
    assert((details?.reason ?? "").length > 0);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/questions#R15: 자유 답·다른 선택지·바뀐 action·사람 자격으로는 적용하지 않는다", async () => {
  const world = await openWaitingWorld();
  try {
    const before = await readingWidth(world);
    // 자유 답으로 끝난 질문은 적용할 command가 없다.
    const basis = await readingWidth(world);
    questionCounter += 1;
    const freeGroup = id("qgr", questionCounter);
    const free = questionOf(freeGroup);
    const action = settingsOptionAction({
      question: free,
      changes: [{
        layer: "common",
        key: "shell.reading_width",
        action: "set",
        value: "wide",
      }],
      revision: basis.revision,
      defaults_revision: basis.defaults_revision,
    });
    const waited = await askQuestionWith(world, world.lophn, freeGroup, {
      options: [option("apply", action)],
    });
    assertEquals(waited.status, 200, JSON.stringify(waited.body));
    const given = await answer(
      world,
      freeGroup,
      "그 설정을 wide로 바꿔 주세요",
    );
    assertEquals(given.status, 200, JSON.stringify(given.body));
    const seq = answeredSeqOf(world, free);
    const refused = await world.post(
      "questions/apply-option",
      MACHINE_TOKEN,
      applyBody(free, action, seq),
    );
    assertEquals(refused.status, 403, JSON.stringify(refused.body));
    // 사람 자격은 적용 command를 부를 수 없다.
    const person = await world.post(
      "questions/apply-option",
      USER_TOKEN,
      applyBody(free, action, seq),
    );
    assertEquals(person.status, 403, JSON.stringify(person.body));
    assertEquals((await readingWidth(world)).revision, before.revision);
    assertEquals(count(world.server, SETTINGS_CHANGED), 0);
    assertEquals(count(world.server, APPLIED), 0);
    // 선택한 답이어도 고정한 action과 다른 내용은 적용하지 않는다.
    const chosen = await askAndChoose(world, world.editor, "wide");
    const tampered = settingsOptionAction({
      question: chosen.question,
      changes: [{
        layer: "common",
        key: "shell.reading_width",
        action: "set",
        value: "narrow",
      }],
      revision: basis.revision,
      defaults_revision: basis.defaults_revision,
    });
    const other = await world.post(
      "questions/apply-option",
      MACHINE_TOKEN,
      applyBody(
        chosen.question,
        tampered,
        answeredSeqOf(world, chosen.question),
      ),
    );
    assertEquals(other.status, 403, JSON.stringify(other.body));
    // 고르지 않은 선택지 key로도 적용하지 않는다.
    const wrongKey = await world.post(
      "questions/apply-option",
      MACHINE_TOKEN,
      applyBody(
        chosen.question,
        chosen.action,
        answeredSeqOf(world, chosen.question),
        "plain",
      ),
    );
    assertEquals(wrongKey.status, 403, JSON.stringify(wrongKey.body));
    assertEquals(count(world.server, SETTINGS_CHANGED), 0);
    assertEquals(count(world.server, APPLIED), 0);
  } finally {
    await world.dispose();
  }
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R1: tool이 먼저 만든 질문 묶음을 읽어 같은 내용으로 WaitRun하면 새 묶음 없이 그 묶음을 대기에 잇는다", async () => {
  const world = await openWaitingWorld();
  try {
    const seat = world.lophn;
    const group = id("qgr", 901);
    const created = {
      id: group,
      run: seat.run,
      session: seat.session,
      expires_at: null,
      questions: [{
        id: id("qst", 901),
        prompt: "어느 쪽으로 정리할까요?",
        reason: "두 방향이 모두 가능해서 정해야 합니다",
        options: [
          {
            key: "a",
            label: "A로",
            evidence: [],
            adoption: null,
            action: null,
            description: "A 설명",
          },
          {
            key: "b",
            label: "B로",
            evidence: [],
            adoption: null,
            action: null,
            description: "B 설명",
          },
        ],
        recommendation: { option_key: "a", explanation: "A가 더 가깝습니다" },
      }],
    };
    const made = await world.post("questions/create", seat.agentToken, created);
    assertEquals(made.status, 200, JSON.stringify(made.body));
    // 묶음을 만든 call은 끝났고 run은 아직 running이다.
    assertEquals(runRow(world, seat.run)["state"], "running");
    const read = await world.read("questions/read", MACHINE_TOKEN, { group });
    const text = await world.read("questions/text", MACHINE_TOKEN, { group });
    assertEquals(read.status, 200, JSON.stringify(read.body));
    assertEquals(text.status, 200, JSON.stringify(text.body));
    const stored = (read.body["group"] as {
      questions: { recommendation: { option_key: string | null } }[];
    }).questions[0];
    const words = (text.body as {
      questions: {
        prompt: string;
        reason: string;
        options: { key: string; description: string }[];
        recommendation: { explanation: string };
      }[];
    }).questions[0];
    const asked = created.questions[0];
    const waited = await world.post("runs/wait", MACHINE_TOKEN, {
      run: seat.run,
      request: {
        kind: "question",
        input: {
          ...created,
          questions: [{
            ...asked,
            prompt: words.prompt,
            reason: words.reason,
            options: asked.options.map((option) => ({
              ...option,
              description: words.options.find((item) =>
                item.key === option.key
              )!.description,
            })),
            recommendation: {
              option_key: stored.recommendation.option_key,
              explanation: words.recommendation.explanation,
            },
          }],
        },
      },
      call: null,
    }, { state_seq: await stateSeqOf(world, seat.run) });
    assertEquals(waited.status, 200, JSON.stringify(waited.body));
    assertEquals(runRow(world, seat.run)["state"], "waiting_user");
    assertEquals(runRow(world, seat.run)["waiting_on"], group);
    assertEquals(
      count(world.server, "select count(*) as n from question_groups"),
      1,
    );
  } finally {
    await world.dispose();
  }
});
