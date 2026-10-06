// core 통로가 보내는 route 이름과 입력 모양. renderer 설정(DOM lib)은 contracts graph를
// type 검사하지 못하므로 contracts를 들이지 않고 schema의 field 이름을 그대로 적는다.
import { assert, assertEquals } from "@std/assert";

import type { CoreCall } from "../../../../ipc/core.ts";
import type { CoreReply } from "../../../../ipc/core-api.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { coreRequestSource } from "./core-source.ts";
import { QUESTION_TEXT_MAX_BYTES } from "./model.ts";
import type { QuestionRequest, ReviewIntent } from "./source.ts";
import { questionContract } from "./testdata/question-contract.ts";

const QST = "qst_01k6aaaaaaaaaaaaaaaaaaaaa1";
const QST2 = "qst_01k6aaaaaaaaaaaaaaaaaaaaa2";
const APR = "apr_01k6aaaaaaaaaaaaaaaaaaaaa1";
const APR2 = "apr_01k6aaaaaaaaaaaaaaaaaaaaa2";
const RUN = "run_01k6aaaaaaaaaaaaaaaaaaaaa1";
const RUN2 = "run_01k6aaaaaaaaaaaaaaaaaaaaa2";
const ASG = "asg_01k6aaaaaaaaaaaaaaaaaaaaa1";
const SES = "ses_01k6aaaaaaaaaaaaaaaaaaaaa1";
const SES2 = "ses_01k6aaaaaaaaaaaaaaaaaaaaa2";
const PRJ = "prj_01k6aaaaaaaaaaaaaaaaaaaaa1";
const NTF = "ntf_01k6aaaaaaaaaaaaaaaaaaaaa1";

type Answer = (call: CoreCall) => CoreReply;

function coreOf(answer: Answer): { core: CoreSource; calls: CoreCall[] } {
  const calls: CoreCall[] = [];
  return {
    calls,
    core: {
      subscribe: () => () => {},
      call(input) {
        calls.push(input);
        return Promise.resolve(answer(input));
      },
    },
  };
}

function name(call: CoreCall): string {
  return `${call.kind}:${call.resource}/${call.method}`;
}

const ok = (value: unknown): CoreReply => ({ ok: true, value });

function questionValue(patch: Record<string, unknown> = {}) {
  return {
    id: QST,
    run: RUN,
    session: SES,
    prompt_blob: "a".repeat(64),
    reason_blob: "b".repeat(64),
    options: [
      {
        key: "keep",
        label: "Keep both files",
        description_blob: "c".repeat(64),
        evidence: [],
        adoption: null,
        action: null,
      },
      {
        key: "move",
        label: "Move it",
        description_blob: "d".repeat(64),
        evidence: [],
        adoption: null,
        action: { concern: "platform/settings", command: "apply_settings" },
      },
    ],
    recommendation: { option_key: "keep", explanation_blob: "e".repeat(64) },
    expires_at: null,
    status: "pending",
    answer: null,
    closed_reason: null,
    closed_reason_blob: null,
    created_seq: "10",
    closed_seq: null,
    applied: false,
    ...patch,
  };
}

function approvalValue(patch: Record<string, unknown> = {}) {
  return {
    id: APR,
    requester: "agent",
    run: RUN2,
    reason_blob: "f".repeat(64),
    effect: { reversible: true },
    expires_at: null,
    status: "pending",
    closed_reason_blob: null,
    created_seq: "20",
    closed_seq: null,
    ...patch,
  };
}

const QUESTION: QuestionRequest = {
  kind: "question",
  id: QST,
  run: RUN,
  session: SES,
  role: "lophn",
  place: null,
  blocking: false,
  createdSeq: "10",
  closedSeq: null,
  createdAt: null,
  closedAt: null,
  expiresAt: null,
  status: "pending",
  options: [{ key: "keep", label: "Keep both files", action: false }],
  recommended: null,
  answer: null,
  closedReason: null,
  applied: false,
};

Deno.test("lophn-agent/questions#R6: action 없는 답은 확인 handle 없이 questions/answer로 가고 자유 답은 글을 값으로 싣는다", async () => {
  const contract = await questionContract();
  const { core, calls } = coreOf(() => ok({}));
  const source = coreRequestSource(core, undefined);
  assertEquals(
    await source.answer(QUESTION, { kind: "option", option: "keep" }),
    { ok: true, value: undefined },
  );
  await source.answer(QUESTION, { kind: "option", option: "keep" });
  await source.answer(QUESTION, { kind: "text", text: "Keep the newer one" });
  assertEquals(calls.map(name), [
    "command:questions/answer",
    "command:questions/answer",
    "command:questions/answer",
  ]);
  const [first, again, text] = calls.map((call) =>
    call.body as {
      input: Record<string, unknown>;
      idempotency_key: string;
      compare: unknown;
      prepared: unknown[];
      confirmation?: unknown;
    }
  );
  assertEquals(first!.input, {
    question: QST,
    created_seq: "10",
    answer: { kind: "option", option_key: "keep" },
  });
  assertEquals(first!.compare, { created_seq: "10" });
  assertEquals(first!.prepared, []);
  // 일반 답에는 확인 handle이 없다. action 답 route의 handle은 보호 창이 맡는다.
  assertEquals("confirmation" in first!, false);
  assert(first!.idempotency_key.startsWith(`questions-answer-${QST}-`));
  assert(new TextEncoder().encode(first!.idempotency_key).length <= 128);
  assertEquals(again!.idempotency_key, first!.idempotency_key);
  assert(text!.idempotency_key !== first!.idempotency_key);
  assertEquals(text!.input["answer"], {
    kind: "text",
    text: "Keep the newer one",
  });
  for (const body of [first!, text!]) {
    assert(contract.answerQuestion.input.safeParse(body.input).success);
    // action 답 route는 binding_hash·evidence가 없으면 받지 않는다.
    assert(!contract.answerQuestionAction.input.safeParse(body.input).success);
  }
  assertEquals(contract.answerQuestionAction.binding, [
    "question",
    "created_seq",
    "answer",
    "binding_hash",
  ]);
});

Deno.test("lophn-agent/questions#R6: 미루기와 취소는 따로 닫는 command이고 취소만 이유 글을 값으로 싣는다", async () => {
  const contract = await questionContract();
  const { core, calls } = coreOf(() => ok({}));
  const source = coreRequestSource(core, undefined);
  await source.defer(QUESTION);
  await source.cancel(QUESTION, "Not needed anymore");
  assertEquals(calls.map(name), [
    "command:questions/defer",
    "command:questions/cancel",
  ]);
  const deferred = (calls[0]!.body as { input: unknown }).input;
  const cancelled = (calls[1]!.body as { input: unknown }).input;
  assertEquals(deferred, { question: QST, created_seq: "10" });
  assertEquals(cancelled, {
    question: QST,
    created_seq: "10",
    closed_reason: "cancelled",
    closed_reason_text: "Not needed anymore",
  });
  assert(contract.deferQuestion.input.safeParse(deferred).success);
  assert(contract.cancelQuestion.input.safeParse(cancelled).success);
  const failing = coreRequestSource(
    coreOf(() => ({ ok: false, error: { code: "conflict", message: "" } }))
      .core,
    undefined,
  );
  assertEquals(await failing.defer(QUESTION), {
    ok: false,
    code: "conflict",
  });
});

Deno.test("lophn-agent/questions#R4: 질문의 글은 questions/text로 읽고 선택지 설명은 key로 찾는다", async () => {
  const contract = await questionContract();
  // 칸이 보내기 전에 막는 상한이 contract의 상한과 같다.
  assertEquals(QUESTION_TEXT_MAX_BYTES, contract.QUESTION_TEXT_MAX_BYTES);
  let reply: CoreReply = ok({
    question: QST,
    prompt: "Which copy should stay?",
    reason: "Both changed.",
    options: [{ key: "keep", description: "Keep both, renamed." }],
    recommendation: { option_key: "keep", explanation: "Nothing is lost." },
    answer_text: null,
    closed_reason_text: null,
  });
  const { core, calls } = coreOf(() => reply);
  const source = coreRequestSource(core, undefined);
  const read = await source.text(QUESTION);
  assert(read.ok);
  assertEquals(read.value.prompt, "Which copy should stay?");
  assertEquals(read.value.reason, "Both changed.");
  assertEquals(read.value.options.get("keep"), "Keep both, renamed.");
  assertEquals(read.value.recommendation, "Nothing is lost.");
  assertEquals(read.value.answer, null);
  assertEquals(read.value.closedReason, null);
  assertEquals(calls.map(name), ["read:questions/text"]);
  assertEquals(calls[0]!.body, { question: QST });
  assert(contract.questionText.input.safeParse(calls[0]!.body).success);
  reply = { ok: false, error: { code: "unavailable", message: "" } };
  assertEquals(await source.text(QUESTION), {
    ok: false,
    code: "unavailable",
  });
});

Deno.test("platform/notifications#R5: 읽음 표시는 notifications/read 하나이고 목록은 source seq 다음부터 끝까지 읽는다", async () => {
  const page = Array.from({ length: 200 }, (_, index) => ({
    notification: {
      id: `ntf_01k6aaaaaaaaaaaaaaaaaaa${String(index).padStart(3, "0")}`,
      source_seq: String(index + 1),
      read_at: null,
    },
    source_event: "QuestionCreated",
  }));
  const { core, calls } = coreOf((call) => {
    if (name(call) === "read:notifications/list") {
      const body = call.body as { after_source_seq?: string };
      return ok({
        notifications: body.after_source_seq === undefined ? page : [{
          notification: { id: NTF, source_seq: "201", read_at: null },
          source_event: "ProblemOpened",
        }],
      });
    }
    return ok({});
  });
  const source = coreRequestSource(core, undefined);
  const unread = await source.unread();
  assert(unread.ok);
  assertEquals(unread.value.length, 201);
  assertEquals(unread.value[200], {
    id: NTF,
    sourceEvent: "ProblemOpened",
    sourceSeq: "201",
    readAt: null,
  });
  assertEquals(calls.map((call) => call.body), [
    { unread_only: true, limit: 200 },
    { unread_only: true, after_source_seq: "200", limit: 200 },
  ]);
  calls.length = 0;
  await source.markRead(unread.value[200]!);
  assertEquals(calls.map(name), ["command:notifications/read"]);
  assertEquals((calls[0]!.body as { input: unknown }).input, {
    notification: NTF,
  });
});

Deno.test("shell/desktop#R6: 칸의 요청은 그 세션의 것만이고 run이 그 요청을 기다리면 먼저 둘 표시를 단다", async () => {
  const { core, calls } = coreOf((call) => {
    switch (name(call)) {
      case "read:questions/list":
        return ok({
          questions: [
            questionValue(),
            questionValue({ id: QST2, session: SES2, run: RUN2 }),
          ],
          next_cursor: null,
        });
      case "read:approvals/list":
        return ok({
          requests: [
            approvalValue(),
            approvalValue({ id: APR2, run: null }),
          ],
        });
      case "read:runs/list":
        return ok({
          runs: [{ id: RUN, assignment: ASG, session: SES, waiting_on: QST }],
          next_cursor: null,
        });
      case "read:runs/read":
        return ok({
          run: { id: RUN2, assignment: ASG, session: SES, waiting_on: null },
        });
      default:
        return ok({});
    }
  });
  const source = coreRequestSource(core, undefined);
  const pending = await source.pending(SES);
  assert(pending.ok);
  assertEquals(pending.value.map((request) => request.id), [QST, APR]);
  assertEquals(pending.value.map((request) => request.blocking), [true, false]);
  const first = pending.value[0]!;
  assert(first.kind === "question");
  assertEquals(first.options, [
    { key: "keep", label: "Keep both files", action: false },
    { key: "move", label: "Move it", action: true },
  ]);
  assertEquals(first.recommended, "keep");
  const bodies = Object.fromEntries(
    calls.map((call) => [name(call), call.body]),
  );
  assertEquals(bodies["read:questions/list"], { status: "pending" });
  assertEquals(bodies["read:approvals/list"], { status: "pending" });
  assertEquals(bodies["read:runs/list"], { state: "waiting_user" });
  assertEquals(bodies["read:runs/read"], { run: RUN2 });
});

Deno.test("shell/desktop#R9: 전체 목록은 역할·자리·시각을 run·세션·event에서 채운다", async () => {
  const { core, calls } = coreOf((call) => {
    switch (name(call)) {
      case "read:assignments/list":
        return ok({
          assignments: [{ id: ASG, role: "operator" }],
          next_cursor: null,
        });
      case "read:runs/list":
        return ok({
          runs: [
            { id: RUN, assignment: ASG, session: SES, waiting_on: null },
            { id: RUN2, assignment: ASG, session: null, waiting_on: APR },
          ],
          next_cursor: null,
        });
      case "read:sessions/list":
        return ok({
          sessions: [{ id: SES, work_place: { kind: "project", id: PRJ } }],
          next_cursor: null,
        });
      case "read:questions/list":
        return ok({
          questions: [questionValue({
            status: "answered",
            answer: { kind: "option", option_key: "move", text_blob: null },
            closed_seq: "15",
            applied: true,
          })],
          next_cursor: null,
        });
      case "read:approvals/list":
        return ok({ requests: [approvalValue()] });
      case "read:notifications/list":
        return ok({ notifications: [] });
      case "read:events/list":
        return ok({
          events: [
            { seq: "10", at: "2026-10-06T08:00:00.000Z" },
            { seq: "15", at: "2026-10-06T08:30:00.000Z" },
            { seq: "20", at: "2026-10-06T08:45:00.000Z" },
          ],
          scanned_through_seq: "20",
          head_seq: "20",
        });
      default:
        return ok({});
    }
  });
  const source = coreRequestSource(core, undefined);
  const overview = await source.overview();
  assert(overview.ok);
  const [question, approval] = overview.value.requests;
  assert(question?.kind === "question");
  assertEquals(question.role, "operator");
  assertEquals(question.place, { kind: "project", id: PRJ });
  assertEquals(question.answer, { kind: "option", option: "move" });
  assertEquals(question.applied, true);
  assertEquals(question.createdAt, Date.parse("2026-10-06T08:00:00.000Z"));
  assertEquals(question.closedAt, Date.parse("2026-10-06T08:30:00.000Z"));
  assert(approval?.kind === "approval");
  assertEquals(approval.session, null);
  assertEquals(approval.place, null);
  assertEquals(approval.blocking, true);
  assertEquals(approval.reversible, true);
  assertEquals(approval.createdAt, Date.parse("2026-10-06T08:45:00.000Z"));
  const events = calls.find((call) => name(call) === "read:events/list");
  const body = events!.body as {
    after_seq: string;
    types: string[];
    subjects: string[];
  };
  assertEquals(body.after_seq, "9");
  assertEquals(body.subjects, [QST, APR]);
  assert(body.types.includes("QuestionCreated"));
  assert(body.types.includes("ApprovalRequestGranted"));
  // 목록은 filter 없이 모두 읽는다.
  for (
    const route of [
      "read:assignments/list",
      "read:runs/list",
      "read:sessions/list",
      "read:questions/list",
      "read:approvals/list",
    ]
  ) {
    assertEquals(calls.find((call) => name(call) === route)?.body, {});
  }
});

Deno.test("shell/desktop#R6: [Review]는 preload의 보호 창 열기로만 가고 없으면 열 수 없다고 돌려준다", async () => {
  const opened: unknown[] = [];
  const { core, calls } = coreOf(() => ok({}));
  const source = coreRequestSource(core, (intent) => {
    opened.push(intent);
    return Promise.resolve({ windowId: "w1", displayId: "d1" });
  });
  const intent: ReviewIntent = { kind: "approval_request", approval: APR };
  assertEquals(await source.review(intent), { ok: true, value: undefined });
  assertEquals(opened, [{
    request: intent,
    parentWindow: "requesting-window",
  }]);
  // 결정 command를 renderer가 core에 직접 보내지 않는다.
  assertEquals(calls, []);
  const refused = coreRequestSource(
    core,
    () => Promise.resolve({ code: "conflict", message: "changed" }),
  );
  assertEquals(await refused.review(intent), { ok: false, code: "conflict" });
  const none = coreRequestSource(core, undefined);
  assertEquals(await none.review(intent), { ok: false, code: "unavailable" });
});

Deno.test("platform/approvals#R1: approval 설명은 blobs/read로 읽고 글이 아니면 보이지 않는다", async () => {
  const text = "Delete the old export";
  let bytes = btoa(text);
  const { core, calls } = coreOf(() =>
    ok({ status: "available", bytes, length_bytes: text.length })
  );
  const source = coreRequestSource(core, undefined);
  const approval = {
    kind: "approval" as const,
    id: APR,
    run: null,
    session: null,
    role: null,
    place: null,
    blocking: false,
    createdSeq: "20",
    closedSeq: null,
    createdAt: null,
    closedAt: null,
    expiresAt: null,
    status: "pending" as const,
    reversible: false,
  };
  assertEquals(await source.reason(approval), { ok: true, value: text });
  assertEquals(calls[0]!.body, {
    owner_kind: "approval_request",
    owner_key: APR,
    field: "reason",
    offset_bytes: 0,
    length_bytes: 4096,
  });
  bytes = btoa(String.fromCharCode(0xff, 0xfe));
  assertEquals(await source.reason(approval), { ok: true, value: null });
});

Deno.test("shell/desktop#R7: approval·notification route를 읽지 못하면 질문만 돌려주고 못 읽은 쪽을 표시한다", async () => {
  const { core } = coreOf((call) => {
    switch (name(call)) {
      case "read:approvals/list":
      case "read:notifications/list":
        return { ok: false, error: { code: "not_found", message: "" } };
      case "read:questions/list":
        return ok({ questions: [questionValue()], next_cursor: null });
      case "read:events/list":
        return ok({ events: [], scanned_through_seq: "10", head_seq: "10" });
      default:
        return ok({
          assignments: [],
          runs: [],
          sessions: [],
          next_cursor: null,
        });
    }
  });
  const source = coreRequestSource(core, undefined);
  const overview = await source.overview();
  assert(overview.ok);
  assertEquals(overview.value.requests.map((request) => request.id), [QST]);
  assertEquals(overview.value.approvalsRead, false);
  assertEquals(overview.value.notificationsRead, false);
  const pending = await source.pending(SES);
  assert(pending.ok);
  assertEquals(pending.value.map((request) => request.id), [QST]);
});
