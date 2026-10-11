// context API의 blob 이름과 직렬화, 위반 넘김 근거다. 호출 경계(core의 준비)와 command(ledger의 등록)가
// 같은 값에서 같은 bytes·같은 hash를 만들어야 해서 두 쪽이 함께 쓰는 순수 함수를 여기 둔다.
import { canonicalize } from "../../base/mod.ts";
import type {
  ContextValue,
  StoredViolation,
  ViolationKey,
} from "./context-api.ts";

// content blob(BundleContent JSON, 위반 넘김 근거, 그 근거를 옮긴 요청 글)의 준비 목적과 영구 참조.
// owner_key는 blob의 hash다: 내용으로 주소를 정한 값이라 같은 내용은 한 참조다.
export const CONTEXT_CONTENT_PURPOSE = "context_content";
export const CONTEXT_CONTENT_OWNER_KIND = "context_content";
export const CONTEXT_CONTENT_FIELD = "content";

const encoder = new TextEncoder();

// blob에 들어가는 바이트다. 키를 정렬한 정규 JSON이라 같은 값은 같은 바이트다.
export function contextContentBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalize(value));
}

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

// 넘길 위반을 고른다. 요청이 없으면 저장된 전부, 있으면 요청한 키마다 하나(없거나 겹치면 err).
export function chooseViolations(
  stored: readonly StoredViolation[],
  wanted: readonly ViolationKey[] | undefined,
): { ok: true; value: StoredViolation[] } | {
  ok: false;
  reason: "missing" | "duplicate";
  path: string;
} {
  if (wanted === undefined) return { ok: true, value: [...stored] };
  const chosen: StoredViolation[] = [];
  for (const key of wanted) {
    const found = stored.find((row) =>
      sameViolationKey(keyOfViolation(row), key)
    );
    if (!found) return { ok: false, reason: "missing", path: key.path };
    if (chosen.includes(found)) {
      return { ok: false, reason: "duplicate", path: key.path };
    }
    chosen.push(found);
  }
  return { ok: true, value: chosen };
}

type RuleDefinition = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// `Type.rule id`가 가리키는 규칙을 적용된 판의 계약에서 찾는다. 없으면 null이다.
function currentRule(
  contract: unknown,
  violation: StoredViolation,
): RuleDefinition | null {
  if (violation.rule === null) return null;
  if (!isRecord(contract) || !Array.isArray(contract.types)) return null;
  const dot = violation.rule.indexOf(".");
  const typeName = violation.rule.slice(0, dot);
  const ruleId = violation.rule.slice(dot + 1);
  for (const type of contract.types) {
    if (!isRecord(type) || type.name !== typeName) continue;
    if (!Array.isArray(type.rules)) return null;
    for (const rule of type.rules) {
      if (isRecord(rule) && rule.id === ruleId) return rule;
    }
  }
  return null;
}

const text = (value: string | null): string => value ?? "";

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// 근거 안의 위반은 읽기와 같은 순서(path, kind, rule, section, target, type의 code unit 순)로
// 둔다. 어디서 읽은 목록이든 같은 위반 집합은 같은 근거 bytes가 된다.
function inEvidenceOrder(
  violations: readonly StoredViolation[],
): StoredViolation[] {
  const keyOf = (v: StoredViolation) => [
    v.path,
    v.kind,
    text(v.rule),
    text(v.section),
    text(v.target),
    text(v.type),
  ];
  return [...violations].sort((a, b) => {
    const left = keyOf(a);
    const right = keyOf(b);
    for (let i = 0; i < left.length; i++) {
      const diff = compareCodeUnits(left[i]!, right[i]!);
      if (diff !== 0) return diff;
    }
    return 0;
  });
}

// context.hand_off_violations가 붙이는 근거를 만든다. 경로·section·규칙·현재 규칙 정의만 담고
// 문서 판이나 `doc@ver` 주소는 담지 않는다(contexts.md 정책 "근거"). contract는 적용된 판 content의
// contract다(적용된 판이 없으면 null).
export function evidenceOf(
  context: ContextValue["id"],
  contract: unknown,
  violations: readonly StoredViolation[],
): Record<string, unknown> {
  return {
    context,
    violations: inEvidenceOrder(violations).map((violation) => ({
      kind: violation.kind,
      rule: violation.rule,
      type: violation.type,
      path: violation.path,
      section: violation.section,
      target: violation.target,
      message: violation.message,
      rule_definition: currentRule(contract, violation),
    })),
  };
}
