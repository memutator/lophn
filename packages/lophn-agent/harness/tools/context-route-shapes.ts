// context 읽기 tool이 기대하는 새 core read route 셋의 결과 모양이다(spec). 이 셋은
// `packages/contracts/documents/context-api.ts`에 아직 없고, documents 쪽 spec이 아래 이름·입력·결과 모양을
// 그대로 route와 zod schema로 옮긴다. 세 route 모두 읽기 effect이고 결과는 다른 context 읽기처럼
// `as_of_seq`·`complete`·`next_cursor`(publicRead/publicPage 공통)를 더 가진다. 모양을 바꾸면 이 파일과 세
// tool의 시험 fake가 함께 바뀐다.
import type {
  CheckFinding,
  EntityRef,
  StoredViolation,
} from "../../../contracts/documents/mod.ts";

// ---- context.preview ----
// 입력 `{context, bundle, cursor?}`. 만드는 중인 판(bundle)을 지금 project 파일로 추출해 보기만 한다.
// 적용된 판·파일·ledger의 context 상태를 바꾸지 않는다(publicPage: 위반 page).
export const CONTEXT_PREVIEW_CONTRACT = "context.preview";

export type ContextPreviewRead = {
  context: string;
  bundle: string;
  // 지금 파일에서 뽑은 type별 개체 수(계약의 type 순서)
  types: { type: string; count: number }[];
  violation_count: number;
  // 위반 한 page. 문구가 붙은 저장 모양에서 context·판 hash만 뺀 것이다.
  violations: Omit<StoredViolation, "context" | "bundle_hash">[];
  // 제출 검사의 판 단계 결과 가운데 파일 없이 알 수 있는 것(계약 모양·cross project 경로·예시 불일치 등)
  findings: CheckFinding[];
  complete: boolean;
  next_cursor: string | null;
};

// ---- context.entity ----
// 입력 `{context, type, key}`. 적용된 판에서 개체 하나의 field와 관계를 읽는다(publicRead).
export const CONTEXT_ENTITY_CONTRACT = "context.entity";

export type ContextEntityRead = {
  context: string;
  bundle_hash: string;
  ref: EntityRef;
  // field 이름 → 값. list는 배열이다.
  fields: Record<string, unknown>;
  relations: {
    name: string;
    label: string;
    // 대상 개체. 대상이 없으면 빈 배열이다.
    targets: EntityRef[];
  }[];
};

// ---- context.series_next ----
// 입력 `{context, type}`. series kind type의 다음 문서 이름을 계산해 읽기만 한다(publicRead).
// series kind가 아닌 type은 invalid_input, 닿지 않는 context는 not_found다.
export const CONTEXT_SERIES_NEXT_CONTRACT = "context.series_next";

export type SeriesNextRead = {
  context: string;
  type: string;
  // type의 series pattern
  pattern: string;
  next: {
    // 계산 불가면 빈 문자열
    key: string;
    // 계산 불가면 null. 파일 이름 칸에 `*`가 남아 있을 수 있다.
    path: string | null;
    // 마지막 멤버의 path. 멤버가 없으면 null
    from: string | null;
    // path가 있고 `*`가 없으면 true
    complete: boolean;
    // 계산한 key를 가진 멤버가 이미 있다
    taken: boolean;
  };
};
