// context.hand_off_violations가 붙이는 근거를 만든다. 뼈대는 contracts의 evidenceOf(core가 호출 경계에서
// 같은 근거를 미리 준비하려고 같은 함수를 쓴다)이고, 여기서는 상태에서 적용된 판의 계약을 꺼내 건넨다.
import {
  type ContextValue,
  evidenceOf,
  type StoredViolation,
} from "../../../../protocol/projects/mod.ts";
import type { ContextApiState } from "./state.ts";

export {
  chooseViolations,
  keyOfViolation,
  sameViolationKey,
} from "../../../../protocol/projects/mod.ts";

export function buildEvidence(
  state: ContextApiState,
  context: ContextValue,
  violations: readonly StoredViolation[],
): Record<string, unknown> {
  const applied = context.applied_bundle === null
    ? undefined
    : state.bundles.get(context.applied_bundle);
  return evidenceOf(context.id, applied?.content.contract ?? null, violations);
}
