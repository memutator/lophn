import type { Contract } from "../../../../protocol/projects/mod.ts";
import { applyRule } from "./run-rules.ts";
import type { CheckEntity, ExternalKeys, RuleViolation } from "./types.ts";

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// 계약의 CheckRule을 개체에 적용해 rule 위반을 낸다. 순서는 path, kind, rule, section의 code unit 순이고
// section이 null이면 먼저다. 같은 키는 생성 순서(type, rule 선언 순, 개체 입력 순)를 지킨다.
export function checkEntities(
  contract: Contract,
  entities: readonly CheckEntity[],
  externalKeys: ExternalKeys,
): RuleViolation[] {
  const violations: RuleViolation[] = [];
  for (const type of contract.types) {
    const own = entities.filter((e) => e.type === type.name);
    for (const rule of type.rules) {
      violations.push(
        ...applyRule(rule, {
          type,
          entities: own,
          allEntities: entities,
          externalKeys,
        }),
      );
    }
  }
  return violations.sort((a, b) =>
    compare(a.path, b.path) || compare(a.kind, b.kind) ||
    compare(a.rule, b.rule) ||
    (a.section === b.section
      ? 0
      : a.section === null
      ? -1
      : b.section === null
      ? 1
      : compare(a.section, b.section))
  );
}
