import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import {
  CONFIRMATION_ERRORS,
  CONFIRMATION_IPC,
  CONFIRMATION_REQUEST_KINDS,
  confirmationDisplaySchema,
  confirmationEndedSchema,
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
      "shell:confirmation-ended",
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
      onConfirmationEnded: () => () => {},
    };
    assertEquals(Object.keys(shell), [
      "openConfirmation",
      "onConfirmationEnded",
    ]);
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
  "shell/confirmation-window#R9: 끝남 알림은 어느 창의 확인인지와 끝난 종류만 싣고 내용·결정·proof는 싣지 않는다",
  () => {
    assert(
      confirmationEndedSchema.safeParse({ windowId: "cfw_1", ended: "closed" })
        .success,
    );
    assert(
      confirmationEndedSchema.safeParse({
        windowId: "cfw_1",
        ended: "rejected",
      }).success,
    );
    for (
      const extra of [
        { decision: "grant" },
        { request: { kind: "approval_request", approval: APR } },
        { handle: "raw" },
      ]
    ) {
      assert(
        !confirmationEndedSchema.safeParse({
          windowId: "cfw_1",
          ended: "closed",
          ...extra,
        }).success,
      );
    }
    // 결정으로 끝난 것은 알리지 않는다. 허락은 실제 상태 변화로만 풀린다.
    assert(
      !confirmationEndedSchema.safeParse({
        windowId: "cfw_1",
        ended: "decided",
      })
        .success,
    );
  },
);

const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const RVT = "rvt_01arz3ndektsv4rrffq69g5fav";

Deno.test(
  "shell/confirmation-window#R2, lophn-agent/revert#R2: owner decision 열기는 대상 ID를, provider credential 입력은 값 아닌 등록 정보만 싣는다",
  () => {
    const revert = confirmationOpenIntentSchema.parse({
      request: {
        kind: "owner_decision",
        concern: "lophn-agent/revert",
        decision: "RevertRun",
        targets: [RUN],
      },
      parentWindow: "win-1",
    });
    assertEquals(revert.request.kind, "owner_decision");
    assert(
      !confirmationOpenIntentSchema.safeParse({
        request: {
          kind: "owner_decision",
          concern: "lophn-agent/revert",
          decision: "RevertRun",
          targets: [RUN, RUN],
        },
        parentWindow: "win-1",
      }).success,
    );
    const credential = {
      key: "main",
      kind: "api_key",
      label: "Main key",
      account: null,
      organization: null,
      plan: null,
      dedup_fingerprint: HASH,
    };
    assert(
      confirmationOpenIntentSchema.safeParse({
        request: {
          kind: "secret_input",
          owner: "pvd_01arz3ndektsv4rrffq69g5fav",
          purpose: "provider_credential",
          credential,
        },
        parentWindow: "win-1",
      }).success,
    );
    assert(
      !confirmationOpenIntentSchema.safeParse({
        request: {
          kind: "secret_input",
          owner: "weather.key",
          purpose: "app_secret",
          credential,
        },
        parentWindow: "win-1",
      }).success,
    );
    assert(
      !confirmationOpenIntentSchema.safeParse({
        request: {
          kind: "secret_input",
          owner: "pvd_01arz3ndektsv4rrffq69g5fav",
          purpose: "provider_credential",
          credential: { ...credential, value: "raw-secret" },
        },
        parentWindow: "win-1",
      }).success,
    );
  },
);

Deno.test(
  "shell/confirmation-window#R6, lophn-agent/harness/provider#R6: 등록한 계정의 교체·삭제 열기는 계정 key와 행동만 싣고 등록 정보나 다른 목적과 함께 오지 않는다",
  () => {
    const owner = "pvd_01arz3ndektsv4rrffq69g5fav";
    const open = (request: Record<string, unknown>) =>
      confirmationOpenIntentSchema.safeParse({
        request: { kind: "secret_input", owner, ...request },
        parentWindow: "win-1",
      }).success;
    const purpose = "provider_credential";
    assert(open({ purpose, change: { key: "main", action: "replace" } }));
    assert(open({ purpose, change: { key: "main", action: "revoke" } }));
    assert(!open({ purpose, change: { key: "main", action: "delete" } }));
    assert(!open({ purpose, change: { key: "main", action: "revoke", v: 1 } }));
    assert(
      !open({
        purpose: "app_secret",
        change: { key: "main", action: "revoke" },
      }),
    );
    assert(
      !open({
        purpose,
        change: { key: "main", action: "revoke" },
        credential: {
          key: "main",
          kind: "api_key",
          label: "Main key",
          account: null,
          organization: null,
          plan: null,
          dedup_fingerprint: HASH,
        },
      }),
    );
    assert(
      confirmationOutcomeSchema.safeParse({
        outcome: "decided",
        secret_ref: "Main key",
        stored: "revoked",
      }).success,
    );
  },
);

Deno.test(
  "shell/confirmation-window#R5, platform/approvals#R9: 표시는 종류별 view·상태·결정을, 결과는 접수와 실제 적용을 구별한다",
  () => {
    const display = confirmationDisplaySchema.parse({
      displayId: "dsp_1",
      request: {
        kind: "owner_decision",
        concern: "lophn-agent/revert",
        decision: "RevertRun",
        targets: [RUN],
        input: {
          kind: "inline",
          value: {
            id: RVT,
            run: RUN,
            allow_partial: true,
            preview_hash: HASH,
          },
        },
        comparison: { preview_hash: HASH },
      },
      view: { kind: "revert", groups: [] },
      state: "ready",
      decisions: ["RevertRun"],
      second: true,
    });
    assertEquals(display.decisions, ["RevertRun"]);
    assert(
      !confirmationDisplaySchema.safeParse({ ...display, state: "granted" })
        .success,
    );
    assert(
      !confirmationDisplaySchema.safeParse({ ...display, handle: "raw" })
        .success,
    );
    const accepted = confirmationOutcomeSchema.parse({
      outcome: "decided",
      receipt: { kind: "entity", id: APR },
      result: "accepted",
    });
    assertEquals(accepted.outcome, "decided");
    assert(
      confirmationOutcomeSchema.safeParse({
        outcome: "decided",
        receipt: { kind: "entity", id: RVT },
        result: "partial",
      }).success,
    );
    assert(
      !confirmationOutcomeSchema.safeParse({
        outcome: "decided",
        receipt: { kind: "entity", id: APR },
        result: "done",
      }).success,
    );
  },
);
