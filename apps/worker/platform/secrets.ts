// I/O worker의 secret 보호 경계(platform/secrets#R2, R5, R11).
// 원값은 pipe op의 callback 메모리로만 들어오고 JSON payload·응답에는 없다.

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
  secretSend,
  secretSendInputSchema,
  type SecretSendOutput,
  secretStoreRefresh,
  secretStoreRefreshInputSchema,
  type SecretStoreRefreshOutput,
  type SecretValue,
} from "../../../packages/contracts/platform/mod.ts";
import type {
  SecretAttach,
  SecretRefresh,
  SecretWork,
} from "../../../packages/platform/secrets/mod.ts";

export type SecretPipeRequest = {
  request_id: string;
  op: string;
  payload: unknown;
};

export type SecretPipePayload =
  | SecretPreparation
  | SecretSendOutput
  | SecretStoreRefreshOutput;

export type SecretPipeResponse =
  | { request_id: string; ok: true; payload: SecretPipePayload }
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

export type SecretPipeDeps = {
  work: SecretWork;
  // 전송 부착·갱신 저장은 신뢰 adapter 경계다. 없으면 그 op는 거절한다.
  attach?: SecretAttach;
  refresh?: SecretRefresh;
};

export function createSecretPipe(deps: SecretPipeDeps): SecretPipe {
  return {
    async handle(request, value) {
      if (request.op === secretSend.name) {
        return await runSend(deps.attach, request, value);
      }
      if (request.op === secretStoreRefresh.name) {
        return await runRefresh(deps.refresh, request, value);
      }
      if (request.op !== secretPrepare.name) {
        return failed(request.request_id, REJECTED);
      }
      const parsed = secretPrepareInputSchema.safeParse(request.payload);
      if (!parsed.success) return invalid(request.request_id);
      const bytes = await value();
      if (bytes === undefined || byteLength(bytes) === 0) {
        return failed(request.request_id, {
          code: "invalid_input",
          message: "보호 입력 값이 없다",
        });
      }
      return answered(
        request.request_id,
        await deps.work.prepare(parsed.data, bytes),
      );
    },
  };
}

async function runSend(
  attach: SecretAttach | undefined,
  request: SecretPipeRequest,
  value: () => Promise<SecretValue | undefined>,
): Promise<SecretPipeResponse> {
  if (attach === undefined) return failed(request.request_id, REJECTED);
  const parsed = secretSendInputSchema.safeParse(request.payload);
  if (!parsed.success) return invalid(request.request_id);
  // 전송 callback은 값을 메모리에서만 받는다. pipe 응답은 전송 여부뿐이다.
  return answered(
    request.request_id,
    await attach.send(parsed.data, async (secret) => {
      void secret;
      const delivered = await value();
      return delivered === undefined
        ? err({
          code: "unavailable",
          message: "전송 callback을 사용할 수 없다",
        })
        : ok({ sent: true });
    }),
  );
}

async function runRefresh(
  refresh: SecretRefresh | undefined,
  request: SecretPipeRequest,
  value: () => Promise<SecretValue | undefined>,
): Promise<SecretPipeResponse> {
  if (refresh === undefined) return failed(request.request_id, REJECTED);
  const parsed = secretStoreRefreshInputSchema.safeParse(request.payload);
  if (!parsed.success) return invalid(request.request_id);
  return answered(request.request_id, await refresh.store(parsed.data, value));
}

function answered<T extends SecretPipePayload>(
  requestId: string,
  result: Result<T>,
): SecretPipeResponse {
  return result.ok
    ? { request_id: requestId, ok: true, payload: result.value }
    : failed(requestId, {
      code: result.error.code,
      message: result.error.message,
    });
}

function invalid(requestId: string): SecretPipeResponse {
  return failed(requestId, {
    code: "invalid_input",
    message: "보호 입력이 schema와 다르다",
  });
}

function failed(
  requestId: string,
  error: { code: ErrorCode; message: string },
): SecretPipeResponse {
  return { request_id: requestId, ok: false, error };
}

function byteLength(value: SecretValue): number {
  return typeof value === "string"
    ? new TextEncoder().encode(value).length
    : value.length;
}

export function rejectForeignSecretPath(op: string): Result<never> | undefined {
  if (
    op === secretPrepare.name || op === secretSend.name ||
    op === secretStoreRefresh.name
  ) return undefined;
  return err(REJECTED);
}

export function preparedOnly(value: unknown): Result<SecretPreparation> {
  const parsed = secretPrepare.output.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err({ code: "invalid_input", message: "준비 결과가 schema와 다르다" });
}
