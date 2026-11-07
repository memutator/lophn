import { z } from "zod";
import { secretNameSchema } from "../secrets/secrets.ts";
import { exceptionObservationInputSchema } from "../problems/exception-observation.ts";
import {
  invocationIdSchema,
  jsonValueSchema,
  processNonceSchema,
  releaseIdSchema,
  runtimeModeSchema,
  sha256Schema,
  toolKeySchema,
} from "./channel-values.ts";
import {
  noticeBodySchema,
  noticeKeySchema,
  noticeTitleSchema,
} from "./notice.ts";
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

export const NET_FETCH_BODY_MAX_BYTES = 10 * 1024 * 1024;
export const NET_FETCH_HEADERS_MAX = 32;
// 인증은 core가 useSecret으로 붙인다. 앱이 직접 넣지 못하는 header다.
export const NET_FETCH_FORBIDDEN_HEADERS = [
  "authorization",
  "cookie",
  "host",
  "content-length",
  "proxy-authorization",
];

export type NetFetchBody = string | { base64: string };

// 풀어 쓴 byte 수다. broker와 SDK가 같은 규칙을 본다(SDK는 protocol을 import할 수 없어
// 같은 규칙을 사본으로 둔다). base64는 padding 규칙에 맞는 값을 가정한다.
export function fetchBodyBytes(body: NetFetchBody): number {
  if (typeof body === "string") return new TextEncoder().encode(body).length;
  const text = body.base64;
  const pad = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  return (text.length / 4) * 3 - pad;
}

const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

// 전송부가 exact host·port·redirect와 grant를 매번 검사한다. 앱은 결과만 받는다.
export const brokerNetFetchInputSchema = z
  .strictObject({
    ...childFields,
    invocation: invocationIdSchema.nullable(),
    command: toolKeySchema,
    host: z.string().min(1),
    port: z.number().int().min(1).max(65535),
    method: z.string().min(1),
    path: z.string().min(1),
    headers: z
      .record(
        z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
        z
          .string()
          .max(4096)
          .refine((value) => !/[\r\n\0]/.test(value)),
      )
      .optional(),
    body: z
      .union([z.string(), z.strictObject({ base64: z.string().regex(BASE64) })])
      .optional(),
  })
  .superRefine((value, context) => {
    const headers = Object.keys(value.headers ?? {});
    if (headers.length > NET_FETCH_HEADERS_MAX) {
      context.addIssue({ code: "custom", message: "too many headers" });
    }
    if (
      headers.some((key) =>
        NET_FETCH_FORBIDDEN_HEADERS.includes(key.toLowerCase()),
      )
    ) {
      context.addIssue({ code: "custom", message: "header is not allowed" });
    }
    if (value.body === undefined) return;
    if (["GET", "HEAD"].includes(value.method.toUpperCase())) {
      context.addIssue({
        code: "custom",
        message: "GET and HEAD have no body",
      });
    }
    if (fetchBodyBytes(value.body) > NET_FETCH_BODY_MAX_BYTES) {
      context.addIssue({ code: "custom", message: "body is too large" });
    }
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
  command: toolKeySchema,
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

// 잡은 예외의 관측. app·release·mode는 자식 연결의 credential이 정하고 본문은 관측만 담는다.
export const brokerProblemObserveInputSchema = z.strictObject({
  ...childFields,
  observation: exceptionObservationInputSchema,
});

// source 자식 신원으로 제한된 다른 앱 connection 준비. 업무 payload는 중계하지 않는다.

// capability 거절은 필요한 permission 이름과 scope를 알린다.

// 앱이 사람에게 알린다. 호출 문맥(command·invocation)은 없다: 시작 코드와 flow에서도 부른다.
export const brokerNotifyInputSchema = z.strictObject({
  ...childFields,
  title: noticeTitleSchema,
  body: noticeBodySchema.optional(),
  key: noticeKeySchema.optional(),
  persistent: z.boolean().optional(),
});
export const brokerNotifyOutputSchema = z.strictObject({
  notified: z.literal(true),
});
