// context 읽기 tool이 부르는 core read route 셋(`context.preview`, `context.entity`,
// `context.series_next`)의 이름과 결과 모양이다. 모양의 정본은
// `packages/contracts/documents/context-api.ts`이고 여기서는 route 이름과 tool이 읽는 몸통 type만 둔다.
// 세 route 모두 읽기 effect이고 core 결과는 다른 context 읽기처럼 `as_of_seq`·`complete`·`next_cursor`를 더 가진다.
import type {
  ContextEntityRead as ContextEntityReply,
  ContextPreviewRead as ContextPreviewReply,
  ContextSeriesNextRead as SeriesNextReply,
} from "../../../contracts/documents/mod.ts";

// tool이 쓰는 결과 몸통이다. core 읽기가 모두 싣는 `as_of_seq`와 `omitted`는 tool이 읽지 않으므로 뺀다.
// page 읽기(preview)만 `complete`·`next_cursor`를 남긴다.
type Body<T> = Omit<T, "as_of_seq" | "omitted">;

// ---- context.preview ----
// 입력 `{context, bundle, cursor?}`. 만드는 중인 판(bundle)을 지금 project 파일로 추출해 보기만 한다.
export const CONTEXT_PREVIEW_CONTRACT = "context.preview";
export type ContextPreviewRead = Body<ContextPreviewReply>;

// ---- context.entity ----
// 입력 `{context, type, key}`. 적용된 판에서 개체 하나의 field와 관계를 읽는다.
export const CONTEXT_ENTITY_CONTRACT = "context.entity";
export type ContextEntityRead = Omit<Body<ContextEntityReply>, "next_cursor">;

// ---- context.series_next ----
// 입력 `{context, type}`. series kind type의 다음 문서 이름을 계산해 읽기만 한다.
// series kind가 아닌 type은 invalid_input, 닿지 않는 context는 not_found다.
export const CONTEXT_SERIES_NEXT_CONTRACT = "context.series_next";
export type SeriesNextRead = Omit<Body<SeriesNextReply>, "next_cursor">;
