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
  approvalRequestCancelled,
  approvalRequestExpired,
  approvalRequestGranted,
  approvalRequestRejected,
  approvalRequestSchema,
  approvalsList,
  approvalsText,
  approvalUseSchema,
  cancelApprovalRequest,
  createApprovalRequestInputSchema,
  createApprovalRequestStoredSchema,
  grantApprovalRequest,
  rejectApprovalRequest,
} from "./approvals.ts";

const APR = "apr_01arz3ndektsv4rrffq69g5fav";
const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const SES = "ses_01arz3ndektsv4rrffq69g5fav";
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
  session_grantable: true,
};
const request = {
  id: APR,
  requester: action.caller,
  run: RUN,
  reason_blob: HASH,
  effect,
  action,
  expires_at: null,
  session_grantable: true,
  status: "pending" as const,
  grant_scope: null,
  grant_session: null,
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
    // 사람이 고른 범위(scope)도 confirmation 내용에 묶여 handle 하나로 once를 session으로 넓히지 못한다.
    assertEquals(
      route.binding,
      route === grantApprovalRequest
        ? ["approval", "created_seq", "binding_hash", "scope"]
        : ["approval", "created_seq", "binding_hash"],
    );
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
  // 종료 이유는 거절·취소에서 적었을 때만 있다(R14). 이유 없이 끝난 것과 만료는 null이다.
  for (const status of ["rejected", "expired", "cancelled"]) {
    assert(
      approvalRequestSchema.safeParse({
        ...request,
        status,
        closed_reason_blob: null,
        closed_seq: "43",
      }).success,
    );
  }
  for (const status of ["rejected", "cancelled"]) {
    assert(
      approvalRequestSchema.safeParse({
        ...request,
        status,
        closed_reason_blob: HASH,
        closed_seq: "43",
      }).success,
    );
  }
  // 끝나지 않았거나 허락한 request에는 종료 이유가 없다.
  assert(
    !approvalRequestSchema.safeParse({
      ...request,
      closed_reason_blob: HASH,
    }).success,
  );
  assert(
    !approvalRequestSchema.safeParse({
      ...request,
      status: "granted",
      closed_reason_blob: HASH,
      closed_seq: "43",
    }).success,
  );
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

Deno.test("platform/approvals#R14: 거절·취소는 이유를 글 값(없으면 null)으로 받고 hash를 받지 않는다", () => {
  const base = { approval: APR, created_seq: "42", binding_hash: HASH };
  for (
    const [schema, extra] of [
      [rejectApprovalRequest.input, base],
      [cancelApprovalRequest.input, { approval: APR, created_seq: "42" }],
    ] as const
  ) {
    assert(schema.safeParse({ ...extra, closed_reason: null }).success);
    assert(
      schema.safeParse({ ...extra, closed_reason: "No longer needed." })
        .success,
    );
    // 이유 칸은 있어야 하고(없으면 null) 공백뿐이거나 옛 hash 모양은 거절한다.
    assert(!schema.safeParse(extra).success);
    assert(!schema.safeParse({ ...extra, closed_reason: "  " }).success);
    assert(!schema.safeParse({ ...extra, closed_reason_blob: HASH }).success);
    assert(
      !schema.safeParse({
        ...extra,
        closed_reason: "a".repeat(APPROVAL_TEXT_MAX_BYTES + 1),
      }).success,
    );
  }
  // 만료 event에는 이유 hash가 없다. 거절·취소 event는 적었을 때만 hash가 있다.
  assert(
    approvalRequestExpired.payload.safeParse({
      created_seq: "42",
      closed_reason_blob: null,
    }).success,
  );
  assert(
    !approvalRequestExpired.payload.safeParse({
      created_seq: "42",
      closed_reason_blob: HASH,
    }).success,
  );
  for (const event of [approvalRequestRejected, approvalRequestCancelled]) {
    for (const closed of [null, HASH]) {
      assert(
        event.payload.safeParse({
          created_seq: "42",
          closed_reason_blob: closed,
        }).success,
      );
    }
  }
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
      closed_reason: null,
      as_of_seq: "42",
      next_cursor: null,
    }).success,
  );
});

const granted = {
  ...request,
  status: "granted" as const,
  grant_scope: "once" as const,
  closed_seq: "43",
};

Deno.test("platform/approvals#R18 [agent-I14]: 허락 결정은 scope(once|session, 기본 once)를 싣고 계속 허락(always)은 없다", () => {
  const input = {
    approval: APR,
    created_seq: "42",
    binding_hash: HASH,
  };
  const schema = grantApprovalRequest.input;
  assert(schema.safeParse({ ...input, scope: "once" }).success);
  assert(schema.safeParse({ ...input, scope: "session" }).success);
  // 범위가 빠지면 한 번 허락(once)이다: session 허락을 열지 않는 좁은 쪽이 기본이라 침묵이 넓은
  // 허락이 되지 않는다(R4). 기본값을 쓰는 사례는 기존 호출처(scope를 모르는 shell·fixture)다.
  const parsed = schema.parse(input);
  assertEquals(parsed.scope, "once");
  for (const scope of ["always", "forever", "project", "", null]) {
    assert(!schema.safeParse({ ...input, scope }).success, String(scope));
  }
  // 범위는 허락에만 있다. 거절 입력에는 없다.
  assert(
    !rejectApprovalRequest.input.safeParse({
      ...input,
      scope: "once",
      closed_reason: null,
    }).success,
  );
});

Deno.test("platform/approvals#R19 [agent-I14]: request는 session_grantable과 허락 범위·허락 session을 값으로 싣고 서로 맞아야 한다", () => {
  assert(approvalRequestSchema.safeParse(request).success);
  assert(
    approvalRequestSchema.safeParse({ ...request, session_grantable: false })
      .success,
  );
  assert(approvalRequestSchema.safeParse(granted).success);
  assert(
    approvalRequestSchema.safeParse({
      ...granted,
      grant_scope: "session",
      grant_session: SES,
    }).success,
  );
  // 옛 모양: 범위 칸이 없는 request는 request가 아니다.
  const { session_grantable: _, ...noGrantable } = request;
  assert(!approvalRequestSchema.safeParse(noGrantable).success);
  const { grant_scope: __, ...noScope } = request;
  assert(!approvalRequestSchema.safeParse(noScope).success);
  // 허락 범위는 granted일 때만 있다.
  for (const status of ["pending", "rejected", "expired", "cancelled"]) {
    assert(
      !approvalRequestSchema.safeParse({
        ...request,
        status,
        grant_scope: "once",
        closed_seq: status === "pending" ? null : "43",
      }).success,
      status,
    );
  }
  assert(
    !approvalRequestSchema.safeParse({ ...granted, grant_scope: null })
      .success,
  );
  // session 범위는 허락 session이 있어야 하고, once에는 허락 session이 없다.
  assert(
    !approvalRequestSchema.safeParse({ ...granted, grant_scope: "session" })
      .success,
  );
  assert(
    !approvalRequestSchema.safeParse({ ...granted, grant_session: SES })
      .success,
  );
  // session 범위는 session_grantable인 request만 갖는다(R20).
  assert(
    !approvalRequestSchema.safeParse({
      ...granted,
      session_grantable: false,
      grant_scope: "session",
      grant_session: SES,
    }).success,
  );
  assert(
    !approvalRequestSchema.safeParse({
      ...granted,
      grant_scope: "always",
    }).success,
  );
});

Deno.test("platform/approvals#R20 [agent-I14]: 생성 입력은 session_grantable을 정하고 빠지면 false다", () => {
  assert(createApprovalRequestInputSchema.safeParse(createInput).success);
  assert(
    createApprovalRequestInputSchema.safeParse({
      ...createInput,
      session_grantable: false,
    }).success,
  );
  // 빠지면 false다: session 선택이 없는 request(앱 confirm·앱 permission·release 적용·복원 같은
  // 기존 호출처)가 그대로 만들어진다. agent tool call의 ask만 true를 싣는다.
  const { session_grantable: _, ...rest } = createInput;
  const defaulted = createApprovalRequestInputSchema.parse(rest);
  assertEquals(defaulted.session_grantable, false);
  assert(
    !createApprovalRequestInputSchema.safeParse({
      ...createInput,
      session_grantable: "yes",
    }).success,
  );
});

Deno.test("platform/approvals#R19 [agent-I14]: ApprovalRequestGranted event는 범위와 허락 session을 싣는다", () => {
  const payload = { created_seq: "42", binding_hash: HASH };
  assert(
    approvalRequestGranted.payload.safeParse({
      ...payload,
      scope: "once",
      session: null,
    }).success,
  );
  assert(
    approvalRequestGranted.payload.safeParse({
      ...payload,
      scope: "session",
      session: SES,
    }).success,
  );
  assert(!approvalRequestGranted.payload.safeParse(payload).success);
  // session 범위는 session이 있어야 하고 once에는 session이 없다.
  assert(
    !approvalRequestGranted.payload.safeParse({
      ...payload,
      scope: "session",
      session: null,
    }).success,
  );
  assert(
    !approvalRequestGranted.payload.safeParse({
      ...payload,
      scope: "once",
      session: SES,
    }).success,
  );
  assert(
    !approvalRequestGranted.payload.safeParse({
      ...payload,
      scope: "always",
      session: null,
    }).success,
  );
});

Deno.test("platform/approvals#R19 [agent-I14]: ListApprovals는 허락 session으로 거를 수 있다", () => {
  assert(
    approvalsList.input.safeParse({ status: "granted", grant_session: SES })
      .success,
  );
  assert(!approvalsList.input.safeParse({ grant_session: RUN }).success);
});

Deno.test("platform/approvals#R18 [agent-I14]: 저장된 요청 모양은 session_grantable이 빠져도 false로 읽는다", () => {
  const { session_grantable: _, ...rest } = createInput;
  const stored = {
    id: APR,
    requester: action.caller,
    run: null,
    reason_blob: HASH,
    effect,
    action,
    expires_at: null,
  };
  assert(createApprovalRequestStoredSchema.safeParse(stored).success);
  assert(
    createApprovalRequestStoredSchema.safeParse({
      ...stored,
      session_grantable: true,
    }).success,
  );
  assert(createApprovalRequestInputSchema.safeParse(rest).success);
});
