// project sidebar의 Context 모양 본문: contexts 목록(이름을 누르면 그 Context 탭)과 그 아래 saved views
// (이름을 누르면 결과를 연다). 이 모양을 열 때(마운트) 한 번 읽고 polling하지 않는다.
import { useEffect, useRef, useState } from "react";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { commonIcons, workspaceIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import styles from "../sidebar/project-sidebar.module.css";
import type {
  ContextListItem,
  ContextsSource,
  SavedViewListItem,
} from "./source.ts";

interface ContextSidebarProps {
  readonly source: ContextsSource;
  readonly project: string;
  readonly onOpenContext: (context: ContextListItem) => void;
  readonly onOpenSavedView: (view: SavedViewListItem) => void;
  /** 읽은 context 목록을 작업대에 알린다(탭 이름, 팔레트, 새 탭 menu가 같이 쓴다). */
  readonly onLoaded?: (list: readonly ContextListItem[]) => void;
  /** 지금 보고 있는 saved view의 ID. 그 줄이 고른 모양이 된다. */
  readonly activeSavedView?: string;
}

interface Loaded {
  readonly contexts: readonly ContextListItem[];
  /** 모든 context의 saved view를 이름 순으로. 읽지 못한 context의 것은 빠진다. */
  readonly views: readonly SavedViewListItem[];
}

export function ContextSidebar(
  {
    source,
    project,
    onOpenContext,
    onOpenSavedView,
    onLoaded,
    activeSavedView,
  }: ContextSidebarProps,
) {
  const [loaded, setLoaded] = useState<Loaded>({ contexts: [], views: [] });
  const notify = useRef(onLoaded);
  notify.current = onLoaded;
  useEffect(() => {
    let live = true;
    void (async () => {
      const list = await source.list(project);
      if (!live || !list.ok) return;
      setLoaded((current) => ({ ...current, contexts: list.value }));
      notify.current?.(list.value);
      const reads = await Promise.all(
        list.value.map((item) => source.savedViews(item.id)),
      );
      if (!live) return;
      const views = reads.flatMap((read) => read.ok ? read.value : []);
      setLoaded({
        contexts: list.value,
        views: [...views].sort((a, b) => a.name.localeCompare(b.name)),
      });
    })();
    return () => {
      live = false;
    };
  }, [source, project]);

  const titleOf = (id: string) =>
    loaded.contexts.find((item) => item.id === id)?.title;
  return (
    <>
      <section className={styles.section} data-contexts="">
        <h2 className={styles.sectionLabel}>
          {t("contexts.heading.sidebar-contexts")}
        </h2>
        {loaded.contexts.length === 0
          ? <p className={styles.empty}>{t("contexts.empty.tab-none")}</p>
          : (
            <ul className={styles.list} role="list">
              {loaded.contexts.map((item) => (
                <li key={item.id} className={styles.li}>
                  <button
                    type="button"
                    className={styles.item}
                    data-context={item.id}
                    onClick={() =>
                      onOpenContext(item)}
                  >
                    <Icon
                      icon={workspaceIcons.context}
                      pixels={iconPixels("base")}
                    />
                    <span className={styles.label}>{item.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </section>
      <section className={styles.section} data-saved-views="">
        <h2 className={styles.sectionLabel}>
          {t("contexts.heading.sidebar-saved-views")}
        </h2>
        {loaded.views.length === 0
          ? (
            <p className={styles.empty}>
              {t("contexts.note.search-no-saved-views")}
            </p>
          )
          : (
            <ul className={styles.list} role="list">
              {loaded.views.map((view) => (
                <li key={view.id} className={styles.li}>
                  <button
                    type="button"
                    className={styles.item}
                    data-saved-view={view.id}
                    data-active={activeSavedView === view.id || undefined}
                    disabled={view.broken}
                    title={titleOf(view.context)}
                    onClick={() =>
                      onOpenSavedView(view)}
                  >
                    <Icon
                      icon={commonIcons.savedView}
                      pixels={iconPixels("base")}
                    />
                    <span className={styles.label}>{view.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
      </section>
    </>
  );
}
