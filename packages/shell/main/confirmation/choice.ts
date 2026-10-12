// approval request의 결정 이름과, 사람이 창에서 고른 범위를 결정에서 읽는 규칙.
// 범위(scope)는 confirmation 내용(binding)에 묶이므로 coordinator가 handle을 그 범위에 맞춘다.
import type { ApprovalPreselect } from "./types.ts";

export const GRANT = "grant_approval_request";
export const REJECT = "reject_approval_request";
export const CANCEL = "cancel_approval_request";

/**
 * 결정과 그 입력에서 사람이 고른 범위를 읽는다.
 * - 거절은 범위가 없다(deny). 입력의 scope는 보지 않는다.
 * - 허락은 입력의 scope(once | session, 빠지면 once)다. 계속 허락 같은 값은 받지 않는다.
 * - 그 밖의 결정(명시 취소)은 범위를 바꾸지 않는다(null).
 */
export function chosenPreselect(
  decision: string,
  commandInput: unknown,
): { ok: true; preselect: ApprovalPreselect | null } | { ok: false } {
  if (decision === REJECT) return { ok: true, preselect: "deny" };
  if (decision !== GRANT) return { ok: true, preselect: null };
  const input = commandInput !== null && typeof commandInput === "object"
    ? commandInput as Record<string, unknown>
    : {};
  const scope = input.scope;
  if (scope === undefined || scope === "once") {
    return { ok: true, preselect: "allow_once" };
  }
  if (scope === "session") return { ok: true, preselect: "allow_session" };
  return { ok: false };
}
