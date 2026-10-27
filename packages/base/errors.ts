export const ERROR_CODES = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
  "internal",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type LophnError = {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
};

// 경계 밖으로 나가는 오류에는 원문·stack이 없다.
const INTERNAL_MESSAGE = "internal error";

export function internalError(): LophnError {
  return { code: "internal", message: INTERNAL_MESSAGE };
}

export function asInternalError(_thrown: unknown): LophnError {
  return internalError();
}

// 던져진 file·process 오류의 code(`ENOENT`, `EEXIST` …)다. code가 없으면 undefined다.
export function errorCode(thrown: unknown): string | undefined {
  const code = (thrown as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}
