// 작성 편의형. 검증과 정규화는 정본 validateBlueprint만 쓴다.
// 신뢰하지 않는 JSON은 validateBlueprint가 받는다. 작성형은 타입을 유지한다.

import {
  type Blueprint,
  type BlueprintOptions,
  validateBlueprint,
} from "../../protocol/apps/blueprint/mod.ts";

export function defineBlueprint(
  value: Blueprint,
  options?: BlueprintOptions,
): Blueprint {
  const result = validateBlueprint(value, options);
  if (!result.ok) throw new TypeError(result.error.message);
  return result.value;
}
