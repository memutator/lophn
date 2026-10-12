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
const QGR = "qgr_01arz3ndektsv4rrffq69g5fav";
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
        group: QGR,
        question: QST,
        option_key: "keep",
        created_seq: "4",
        binding_hash: HASH,
      }).success,
    );
    // 고정 action 답은 묶음을 정본으로 가리킨다. 질문 id만 든 옛 모양은 받지 않는다.
    assert(
      !confirmationRequestSchema.safeParse({
        kind: "question_option_action",
        question: QST,
        option_key: "keep",
        created_seq: "4",
        binding_hash: HASH,
      }).success,
    );
    assert(
      !confirmationRequestSchema.safeParse({
        kind: "question_option_action",
        group: QST,
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

const SES = "ses_01arz3ndektsv4rrffq69g5fav";
const MSG = "msg_01arz3ndektsv4rrffq69g5fav";
const MCL = "mcl_01arz3ndektsv4rrffq69g5fav";
const RVT = "rvt_01arz3ndektsv4rrffq69g5fav";

Deno.test(
  "shell/confirmation-window#R2, lophn-agent/revert#R2: owner decision 열기는 대상 ID를, provider credential 입력은 값 아닌 등록 정보만 싣는다",
  () => {
    // Rewind는 session과 checkpoint 메시지, 고른 범위를 가리킨다(summarize는 끝난 요약 call도).
    for (const choice of ["restore_all", "messages_only"] as const) {
      const revert = confirmationOpenIntentSchema.parse({
        request: {
          kind: "owner_decision",
          concern: "lophn-agent/revert",
          decision: "Rewind",
          targets: [SES, MSG],
          choice,
        },
        parentWindow: "win-1",
      });
      assertEquals(revert.request.kind, "owner_decision");
    }
    assert(
      confirmationOpenIntentSchema.safeParse({
        request: {
          kind: "owner_decision",
          concern: "lophn-agent/revert",
          decision: "Rewind",
          targets: [SES, MSG, MCL],
          choice: "summarize",
        },
        parentWindow: "win-1",
      }).success,
    );
    assert(
      !confirmationOpenIntentSchema.safeParse({
        request: {
          kind: "owner_decision",
          concern: "lophn-agent/revert",
          decision: "Rewind",
          targets: [SES, SES],
          choice: "restore_all",
        },
        parentWindow: "win-1",
      }).success,
    );
    assert(
      !confirmationOpenIntentSchema.safeParse({
        request: {
          kind: "owner_decision",
          concern: "lophn-agent/revert",
          decision: "Rewind",
          targets: [SES, MSG],
          choice: "everything",
        },
        parentWindow: "win-1",
      }).success,
    );
    const connect = {
      name: "Anthropic",
      definition: {
        key: "anthropic",
        display_name: "Anthropic",
        protocols: ["anthropic-messages"],
        auth_kinds: ["api_key"],
        models_endpoint: "https://api.anthropic.com/v1/models",
        oauth: null,
        revision: "2026-10",
      },
      endpoint: "https://api.anthropic.com/v1",
      protocol: "anthropic-messages",
      kind: "api_key",
    };
    assert(
      confirmationOpenIntentSchema.safeParse({
        request: {
          kind: "secret_input",
          owner: "pvd_01arz3ndektsv4rrffq69g5fav",
          purpose: "provider_credential",
          connect,
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
          connect,
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
          connect: { ...connect, value: "raw-secret" },
        },
        parentWindow: "win-1",
      }).success,
    );
  },
);

Deno.test(
  "shell/confirmation-window#R6, lophn-agent/harness/provider#R6: provider 연결(Connect)과 끊기(Disconnect) 열기는 provider 전체를 가리키고 계정 key·교체·회수나 다른 목적과 함께 오지 않는다",
  () => {
    const owner = "pvd_01arz3ndektsv4rrffq69g5fav";
    const open = (request: Record<string, unknown>) =>
      confirmationOpenIntentSchema.safeParse({
        request: { kind: "secret_input", owner, ...request },
        parentWindow: "win-1",
      }).success;
    const purpose = "provider_credential";
    const definition = {
      key: "openai",
      display_name: "OpenAI",
      protocols: ["openai-responses"],
      auth_kinds: ["api_key", "oauth"],
      models_endpoint: "https://api.openai.com/v1/models",
      oauth: {
        product: "chatgpt",
        flow: "device_code_then_pkce_paste_url",
        issuer: "https://auth.openai.com",
        authorization_endpoint: "https://auth.openai.com/authorize",
        token_endpoint: "https://auth.openai.com/token",
        allowed_call_origins: ["https://api.openai.com"],
        scopes: ["openid"],
        verified_for_lophn: false,
      },
      revision: "2026-10",
    };
    const connect = {
      name: "OpenAI",
      definition,
      endpoint: "https://api.openai.com/v1",
      protocol: "openai-responses",
      kind: "api_key",
    };
    assert(open({ purpose, disconnect: true }));
    assert(!open({ purpose, disconnect: false }));
    assert(!open({ purpose: "app_secret", disconnect: true }));
    assert(!open({ purpose, disconnect: true, connect }));
    assert(open({ purpose, connect }));
    // OAuth 로그인은 시작한 login handle을 싣고, key는 싣지 않는다.
    assert(
      open({ purpose, connect: { ...connect, kind: "oauth", login: "h" } }),
    );
    assert(!open({ purpose, connect: { ...connect, kind: "oauth" } }));
    assert(!open({ purpose, connect: { ...connect, login: "h" } }));
    // 계정 교체·회수와 옛 등록 정보 field는 없다.
    assert(!open({ purpose, change: { key: "main", action: "replace" } }));
    assert(!open({ purpose, change: { key: "main", action: "revoke" } }));
    assert(
      !open({
        purpose,
        credential: {
          key: "main",
          kind: "api_key",
          label: "Main key",
          account: null,
          organization: null,
          plan: null,
        },
      }),
    );
    assert(
      confirmationOutcomeSchema.safeParse({
        outcome: "decided",
        secret_ref: "OpenAI",
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
        decision: "Rewind",
        targets: [SES, MSG],
        input: {
          kind: "inline",
          value: {
            id: RVT,
            session: SES,
            checkpoint: MSG,
            choice: "restore_all",
            accept_remaining: true,
            preview_hash: HASH,
          },
        },
        comparison: { preview_hash: HASH },
      },
      view: { kind: "rewind", restore: [], skip: [], remain: [] },
      state: "ready",
      decisions: ["Rewind"],
      second: true,
    });
    assertEquals(display.decisions, ["Rewind"]);
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

Deno.test(
  "shell/desktop#R47, platform/approvals#R18 [agent-I42]: approval 열기는 미리 고른 범위(allow_once·allow_session·deny)를 받고 계속 허락은 받지 않는다",
  () => {
    for (const preselect of ["allow_once", "allow_session", "deny"]) {
      assert(
        confirmationOpenIntentSchema.safeParse({
          request: { kind: "approval_request", approval: APR, preselect },
          parentWindow: "win-1",
        }).success,
        preselect,
      );
    }
    for (const preselect of ["always", "allow_always", "once", "", null]) {
      assert(
        !confirmationOpenIntentSchema.safeParse({
          request: { kind: "approval_request", approval: APR, preselect },
          parentWindow: "win-1",
        }).success,
        String(preselect),
      );
    }
    // 고정된 요청(표시 request)에는 미리 고른 범위가 없다.
    assert(
      !confirmationRequestSchema.safeParse({
        kind: "approval_request",
        approval: APR,
        created_seq: "4",
        binding_hash: HASH,
        preselect: "allow_once",
      }).success,
    );
  },
);
