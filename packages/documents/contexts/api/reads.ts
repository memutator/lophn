// context API 읽기. 묶음마다 파일 하나다: reads-contexts(list·get·overview·containing),
// reads-bundle(contract·draft), reads-preview(preview: worker 쪽 자리), reads-search(search·saved_views), reads-options(input_options),
// reads-entity(entity·series_next), reads-lists(violations·bundles·glossary). 검색은 주입된
// SearchExecutor가 돌리고 읽기는 입력 검사와 page 자르기를 한다.
import type { Result } from "../../../base/mod.ts";
import type {
  contextBundlesRoute,
  contextContainingRoute,
  contextContractRoute,
  contextDraftRoute,
  contextEntityRoute,
  contextGetRoute,
  contextInputOptionsRoute,
  contextListRoute,
  contextOverviewRoute,
  contextPreviewRoute,
  contextSavedViewsRoute,
  contextSearchRoute,
  contextSeriesNextRoute,
  contextViolationsRoute,
  glossaryListRoute,
  SearchRow,
} from "../../../protocol/projects/mod.ts";
import type {
  Input,
  Output,
  ReadRoute,
} from "../../../protocol/platform/mod.ts";
import { createBundleReads } from "./reads-bundle.ts";
import { createContextReads } from "./reads-contexts.ts";
import { createEntityReads } from "./reads-entity.ts";
import { createListReads } from "./reads-lists.ts";
import { createOptionReads } from "./reads-options.ts";
import { createPreviewReads } from "./reads-preview.ts";
import { createSearchReads } from "./reads-search.ts";
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
  contextContract: ReadHandler<typeof contextContractRoute>;
  contextDraft: ReadHandler<typeof contextDraftRoute>;
  contextPreview: ReadHandler<typeof contextPreviewRoute>;
  contextSearch: ReadHandler<typeof contextSearchRoute>;
  contextInputOptions: ReadHandler<typeof contextInputOptionsRoute>;
  contextViolations: ReadHandler<typeof contextViolationsRoute>;
  contextBundles: ReadHandler<typeof contextBundlesRoute>;
  contextSavedViews: ReadHandler<typeof contextSavedViewsRoute>;
  contextEntity: ReadHandler<typeof contextEntityRoute>;
  contextSeriesNext: ReadHandler<typeof contextSeriesNextRoute>;
  contextContaining: ReadHandler<typeof contextContainingRoute>;
  glossaryList: ReadHandler<typeof glossaryListRoute>;
};

export function createContextApiReads(
  state: ContextApiState,
  deps: ContextApiReadDeps,
): ContextApiReads {
  return {
    ...createContextReads(state),
    ...createBundleReads(state),
    ...createPreviewReads(),
    ...createOptionReads(state),
    ...createSearchReads(state, deps),
    ...createEntityReads(state),
    ...createListReads(state),
  };
}
