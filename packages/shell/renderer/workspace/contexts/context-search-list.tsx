// Context 탭의 Search 하위 탭: 이 context가 선언한 검색과 저장한 보기의 목록. 하나를
// 고르면 결과를 여기서 그리지 않고 그 검색을 고른 Search 탭을 여는 일을 부른 쪽에 맡긴다.
import type { ReactNode } from "react";
import { ErrorState, Skeleton } from "@lophn/design/components";
import { t } from "@lophn/wording";

import styles from "./search-tab.module.css";
import type { SearchTabState } from "./search-tab.tsx";
import { useRead } from "./search-tab-read.ts";
import type { ContextsSource } from "./source.ts";

export interface ContextSearchListProps {
  readonly source: ContextsSource;
  /** context ID. */
  readonly context: string;
  /** 고른 검색이나 보기를 그 Search 탭 값으로 넘긴다. */
  readonly onOpenSearch: (state: SearchTabState) => void;
}

export function ContextSearchList(
  { source, context, onOpenSearch }: ContextSearchListProps,
): ReactNode {
  const contract = useRead(context, async () => {
    const read = await source.contract(context);
    return read.ok
      ? { ok: true, value: read.value?.content?.searches ?? [] }
      : read;
  });
  const views = useRead(context, () => source.savedViews(context));
  const searches = contract.slot;
  return (
    <div className={styles.side} data-context-search="">
      <section className={styles.group}>
        <h2 className={styles.heading}>
          {t("contexts.heading.search-searches")}
        </h2>
        {searches.status === "loading" && <Skeleton lines={3} />}
        {searches.status === "failed" && (
          <ErrorState
            target={t("contexts.heading.search-searches")}
            onRetry={contract.reload}
          />
        )}
        {searches.status === "loaded" && searches.value.length === 0 && (
          <p className={styles.note}>
            {t("contexts.empty.search-no-searches")}
          </p>
        )}
        {searches.status === "loaded" && searches.value.length > 0 && (
          <ul className={styles.list} data-search-list="">
            {searches.value.map((search) => (
              <li key={search.name}>
                <button
                  type="button"
                  className={styles.item}
                  data-declared={search.name}
                  onClick={() =>
                    onOpenSearch({
                      context,
                      search: search.name,
                      inputs: {},
                      page: 0,
                      savedView: null,
                    })}
                >
                  {search.title}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className={styles.group}>
        <h2 className={styles.heading}>
          {t("contexts.heading.search-saved-views")}
        </h2>
        {views.slot.status === "loading" && <Skeleton lines={2} />}
        {views.slot.status === "failed" && (
          <ErrorState
            target={t("contexts.heading.search-saved-views")}
            onRetry={views.reload}
          />
        )}
        {views.slot.status === "loaded" && views.slot.value.length === 0 && (
          <p className={styles.note}>
            {t("contexts.note.search-no-saved-views")}
          </p>
        )}
        {views.slot.status === "loaded" && views.slot.value.length > 0 && (
          <ul className={styles.list} data-saved-views="">
            {views.slot.value.map((view) => (
              <li key={view.id}>
                <button
                  type="button"
                  className={styles.item}
                  data-saved-view={view.id}
                  disabled={view.broken}
                  onClick={() =>
                    onOpenSearch({
                      context,
                      search: view.search,
                      inputs: view.inputs,
                      page: 0,
                      savedView: view.id,
                    })}
                >
                  {view.name}
                  {view.broken && (
                    <span className={styles.broken}>
                      {t("contexts.label.search-view-broken")}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
