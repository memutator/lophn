// Search 탭의 왼쪽 열: context 고르기 · "Open context" · 선언된 검색 ·
// Saved views. 순서가 화면 순서다.
import type { ReactNode } from "react";
import {
  Button,
  ErrorState,
  Field,
  Select,
  Skeleton,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import styles from "./search-tab.module.css";
import type { Slot } from "./search-tab-read.ts";
import type {
  ContextListItem,
  DeclaredSearch,
  SavedViewListItem,
} from "./source.ts";

interface SearchSideProps {
  readonly context: string;
  readonly search: string | null;
  readonly savedView: string | null;
  readonly contexts: Slot<readonly ContextListItem[]>;
  readonly searches: Slot<readonly DeclaredSearch[]>;
  readonly views: Slot<readonly SavedViewListItem[]>;
  readonly onReload: () => void;
  readonly onContext: (context: string) => void;
  readonly onOpenContext: () => void;
  readonly onSearch: (name: string) => void;
  readonly onView: (view: SavedViewListItem) => void;
}

export function SearchSide(props: SearchSideProps): ReactNode {
  const { contexts, searches, views } = props;
  return (
    <aside className={styles.side} data-search-side>
      {contexts.status === "loaded"
        ? (
          <Field label={t("contexts.label.search-context")}>
            <Select
              options={contexts.value.map((item) => ({
                value: item.id,
                label: item.title,
              }))}
              value={props.context}
              onValueChange={(next) => {
                if (next !== props.context) props.onContext(next);
              }}
            />
          </Field>
        )
        : contexts.status === "failed"
        ? (
          <ErrorState
            target={t("contexts.label.search-context")}
            onRetry={props.onReload}
          />
        )
        : <Skeleton shape="control" />}
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={props.onOpenContext}
          data-open-context
        >
          {t("contexts.button.search-open-context")}
        </Button>
      </div>
      <section className={styles.group}>
        <h2 className={styles.heading}>
          {t("contexts.heading.search-searches")}
        </h2>
        <div data-search-list>
          {searches.status === "loading" && <Skeleton lines={3} />}
          {searches.status === "failed" && (
            <ErrorState
              target={t("contexts.heading.search-searches")}
              onRetry={props.onReload}
            />
          )}
          {searches.status === "loaded" && searches.value.length > 0 && (
            <ul className={styles.list}>
              {searches.value.map((search) => (
                <li key={search.name}>
                  <button
                    type="button"
                    className={styles.item}
                    data-declared={search.name}
                    aria-current={search.name === props.search
                      ? "true"
                      : undefined}
                    onClick={() => props.onSearch(search.name)}
                  >
                    {search.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section className={styles.group}>
        <h2 className={styles.heading}>
          {t("contexts.heading.search-saved-views")}
        </h2>
        <div data-saved-views>
          {views.status === "loading" && <Skeleton lines={2} />}
          {views.status === "failed" && (
            <ErrorState
              target={t("contexts.heading.search-saved-views")}
              onRetry={props.onReload}
            />
          )}
          {views.status === "loaded" && views.value.length === 0 && (
            <p className={styles.note}>
              {t("contexts.note.search-no-saved-views")}
            </p>
          )}
          {views.status === "loaded" && views.value.length > 0 && (
            <ul className={styles.list}>
              {views.value.map((view) => (
                <li key={view.id}>
                  <button
                    type="button"
                    className={styles.item}
                    data-saved-view={view.id}
                    disabled={view.broken}
                    aria-current={view.id === props.savedView
                      ? "true"
                      : undefined}
                    onClick={() => props.onView(view)}
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
        </div>
      </section>
    </aside>
  );
}
