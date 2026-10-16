// context API의 blob 이름과 직렬화다. 호출 경계(core의 준비)와 command(ledger의 등록)가
// 같은 값에서 같은 bytes·같은 hash를 만들어야 해서 두 쪽이 함께 쓰는 순수 함수를 여기 둔다.
import { canonicalize } from "../../base/mod.ts";

// content blob(BundleContent JSON)의 준비 목적과 영구 참조.
// owner_key는 blob의 hash다: 내용으로 주소를 정한 값이라 같은 내용은 한 참조다.
export const CONTEXT_CONTENT_PURPOSE = "context_content";
export const CONTEXT_CONTENT_OWNER_KIND = "context_content";
export const CONTEXT_CONTENT_FIELD = "content";

const encoder = new TextEncoder();

// blob에 들어가는 바이트다. 키를 정렬한 정규 JSON이라 같은 값은 같은 바이트다.
export function contextContentBytes(value: unknown): Uint8Array {
  return encoder.encode(canonicalize(value));
}

type RuleDefinition = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// `Type.rule id`가 가리키는 규칙을 적용된 판의 계약에서 찾는다. 없으면 null이다.
export function ruleDefinitionOf(
  contract: unknown,
  rule: string | null,
): RuleDefinition | null {
  if (rule === null) return null;
  if (!isRecord(contract) || !Array.isArray(contract.types)) return null;
  const dot = rule.indexOf(".");
  const typeName = rule.slice(0, dot);
  const ruleId = rule.slice(dot + 1);
  for (const type of contract.types) {
    if (!isRecord(type) || type.name !== typeName) continue;
    if (!Array.isArray(type.rules)) return null;
    for (const rule of type.rules) {
      if (isRecord(rule) && rule.id === ruleId) return rule;
    }
  }
  return null;
}
