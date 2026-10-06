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

// preload가 창을 열 때 보내는 참조. command 본문·HTML·허락값은 받지 않는다.
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
    // 결정할 대상 ID(예: 파일에서 뺄 문서). main이 이 ID로 정본을 따로 읽어 요청을 고정한다.
    targets: z.array(anyIdSchema).min(1).refine(unique, {
      message: "duplicate target",
    }).optional(),
  }),
  z.strictObject({
    kind: z.literal("secret_input"),
    owner: z.string().min(1),
    purpose: z.string().min(1),
  }),
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

// renderer가 보는 표시 자료. handle 원문 대신 이 창의 displayId만 담는다.
export const confirmationDisplaySchema = z.strictObject({
  displayId: z.string().min(1),
  request: confirmationRequestSchema,
});

export type ConfirmationDisplay = z.infer<typeof confirmationDisplaySchema>;

// input은 그 결정의 입력이다. secret 값은 이 입력으로만 들어오고 결과로 나가지 않는다.
export const confirmationSubmitSchema = z.strictObject({
  displayId: z.string().min(1),
  decision: decisionNameSchema,
  input: jsonObjectSchema.optional(),
});

export type ConfirmationSubmission = z.infer<typeof confirmationSubmitSchema>;

export const confirmationCancelSchema = z.strictObject({});

const receiptSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("entity"), id: anyIdSchema }),
  z.strictObject({ kind: z.literal("event"), seq: seqSchema }),
]);

export const confirmationOutcomeSchema = z.union([
  z.strictObject({ outcome: z.literal("decided"), receipt: receiptSchema }),
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
export type LophnConfirmation = {
  getDisplay(): Promise<ConfirmationDisplay>;
  submit(submission: ConfirmationSubmission): Promise<ConfirmationOutcome>;
  cancel(): Promise<ConfirmationOutcome>;
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
