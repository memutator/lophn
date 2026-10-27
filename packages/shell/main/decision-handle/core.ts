// 결정 대상의 정본을 읽는 core 통로. desktop/core/client.ts의 CoreSession 중 main 안 통로(internal)만
// 쓴다. renderer allowlist를 거치지 않으므로 renderer IPC는 이 통로를 부르지 못한다.
import { contentBasis } from "./handle.ts";

export type Called<T = unknown> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: { code: string; message: string; details?: unknown };
    };

export interface DecisionCore {
  internal(
    kind: string,
    resource: string,
    method: string,
    body: unknown,
  ): Promise<Called>;
}

/** handle을 묶을 정본. 대상과 내용 기준, 쓸 수 있는 결정, 대상의 기한이다. */
interface Canonical {
  readonly targetRef: string;
  readonly content: Record<string, unknown>;
  readonly allowed: readonly string[];
  readonly expiresAt: string | null;
}

export type Read =
  | { ok: true; value: Canonical }
  | { ok: false; error: { code: string; message: string } };

export function failed(
  code: string,
  message: string,
): {
  ok: false;
  error: { code: string; message: string };
} {
  return { ok: false, error: { code, message } };
}

/** read 실패를 이유로 옮긴다. 응답 details는 싣지 않는다. */
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

export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
