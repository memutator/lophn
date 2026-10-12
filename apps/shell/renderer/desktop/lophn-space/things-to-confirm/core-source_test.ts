// core 통로가 보내는 route 이름과 입력 모양. renderer 설정(DOM lib)은 contracts graph를
// type 검사하지 못하므로 contracts를 들이지 않고 schema의 field 이름을 그대로 적는다.
import { assert, assertEquals } from "@std/assert";

import type { CoreCall } from "../../../../ipc/core.ts";
import type { CoreReply } from "../../../../ipc/core-api.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { coreRequestSource } from "./core-source.ts";
import type { QuestionRequest, ReviewIntent } from "./source.ts";

const QST = "qst_01k6aaaaaaaaaaaaaaaaaaaaa1";
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

Deno.test("lophn-agent/questions#R4, R6: 질문 묶음은 이 화면이 읽거나 보내지 않고 질문 쪽 통로는 못 한다고 답한다", async () => {
  const { core, calls } = coreOf(() =>
    ok({
      assignments: [],
      runs: [],
      sessions: [],
      requests: [],
      notifications: [],
      next_cursor: null,
    })
  );
  const source = coreRequestSource(core, undefined);
  assertEquals(await source.text(QUESTION), { ok: false, code: "unavailable" });
  assertEquals(
    await source.answer(QUESTION, { kind: "option", option: "keep" }),
    { ok: false, code: "unavailable" },
  );
  assertEquals(await source.defer(QUESTION), {
    ok: false,
    code: "unavailable",
  });
  assertEquals(await source.cancel(QUESTION, "No longer needed"), {
    ok: false,
    code: "unavailable",
  });
  const overview = await source.overview();
  assert(overview.ok);
  assertEquals(overview.value.requests, []);
  const pending = await source.pending(SES);
  assert(pending.ok);
  assertEquals(pending.value, []);
  assert(calls.every((call) => call.resource !== "questions"));
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

Deno.test("shell/desktop#R6: 칸의 요청은 그 세션의 것만이고 run이 그 요청을 기다리면 먼저 둘 표시를 단다", async () => {
  const { core, calls } = coreOf((call) => {
    switch (name(call)) {
      case "read:approvals/list":
        return ok({
          requests: [
            approvalValue(),
            approvalValue({ id: APR2, run: null }),
          ],
        });
      case "read:runs/list":
        return ok({
          runs: [{ id: RUN, assignment: ASG, session: SES, waiting_on: APR }],
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
  assertEquals(pending.value.map((request) => request.id), [APR]);
  assertEquals(pending.value.map((request) => request.blocking), [true]);
  const bodies = Object.fromEntries(
    calls.map((call) => [name(call), call.body]),
  );
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
          sessions: [],
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
  const pending = await source.pending(SES);
  assert(pending.ok);
  assertEquals(pending.value, []);
});
