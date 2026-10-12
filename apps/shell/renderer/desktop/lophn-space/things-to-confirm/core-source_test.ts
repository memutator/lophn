// core 통로가 보내는 route 이름과 입력 모양. renderer 설정(DOM lib)은 contracts graph를
// type 검사하지 못하므로 contracts를 들이지 않고 schema의 field 이름을 그대로 적는다.
import { assert, assertEquals } from "@std/assert";

import type { CoreCall } from "../../../../ipc/core.ts";
import type { CoreReply } from "../../../../ipc/core-api.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { coreRequestSource } from "./core-source.ts";
import type { QuestionGroupRequest, ReviewIntent } from "./source.ts";

const GRP = "qgr_01k6aaaaaaaaaaaaaaaaaaaaa1";
const GRP2 = "qgr_01k6aaaaaaaaaaaaaaaaaaaaa2";
const QST = "qst_01k6aaaaaaaaaaaaaaaaaaaaa1";
const QST2 = "qst_01k6aaaaaaaaaaaaaaaaaaaaa2";
const APR = "apr_01k6aaaaaaaaaaaaaaaaaaaaa1";
const APR2 = "apr_01k6aaaaaaaaaaaaaaaaaaaaa2";
const RUN = "run_01k6aaaaaaaaaaaaaaaaaaaaa1";
const RUN2 = "run_01k6aaaaaaaaaaaaaaaaaaaaa2";
const ASG = "asg_01k6aaaaaaaaaaaaaaaaaaaaa1";
const SES = "ses_01k6aaaaaaaaaaaaaaaaaaaaa1";
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

const HASH = "f".repeat(64);

function groupValue(patch: Record<string, unknown> = {}) {
  return {
    id: GRP,
    run: RUN,
    session: null,
    expires_at: null,
    status: "pending",
    closed_reason: null,
    closed_reason_blob: null,
    created_seq: "10",
    closed_seq: null,
    questions: [{
      id: QST,
      group: GRP,
      position: 1,
      prompt_blob: HASH,
      reason_blob: HASH,
      options: [
        {
          key: "keep",
          label: "Keep both files",
          description_blob: HASH,
          evidence: [],
          adoption: null,
          action: null,
        },
        {
          key: "move",
          label: "Move it",
          description_blob: HASH,
          evidence: [],
          adoption: null,
          action: {
            concern: "documents/terms",
            command: "term.define",
            targets: [],
            input: { kind: "inline", value: {} },
            comparison: {},
          },
        },
      ],
      recommendation: { option_key: "keep", explanation_blob: HASH },
      answer: null,
      applied: false,
    }],
    ...patch,
  };
}

const GROUP: QuestionGroupRequest = {
  kind: "question",
  id: GRP,
  run: RUN,
  session: null,
  role: "operator",
  place: null,
  blocking: false,
  createdSeq: "10",
  closedSeq: null,
  createdAt: null,
  closedAt: null,
  expiresAt: null,
  status: "pending",
  closedReason: null,
  questions: [
    {
      id: QST,
      options: [
        {
          key: "keep",
          label: "Keep both files",
          action: false,
          command: null,
        },
        { key: "move", label: "Move it", action: true, command: "term.define" },
      ],
      recommended: "keep",
      answer: null,
      applied: false,
    },
    {
      id: QST2,
      options: [{ key: "yes", label: "Yes", action: false, command: null }],
      recommended: null,
      answer: null,
      applied: false,
    },
  ],
};

Deno.test("lophn-agent/questions#R2 [I45]: 세션 없는 run의 묶음만 전체 목록에 싣고 역할·기다림·시각은 run·event에서 채운다", async () => {
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
            { id: RUN, assignment: ASG, session: null, waiting_on: GRP },
            { id: RUN2, assignment: ASG, session: SES, waiting_on: GRP2 },
          ],
          next_cursor: null,
        });
      case "read:questions/list":
        return ok({
          groups: [
            groupValue({
              expires_at: "2026-10-07T00:00:00.000Z",
              questions: [
                ...groupValue().questions,
                {
                  ...groupValue().questions[0],
                  id: QST2,
                  position: 2,
                  options: [{
                    key: "yes",
                    label: "Yes",
                    description_blob: HASH,
                    evidence: [],
                    adoption: null,
                    action: null,
                  }],
                  recommendation: null,
                },
              ],
            }),
            // 세션 있는 run의 묶음은 대화 안 카드가 맡는다.
            groupValue({ id: GRP2, run: RUN2, session: SES }),
          ],
          next_cursor: null,
        });
      case "read:approvals/list":
        return ok({ requests: [] });
      case "read:notifications/list":
        return ok({ notifications: [] });
      case "read:events/list":
        return ok({
          events: [{ seq: "10", at: "2026-10-06T08:00:00.000Z" }],
          scanned_through_seq: "10",
          head_seq: "10",
        });
      default:
        return ok({});
    }
  });
  const overview = await coreRequestSource(core, undefined).overview();
  assert(overview.ok);
  assertEquals(overview.value.requests, [{
    ...GROUP,
    expiresAt: "2026-10-07T00:00:00.000Z",
    blocking: true,
    createdAt: Date.parse("2026-10-06T08:00:00.000Z"),
  }]);
  assertEquals(
    calls.find((call) => name(call) === "read:questions/list")?.body,
    {},
  );
  const events = calls.find((call) => name(call) === "read:events/list");
  const body = events!.body as { types: string[]; subjects: string[] };
  assertEquals(body.subjects, [GRP]);
  for (
    const type of [
      "QuestionCreated",
      "QuestionAnswered",
      "QuestionExpired",
      "QuestionCancelled",
    ]
  ) {
    assert(body.types.includes(type), type);
  }
});

Deno.test("lophn-agent/questions#R10 [I45]: 닫힌 묶음은 답의 종류와 닫힌 이유와 적용 여부를 싣는다", async () => {
  const closed = (
    id: string,
    patch: Record<string, unknown>,
    answer: unknown = null,
  ) => {
    const base = groupValue({ id, created_seq: "10", ...patch });
    return {
      ...base,
      questions: base.questions.map((entry) => ({
        ...entry,
        group: id,
        answer,
        applied: answer !== null,
      })),
    };
  };
  const { core } = coreOf((call) => {
    switch (name(call)) {
      case "read:questions/list":
        return ok({
          groups: [
            closed(GRP, { status: "answered", closed_seq: "11" }, {
              kind: "option",
              option_key: "move",
              text_blob: null,
            }),
            closed(GRP2, { status: "answered", closed_seq: "12" }, {
              kind: "text",
              option_key: null,
              text_blob: HASH,
            }),
            closed("qgr_01k6aaaaaaaaaaaaaaaaaaaaa3", {
              status: "cancelled",
              closed_seq: "13",
              closed_reason: "deferred",
            }),
            closed("qgr_01k6aaaaaaaaaaaaaaaaaaaaa4", {
              status: "expired",
              closed_seq: "14",
              closed_reason: "expired",
            }),
          ],
          next_cursor: null,
        });
      case "read:events/list":
        return ok({ events: [], scanned_through_seq: "14", head_seq: "14" });
      default:
        return ok({
          assignments: [],
          runs: [],
          requests: [],
          notifications: [],
          next_cursor: null,
        });
    }
  });
  const overview = await coreRequestSource(core, undefined).overview();
  assert(overview.ok);
  const groups = overview.value.requests.flatMap((request) =>
    request.kind === "question" ? [request] : []
  );
  assertEquals(
    groups.map((group) => [group.status, group.closedReason, group.closedSeq]),
    [
      ["answered", null, "11"],
      ["answered", null, "12"],
      ["cancelled", "deferred", "13"],
      ["expired", "expired", "14"],
    ],
  );
  assertEquals(groups[0]!.questions[0]!.answer, {
    kind: "option",
    option: "move",
  });
  assertEquals(groups[0]!.questions[0]!.applied, true);
  assertEquals(groups[1]!.questions[0]!.answer, { kind: "text" });
  assertEquals(groups[2]!.questions[0]!.answer, null);
  assertEquals(groups[2]!.questions[0]!.applied, false);
});

Deno.test("lophn-agent/questions#R4 [I45]: 묶음의 글은 ReadQuestionText 하나로 읽는다", async () => {
  const { core, calls } = coreOf(() =>
    ok({
      group: GRP,
      questions: [
        {
          question: QST,
          prompt: "Which copy should stay?",
          reason: "Both changed.",
          options: [{ key: "keep", description: "Keep both" }],
          recommendation: { option_key: "keep", explanation: "Newest wins" },
          answer_text: "Own words",
        },
        {
          question: QST2,
          prompt: "Include regressions?",
          reason: "Longer report.",
          options: [{ key: "yes", description: "List them" }],
          recommendation: null,
          answer_text: null,
        },
      ],
      closed_reason_text: "Not needed",
    })
  );
  const text = await coreRequestSource(core, undefined).text(GROUP);
  assert(text.ok);
  assertEquals(calls.map((call) => [name(call), call.body]), [[
    "read:questions/text",
    { group: GRP },
  ]]);
  assertEquals(text.value.closedReason, "Not needed");
  assertEquals(text.value.questions.map((entry) => entry.id), [QST, QST2]);
  assertEquals(text.value.questions[0], {
    id: QST,
    prompt: "Which copy should stay?",
    reason: "Both changed.",
    options: new Map([["keep", "Keep both"]]),
    recommendation: "Newest wins",
    answer: "Own words",
  });
  assertEquals(text.value.questions[1]!.recommendation, null);
  assertEquals(text.value.questions[1]!.answer, null);
});

Deno.test("lophn-agent/questions#R4, R6 [I45]: 묶음 답은 AnswerQuestionGroup 한 번에 모든 답을 싣고 같은 답을 다시 보내면 같은 key다", async () => {
  const { core, calls } = coreOf(() => ok({ id: GRP }));
  const source = coreRequestSource(core, undefined);
  const answers = [
    { question: QST, answer: { kind: "option" as const, option_key: "keep" } },
    { question: QST2, answer: { kind: "text" as const, text: "Own words" } },
  ];
  assertEquals(await source.answer(GROUP, answers), {
    ok: true,
    value: undefined,
  });
  assertEquals(calls.map(name), ["command:questions/answer"]);
  const sent = calls[0]!.body as {
    input: unknown;
    idempotency_key: string;
    compare: unknown;
    prepared: unknown[];
  };
  assertEquals(sent.input, { group: GRP, created_seq: "10", answers });
  assertEquals(sent.compare, { created_seq: "10" });
  assertEquals(sent.prepared, []);
  assert(sent.idempotency_key.startsWith(`questions-answer-${GRP}-`));
  await source.answer(GROUP, answers);
  await source.answer(GROUP, [
    answers[0]!,
    { question: QST2, answer: { kind: "text", text: "Other words" } },
  ]);
  const keys = calls.map((call) =>
    (call.body as { idempotency_key: string }).idempotency_key
  );
  assertEquals(keys[1], keys[0]);
  assert(keys[2] !== keys[0]);
});

Deno.test("lophn-agent/questions#R6 [I45]: 답이 거절되면 core의 오류 코드를 돌려준다", async () => {
  const { core } = coreOf(() => ({
    ok: false,
    error: { code: "conflict", message: "" },
  }));
  const source = coreRequestSource(core, undefined);
  assertEquals(
    await source.answer(GROUP, [{
      question: QST,
      answer: { kind: "option", option_key: "keep" },
    }]),
    { ok: false, code: "conflict" },
  );
  assertEquals(await source.defer(GROUP), { ok: false, code: "conflict" });
  assertEquals(await source.cancel(GROUP, "Not needed"), {
    ok: false,
    code: "conflict",
  });
});

Deno.test("lophn-agent/questions#R6, R8 [I45]: Skip과 취소는 묶음 전체를 닫는 별도 요청이고 취소는 이유 글을 값으로 싣는다", async () => {
  const { core, calls } = coreOf(() => ok({ id: GRP }));
  const source = coreRequestSource(core, undefined);
  assertEquals(await source.defer(GROUP), { ok: true, value: undefined });
  assertEquals(await source.cancel(GROUP, "No longer needed"), {
    ok: true,
    value: undefined,
  });
  assertEquals(calls.map(name), [
    "command:questions/defer",
    "command:questions/cancel",
  ]);
  const [defer, cancel] = calls.map((call) =>
    call.body as {
      input: unknown;
      idempotency_key: string;
      compare: unknown;
    }
  );
  assertEquals(defer!.input, { group: GRP, created_seq: "10" });
  assertEquals(defer!.compare, { created_seq: "10" });
  assertEquals(defer!.idempotency_key, `questions-defer-${GRP}`);
  assertEquals(cancel!.input, {
    group: GRP,
    created_seq: "10",
    closed_reason: "cancelled",
    closed_reason_text: "No longer needed",
  });
  assertEquals(cancel!.compare, { created_seq: "10" });
  assertEquals(cancel!.idempotency_key, `questions-cancel-${GRP}`);
});

Deno.test("lophn-agent/questions#R13 [I45]: term.define·app.create를 고른 질문 하나짜리 묶음은 확인 창 없이 main 통로로 확정하고 통로가 없으면 못 한다고 답한다", async () => {
  const sent: unknown[] = [];
  const shell = globalThis as {
    lophnShell?: {
      confirmTermDefinition?: (input: unknown) => Promise<unknown>;
    };
  };
  const before = shell.lophnShell;
  const single: QuestionGroupRequest = {
    ...GROUP,
    questions: [GROUP.questions[0]!],
  };
  const pick = [{
    question: QST,
    answer: { kind: "option" as const, option_key: "move" },
  }];
  try {
    const { core, calls } = coreOf(() => ok({}));
    const source = coreRequestSource(core, undefined);
    shell.lophnShell = undefined;
    assertEquals(await source.answer(single, pick), {
      ok: false,
      code: "unavailable",
    });
    shell.lophnShell = {
      confirmTermDefinition: (input) => {
        sent.push(input);
        return Promise.resolve({ ok: true });
      },
    };
    assertEquals(await source.answer(single, pick), {
      ok: true,
      value: undefined,
    });
    assertEquals(sent, [{ question: QST, option_key: "move" }]);
    // 이 길은 답 command를 renderer가 직접 보내지 않는다.
    assertEquals(calls, []);
  } finally {
    shell.lophnShell = before;
  }
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

Deno.test("platform/notifications#R10: 목록의 OS 전달 실패 이유만 row에 옮기고 다른 전달 상태는 옮기지 않는다", async () => {
  const row = (id: string, delivery: unknown) => ({
    notification: { id, source_seq: id.slice(-1), read_at: null },
    source_event: "ApprovalRequestCreated",
    delivery,
  });
  const { core } = coreOf((call) =>
    name(call) === "read:notifications/list"
      ? ok({
        notifications: [
          row("ntf_01k6aaaaaaaaaaaaaaaaaaaaa1", {
            state: "failed",
            reason: "show_failed",
            observed_at: "2026-10-09T00:00:00Z",
          }),
          row("ntf_01k6aaaaaaaaaaaaaaaaaaaaa2", {
            state: "failed",
            reason: "unsupported",
            observed_at: "2026-10-09T00:00:00Z",
          }),
          row("ntf_01k6aaaaaaaaaaaaaaaaaaaaa3", { state: "unconfirmed" }),
          row("ntf_01k6aaaaaaaaaaaaaaaaaaaaa4", undefined),
        ],
      })
      : ok({})
  );
  const unread = await coreRequestSource(core, undefined).unread();
  assert(unread.ok);
  assertEquals(unread.value.map((value) => value.osFailure), [
    "show_failed",
    "unsupported",
    undefined,
    undefined,
  ]);
  assert(!("osFailure" in unread.value[2]!));
});

Deno.test("shell/desktop#R9 [I45]: 전체 목록은 역할·자리·시각을 run·세션·event에서 채운다", async () => {
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
      case "read:sessions/read":
        return ok({
          session: { id: SES, work_place: { kind: "project", id: PRJ } },
        });
      case "read:approvals/list":
        return ok({
          requests: [
            approvalValue(),
            approvalValue({ id: APR2, run: RUN, created_seq: "10" }),
          ],
        });
      case "read:questions/list":
        return ok({ groups: [], next_cursor: null });
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
  const [approval, placed] = overview.value.requests;
  assert(approval?.kind === "approval");
  assertEquals(approval.session, null);
  assertEquals(approval.place, null);
  assertEquals(approval.blocking, true);
  assertEquals(approval.reversible, true);
  assertEquals(approval.createdAt, Date.parse("2026-10-06T08:45:00.000Z"));
  assert(placed?.kind === "approval");
  assertEquals(placed.role, "operator");
  assertEquals(placed.session, SES);
  assertEquals(placed.place, { kind: "project", id: PRJ });
  assertEquals(placed.blocking, false);
  assertEquals(placed.createdAt, Date.parse("2026-10-06T08:00:00.000Z"));
  const events = calls.find((call) => name(call) === "read:events/list");
  const body = events!.body as {
    after_seq: string;
    types: string[];
    subjects: string[];
  };
  assertEquals(body.after_seq, "9");
  assertEquals(body.subjects, [APR, APR2]);
  assert(body.types.includes("ApprovalRequestGranted"));
  // 목록은 filter 없이 모두 읽는다. 세션은 목록이 아니라 요청이 걸린 세션만 하나씩 읽는다.
  for (
    const route of [
      "read:assignments/list",
      "read:runs/list",
      "read:questions/list",
      "read:approvals/list",
    ]
  ) {
    assertEquals(calls.find((call) => name(call) === route)?.body, {});
  }
  assertEquals(calls.map(name).includes("read:sessions/list"), false);
  assertEquals(
    calls.find((call) => name(call) === "read:sessions/read")?.body,
    { session: SES },
  );
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

Deno.test("shell/desktop#R7: approval·notification route를 읽지 못하면 못 읽은 쪽을 표시한다", async () => {
  const { core } = coreOf((call) => {
    switch (name(call)) {
      case "read:approvals/list":
      case "read:notifications/list":
        return { ok: false, error: { code: "not_found", message: "" } };
      default:
        return ok({
          assignments: [],
          runs: [],
          groups: [],
          next_cursor: null,
        });
    }
  });
  const source = coreRequestSource(core, undefined);
  const overview = await source.overview();
  assert(overview.ok);
  assertEquals(overview.value.requests, []);
  assertEquals(overview.value.approvalsRead, false);
  assertEquals(overview.value.notificationsRead, false);
});

Deno.test("shell/desktop#R7 [I45]: 묶음 목록을 읽지 못하면 질문이 없다고 말하지 않고 전체 읽기를 실패로 돌려준다", async () => {
  const { core } = coreOf((call) =>
    name(call) === "read:questions/list"
      ? { ok: false, error: { code: "unavailable", message: "" } }
      : ok({ assignments: [], runs: [], next_cursor: null })
  );
  assertEquals(await coreRequestSource(core, undefined).overview(), {
    ok: false,
    code: "unavailable",
  });
});
