// 경계의 오류다. 앱 process는 파일 접근을 막지 않으므로 이 값은 보안 경계가 아니라 원인을 알리는 값이다.

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
