// Launcher failure states for start failure, sandbox failure, schema incompatibility.
// Each state is a distinct launch failure that shows in the launcher without normal appearance.
import type { MessageKey } from "@lophn/wording";

export type StartFailureKind = "start" | "sandbox" | "schema";

export interface StartFailure {
  kind: StartFailureKind;
  /** 안쪽 오류 code. 사람 문구가 아니라 펼친 상세에만 보인다. */
  message: string;
  /** 안쪽 행동 code. 사람 문구가 아니라 펼친 상세에만 보인다. */
  nextAction: string;
  /** 화면에 보이는 사람 말(wording catalog key). */
  title: MessageKey;
  text: MessageKey;
}

/** Core 시작 실패: daemon lock 확인, 프로세스 상태 확인 실패, binary 못 찾음 */
export function startFailure(): StartFailure {
  return {
    kind: "start",
    message: "app-start-failed",
    nextAction: "retry-start-app",
    title: "launcher.title.start-failed",
    text: "launcher.failure.start-failed",
  };
}

/** Sandbox 실패: security settings 적용 불가, permissions 오류 */
export function sandboxFailure(): StartFailure {
  return {
    kind: "sandbox",
    message: "app-sandbox-failed",
    nextAction: "check-permissions",
    title: "launcher.title.sandbox-failed",
    text: "launcher.failure.sandbox-failed",
  };
}

/** Schema 비호환성: API contract 버전 mismatch, field missing */
export function schemaFailure(): StartFailure {
  return {
    kind: "schema",
    message: "app-schema-incompatible",
    nextAction: "check-update-available",
    title: "launcher.title.schema-incompatible",
    text: "launcher.failure.schema-incompatible",
  };
}
