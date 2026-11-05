// 거절은 필요한 permission 이름과 scope를 알린다. 이 값은 안내일 뿐
// grant를 주지 않는다. 실제 강제는 broker가 요청마다 선언∩grant로 한다.

export type CapabilityErrorCode =
  | "invalid_input"
  | "not_found"
  | "forbidden"
  | "unauthorized"
  | "conflict"
  | "unavailable"
  | "internal";

export type CapabilityErrorInit = {
  code: CapabilityErrorCode;
  message: string;
  permission?: string;
  scope?: Record<string, unknown>;
  // "unknown"이면 요청이 상대에 닿았는지 모른다. 외부 효과가 있는 호출을 다시 부르기 전에
  // 앱이 자기 계약으로 확인해야 한다.
  outcome?: "unknown";
};

export class CapabilityError extends Error {
  readonly code: CapabilityErrorCode;
  readonly permission?: string;
  readonly scope?: Record<string, unknown>;
  readonly outcome?: "unknown";

  constructor(init: CapabilityErrorInit) {
    super(init.message);
    this.name = "CapabilityError";
    this.code = init.code;
    this.permission = init.permission;
    this.scope = init.scope;
    this.outcome = init.outcome;
  }
}

const CODES = new Set<string>([
  "invalid_input",
  "not_found",
  "forbidden",
  "unauthorized",
  "conflict",
  "unavailable",
  "internal",
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

// broker 오류 envelope를 오류로 바꾼다. forbidden은 broker가 준 permission·scope를 그대로 싣고
// 없으면 요청이 쓴 값으로 채운다.
export function fromBroker(
  body: unknown,
  requested: { permission: string; scope: Record<string, unknown> },
): CapabilityError {
  const error = record(record(body)?.error);
  const code =
    typeof error?.code === "string" && CODES.has(error.code)
      ? (error.code as CapabilityErrorCode)
      : "unavailable";
  if (code !== "forbidden") {
    return new CapabilityError({
      code,
      message:
        typeof error?.message === "string"
          ? error.message
          : "broker request failed",
    });
  }
  const details = record(error?.details);
  const permission =
    typeof details?.permission === "string"
      ? details.permission
      : requested.permission;
  const scope = record(details?.scope) ?? requested.scope;
  return new CapabilityError({
    code,
    message: `${permission} ${JSON.stringify(
      scope,
    )} is not permitted. Declare this permission in the declaration and ask the person to grant it.`,
    permission,
    scope,
  });
}

export function missingHost(): CapabilityError {
  return new CapabilityError({
    code: "unavailable",
    message: "this code is not running inside a lophn app process",
  });
}
