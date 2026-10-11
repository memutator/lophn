import type { Contract } from "../../../contracts/documents/mod.ts";
import type { CheckEntity, ExternalKeys, RuleViolation } from "./types.ts";

// 계약의 CheckRule을 개체에 적용해 rule 위반을 낸다. 순서는 path, kind, rule, section의 code unit 순이다.
// 아직 구현하지 않았다(spec 단계).
export function checkEntities(
  _contract: Contract,
  _entities: readonly CheckEntity[],
  _externalKeys: ExternalKeys,
): RuleViolation[] {
  return [];
}
