// context.hand_off_violations가 붙이는 근거를 만든다. 경로·section·규칙·현재 규칙 정의만 담고
// 문서 판이나 `doc@ver` 주소는 담지 않는다(contexts.md 정책 "근거").
import type {
  ContextValue,
  StoredViolation,
  ViolationKey,
} from "../../../contracts/documents/mod.ts";
import type { ContextApiState } from "./state.ts";

export function sameViolationKey(a: ViolationKey, b: ViolationKey): boolean {
  return a.kind === b.kind && a.rule === b.rule && a.path === b.path &&
    a.section === b.section;
}

export function keyOfViolation(violation: StoredViolation): ViolationKey {
  return {
    kind: violation.kind,
    rule: violation.rule,
    path: violation.path,
    section: violation.section,
  };
}

type RuleDefinition = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// `Type.rule id`가 가리키는 규칙을 적용된 판의 계약에서 찾는다. 없으면 null이다.
function currentRule(
  state: ContextApiState,
  context: ContextValue,
  violation: StoredViolation,
): RuleDefinition | null {
  if (violation.rule === null || context.applied_bundle === null) return null;
  const types = state.bundles.get(context.applied_bundle)?.content.contract;
  if (!isRecord(types) || !Array.isArray(types.types)) return null;
  const dot = violation.rule.indexOf(".");
  const typeName = violation.rule.slice(0, dot);
  const ruleId = violation.rule.slice(dot + 1);
  for (const type of types.types) {
    if (!isRecord(type) || type.name !== typeName) continue;
    if (!Array.isArray(type.rules)) return null;
    for (const rule of type.rules) {
      if (isRecord(rule) && rule.id === ruleId) return rule;
    }
  }
  return null;
}

export function buildEvidence(
  state: ContextApiState,
  context: ContextValue,
  violations: readonly StoredViolation[],
): Record<string, unknown> {
  return {
    context: context.id,
    violations: violations.map((violation) => ({
      kind: violation.kind,
      rule: violation.rule,
      type: violation.type,
      path: violation.path,
      section: violation.section,
      target: violation.target,
      message: violation.message,
      rule_definition: currentRule(state, context, violation),
    })),
  };
}
