import { z } from "zod";
import { ERROR_CODES, type ErrorCode } from "../../base/mod.ts";
import { errorBodySchema } from "../platform/errors.ts";
import { ID_PREFIXES, type IdPrefix, idSchema } from "../platform/ids.ts";
import { decisionNameSchema } from "../platform/confirmation-handle.ts";
import {
  providerDefinitionSchema,
  providerProtocolSchema,
} from "../lophn-agent/provider-values.ts";
import { seqSchema, sha256Schema } from "../platform/values.ts";

// shell 크롬의 외부 링크는 확인 없이 OS 브라우저로 연다(D21). 종류에 없다.
export const CONFIRMATION_REQUEST_KINDS = [
  "approval_request",
  "question_option_action",
  "owner_decision",
  "secret_input",
] as const;

export type ConfirmationRequestKind =
  (typeof CONFIRMATION_REQUEST_KINDS)[number];

const CONCERN = /^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)+$/;

const concernSchema = z.string().regex(CONCERN);

function isIdPrefix(prefix: string): prefix is IdPrefix {
  return Object.hasOwn(ID_PREFIXES, prefix);
}

const anyIdSchema = z.string().refine(
  (value) => {
    const prefix = value.slice(0, value.indexOf("_"));
    return isIdPrefix(prefix) && idSchema(prefix).safeParse(value).success;
  },
  { message: "invalid id" },
);

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

// 정확한 입력. 큰 입력은 blob 참조로 고정한다(domain-model ApprovalAction.input).
const fixedInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("inline"),
    value: z.record(z.string(), z.json()),
  }),
  z.strictObject({ kind: z.literal("blob"), sha256: sha256Schema }),
]);

const jsonObjectSchema = z.record(z.string(), z.json());

// provider 연결(Connect)의 값 아닌 등록 정보. provider는 아직 없고 보호 창이 받은 값의 준비 증거와 함께
// RegisterProvider로 등록한다. OAuth는 시작한 login handle을 싣는다(login-complete가 받는다).
const providerConnectFieldsSchema = z.strictObject({
  name: z.string().regex(/\S/),
  definition: providerDefinitionSchema,
  endpoint: z.string().min(1),
  protocol: providerProtocolSchema,
  kind: z.enum(["api_key", "oauth"]),
  login: z.string().regex(/\S/).optional(),
}).refine((value) => (value.kind === "oauth") === (value.login !== undefined), {
  message: "only an OAuth connection carries its login handle",
});

// preload가 창을 열 때 보내는 참조. command 본문·HTML·허락값은 받지 않는다.
// owner decision의 targets는 결정 대상의 고정 ID다(예: 되돌릴 run). main이 정본을 다시 읽는다.
const confirmationIntentSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("approval_request"),
    approval: idSchema("apr"),
    // 대화 안 승인 카드가 미리 고른 결정. 창은 이 선택을 보이게 열 뿐 결정을 제출하지 않는다.
    // 계속 허락(Always)은 없다(platform/approvals#R18).
    preselect: z.enum(["allow_once", "allow_session", "deny"]).optional(),
  }),
  // 고정 action 선택지는 질문 하나짜리 묶음에만 있다. 정본 참조는 묶음이다.
  z.strictObject({
    kind: z.literal("question_option_action"),
    group: idSchema("qgr"),
    option_key: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("owner_decision"),
    concern: concernSchema,
    decision: decisionNameSchema,
    targets: z.array(anyIdSchema).min(1).refine(unique, {
      message: "duplicate target",
    }).optional(),
    automation: z.string().min(1).optional(),
    requirement: z.number().int().nonnegative().optional(),
    // 문제 결정(problems/closing)에서 사람이 고른 결정과 dismiss의 한 줄 이유. 창은 이 값을
    // 그대로 보이고, main은 문제를 독립 read해 handle을 묶는다.
    choice: z.enum(["fixed", "not_fixed", "not_visible", "dismiss"]).optional(),
    note: z.string().regex(/^[^\r\n]*\S[^\r\n]*$/).optional(),
  }),
  z.strictObject({
    kind: z.literal("secret_input"),
    owner: z.string().min(1),
    purpose: z.string().min(1),
    // provider 연결(Connect). owner는 만들 provider의 ID다.
    connect: providerConnectFieldsSchema.optional(),
    // provider 끊기(DisconnectProvider). owner는 끊을 provider의 ID다.
    disconnect: z.literal(true).optional(),
  }).refine(
    (value) =>
      (value.connect === undefined && value.disconnect === undefined) ||
      (value.purpose === "provider_credential" &&
        (value.connect === undefined || value.disconnect === undefined)),
    {
      message:
        "a connect or a disconnect belongs to a provider credential input",
    },
  ),
]);

export type ConfirmationIntent = z.infer<typeof confirmationIntentSchema>;

// main service가 받는 고정 요청. 표시와 제출은 이 자료 하나에서 만든다.
export const confirmationRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("approval_request"),
    approval: idSchema("apr"),
    created_seq: seqSchema,
    binding_hash: sha256Schema,
  }),
  // `question`은 묶음의 유일한 질문이다. main이 정본에서 채워 action 답의 evidence에 쓴다.
  z.strictObject({
    kind: z.literal("question_option_action"),
    group: idSchema("qgr"),
    question: idSchema("qst"),
    option_key: z.string().min(1),
    created_seq: seqSchema,
    binding_hash: sha256Schema,
  }),
  z.strictObject({
    kind: z.literal("owner_decision"),
    concern: concernSchema,
    decision: decisionNameSchema,
    targets: z.array(anyIdSchema).min(1).refine(unique, {
      message: "duplicate target",
    }),
    input: fixedInputSchema,
    comparison: jsonObjectSchema,
  }),
  z.strictObject({
    kind: z.literal("secret_input"),
    owner: z.string().min(1),
    purpose: z.string().min(1),
  }),
]);

export type ConfirmationRequest = z.infer<typeof confirmationRequestSchema>;

export const confirmationOpenIntentSchema = z.strictObject({
  request: confirmationIntentSchema,
  parentWindow: z.string().min(1),
});

export type ConfirmationOpenIntent = z.infer<
  typeof confirmationOpenIntentSchema
>;

export const confirmationOpenInputSchema = z.strictObject({
  request: confirmationRequestSchema,
  comparison: jsonObjectSchema,
  parentWindow: z.string().min(1),
});

export type ConfirmationOpenInput = z.infer<typeof confirmationOpenInputSchema>;

export const confirmationOpenResultSchema = z.union([
  z.strictObject({
    windowId: z.string().min(1),
    displayId: z.string().min(1),
  }),
  errorBodySchema,
]);

export type ConfirmationOpenResult = z.infer<
  typeof confirmationOpenResultSchema
>;

export const CONFIRMATION_DISPLAY_STATES = [
  "ready",
  "stale",
  "expired",
  "unknown",
  "submitted",
] as const;

// renderer가 보는 표시 자료. handle 원문 대신 이 창의 displayId만 담는다.
// view는 main이 독립 read로 만든 종류별 표시 값(redaction된 글·정확한 대상·입력)이고,
// decisions는 지금 누를 수 있는 결정 이름이다. second면 결정 전에 영향·범위를 다시 보인다.
export const confirmationDisplaySchema = z.strictObject({
  displayId: z.string().min(1),
  request: confirmationRequestSchema,
  view: jsonObjectSchema.optional(),
  state: z.enum(CONFIRMATION_DISPLAY_STATES).optional(),
  decisions: z.array(decisionNameSchema).optional(),
  second: z.boolean().optional(),
});

export type ConfirmationDisplay = z.infer<typeof confirmationDisplaySchema>;

// input은 그 결정의 입력이다. secret 값은 이 입력으로만 들어오고 결과로 나가지 않는다.
export const confirmationSubmitSchema = z.strictObject({
  displayId: z.string().min(1),
  decision: decisionNameSchema,
  input: jsonObjectSchema.optional(),
  // 2차 확인 단계에서 영향과 범위를 다시 본 뒤의 제출이다.
  confirmedSecond: z.boolean().optional(),
});

export type ConfirmationSubmission = z.infer<typeof confirmationSubmitSchema>;

export const confirmationCancelSchema = z.strictObject({});

const receiptSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("entity"), id: anyIdSchema }),
  z.strictObject({ kind: z.literal("event"), seq: seqSchema }),
]);

// 결정 접수와 실제 적용을 구별한다. accepted는 결정만 받았고 동작은 따로 돈다.
// 나머지는 결정 자체가 적용인 command(RevertRun)의 결과다.
export const CONFIRMATION_RESULTS = [
  "accepted",
  "applying",
  "applied",
  "partial",
  "uncertain",
  "blocked",
] as const;

export const confirmationOutcomeSchema = z.union([
  z.strictObject({
    outcome: z.literal("decided"),
    receipt: receiptSchema,
    result: z.enum(CONFIRMATION_RESULTS).optional(),
  }),
  z.strictObject({
    outcome: z.literal("decided"),
    secret_ref: z.string().min(1),
    stored: z.enum(["stored", "unchanged", "revoked"]),
  }),
  z.strictObject({ outcome: z.literal("dismissed") }),
]);

export type ConfirmationOutcome = z.infer<typeof confirmationOutcomeSchema>;

// 확인이 확정되지 않은 채 끝난 종류. 사람의 거절(rejected)과 닫기·취소, 만료·교체가 모두 여기 든다.
export const CONFIRMATION_ENDED_KINDS = [
  "cancelled",
  "closed",
  "crashed",
  "expired",
  "replaced",
  "rejected",
] as const;

// main이 확인을 연 창에게만 보내는 끝남 알림. 어느 요청이었는지 알아보는 windowId(열기 결과로
// 받은 값)와 끝난 종류만 있고 확인 내용·대상·proof는 싣지 않는다. 허락은 알리지 않는다.
export const confirmationEndedSchema = z.strictObject({
  windowId: z.string().min(1),
  ended: z.enum(CONFIRMATION_ENDED_KINDS),
});

export type ConfirmationEnded = z.infer<typeof confirmationEndedSchema>;

export const CONFIRMATION_IPC = {
  "shell:confirmation-open": confirmationOpenIntentSchema,
  "shell:confirmation-ended": confirmationEndedSchema,
  "confirmation:display": confirmationDisplaySchema,
  "confirmation:submit": confirmationSubmitSchema,
  "confirmation:cancel": confirmationCancelSchema,
} as const;

export type ConfirmationIpc = keyof typeof CONFIRMATION_IPC;

// 일반 preload. 창을 열 뿐 결정을 제출하지 못한다.
export type LophnShell = {
  openConfirmation(
    intent: ConfirmationOpenIntent,
  ): Promise<ConfirmationOpenResult>;
  // 연 창만 자기가 연 확인이 확정되지 않고 끝났을 때 알림을 받는다.
  onConfirmationEnded(listener: (ended: ConfirmationEnded) => void): () => void;
};

// 보호 preload. 이 창의 표시 읽기·결정 제출·취소만 있다.
// subscribe는 main이 표시를 다시 고정했을 때(대상 변경·만료·제출) 새 표시를 받는다.
export type LophnConfirmation = {
  getDisplay(): Promise<ConfirmationDisplay>;
  submit(submission: ConfirmationSubmission): Promise<ConfirmationOutcome>;
  cancel(): Promise<ConfirmationOutcome>;
  subscribe?(listener: (display: ConfirmationDisplay) => void): () => void;
};

// architecture/shell 5.1이 적는 오류. internal은 결정 경계의 결과가 아니다.
export const CONFIRMATION_ERRORS = [
  "invalid_input",
  "not_found",
  "forbidden",
  "unauthorized",
  "conflict",
  "unavailable",
] as const satisfies readonly ErrorCode[];

const knownErrors: readonly string[] = ERROR_CODES;
for (const code of CONFIRMATION_ERRORS) {
  if (!knownErrors.includes(code)) {
    throw new Error("confirmation error code is outside the common seven");
  }
}
