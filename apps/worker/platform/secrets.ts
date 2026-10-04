// I/O worker의 secret 보호 입력(platform/secrets#R2).
// 원값은 pipe op secret.prepare의 callback 메모리로만 들어오고 JSON payload에는 없다.

import {
  err,
  type ErrorCode,
  ok,
  type Result,
} from "../../../packages/base/mod.ts";
import {
  type SecretPreparation,
  secretPrepare,
  secretPrepareInputSchema,
  type SecretValue,
} from "../../../packages/contracts/platform/mod.ts";
import type { SecretWork } from "../../../packages/platform/secrets/mod.ts";

export type SecretPipeRequest = {
  request_id: string;
  op: string;
  payload: unknown;
};

export type SecretPipeResponse =
  | { request_id: string; ok: true; payload: SecretPreparation }
  | {
    request_id: string;
    ok: false;
    error: { code: ErrorCode; message: string };
  };

export type SecretPipe = {
  // 값 callback은 core가 보호 입력 bytes를 메모리로만 넘길 때 부른다.
  handle(
    request: SecretPipeRequest,
    value: () => Promise<SecretValue | undefined>,
  ): Promise<SecretPipeResponse>;
};

const REJECTED = {
  code: "forbidden" as const,
  message: "보호 입력만 secret을 받는다",
};

export function createSecretPipe(work: SecretWork): SecretPipe {
  return {
    async handle(request, value) {
      if (request.op !== secretPrepare.name) {
        return { request_id: request.request_id, ok: false, error: REJECTED };
      }
      const parsed = secretPrepareInputSchema.safeParse(request.payload);
      if (!parsed.success) {
        return {
          request_id: request.request_id,
          ok: false,
          error: {
            code: "invalid_input",
            message: "보호 입력이 schema와 다르다",
          },
        };
      }
      const bytes = await value();
      if (bytes === undefined || byteLength(bytes) === 0) {
        return {
          request_id: request.request_id,
          ok: false,
          error: { code: "invalid_input", message: "보호 입력 값이 없다" },
        };
      }
      const prepared = await work.prepare(parsed.data, bytes);
      return prepared.ok
        ? { request_id: request.request_id, ok: true, payload: prepared.value }
        : {
          request_id: request.request_id,
          ok: false,
          error: { code: prepared.error.code, message: prepared.error.message },
        };
    },
  };
}

function byteLength(value: SecretValue): number {
  return typeof value === "string"
    ? new TextEncoder().encode(value).length
    : value.length;
}

export function rejectForeignSecretPath(op: string): Result<never> | undefined {
  if (op === secretPrepare.name) return undefined;
  return err(REJECTED);
}

export function preparedOnly(value: unknown): Result<SecretPreparation> {
  const parsed = secretPrepare.output.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err({ code: "invalid_input", message: "준비 결과가 schema와 다르다" });
}
