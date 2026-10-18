import { z } from "zod";
import { secretNameSchema } from "../secrets/secrets.ts";
import { exceptionObservationInputSchema } from "../problems/exception-observation.ts";
import { reportAcceptanceSchema } from "../problems/reports.ts";
import {
  appApiKeySchema,
  invocationIdSchema,
  jsonValueSchema,
  processNonceSchema,
  releaseIdSchema,
  runtimeModeSchema,
  sha256Schema,
} from "./channel-values.ts";
import { readyAttestationInputSchema } from "./runtime.ts";

// 자식 credential·현재 mode·nonce에 묶인다. 신원은 요청 본문이 정하지 않는다.
const childFields = {
  process_nonce: processNonceSchema,
  mode: runtimeModeSchema,
};

export const brokerReadyInputSchema = z.strictObject({
  ...childFields,
  attestation: readyAttestationInputSchema,
  // 앱 시작이 DB를 바꿨을 때의 changeset(base64).
  start_changeset: z.string().nullable().optional(),
});

// 후행 기록 전달. 기록 사실의 정본은 invocation 전달 contract다.

// core 제어 연결이 살아 있는지. EOF면 새 호출부터 닫는다.

// 전송부가 exact host·port·redirect와 grant를 매번 검사한다. 앱은 결과만 받는다.
export const brokerNetFetchInputSchema = z.strictObject({
  ...childFields,
  invocation: invocationIdSchema.nullable(),
  command: appApiKeySchema,
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
  command: appApiKeySchema,
  input_hash: sha256Schema,
  name: secretNameSchema,
  destination: z.strictObject({
    // http는 loopback host의 목적지만이다(판정은 core의 secretAllowed).
    scheme: z.enum(["http", "https"]),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
  }),
});
export const brokerSecretUseOutputSchema = z.object({ used: z.literal(true) });

// 자기 앱의 선언 code 보고. problem을 닫는 통로는 없다.
// report id·발생 시각·invocation은 SDK가 첫 전송 전에 고정한 값이다. 없으면 supervisor가
// id와 시각을 정하고 invocation은 연결하지 않은 것으로 남긴다.
export const brokerProblemReportOutputSchema = reportAcceptanceSchema;

// 잡은 예외의 관측. app·release·mode는 자식 연결의 credential이 정하고 본문은 관측만 담는다.
export const brokerProblemObserveInputSchema = z.strictObject({
  ...childFields,
  observation: exceptionObservationInputSchema,
});

// source 자식 신원으로 제한된 다른 앱 connection 준비. 업무 payload는 중계하지 않는다.

// capability 거절은 필요한 permission 이름과 scope를 알린다.
