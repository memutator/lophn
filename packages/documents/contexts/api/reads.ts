// context API 읽기의 구현 자리다. 아직 구현하지 않았다(spec 단계). 구현 작업: ctx-I31.
import type { Result } from "../../../base/mod.ts";
import type {
  contextBundlesRoute,
  contextContainingRoute,
  contextGetRoute,
  contextListRoute,
  contextOverviewRoute,
  contextSavedViewsRoute,
  contextSearchRoute,
  contextViolationsRoute,
  glossaryListRoute,
  SearchRow,
} from "../../../contracts/documents/mod.ts";
import type {
  Input,
  Output,
  ReadRoute,
} from "../../../contracts/platform/mod.ts";
import type { ContextApiActor, ContextApiState, EntityRow } from "./state.ts";

export type ReadCall<R extends ReadRoute> = {
  actor: ContextApiActor;
  input: Input<R>;
};
// 읽기 결과의 as_of_seq·complete·next_cursor는 platform 공통 필드다. 시험은 거기에 더해 각 읽기의
// 값과 순서를 본다.
export type ReadHandler<R extends ReadRoute> = (
  call: ReadCall<R>,
) => Result<Output<R>>;

// 선언 검색 실행기(순수 함수)다. 개체 + 적용된 판의 선언 + 입력 → 정렬된 결과 전체.
// page로 자르는 일은 읽기가 한다.
export type SearchExecutor = (
  entities: readonly EntityRow[],
  content: Record<string, unknown>,
  search: string,
  inputs: Record<string, unknown>,
) => readonly SearchRow[];

export type ContextApiReadDeps = {
  execute: SearchExecutor;
};

export type ContextApiReads = {
  contextList: ReadHandler<typeof contextListRoute>;
  contextGet: ReadHandler<typeof contextGetRoute>;
  contextOverview: ReadHandler<typeof contextOverviewRoute>;
  contextSearch: ReadHandler<typeof contextSearchRoute>;
  contextViolations: ReadHandler<typeof contextViolationsRoute>;
  contextBundles: ReadHandler<typeof contextBundlesRoute>;
  contextSavedViews: ReadHandler<typeof contextSavedViewsRoute>;
  contextContaining: ReadHandler<typeof contextContainingRoute>;
  glossaryList: ReadHandler<typeof glossaryListRoute>;
};

export function createContextApiReads(
  _state: ContextApiState,
  _deps: ContextApiReadDeps,
): ContextApiReads {
  throw new Error("not implemented");
}
