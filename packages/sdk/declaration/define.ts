// 작성 편의형. 검증과 정규화는 정본 validateDeclaration만 쓴다.
// 신뢰하지 않는 JSON은 validateDeclaration가 받는다. 작성형은 타입을 유지한다.

import {
  type AppDeclaration,
  type DeclarationOptions,
  validateDeclaration,
} from "../../protocol/apps/declaration/mod.ts";

export function defineApp(
  value: AppDeclaration,
  options?: DeclarationOptions,
): AppDeclaration {
  const result = validateDeclaration(value, options);
  if (!result.ok) throw new TypeError(result.error.message);
  return result.value;
}
