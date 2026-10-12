// 위반 한 줄의 문구. 순수 함수(추출·검사)는 문구 없이 위반을 내고, 읽기가 이 문구를 붙인다.
// 저장된 위반 목록(context.violations)과 context.preview가 같은 문구를 쓴다.
// rule 위반은 계약이 그 규칙에 적어 둔 message(CheckRule.message)를 그대로 쓴다. 계약을 모르거나
// 규칙을 찾지 못하면 규칙 이름으로 만든 문구를 쓴다. `contract`는 읽는 판(적용된 판, preview는 draft)의 계약이다.
import { ruleDefinitionOf } from "../../../../protocol/projects/mod.ts";

// 계약이 그 규칙(`Type.rule id`)에 적어 둔 message. 계약을 모르거나 규칙이 없으면 undefined다.
export function declaredRuleMessage(
  contract: unknown,
  rule: string | null,
): string | undefined {
  const declared = ruleDefinitionOf(contract, rule)?.message;
  return typeof declared === "string" && declared.trim() !== ""
    ? declared
    : undefined;
}

export function violationMessage(violation: {
  kind: string;
  rule: string | null;
  path: string;
  type: string | null;
  target: string | null;
}, contract?: unknown): string {
  const at = violation.target === null ? "" : ` (${violation.target})`;
  switch (violation.kind) {
    case "rule": {
      return declaredRuleMessage(contract, violation.rule) ??
        `${violation.rule ?? "rule"} is violated${at}`;
    }
    case "unreadable":
      return `${violation.path} cannot be read${at}`;
    case "path_mismatch":
      return `${violation.path} does not match the ${
        violation.type ?? "type"
      } pattern`;
    default:
      return `the link to ${violation.target ?? "its target"} does not resolve`;
  }
}
