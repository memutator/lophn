// 실패 note 옆에 보일 이유 글. source가 돌려주는 message는 core 오류 code(`conflict`,
// `unavailable`, `not_found`…)라서 그대로 보이지 않고 wording으로 옮긴다. 모르는 값은 internal이다.
import { t } from "@lophn/wording";

const REASONS = {
  invalid_input: "contexts.error.reason.invalid_input",
  unauthorized: "contexts.error.reason.unauthorized",
  forbidden: "contexts.error.reason.forbidden",
  not_found: "contexts.error.reason.not_found",
  conflict: "contexts.error.reason.conflict",
  unavailable: "contexts.error.reason.unavailable",
  internal: "contexts.error.reason.internal",
} as const;

export function errorReason(code: string): string {
  return t(
    Object.hasOwn(REASONS, code)
      ? REASONS[code as keyof typeof REASONS]
      : REASONS.internal,
  );
}
