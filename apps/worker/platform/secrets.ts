// I/O worker의 secret 보호 경계(platform/secrets#R2, R5, R11).
// 원값은 pipe op의 callback 메모리로만 들어오고 JSON payload·응답에는 없다.

import {
  err,
  type ErrorCode,
  ok,
  type Result,
} from "../../../packages/base/mod.ts";
import {
  SECRET_EXPORT_OP,
  SECRET_IMPORT_OP,
  secretExportInputSchema,
  type SecretExportOutput,
  secretImportInputSchema,
  type SecretImportOutput,
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
} from "../../../packages/protocol/server/mod.ts";
import type {
  SecretAttach,
  SecretRefresh,
  SecretTransfer,
  SecretWork,
} from "../../../packages/core/secrets/mod.ts";

export type SecretPipeRequest = {
  request_id: string;
  op: string;
  payload: unknown;
};

export type SecretPipePayload =
  | SecretPreparation
  | SecretSendOutput
  | SecretStoreRefreshOutput
  | SecretExportOutput
  | SecretImportOutput;

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
  // 전송 부착·갱신 저장·이전은 신뢰 adapter 경계다. 없으면 그 op는 거절한다.
  attach?: SecretAttach;
  refresh?: SecretRefresh;
  transfer?: SecretTransfer;
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
      if (request.op === SECRET_EXPORT_OP || request.op === SECRET_IMPORT_OP) {
        return await handleTransfer(request, value, deps.transfer);
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

async function handleTransfer(
  request: SecretPipeRequest,
  value: () => Promise<SecretValue | undefined>,
  transfer: SecretTransfer | undefined,
): Promise<SecretPipeResponse> {
  if (transfer === undefined) return failed(request.request_id, REJECTED);
  const passphrase = await value();
  if (passphrase === undefined || byteLength(passphrase) === 0) {
    return failed(request.request_id, {
      code: "invalid_input",
      message: "보호 입력 암호가 없다",
    });
  }
  if (request.op === SECRET_EXPORT_OP) {
    const parsed = secretExportInputSchema.safeParse(request.payload);
    if (!parsed.success) return invalid(request.request_id);
    // 암호문 bytes는 callback 결과로만 받고 pipe 응답에는 크기만 남긴다.
    const exported = await transfer.exportBytes(parsed.data, passphrase);
    return answered(
      request.request_id,
      exported.ok
        ? ok({ format: 1 as const, ciphertext_bytes: exported.value.length })
        : exported,
    );
  }
  const parsed = secretImportInputSchema.safeParse(request.payload);
  if (!parsed.success) return invalid(request.request_id);
  const ciphertext = await value();
  if (!(ciphertext instanceof Uint8Array) || ciphertext.length === 0) {
    return failed(request.request_id, {
      code: "invalid_input",
      message: "보호 파일이 없다",
    });
  }
  return answered(
    request.request_id,
    await transfer.importBytes(parsed.data, passphrase, ciphertext),
  );
}

export function rejectForeignSecretPath(op: string): Result<never> | undefined {
  if (
    op === secretPrepare.name || op === secretSend.name ||
    op === secretStoreRefresh.name || op === SECRET_EXPORT_OP ||
    op === SECRET_IMPORT_OP
  ) return undefined;
  return err(REJECTED);
}

export function preparedOnly(value: unknown): Result<SecretPreparation> {
  const parsed = secretPrepare.output.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err({ code: "invalid_input", message: "준비 결과가 schema와 다르다" });
}
