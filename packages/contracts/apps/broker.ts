function unique<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

import { z } from "zod";
import { versionIdSchema } from "../documents/values.ts";
import {
  atSchema,
  errorBodySchema,
  idSchema,
  secretNameSchema,
} from "../platform/mod.ts";
import { problemCodeSchema } from "../problems/problem-codes.ts";
import { reportAcceptanceSchema } from "../problems/reports.ts";
import { invocationEvidenceInputSchema } from "../problems/snapshots.ts";
import { appConnectOutputSchema, signedConfirmProofSchema } from "./channel.ts";
import {
  appIdSchema,
  approvalIdSchema,
  AUTOMATION_CONCURRENCY_LIMIT,
  AUTOMATION_TIMEOUT_MS,
  BROKER_SOCKET_PATHS,
  commandKeySchema,
  invocationIdSchema,
  jsonValueSchema,
  processNonceSchema,
  releaseIdSchema,
  runtimeModeSchema,
  sha256Schema,
  TRACE_NAME_MAX_CHARS,
} from "./channel-values.ts";
import { readyAttestationInputSchema } from "./runtime.ts";

export {
  AUTOMATION_CONCURRENCY_LIMIT,
  AUTOMATION_TIMEOUT_MS,
  BROKER_SOCKET_PATHS,
};

// 자식 credential·현재 mode·nonce에 묶인다. 신원은 요청 본문이 정하지 않는다.
const childFields = {
  process_nonce: processNonceSchema,
  mode: runtimeModeSchema,
};

export const brokerReadyInputSchema = z.strictObject({
  ...childFields,
  attestation: readyAttestationInputSchema,
});
export const brokerReadyOutputSchema = z.object({ accepted: z.literal(true) });

// 후행 기록 전달. 기록 사실의 정본은 T35 invocation 전달 contract다.
export const brokerInvocationSubmitInputSchema = z.strictObject({
  ...childFields,
  invocation: invocationIdSchema,
  fact: z.enum(["start", "finish", "deny"]),
  summary: jsonValueSchema,
});
export const brokerInvocationSubmitOutputSchema = z.object({
  accepted: z.literal(true),
});

// core 제어 연결이 살아 있는지. EOF면 새 호출부터 닫는다(apps/runtime#R17).
export const brokerControlWatchOutputSchema = z.object({ open: z.boolean() });

const automationTurnFields = {
  ...childFields,
  release: releaseIdSchema,
  key: commandKeySchema,
};
export const brokerAutomationTryAcquireInputSchema = z.strictObject(
  automationTurnFields,
);
export const brokerAutomationTryAcquireOutputSchema = z.object({
  permit: z.boolean(),
  limit: z.literal(AUTOMATION_CONCURRENCY_LIMIT),
  timeout_ms: z.literal(AUTOMATION_TIMEOUT_MS),
});
export const brokerAutomationReleaseInputSchema = z.strictObject({
  ...automationTurnFields,
  invocation: invocationIdSchema,
});
export const brokerAutomationReleaseOutputSchema = z.object({
  released: z.literal(true),
});

// 전송부가 exact host·port·redirect와 grant를 매번 검사한다. 앱은 결과만 받는다.
export const brokerNetFetchInputSchema = z.strictObject({
  ...childFields,
  invocation: invocationIdSchema.nullable(),
  command: commandKeySchema,
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  method: z.string().min(1),
  path: z.string().min(1),
});
export const brokerNetFetchOutputSchema = z.object({
  status: z.number().int().min(100).max(599),
  body: jsonValueSchema,
});

// SecretUseContext의 앱 쪽 입력. 원값 get·CRUD가 아니고 안전한 사용 결과만 받는다.
export const brokerSecretUseInputSchema = z.strictObject({
  ...childFields,
  release: releaseIdSchema,
  invocation: invocationIdSchema.nullable(),
  command: commandKeySchema,
  input_hash: sha256Schema,
  name: secretNameSchema,
  destination: z.strictObject({
    scheme: z.literal("https"),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
  }),
});
export const brokerSecretUseOutputSchema = z.object({ used: z.literal(true) });

// 문서 저장 client의 앱 쪽 입력. 실제 확정은 documents/versions를 따른다.
// 문서 key는 blueprint DocumentDeclaration.key와 같다. 선언 대조는 runtime이다.
export const documentKeySchema = z.string().min(1).refine(
  (value) => value.trim().length > 0 && !/\p{Cc}/u.test(value),
  { message: "document key cannot be blank or contain controls" },
);

export const brokerDocumentSaveInputSchema = z.strictObject({
  ...childFields,
  key: documentKeySchema,
  base_version: versionIdSchema.nullable(),
  idempotency_key: z.string().min(1),
});
export const brokerDocumentSaveOutputSchema = z.object({
  saved: z.boolean(),
  version: versionIdSchema.nullable(),
});

// 자기 앱의 선언 code 보고. problem을 닫는 통로는 없다(apps/sdk#R26).
// report id·발생 시각·invocation은 SDK가 첫 전송 전에 고정한 값이다. 없으면 supervisor가
// id와 시각을 정하고 invocation은 연결하지 않은 것으로 남긴다.
export const brokerProblemReportInputSchema = z.strictObject({
  ...childFields,
  code: problemCodeSchema,
  details: jsonValueSchema.optional(),
  trace: z.string().max(TRACE_NAME_MAX_CHARS).optional(),
  report_id: idSchema("rpt").optional(),
  observed_at: atSchema.optional(),
  invocation: invocationEvidenceInputSchema.nullable().optional(),
});
export const brokerProblemReportOutputSchema = reportAcceptanceSchema;

// source 자식 신원으로 제한된 다른 앱 connection 준비. 업무 payload는 중계하지 않는다.
export const brokerAppsConnectInputSchema = z.strictObject({
  ...childFields,
  app: appIdSchema,
  commands: z.array(commandKeySchema).min(1).refine(unique, {
    message: "duplicate command",
  }),
  parent_invocation: invocationIdSchema.nullable(),
  // 지금 처리 중인 호출이 다른 앱에게서 받은 것이면 그 연결의 출처(받은 AppConnection의 caller
  // 식별)다. 준비 서비스가 자기가 발급한 origin 중 이 자식 프로세스가 받은 것과 맞춰 보고 path는
  // 서비스가 가진 값을 쓴다. 자식이 주장하는 path는 없다. 모르는 출처는 거절한다.
  incoming: z.strictObject({
    app: appIdSchema,
    release: releaseIdSchema,
    parent_invocation: invocationIdSchema.nullable(),
  }).optional(),
});
export const brokerAppsConnectOutputSchema = appConnectOutputSchema;

// 다른 앱의 confirm=true command 호출 준비(apps/connections#R3). 호출한 앱 자식이 정확한 대상·
// command·입력의 approval을 요청하고 사람의 결정을 poll로 기다려 서명된 proof를 받는다. 신원은
// 자식 연결이 정하며 입력 지문은 서비스가 대상의 고정 blueprint로 계산한다. proof는 approval이
// 적용돼 접수가 확정된 뒤에만 나온다.
export const APPS_CONFIRM_POLL_WAIT_MAX_MS = 5_000;

export const brokerAppsConfirmRequestInputSchema = z.strictObject({
  ...childFields,
  app: appIdSchema,
  command: commandKeySchema,
  input: jsonValueSchema.optional(),
  // 호출할 연결이 묶인 대상 프로세스. 다르면 conflict다.
  target_release: releaseIdSchema,
  target_process_nonce: processNonceSchema,
  parent_invocation: invocationIdSchema.nullable(),
});
export const brokerAppsConfirmRequestOutputSchema = z.object({
  approval: approvalIdSchema,
  input_hash: sha256Schema,
  state: z.literal("pending"),
});

export const brokerAppsConfirmPollInputSchema = z.strictObject({
  ...childFields,
  approval: approvalIdSchema,
  // 결정이 나기를 이 시간까지 기다린다. 소켓을 오래 잡지 않도록 짧게 제한한다.
  wait_ms: z.number().int().min(0).max(APPS_CONFIRM_POLL_WAIT_MAX_MS)
    .optional(),
});
export const brokerAppsConfirmPollOutputSchema = z.discriminatedUnion(
  "state",
  [
    z.object({ state: z.literal("pending") }),
    z.object({
      state: z.literal("granted"),
      invocation: invocationIdSchema,
      proof: signedConfirmProofSchema,
    }),
    z.object({ state: z.literal("rejected") }),
    z.object({ state: z.literal("expired") }),
  ],
);

// capability 거절은 필요한 permission 이름과 scope를 알린다(apps/sdk#R23).
export const brokerPermissionErrorSchema = errorBodySchema.refine(
  (value) =>
    value.error.code !== "forbidden" ||
    (typeof value.error.details?.permission === "string" &&
      value.error.details.scope !== undefined),
  { message: "forbidden needs the permission name and scope" },
);
