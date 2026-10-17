// Search 탭 본문의 결과: 지금 page를 읽어 SearchResults에 넘긴다.
import { type ReactNode, useMemo } from "react";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";

import { SearchResults } from "./search-results.tsx";
import { loadPage } from "./search-tab-page.ts";
import { useRead } from "./search-tab-read.ts";
import type { OpenDocument } from "./shared.ts";
import type {
  ContextsSource,
  DeclaredSearch,
  SearchInputValues,
} from "./source.ts";

interface SearchTabResultsProps {
  readonly source: ContextsSource;
  readonly context: string;
  readonly search: DeclaredSearch;
  /** 마지막 [Search]로 확정한 입력. */
  readonly inputs: SearchInputValues;
  readonly page: number;
  readonly onPage: (page: number) => void;
  readonly onOpenDocument: OpenDocument;
}

export function SearchTabResults(props: SearchTabResultsProps): ReactNode {
  const { source, context, search, inputs, page } = props;
  const pageSize = search.result.page_size;
  // 입력이 바뀌면 cursor도 처음부터 다시 쌓는다.
  const cursors = useMemo<(string | undefined)[]>(
    () => [undefined],
    [context, search.name, inputs],
  );
  const { slot, reload } = useRead(
    `${context}/${search.name}/${JSON.stringify(inputs)}/${page}`,
    () =>
      loadPage(source, { context, search: search.name, inputs }, page, cursors),
  );
  if (slot.status === "failed") {
    return <ErrorState target={search.title} onRetry={reload} />;
  }
  return (
    <Loading
      loading={slot.status === "loading"}
      placeholder={<Skeleton lines={5} />}
    >
      {slot.status === "loaded" && (
        <SearchResults
          search={search}
          rows={slot.value.rows}
          page={page}
          pageSize={pageSize}
          total={slot.value.total}
          onPage={props.onPage}
          onOpenDocument={props.onOpenDocument}
        />
      )}
    </Loading>
  );
}
