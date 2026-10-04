function unique<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

import { z } from "zod";
import { versionIdSchema } from "../documents/values.ts";
import {
  errorBodySchema,
  idSchema,
  secretNameSchema,
} from "../platform/mod.ts";
import { problemCodeSchema } from "../problems/problem-codes.ts";
import { appConnectOutputSchema } from "./channel.ts";
import {
  appIdSchema,
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
export const brokerProblemReportInputSchema = z.strictObject({
  ...childFields,
  code: problemCodeSchema,
  details: jsonValueSchema.optional(),
  trace: z.string().max(TRACE_NAME_MAX_CHARS).optional(),
});
export const brokerProblemReportOutputSchema = z.object({
  report_id: idSchema("rpt"),
});

// source 자식 신원으로 제한된 다른 앱 connection 준비. 업무 payload는 중계하지 않는다.
export const brokerAppsConnectInputSchema = z.strictObject({
  ...childFields,
  app: appIdSchema,
  commands: z.array(commandKeySchema).min(1).refine(unique, {
    message: "duplicate command",
  }),
  parent_invocation: invocationIdSchema.nullable(),
});
export const brokerAppsConnectOutputSchema = appConnectOutputSchema;

// capability 거절은 필요한 permission 이름과 scope를 알린다(apps/sdk#R23).
export const brokerPermissionErrorSchema = errorBodySchema.refine(
  (value) =>
    value.error.code !== "forbidden" ||
    (typeof value.error.details?.permission === "string" &&
      value.error.details.scope !== undefined),
  { message: "forbidden needs the permission name and scope" },
);
