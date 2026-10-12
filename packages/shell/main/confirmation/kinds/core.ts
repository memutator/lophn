// 종류별 정본 read와 제출이 쓰는 core 통로. desktop/core/client.ts의 CoreSession 중
// main 안 통로(internal·upload)만 쓴다. renderer allowlist를 거치지 않으므로 renderer IPC는
// 이 통로를 부르지 못한다. 응답은 session이 contract route schema로 이미 검사했다.
import { contentBasis } from "../handle.ts";
import type { Canonical, SubmitReceipt } from "../coordinator.ts";

export type Called<T = unknown> = { ok: true; value: T } | {
  ok: false;
  error: { code: string; message: string; details?: unknown };
};

export interface KindCore {
  internal(
    kind: string,
    resource: string,
    method: string,
    body: unknown,
  ): Promise<Called>;
  upload(
    resource: string,
    method: string,
    input: unknown,
    bytes: Uint8Array,
  ): Promise<Called>;
}

export type Read =
  | { ok: true; value: Canonical }
  | { ok: false; error: { code: string; message: string } };

export type Sent =
  | { ok: true; value: SubmitReceipt }
  | { ok: false; unknown: true }
  | { ok: false; unknown: false; error: { code: string; message: string } };

export function failed(code: string, message: string): {
  ok: false;
  error: { code: string; message: string };
} {
  return { ok: false, error: { code, message } };
}

/** read 실패를 표시 이유로 옮긴다. 응답 details는 싣지 않는다. */
export function readFailure(result: Called): {
  ok: false;
  error: { code: string; message: string };
} {
  return result.ok
    ? failed("internal", "읽기 결과가 없다")
    : failed(result.error.code, result.error.message);
}

/**
 * core confirmationBinding과 같은 결합. 대상은 첫 binding field 값이고 내용 기준은 binding
 * field만 담은 canonical JSON의 sha256이다.
 */
export function bindingOf(
  fields: readonly string[],
  input: Record<string, unknown>,
): { target: string; content: Record<string, unknown>; hash: string } {
  const content: Record<string, unknown> = {};
  for (const field of fields) content[field] = input[field];
  return {
    target: String(input[fields[0] ?? ""]),
    content,
    hash: contentBasis(content),
  };
}

/** 결과를 모르면 receipt만 다시 본다. transport 단절과 unavailable이 그렇다. */
export async function sendCommand(
  core: KindCore,
  resource: string,
  method: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; value: unknown } | Exclude<Sent, { ok: true }>> {
  let result: Called;
  try {
    result = await core.internal("command", resource, method, body);
  } catch {
    return { ok: false, unknown: true };
  }
  if (result.ok) return result;
  if (result.error.code === "unavailable") return { ok: false, unknown: true };
  return {
    ok: false,
    unknown: false,
    error: { code: result.error.code, message: result.error.message },
  };
}

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
