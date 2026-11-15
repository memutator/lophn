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
  // 폰이 낸 이유다. unavailable이면 no_phone·phone_unreachable·unsupported·phone_in_background·
  // location_off·timeout 가운데 하나이고, forbidden이면 폰이 OS 위치 권한을 거절한 os_permission_denied다.
  reason?: string;
};

export class CapabilityError extends Error {
  readonly code: CapabilityErrorCode;
  readonly permission?: string;
  readonly scope?: Record<string, unknown>;
  readonly reason?: string;

  constructor(init: CapabilityErrorInit) {
    super(init.message);
    this.name = "CapabilityError";
    this.code = init.code;
    this.permission = init.permission;
    this.scope = init.scope;
    this.reason = init.reason;
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

// broker 오류 envelope를 오류로 바꾼다. details.reason은 reason으로 올린다. forbidden은 grant가 없다는 거절이면
// broker가 준 permission·scope를 그대로 싣고 없으면 요청이 쓴 값으로 채운다. 폰의 OS 권한 거절은 grant 문제가 아니라서
// permission·scope가 없다.
export function fromBroker(
  body: unknown,
  requested: { permission: string; scope: Record<string, unknown> },
): CapabilityError {
  const error = record(record(body)?.error);
  const details = record(error?.details);
  const code =
    typeof error?.code === "string" && CODES.has(error.code)
      ? (error.code as CapabilityErrorCode)
      : "unavailable";
  const reason =
    typeof details?.reason === "string" ? details.reason : undefined;
  if (code !== "forbidden" || reason !== undefined) {
    return new CapabilityError({
      code,
      message:
        typeof error?.message === "string"
          ? error.message
          : "broker request failed",
      reason,
    });
  }
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
