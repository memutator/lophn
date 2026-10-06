import { assert, assertEquals } from "@std/assert";
import { canonicalize, ERROR_CODES, fingerprint } from "../../base/mod.ts";
import { eventEnvelopeSchema } from "./events.ts";
import { routePath } from "./route.ts";
import {
  APPROVAL_EVENTS,
  APPROVAL_ROUTES,
  approvalActionSchema,
  approvalBindingHash,
  approvalEffectSchema,
  approvalRequestSchema,
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
    createApprovalRequestInputSchema.safeParse({
      id: APR,
      requester: action.caller,
      run: null,
      reason_blob: HASH,
      effect,
      action,
      expires_at: "2026-10-04T00:00:00.000Z",
    }).success,
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
  // apps route 이름처럼 점으로 나뉜 마디는 받고, 점이 비거나 대문자·공백이면 거절한다.
  assert(
    approvalActionSchema.safeParse({ ...action, command: "grant.create" })
      .success,
  );
  for (const command of ["grant.", ".create", "Grant.create", "grant create"]) {
    assert(!approvalActionSchema.safeParse({ ...action, command }).success);
  }
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
      id: APR,
      requester: action.caller,
      run: null,
      reason_blob: HASH,
      effect,
      action,
      expires_at: null,
      note: "later",
    }).success,
  );
});
