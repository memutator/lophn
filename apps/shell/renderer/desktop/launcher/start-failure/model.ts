// shell#T57 launcher failure states for start failure, sandbox failure, schema incompatibility.
// Each state is a distinct launch failure that shows in the launcher without normal appearance.

export type StartFailureKind = "start" | "sandbox" | "schema";

export interface StartFailure {
  kind: StartFailureKind;
  message: string;
  nextAction: string;
}

/** Core 시작 실패: daemon lock 확인, 프로세스 상태 확인 실패, binary 못 찾음 */
export function startFailure(): StartFailure {
  return {
    kind: "start",
    message: "app-start-failed",
    nextAction: "retry-start-app",
  };
}

/** Sandbox 실패: security settings 적용 불가, permissions 오류 */
export function sandboxFailure(): StartFailure {
  return {
    kind: "sandbox",
    message: "app-sandbox-failed",
    nextAction: "check-permissions",
  };
}

/** Schema 비호환성: API contract 버전 mismatch, field missing */
export function schemaFailure(): StartFailure {
  return {
    kind: "schema",
    message: "app-schema-incompatible",
    nextAction: "check-update-available",
  };
}
