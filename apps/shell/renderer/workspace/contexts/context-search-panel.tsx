// Context 탭의 Search 하위 탭: 이 context가 선언한 검색의 목록과 고른 검색의 입력 form·결과를 탭 안에서
// 보인다(shell/workspace#R22). 채운 입력은 이 하위 탭이 열려 있는 동안만 들고 layout에는 남기지 않는다.
// 입력을 저장하고 되살리는 화면은 Search 탭이다.
import { type ReactNode, useState } from "react";
import {
  EmptyState,
  ErrorState,
  lophnSpaceIcons,
  Skeleton,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import styles from "./search-tab.module.css";
import type { SearchTabState } from "./search-tab.tsx";
import { SearchBody } from "./search-tab-body.tsx";
import { useRead } from "./search-tab-read.ts";
import type { OpenDocument } from "./shared.ts";
import type { ContextsSource } from "./source.ts";

export interface ContextSearchPanelProps {
  readonly source: ContextsSource;
  /** context ID. */
  readonly context: string;
  readonly onOpenDocument: OpenDocument;
  /** 그릴 수 없는 입력 타입일 때의 [Ask Context Engineer]. */
  readonly onAsk: () => void;
}

export function ContextSearchPanel(
  { source, context, onOpenDocument, onAsk }: ContextSearchPanelProps,
): ReactNode {
  const [state, setState] = useState<SearchTabState>({
    context,
    search: null,
    inputs: {},
    page: 0,
    savedView: null,
  });
  // 검색을 다시 고를 때마다 바뀌어 본문이 새 입력으로 처음부터 시작하게 한다.
  const [opened, setOpened] = useState(0);
  const contract = useRead(context, async () => {
    const read = await source.contract(context);
    return read.ok ? { ok: true, value: read.value?.searches ?? [] } : read;
  });
  const searches = contract.slot;
  const declared = searches.status === "loaded"
    ? searches.value.find((search) => search.name === state.search)
    : undefined;

  return (
    <div className={styles.tab} data-context-search="">
      <aside className={styles.side}>
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
          {searches.status === "loaded" && searches.value.length > 0 && (
            <ul className={styles.list} data-search-list="">
              {searches.value.map((search) => (
                <li key={search.name}>
                  <button
                    type="button"
                    className={styles.item}
                    data-declared={search.name}
                    aria-current={search.name === state.search
                      ? "true"
                      : undefined}
                    onClick={() => {
                      setOpened((count) => count + 1);
                      setState({
                        context,
                        search: search.name,
                        inputs: {},
                        page: 0,
                        savedView: null,
                      });
                    }}
                  >
                    {search.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
      <main className={styles.main}>
        {searches.status === "loaded" && searches.value.length === 0 && (
          <EmptyState
            icon={lophnSpaceIcons.search}
            message={t("contexts.empty.search-no-searches")}
            action={{
              label: t("contexts.button.frame-ask"),
              onSelect: onAsk,
            }}
          />
        )}
        {searches.status === "loaded" && searches.value.length > 0 &&
          declared === undefined && (
          <p className={styles.note}>{t("contexts.note.search-pick")}</p>
        )}
        {declared !== undefined && (
          <SearchBody
            key={`${context}/${declared.name}/${opened}`}
            source={source}
            search={declared}
            state={state}
            onState={setState}
            onOpenDocument={onOpenDocument}
            onAsk={onAsk}
            onSaved={() => {}}
          />
        )}
      </main>
    </div>
  );
}
