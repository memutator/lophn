import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { eventEnvelopeSchema } from "../events/events.ts";
import { routePath } from "../base/route.ts";
import {
  INVOCATION_DELIVERY_BACKOFF_MAX_MS,
  INVOCATION_DELIVERY_BACKOFF_MS,
  INVOCATION_DELIVERY_MAX_BYTES,
  INVOCATION_DELIVERY_MAX_MESSAGES,
  INVOCATION_EVENTS,
  INVOCATION_FINISH_STATUSES,
  INVOCATION_ROUTES,
  INVOCATION_SUMMARY_MAX_BYTES,
  invocationAcceptConfirm,
  invocationAcceptConfirmInputSchema,
  invocationAcceptConfirmOutputSchema,
  invocationAccepted,
  invocationDenied,
  invocationFinished,
  invocationOperationInputSchema,
  invocationOperationSchema,
  invocationRecordDeniedInputSchema,
  invocationRecordFinishedInputSchema,
  invocationRecordStartedInputSchema,
  invocationSchema,
  invocationsGet,
  invocationsList,
  invocationStarted,
  invocationSummarySchema,
  invocationTriggerInputSchema,
  invocationTriggerSchema,
} from "./invocations.ts";
import { ALL_EVENTS, ALL_ROUTES } from "../mod.ts";
import { CONFIRM_MARKER_LIMIT } from "./channel-values.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const INV = "inv_01h455vb4pex5v6nkc6gd5fdw1";
const APR = "apr_01h455vb4pex5v6nkc6gd5fdw1";
const RUN = "run_01h455vb4pex5v6nkc6gd5fdw1";
const TOOL = "tcl_01h455vb4pex5v6nkc6gd5fdw1";
const HASH = "ab".repeat(32);
const AT = "2026-10-04T00:00:00.000Z";
const LATER = "2026-10-04T00:01:00.000Z";
const META = { as_of_seq: "8", next_cursor: null };

const directCaller = { kind: "direct" as const };

Deno.test("apps/invocations#R3, apps/invocations#R9: route와 event 이름은 architecture 5.2·5.4와 같다", () => {
  assertEquals(
    INVOCATION_ROUTES.map((
      route,
    ) => [route.kind, routePath(route), route.name]),
    [
      [
        "command",
        "/v1/invocations/accept_confirm",
        "invocation.accept_confirm",
      ],
      [
        "command",
        "/v1/invocations/record_started",
        "invocation.record_started",
      ],
      [
        "command",
        "/v1/invocations/record_finished",
        "invocation.record_finished",
      ],
      ["command", "/v1/invocations/record_denied", "invocation.record_denied"],
      ["read", "/v1/invocations/list", "invocations.list"],
      ["read", "/v1/invocations/get", "invocations.get"],
    ],
  );
  assertEquals(
    INVOCATION_EVENTS.map((event) => event.type),
    [
      "InvocationAccepted",
      "InvocationStarted",
      "InvocationFinished",
      "InvocationDenied",
    ],
  );
  assertEquals(
    ALL_ROUTES.filter((route) => route.resource === "invocations").length,
    INVOCATION_ROUTES.length,
  );
  assertEquals(
    ALL_ROUTES.filter((route) => route.resource === "invocations").map((
      route,
    ) => route.name),
    INVOCATION_ROUTES.map((route) => route.name),
  );
  assertEquals(
    ALL_EVENTS.filter((event) => event.type.startsWith("Invocation")).map((
      event,
    ) => event.type),
    [
      "InvocationAccepted",
      "InvocationStarted",
      "InvocationFinished",
      "InvocationDenied",
    ],
  );
  assertEquals(invocationAcceptConfirm.actors, ["machine"]);
  for (const route of INVOCATION_ROUTES) {
    for (const code of route.errors) assert(ERROR_CODES.includes(code));
  }
});

Deno.test("apps/invocations#R2, apps/invocations#R3: Invocation은 당시 앱·release·대상·계기·mode·호출자·결과를 찾는다", () => {
  const invocation = {
    id: INV,
    app: APP,
    release: REL,
    operation: { kind: "command" as const, command: "usage.sync" },
    trigger: { kind: "automation" as const, key: "nightly" },
    mode: "live" as const,
    actor: "machine" as const,
    caller: directCaller,
    approval: null,
    input_hash: null,
    status: "succeeded" as const,
    started_at: AT,
    finished_at: LATER,
    summary: { code: "ok" },
    detail_hash: null,
  };
  const parsed = invocationSchema.parse(invocation);
  assertEquals(parsed.status, "succeeded");
  assertEquals(
    parsed.operation.kind === "command" ? parsed.operation.command : undefined,
    "usage.sync",
  );
  assertEquals(
    parsed.trigger.kind === "automation" ? parsed.trigger.key : undefined,
    "nightly",
  );
  // 잘못된 status와 잘못된 ID 접두사는 거절한다.
  assert(
    !invocationSchema.safeParse({ ...invocation, status: "degraded" }).success,
  );
  assert(
    !invocationSchema.safeParse({
      ...invocation,
      id: "msg_01h455vb4pex5v6nkc6gd5fdw1",
    }).success,
  );
  assert(
    !invocationSchema.safeParse({ ...invocation, operation: "usage.sync" })
      .success,
  );
});

Deno.test("apps/invocations#R2, apps/invocations#R3: operation과 trigger의 가지를 구별하고 잘못된 가지 field를 거절한다", () => {
  invocationOperationSchema.parse({ kind: "command", command: "usage.sync" });
  invocationOperationSchema.parse({ kind: "start" });
  invocationOperationSchema.parse({ kind: "data_change", from: 0, to: 2 });
  invocationTriggerSchema.parse({ kind: "direct" });
  invocationTriggerSchema.parse({ kind: "automation", key: "nightly" });
  invocationTriggerSchema.parse({ kind: "activation", activation_seq: 3 });
  invocationTriggerSchema.parse({ kind: "restart" });
  // 입력 schema는 모르는 가지 field를 거절한다. 출력 schema는 같은 major에서
  // 선택 field가 더해져도 읽는 쪽이 깨지지 않도록 벗겨 낸다(platform/api#R6).
  assert(
    !invocationOperationInputSchema.safeParse({ kind: "start", command: "x" })
      .success,
  );
  assert(
    !invocationOperationInputSchema.safeParse({ kind: "command" }).success,
  );
  assert(
    !invocationOperationInputSchema.safeParse({
      kind: "data_change",
      from: 2,
      to: 2,
    }).success,
  );
  assert(
    !invocationTriggerInputSchema.safeParse({ kind: "direct", key: "x" })
      .success,
  );
  assert(
    !invocationTriggerInputSchema.safeParse({ kind: "automation" }).success,
  );
  assert(
    !invocationTriggerInputSchema.safeParse({
      kind: "activation",
      activation_seq: 0,
    }).success,
  );
});

Deno.test("apps/invocations#R9, apps/invocations#R10: 접수와 시작을 구분하고 종료 상태에는 확정 시각이 필수다", () => {
  const accepted = {
    id: INV,
    app: APP,
    release: REL,
    operation: { kind: "command" as const, command: "usage.sync" },
    trigger: { kind: "direct" as const },
    mode: "live" as const,
    actor: "user" as const,
    caller: directCaller,
    approval: APR,
    input_hash: HASH,
    status: "accepted" as const,
    started_at: null,
    finished_at: null,
    summary: {},
    detail_hash: null,
  };
  invocationSchema.parse(accepted);
  // accepted에 started_at이 있으면 접수와 시작을 섞은 값이다.
  assert(
    !invocationSchema.safeParse({ ...accepted, started_at: AT }).success,
  );
  const denied = {
    ...accepted,
    status: "denied" as const,
    finished_at: LATER,
    summary: { reason: "forbidden" },
  };
  invocationSchema.parse(denied);
  assert(
    !invocationSchema.safeParse({ ...denied, started_at: AT }).success,
  );
  // succeeded·failed·unknown은 finished_at이 필수다.
  for (const status of INVOCATION_FINISH_STATUSES) {
    invocationSchema.parse({
      ...accepted,
      status,
      started_at: AT,
      finished_at: LATER,
    });
    assert(
      !invocationSchema.safeParse({
        ...accepted,
        status,
        started_at: AT,
        finished_at: null,
      }).success,
    );
  }
  // running은 아직 종료 시각이 없다.
  invocationSchema.parse({
    ...accepted,
    status: "running",
    started_at: AT,
  });
  assert(
    !invocationSchema.safeParse({
      ...accepted,
      status: "running",
      started_at: AT,
      finished_at: LATER,
    }).success,
  );
});

Deno.test("apps/invocations#R6: 같은 사실 재전송 입력이 통과하고 다른 종료 사실 입력도 schema는 같은 모양이다", () => {
  const finished = {
    invocation: INV,
    status: "succeeded" as const,
    started_at: AT,
    finished_at: LATER,
    summary: { code: "ok" },
    detail_hash: null,
  };
  invocationRecordFinishedInputSchema.parse(finished);
  // 같은 사실 재전송은 같은 입력이고 같은 schema를 통과한다.
  invocationRecordFinishedInputSchema.parse(finished);
  // 다른 종료 사실은 handler에서 conflict다. schema 모양은 같다.
  invocationRecordFinishedInputSchema.parse({ ...finished, status: "failed" });
  assert(
    !invocationRecordFinishedInputSchema.safeParse({
      ...finished,
      status: "denied",
    }).success,
  );
  assert(
    !invocationRecordFinishedInputSchema.safeParse({ ...finished, extra: 1 })
      .success,
  );
});

Deno.test("apps/invocations#R6, apps/invocations#R8: record_started 입력은-inv 사실을 받고 모르는 field를 거절한다", () => {
  const started = {
    invocation: INV,
    app: APP,
    release: REL,
    mode: "live" as const,
    actor: "machine" as const,
    caller: directCaller,
    operation: { kind: "command" as const, command: "usage.sync" },
    trigger: { kind: "direct" as const },
    started_at: AT,
  };
  invocationRecordStartedInputSchema.parse(started);
  assert(
    !invocationRecordStartedInputSchema.safeParse({ ...started, extra: 1 })
      .success,
  );
  assert(
    !invocationRecordStartedInputSchema.safeParse({
      ...started,
      invocation: "app_01h455vb4pex5v6nkc6gd5fdw1",
    }).success,
  );
});

Deno.test("apps/invocations#R7, apps/invocations#R8: accept_confirm은 정확한 approval·입력 hash·단일 key를 접수한다", () => {
  const input = {
    app: APP,
    release: REL,
    command: "usage.sync",
    input_hash: HASH,
    approval: APR,
    key: "confirm-1",
    process_nonce: "nonce-1",
    caller: directCaller,
  };
  invocationAcceptConfirmInputSchema.parse(input);
  const output = invocationAcceptConfirmOutputSchema.parse({
    invocation: INV,
    proof: {
      invocation: INV,
      process_nonce: "nonce-1",
      release: REL,
      command: "usage.sync",
      input_hash: HASH,
      caller: directCaller,
      expires_at: LATER,
    },
  });
  assertEquals(output.proof.command, "usage.sync");
  assert(
    !invocationAcceptConfirmInputSchema.safeParse({ ...input, extra: 1 })
      .success,
  );
  assert(
    !invocationAcceptConfirmInputSchema.safeParse({ ...input, key: "" })
      .success,
  );
  assert(
    !invocationAcceptConfirmInputSchema.safeParse({
      ...input,
      input_hash: "ZZ",
    }).success,
  );
});

Deno.test("apps/invocations#R17, apps/invocations#R16: caller는 사람 결정과 실제 요청자를 따로 남긴다", () => {
  const denied = {
    invocation: INV,
    app: APP,
    release: REL,
    actor: "app:app_01h455vb4pex5v6nkc6gd5fdw1" as const,
    caller: {
      kind: "app" as const,
      app: APP,
      release: REL,
      parent_invocation: null,
    },
    operation: { kind: "command" as const, command: "usage.sync" },
    trigger: { kind: "direct" as const },
    finished_at: AT,
    summary: { reason: "not_accepting" },
  };
  invocationRecordDeniedInputSchema.parse(denied);
  // agent caller는 run·tool_call을 남긴다.
  invocationRecordDeniedInputSchema.parse({
    ...denied,
    actor: "machine" as const,
    caller: { kind: "agent" as const, run: RUN, tool_call: TOOL },
  });
  assert(
    !invocationRecordDeniedInputSchema.safeParse({
      ...denied,
      caller: { kind: "app" },
    }).success,
  );
  assert(
    !invocationRecordDeniedInputSchema.safeParse({
      ...denied,
      caller: { kind: "unknown" },
    }).success,
  );
});

Deno.test("apps/invocations#R10, apps/invocations#R11: 미확인 판정과 기록 부재를 구별해 보인다", () => {
  const page = invocationsGet.output.parse({
    ...META,
    invocation: {
      id: INV,
      app: APP,
      release: REL,
      operation: { kind: "command" as const, command: "usage.sync" },
      trigger: { kind: "direct" as const },
      mode: "live" as const,
      actor: "machine" as const,
      caller: directCaller,
      approval: null,
      input_hash: null,
      status: "unknown" as const,
      started_at: null,
      finished_at: LATER,
      summary: { reason: "process_exited" },
      detail_hash: null,
    },
  });
  assertEquals(page.invocation?.status, "unknown");
  // 기록 자체가 없으면 행이 없다.
  const absent = invocationsGet.output.parse({
    ...META,
    invocation: null,
  });
  assertEquals(absent.invocation, null);
  invocationsList.output.parse({
    ...META,
    invocations: [],
  });
});

Deno.test("apps/invocations#R19: marker·전달·summary 한도와 backoff 상수다", () => {
  assertEquals(CONFIRM_MARKER_LIMIT, 4096);
  assertEquals(INVOCATION_DELIVERY_MAX_MESSAGES, 4096);
  assertEquals(INVOCATION_DELIVERY_MAX_BYTES, 8 * 1024 * 1024);
  assertEquals(INVOCATION_SUMMARY_MAX_BYTES, 16 * 1024);
  assertEquals([...INVOCATION_DELIVERY_BACKOFF_MS], [1000, 2000, 4000]);
  assertEquals(INVOCATION_DELIVERY_BACKOFF_MAX_MS, 30_000);
  const summary = JSON.stringify({ code: "ok", reason: "x" });
  invocationSummarySchema.parse(JSON.parse(summary));
  // 16KiB를 넘는 summary는 거절한다.
  const big = JSON.parse(JSON.stringify({ code: "y".repeat(17 * 1024) }));
  assert(!invocationSummarySchema.safeParse(big).success);
});

Deno.test("apps/invocations#R3, apps/invocations#R9: event payload는 envelope을 통과한다", () => {
  eventEnvelopeSchema(invocationAccepted).parse({
    seq: "8",
    type: "InvocationAccepted",
    subject: INV,
    actor: "machine",
    run: null,
    payload: {
      app: APP,
      release: REL,
      command: "usage.sync",
      input_hash: HASH,
      approval: APR,
      caller: directCaller,
    },
    at: AT,
  });
  eventEnvelopeSchema(invocationStarted).parse({
    seq: "9",
    type: "InvocationStarted",
    subject: INV,
    actor: "machine",
    run: null,
    payload: {
      app: APP,
      release: REL,
      mode: "live",
      operation: { kind: "command", command: "usage.sync" },
      trigger: { kind: "direct" },
      caller: directCaller,
      started_at: AT,
    },
    at: AT,
  });
  eventEnvelopeSchema(invocationFinished).parse({
    seq: "10",
    type: "InvocationFinished",
    subject: INV,
    actor: "machine",
    run: null,
    payload: {
      status: "succeeded",
      started_at: AT,
      finished_at: LATER,
      summary: { code: "ok" },
      detail_hash: null,
    },
    at: AT,
  });
  eventEnvelopeSchema(invocationDenied).parse({
    seq: "11",
    type: "InvocationDenied",
    subject: INV,
    actor: "machine",
    run: null,
    payload: {
      finished_at: AT,
      summary: { reason: "forbidden" },
    },
    at: AT,
  });
  assert(
    !invocationFinished.payload.safeParse({
      status: "denied",
      started_at: AT,
      finished_at: LATER,
      summary: {},
      detail_hash: null,
    }).success,
  );
});
