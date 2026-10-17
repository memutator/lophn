// Search 탭: 왼쪽에 context 고르기 · "Open context" · 그 context의 선언된
// 검색 · Saved views, 본문에 고른 검색의 입력 form(SearchInputForm)과 결과(SearchResults).
// 탭이 들고 저장되는 값(state)은 부른 쪽이 가진다.
// 문구 key는 packages/design/wording/en.ts에 이미 있다. 구현은 en.ts를 고치지 않고 아래 key만 t()로 쓴다:
//   contexts.button.search-open-context
//   contexts.button.search-save
//   contexts.empty.search-no-searches
//   contexts.error.search-save-failed
//   contexts.heading.search-saved-views
//   contexts.heading.search-searches
//   contexts.label.search-context
//   contexts.label.search-view-broken
//   contexts.label.search-view-name
//   contexts.note.search-no-saved-views
//   contexts.note.search-pick
//   common.error.load-failed
import { type ReactNode, useEffect, useState } from "react";
import { EmptyState, ErrorState } from "@lophn/ui/feedback";
import { lophnSpaceIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import styles from "./search-tab.module.css";
import { SearchBody } from "./search-tab-body.tsx";
import { useRead } from "./search-tab-read.ts";
import { SearchSide } from "./search-tab-side.tsx";
import type { ContextsSource, SearchInputValues } from "./source.ts";
import { type OpenDocument, searchTabTitle } from "./shared.ts";

/** layout에 저장되는 search 탭 값과 같은 모양. */
export interface SearchTabState {
  /** context ID. */
  readonly context: string;
  /** 고른 선언된 검색 이름. 아직 안 골랐으면 null. */
  readonly search: string | null;
  readonly inputs: SearchInputValues;
  /** 0부터. */
  readonly page: number;
  /** 저장한 보기로 열었으면 그 `viw` ID. */
  readonly savedView: string | null;
}

interface SearchTabProps {
  readonly project: string;
  readonly source: ContextsSource;
  readonly state: SearchTabState;
  readonly onState: (next: SearchTabState) => void;
  /** "Open context" 링크와 선언된 검색이 없을 때의 [Open context]. */
  readonly onOpenContext: (context: string) => void;
  readonly onOpenDocument: OpenDocument;
  /** 읽은 context 이름으로 만든 탭 이름. 복원한 탭은 이름이 비어 있어 읽은 뒤 채운다. */
  readonly onTitle?: (title: string) => void;
}

export function SearchTab(props: SearchTabProps): ReactNode {
  const { project, source, state, onState } = props;
  // 검색을 다시 고르거나 보기를 열 때마다 바뀌어, 본문이 새 입력으로 처음부터 시작하게 한다.
  const [opened, setOpened] = useState(0);

  const contexts = useRead(
    project,
    () => source.list(project),
  );
  const contract = useRead(
    state.context,
    async () => {
      const read = await source.contract(state.context);
      return read.ok
        ? { ok: true, value: read.value.content?.searches ?? [] }
        : read;
    },
  );
  const views = useRead(state.context, () => source.savedViews(state.context));

  const title = contexts.slot.status === "loaded"
    ? contexts.slot.value.find((item) => item.id === state.context)?.title
    : undefined;
  useEffect(() => {
    if (title !== undefined) props.onTitle?.(searchTabTitle(title));
  }, [title]);

  const searches = contract.slot;
  const declared = searches.status === "loaded"
    ? searches.value.find((search) => search.name === state.search)
    : undefined;

  function open(next: SearchTabState): void {
    setOpened((count) => count + 1);
    onState(next);
  }

  return (
    <div className={styles.tab}>
      <SearchSide
        context={state.context}
        search={state.search}
        savedView={state.savedView}
        contexts={contexts.slot}
        searches={searches}
        views={views.slot}
        onReload={() => {
          contexts.reload();
          contract.reload();
          views.reload();
        }}
        onContext={(context) =>
          open({ context, search: null, inputs: {}, page: 0, savedView: null })}
        onOpenContext={() => props.onOpenContext(state.context)}
        onSearch={(name) =>
          open({
            context: state.context,
            search: name,
            inputs: {},
            page: 0,
            savedView: null,
          })}
        onView={(view) =>
          open({
            context: state.context,
            search: view.search,
            inputs: view.inputs,
            page: 0,
            savedView: view.id,
          })}
      />
      <main className={styles.main}>
        {searches.status === "failed" && (
          <ErrorState
            target={t("contexts.heading.search-searches")}
            onRetry={contract.reload}
          />
        )}
        {searches.status === "loaded" && searches.value.length === 0 && (
          <EmptyState
            icon={lophnSpaceIcons.search}
            message={t("contexts.empty.search-no-searches")}
            action={{
              label: t("contexts.button.search-open-context"),
              onSelect: () => props.onOpenContext(state.context),
            }}
          />
        )}
        {searches.status === "loaded" && searches.value.length > 0 &&
          declared === undefined && (
          <p className={styles.note}>{t("contexts.note.search-pick")}</p>
        )}
        {declared !== undefined && (
          <SearchBody
            key={`${state.context}/${declared.name}/${opened}`}
            source={source}
            search={declared}
            state={state}
            onState={onState}
            onOpenDocument={props.onOpenDocument}
            onSaved={views.reload}
          />
        )}
      </main>
    </div>
  );
}
