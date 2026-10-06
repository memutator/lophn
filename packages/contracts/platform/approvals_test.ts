import { assert, assertEquals } from "@std/assert";
import { canonicalize, ERROR_CODES, fingerprint } from "../../base/mod.ts";
import { eventEnvelopeSchema } from "./events.ts";
import { routePath } from "./route.ts";
import {
  APPROVAL_EVENTS,
  APPROVAL_ROUTES,
  APPROVAL_TEXT_MAX_BYTES,
  approvalActionSchema,
  approvalBindingHash,
  approvalEffectSchema,
  approvalRequestSchema,
  approvalsText,
  approvalUseSchema,
  createApprovalRequestInputSchema,
  grantApprovalRequest,
  rejectApprovalRequest,
} from "./approvals.ts";

const APR = "apr_01arz3ndektsv4rrffq69g5fav";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const HASH = "ab".repeat(32);

const effect = {
  changes_blob: HASH,
  external_blob: null,
  reversible: false,
  reversibility_blob: HASH,
};
const action = {
  concern: "documents/versions",
  command: "save",
  caller: "agent:asg_01arz3ndektsv4rrffq69g5fav",
  targets: [DOC],
  input: { kind: "inline" as const, value: { title: "note" } },
  input_hash: HASH,
  comparison: { seq: "41" },
  binding_hash: HASH,
};
// 생성 입력은 설명 글을 값으로 싣는다. hash를 만들지도 blob을 준비하지도 않는다.
const createInput = {
  id: APR,
  requester: action.caller,
  run: null,
  reason: "Save the note.",
  effect: {
    changes: "One note is added.",
    external: null,
    reversible: false,
    reversibility: "The note cannot be removed.",
  },
  action,
  expires_at: "2026-10-04T00:00:00.000Z",
};
const request = {
  id: APR,
  requester: action.caller,
  run: RUN,
  reason_blob: HASH,
  effect,
  action,
  expires_at: null,
  status: "pending" as const,
  closed_reason_blob: null,
  created_seq: "42",
  closed_seq: null,
};

Deno.test("platform/approvals#R1, platform/approvals#R5: route와 event 이름은 architecture 5.1·5.9와 같다", () => {
  assertEquals(
    APPROVAL_ROUTES.map((route) => [route.kind, routePath(route)]),
    [
      ["read", "/v1/approvals/get"],
      ["read", "/v1/approvals/list"],
      ["read", "/v1/approvals/text"],
      ["command", "/v1/approvals/create"],
      ["command", "/v1/approvals/grant"],
      ["command", "/v1/approvals/reject"],
      ["command", "/v1/approvals/expire"],
      ["command", "/v1/approvals/cancel"],
      ["command", "/v1/approvals/apply"],
    ],
  );
  assertEquals(APPROVAL_ROUTES.map((route) => route.name), [
    "GetApproval",
    "ListApprovals",
    "ReadApprovalText",
    "create_approval_request",
    "grant_approval_request",
    "reject_approval_request",
    "expire_approval_request",
    "cancel_approval_request",
    "apply_approved_action",
  ]);
  assertEquals(APPROVAL_EVENTS.map((event) => event.type), [
    "ApprovalRequestCreated",
    "ApprovalRequestGranted",
    "ApprovalRequestRejected",
    "ApprovalRequestExpired",
    "ApprovalRequestCancelled",
  ]);
  for (const route of APPROVAL_ROUTES) {
    for (const code of route.errors) assert(ERROR_CODES.includes(code));
  }
});

Deno.test("platform/approvals#R3, platform/approvals#R14: grant와 reject는 confirmation 필수다", () => {
  for (const route of [grantApprovalRequest, rejectApprovalRequest]) {
    assertEquals(route.confirmation, "required");
    assertEquals(route.binding, ["approval", "created_seq", "binding_hash"]);
    assertEquals(route.display_read, "approvals/get");
    assertEquals(route.actors, ["user"]);
  }
  for (const route of APPROVAL_ROUTES) {
    if (route === grantApprovalRequest || route === rejectApprovalRequest) {
      continue;
    }
    assertEquals(route.confirmation, undefined);
  }
});

Deno.test("platform/approvals#R1, platform/approvals#R5, platform/approvals#R7: 예시 입력이 통과한다", () => {
  assert(approvalRequestSchema.safeParse(request).success);
  assert(approvalEffectSchema.safeParse(effect).success);
  assert(
    approvalUseSchema.safeParse({
      approval: APR,
      concern: action.concern,
      receipt: { kind: "event", seq: "43" },
      accepted_seq: "43",
    }).success,
  );
  assert(
    createApprovalRequestInputSchema.safeParse(createInput).success,
  );
  const envelope = eventEnvelopeSchema(APPROVAL_EVENTS[0]);
  assert(
    envelope.safeParse({
      seq: "42",
      type: "ApprovalRequestCreated",
      subject: APR,
      actor: "machine",
      run: null,
      payload: { binding_hash: HASH },
      at: "2026-10-04T00:00:00.000Z",
    }).success,
  );
});

Deno.test("platform/approvals#R5: binding_hash는 RFC 8785 정규화의 sha256이다", async () => {
  const hash = await approvalBindingHash(action);
  assertEquals(hash.length, 64);
  assertEquals(await approvalBindingHash(action), hash);
  assert(
    await approvalBindingHash({ ...action, command: "move" }) !== hash,
  );
});

Deno.test("platform/approvals#R5: command는 소유 route 이름 그대로여서 dot 이름도 받고 이름을 바꾸거나 맞추지 않는다", () => {
  const named = (command: string) =>
    approvalActionSchema.safeParse({ ...action, command }).success;
  // 실제 소유 command의 route 이름: documents, apps, platform, lophn-agent.
  for (
    const command of [
      "document.rename",
      "document.move",
      "invocation.accept_confirm",
      "create_approval_request",
      "ApplySettings",
    ]
  ) {
    assert(named(command), command);
  }
  // 문법 밖: 비어 있음, 점으로 시작·끝, 빈 조각, 경로·공백·wildcard.
  for (
    const command of [
      "",
      ".rename",
      "document.",
      "document..rename",
      "document/rename",
      "document rename",
      "document.*",
      "1document",
    ]
  ) {
    assert(!named(command), command);
  }
});

Deno.test("platform/approvals#R5: inline input과 comparison의 own JSON key를 hash 전에 보존한다", async () => {
  const value = JSON.parse('{"__proto__":"kept","nested":{"__proto__":42}}');
  const comparison = JSON.parse('{"__proto__":{"seq":"41"}}');
  const input = {
    ...action,
    input: { kind: "inline" as const, value },
    comparison,
  };
  const parsed = approvalActionSchema.parse(input);
  assertEquals(parsed.input.kind, "inline");
  if (parsed.input.kind === "inline") {
    assertEquals(canonicalize(parsed.input.value), canonicalize(value));
    assertEquals(
      await fingerprint(parsed.input.value),
      await fingerprint(value),
    );
  }
  assertEquals(canonicalize(parsed.comparison), canonicalize(comparison));
  assertEquals(
    await approvalBindingHash(parsed),
    await approvalBindingHash(input),
  );
});

Deno.test("platform/approvals#R1, platform/approvals#R5: 모르는 field·틀린 값·틀린 ID 접두사를 거절한다", () => {
  // 출력 schema는 같은 major의 선택 field 추가를 받아들인다. 입력만 모르는 field를 거절한다.
  assert(approvalRequestSchema.safeParse({ ...request, extra: 1 }).success);
  assert(!approvalActionSchema.safeParse({ ...action, secret: "x" }).success);
  assert(!approvalActionSchema.safeParse({ ...action, targets: [] }).success);
  assert(
    !approvalActionSchema.safeParse({ ...action, targets: [DOC, DOC] }).success,
  );
  assert(
    !approvalActionSchema.safeParse({
      ...action,
      input_hash: "AB".repeat(32),
    }).success,
  );
  assert(
    !approvalRequestSchema.safeParse({
      ...request,
      id: "ntf_01arz3ndektsv4rrffq69g5fav",
    }).success,
  );
  assert(
    !approvalRequestSchema.safeParse({
      ...request,
      run: "apr_01arz3ndektsv4rrffq69g5fav",
    }).success,
  );
  assert(
    !approvalRequestSchema.safeParse({
      ...request,
      status: "granted",
    }).success,
  );
  // 거절은 이유 없이 할 수 있다(R14). 만료·취소는 이유가 필수다.
  assert(
    approvalRequestSchema.safeParse({
      ...request,
      status: "rejected",
      closed_reason_blob: null,
      closed_seq: "43",
    }).success,
  );
  for (const status of ["expired", "cancelled"]) {
    assert(
      !approvalRequestSchema.safeParse({
        ...request,
        status,
        closed_reason_blob: null,
        closed_seq: "43",
      }).success,
    );
  }
  assert(
    !createApprovalRequestInputSchema.safeParse({
      ...createInput,
      note: "later",
    }).success,
  );
});

Deno.test("platform/approvals#R1 #R2: 생성 입력은 글 값만 받고 hash 입력과 공백뿐이거나 상한을 넘는 글을 거절한다", () => {
  const { reason: _reason, ...rest } = createInput;
  // 옛 모양(hash)은 글이 아니다.
  assert(
    !createApprovalRequestInputSchema.safeParse({
      ...rest,
      reason_blob: HASH,
      effect,
    }).success,
  );
  for (const blank of ["", "   ", "\n\t"]) {
    assert(
      !createApprovalRequestInputSchema.safeParse({
        ...createInput,
        reason: blank,
      }).success,
    );
    for (const field of ["changes", "reversibility"] as const) {
      assert(
        !createApprovalRequestInputSchema.safeParse({
          ...createInput,
          effect: { ...createInput.effect, [field]: blank },
        }).success,
      );
    }
    // 외부 영향은 없거나(null) 글이다.
    assert(
      !createApprovalRequestInputSchema.safeParse({
        ...createInput,
        effect: { ...createInput.effect, external: blank },
      }).success,
    );
  }
  assert(
    createApprovalRequestInputSchema.safeParse({
      ...createInput,
      effect: { ...createInput.effect, external: "example.com으로 보낸다" },
    }).success,
  );
  // 상한은 UTF-8 bytes다. 한글은 3바이트다.
  const fits = "a".repeat(APPROVAL_TEXT_MAX_BYTES);
  assert(
    createApprovalRequestInputSchema.safeParse({
      ...createInput,
      reason: fits,
    }).success,
  );
  assert(
    !createApprovalRequestInputSchema.safeParse({
      ...createInput,
      reason: fits + "a",
    }).success,
  );
  assert(
    !createApprovalRequestInputSchema.safeParse({
      ...createInput,
      reason: "가".repeat(Math.floor(APPROVAL_TEXT_MAX_BYTES / 3) + 1),
    }).success,
  );
});

Deno.test("platform/approvals#R17: ReadApprovalText는 request를 볼 수 있는 자격이 읽는 글 read다", () => {
  assertEquals(approvalsText.kind, "read");
  assertEquals(routePath(approvalsText), "/v1/approvals/text");
  assertEquals(approvalsText.input.safeParse({ approval: APR }).success, true);
  assertEquals(approvalsText.input.safeParse({ approval: DOC }).success, false);
  assertEquals(
    approvalsText.input.safeParse({ approval: APR, extra: 1 }).success,
    false,
  );
  assert(
    approvalsText.output.safeParse({
      approval: APR,
      reason: "Save the note.",
      changes: "One note is added.",
      external: null,
      reversibility: "The note cannot be removed.",
      as_of_seq: "42",
      next_cursor: null,
    }).success,
  );
});
