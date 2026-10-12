// 계약 검사(rule)가 읽고 내는 값의 모양. 검사는 순수 함수이고 파일 시스템을 읽지 않는다.
// CheckEntity는 추출이 내는 개체와 같은 모양이다. extract/를 import하지 않고 모양만 같게 둔다.

// 개체 field 값: 값이 없으면 null, list는 항목의 배열. 빈 문자열과 빈 배열은 "있는 값"이다.
export type CheckFieldValue =
  | string
  | number
  | boolean
  | null
  | readonly (string | number | boolean)[];

export interface CheckEntity {
  readonly type: string;
  readonly key: string;
  readonly path: string;
  readonly section: string | null;
  readonly fields: Readonly<Record<string, CheckFieldValue>>;
  readonly links: readonly { relation: string; target_key: string }[];
}

// 검사가 내는 위반. message는 읽기 쪽이 CheckRule.message로 붙인다.
// rule은 `Type.rule id`, target은 relation_target_exists에서 없는 대상 key이고 나머지 규칙에서는 null이다.
export interface RuleViolation {
  readonly kind: "rule";
  readonly rule: string;
  readonly type: string;
  readonly path: string;
  readonly section: string | null;
  readonly target: string | null;
}

// 관계의 `to`가 다른 context의 type(`context/Type`)일 때 그 type의 개체 key 집합.
// undefined는 그 context를 읽지 못했다는 뜻이고 이때는 위반을 내지 않는다.
export type ExternalKeys = (
  context: string,
  type: string,
) => ReadonlySet<string> | undefined;
