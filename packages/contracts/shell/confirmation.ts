import { z } from "zod";
import { ERROR_CODES, type ErrorCode } from "../../base/mod.ts";
import { errorBodySchema } from "../platform/errors.ts";
import { ID_PREFIXES, type IdPrefix, idSchema } from "../platform/ids.ts";
import { decisionNameSchema } from "../platform/confirmation-handle.ts";
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

// provider credential 입력(contracts#T29)의 값 아닌 등록 정보. 값과 준비 증거는 main이 붙인다.
const providerCredentialFieldsSchema = z.strictObject({
  key: z.string().regex(/\S/),
  kind: z.enum(["api_key", "oauth"]),
  label: z.string().regex(/\S/),
  account: z.string().regex(/\S/).nullable(),
  organization: z.string().regex(/\S/).nullable(),
  plan: z.string().regex(/\S/).nullable(),
  dedup_fingerprint: sha256Schema,
});

// preload가 창을 열 때 보내는 참조. command 본문·HTML·허락값은 받지 않는다.
// owner decision의 targets는 결정 대상의 고정 ID다(예: 되돌릴 run). main이 정본을 다시 읽는다.
const confirmationIntentSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("approval_request"),
    approval: idSchema("apr"),
  }),
  z.strictObject({
    kind: z.literal("question_option_action"),
    question: idSchema("qst"),
    option_key: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("owner_decision"),
    concern: concernSchema,
    decision: decisionNameSchema,
    targets: z.array(anyIdSchema).min(1).refine(unique, {
      message: "duplicate target",
    }).optional(),
  }),
  z.strictObject({
    kind: z.literal("secret_input"),
    owner: z.string().min(1),
    purpose: z.string().min(1),
    credential: providerCredentialFieldsSchema.optional(),
  }).refine(
    (value) =>
      value.credential === undefined || value.purpose === "provider_credential",
    { message: "credential fields belong to a provider credential input" },
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
  z.strictObject({
    kind: z.literal("question_option_action"),
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
    stored: z.enum(["stored", "unchanged"]),
  }),
  z.strictObject({ outcome: z.literal("dismissed") }),
]);

export type ConfirmationOutcome = z.infer<typeof confirmationOutcomeSchema>;

export const CONFIRMATION_IPC = {
  "shell:confirmation-open": confirmationOpenIntentSchema,
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
