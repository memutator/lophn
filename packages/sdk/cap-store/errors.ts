// 거절은 필요한 permission 이름과 scope를 알린다(apps/sdk#R23). 이 값은 안내일 뿐
// grant를 주지 않는다.

export type CapabilityErrorCode =
  | "invalid_input"
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
