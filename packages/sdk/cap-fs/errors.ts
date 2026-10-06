// 거절은 필요한 permission 이름과 scope를 알린다(apps/sdk#R23). 이 값은 안내일 뿐
// grant를 주지 않는다. 실제 강제는 Deno flag이고 SDK 검사는 보안 경계가 아니다.

export type CapabilityErrorCode =
  | "invalid_input"
  | "not_found"
  | "forbidden"
  | "conflict"
  | "unavailable";

export type CapabilityErrorInit = {
  code: CapabilityErrorCode;
  message: string;
  permission?: string;
  scope?: Record<string, unknown>;
};

export class CapabilityError extends Error {
  readonly code: CapabilityErrorCode;
  readonly permission?: string;
  readonly scope?: Record<string, unknown>;

  constructor(init: CapabilityErrorInit) {
    super(init.message);
    this.name = "CapabilityError";
    this.code = init.code;
    this.permission = init.permission;
    this.scope = init.scope;
  }
}

export function forbidden(
  permission: string,
  scope: Record<string, unknown>,
): CapabilityError {
  return new CapabilityError({
    code: "forbidden",
    message: `${permission} ${
      JSON.stringify(scope)
    } is not permitted. Declare this permission in the blueprint and ask the person to grant it.`,
    permission,
    scope,
  });
}
