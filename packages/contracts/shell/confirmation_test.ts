import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import {
  CONFIRMATION_ERRORS,
  CONFIRMATION_IPC,
  CONFIRMATION_REQUEST_KINDS,
  confirmationOpenInputSchema,
  confirmationOpenIntentSchema,
  type ConfirmationOutcome,
  confirmationOutcomeSchema,
  confirmationRequestSchema,
  confirmationSubmitSchema,
  type LophnConfirmation,
  type LophnShell,
} from "./confirmation.ts";
import { EVENTS } from "./mod.ts";

const APR = "apr_01arz3ndektsv4rrffq69g5fav";
const QST = "qst_01arz3ndektsv4rrffq69g5fav";
const DOC = "doc_01arz3ndektsv4rrffq69g5fav";
const HASH = "ab".repeat(32);

const ownerDecision = {
  kind: "owner_decision",
  concern: "documents/file-tracking",
  decision: "delete_file",
  targets: [DOC],
  input: { kind: "inline", value: { path: "notes/a.md" } },
  comparison: { base_hash: HASH, operation: "delete" },
};

Deno.test(
  "shell/confirmation-window#R1, shell/confirmation-window#R6, platform/secrets#R2: 열기 종류는 네 가지이고 shell 외부 링크는 없다",
  () => {
    assertEquals([...CONFIRMATION_REQUEST_KINDS], [
      "approval_request",
      "question_option_action",
      "owner_decision",
      "secret_input",
    ]);
    assert(
      !CONFIRMATION_REQUEST_KINDS.includes("shell_external_link" as never),
    );
    assertEquals(EVENTS, []);
    for (const code of CONFIRMATION_ERRORS) assert(ERROR_CODES.includes(code));
  },
);

Deno.test(
  "shell/confirmation-window#R1, platform/identity#R14: 예시 열기 요청이 통과하고 모르는 field·틀린 ID 접두사를 거절한다",
  () => {
    const open = confirmationOpenInputSchema.parse({
      request: ownerDecision,
      comparison: { base_hash: HASH },
      parentWindow: "win-1",
    });
    assertEquals(open.request.kind, "owner_decision");
    assert(
      confirmationRequestSchema.safeParse({
        kind: "approval_request",
        approval: APR,
        created_seq: "4",
        binding_hash: HASH,
      }).success,
    );
    assert(
      confirmationRequestSchema.safeParse({
        kind: "question_option_action",
        question: QST,
        option_key: "keep",
        created_seq: "4",
        binding_hash: HASH,
      }).success,
    );
    assert(
      confirmationRequestSchema.safeParse({
        kind: "secret_input",
        owner: "platform/secrets",
        purpose: "provider_key",
      }).success,
    );
    assert(
      !confirmationRequestSchema.safeParse({ ...ownerDecision, html: "<b>" })
        .success,
    );
    assert(
      !confirmationRequestSchema.safeParse({
        ...ownerDecision,
        targets: ["doc_not-an-id"],
      }).success,
    );
    assert(
      !confirmationRequestSchema.safeParse({
        ...ownerDecision,
        targets: [
          "prj_01arz3ndektsv4rrffq69g5fav",
          "prj_01arz3ndektsv4rrffq69g5fav",
        ],
      }).success,
    );
    assert(
      !confirmationRequestSchema.safeParse({
        kind: "approval_request",
        approval: "qst_01arz3ndektsv4rrffq69g5fav",
        created_seq: "4",
        binding_hash: HASH,
      }).success,
    );
  },
);

Deno.test(
  "shell/confirmation-window#R4, shell/confirmation-window#R9: 결과는 decided receipt 또는 dismissed이고 secret 결과는 참조와 저장 결과만 있다",
  () => {
    const decided: ConfirmationOutcome = confirmationOutcomeSchema.parse({
      outcome: "decided",
      receipt: { kind: "entity", id: APR },
    });
    assertEquals(decided.outcome, "decided");
    assert(
      confirmationOutcomeSchema.safeParse({
        outcome: "decided",
        receipt: { kind: "event", seq: "9" },
      }).success,
    );
    assert(
      confirmationOutcomeSchema.safeParse({ outcome: "dismissed" }).success,
    );
    const secret = confirmationOutcomeSchema.parse({
      outcome: "decided",
      secret_ref: "sec_ref",
      stored: "stored",
    });
    assertEquals(Object.keys(secret).sort(), [
      "outcome",
      "secret_ref",
      "stored",
    ]);
    assert(
      !confirmationOutcomeSchema.safeParse({
        outcome: "decided",
        secret_ref: "sec_ref",
        stored: "stored",
        value: "raw-secret",
      }).success,
    );
    assert(!confirmationOutcomeSchema.safeParse({ outcome: "closed" }).success);
  },
);

Deno.test(
  "shell/confirmation-window#R6, shell/app-frame#R7: IPC 이름과 preload API는 창 열기·표시·제출·취소만 받는다",
  () => {
    assertEquals(Object.keys(CONFIRMATION_IPC), [
      "shell:confirmation-open",
      "confirmation:display",
      "confirmation:submit",
      "confirmation:cancel",
    ]);
    const intent = confirmationOpenIntentSchema.parse({
      request: { kind: "approval_request", approval: APR },
      parentWindow: "win-1",
    });
    const shell: LophnShell = {
      openConfirmation: () => Promise.reject(intent),
    };
    assertEquals(Object.keys(shell), ["openConfirmation"]);
    const confirmation: LophnConfirmation = {
      getDisplay: () => Promise.reject(new Error("x")),
      submit: () => Promise.reject(new Error("x")),
      cancel: () => Promise.reject(new Error("x")),
    };
    assertEquals(Object.keys(confirmation), ["getDisplay", "submit", "cancel"]);
    assert(
      confirmationSubmitSchema.safeParse({
        displayId: "disp-1",
        decision: "grant",
      }).success,
    );
    assert(
      confirmationSubmitSchema.safeParse({
        displayId: "disp-1",
        decision: "delete_file",
        input: { path: "notes/a.md" },
      }).success,
    );
    assert(
      !confirmationSubmitSchema.safeParse({
        displayId: "disp-1",
        decision: "grant",
        handle: "raw",
      }).success,
    );
    assert(
      !CONFIRMATION_IPC["shell:confirmation-open"].safeParse({
        request: { kind: "approval_request", approval: APR, body: {} },
        parentWindow: "win-1",
      }).success,
    );
  },
);

Deno.test(
  "shell/confirmation-window#R1 documents/file-tracking#R14: owner_decision 열기는 대상 ID만 싣고 결정 입력·본문은 받지 않는다",
  () => {
    const open = CONFIRMATION_IPC["shell:confirmation-open"];
    const request = {
      kind: "owner_decision",
      concern: "documents/file-tracking",
      decision: "delete_file",
    };
    assert(open.safeParse({ request, parentWindow: "win-1" }).success);
    assert(
      open.safeParse({
        request: { ...request, targets: [DOC] },
        parentWindow: "win-1",
      }).success,
    );
    for (
      const wrong of [
        { ...request, targets: [] },
        { ...request, targets: [DOC, DOC] },
        { ...request, targets: ["notes/a.md"] },
        { ...request, targets: [DOC], input: { path: "notes/a.md" } },
      ]
    ) {
      assert(
        !open.safeParse({ request: wrong, parentWindow: "win-1" }).success,
      );
    }
  },
);
