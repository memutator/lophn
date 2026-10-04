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
  secretPurposeSchema,
  secretSend,
  secretSendInputSchema,
  type SecretSendOutput,
  secretStoreRefresh,
  secretStoreRefreshInputSchema,
  type SecretStoreRefreshOutput,
  type SecretValue,
} from "../../../packages/contracts/platform/mod.ts";
import type {
  ImportCommit,
  SecretAttach,
  SecretExchangeFile,
  SecretRecord,
  SecretRefresh,
  SecretSelection,
  SecretTransfer,
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
  | SecretStoreRefreshOutput
  | SecretExchangeFile
  | readonly ImportCommit[];

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

// contracts에 secret.export·secret.import가 생기기 전의 op 이름.
// 값은 JSON payload가 아니라 passphrase callback으로만 받는다.
export const SECRET_EXPORT_OP = "secret.export";
export const SECRET_IMPORT_OP = "secret.import";

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
  if (transfer === undefined) {
    return { request_id: request.request_id, ok: false, error: REJECTED };
  }
  const passphrase = await value();
  if (typeof passphrase !== "string" || passphrase.length === 0) {
    return {
      request_id: request.request_id,
      ok: false,
      error: { code: "invalid_input", message: "보호 입력 암호가 없다" },
    };
  }
  if (request.op === SECRET_EXPORT_OP) {
    const selection = selectionOf(request.payload);
    if (selection === undefined) {
      return {
        request_id: request.request_id,
        ok: false,
        error: { code: "invalid_input", message: "선택한 secret이 없다" },
      };
    }
    const exported = await transfer.exportSelected({ selection, passphrase });
    return exported.ok
      ? { request_id: request.request_id, ok: true, payload: exported.value }
      : {
        request_id: request.request_id,
        ok: false,
        error: { code: exported.error.code, message: exported.error.message },
      };
  }
  const file = fileOf(request.payload);
  const current = currentOf(request.payload);
  if (file === undefined || current === undefined) {
    return {
      request_id: request.request_id,
      ok: false,
      error: { code: "invalid_input", message: "보호 파일이 없다" },
    };
  }
  const imported = await transfer.importSelected({
    file,
    passphrase,
    current,
  });
  return imported.ok
    ? { request_id: request.request_id, ok: true, payload: imported.value }
    : {
      request_id: request.request_id,
      ok: false,
      error: { code: imported.error.code, message: imported.error.message },
    };
}

function selectionOf(payload: unknown): SecretSelection | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const body = payload as {
    records?: unknown;
    purpose?: unknown;
    owner?: unknown;
  };
  const purpose = secretPurposeSchema.safeParse(body.purpose);
  if (
    !Array.isArray(body.records) || !purpose.success ||
    typeof body.owner !== "string"
  ) return undefined;
  const records: SecretRecord[] = [];
  for (const entry of body.records) {
    if (typeof entry !== "object" || entry === null) return undefined;
    const record = entry as Record<string, unknown>;
    if (
      typeof record.name !== "string" || typeof record.sealedRef !== "string" ||
      typeof record.revision !== "number"
    ) return undefined;
    records.push({
      name: record.name,
      sealedRef: record.sealedRef,
      revision: record.revision,
    });
  }
  if (records.length === 0) return undefined;
  return { records, purpose: purpose.data, owner: body.owner };
}

function fileOf(payload: unknown): SecretExchangeFile | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const bytes = (payload as { bytes?: unknown }).bytes;
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) return undefined;
  return { bytes };
}

function currentOf(
  payload: unknown,
): ((name: string) => SecretRecord | undefined) | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const rows = (payload as { current?: unknown }).current;
  if (!Array.isArray(rows)) return undefined;
  const byName = new Map<string, SecretRecord>();
  for (const entry of rows) {
    if (typeof entry !== "object" || entry === null) return undefined;
    const record = entry as Record<string, unknown>;
    if (
      typeof record.name !== "string" || typeof record.sealedRef !== "string" ||
      typeof record.revision !== "number"
    ) return undefined;
    byName.set(record.name, {
      name: record.name,
      sealedRef: record.sealedRef,
      revision: record.revision,
    });
  }
  return (name) => byName.get(name);
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
