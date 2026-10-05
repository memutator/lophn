import { useEffect, useState } from "react";
import {
  EmptyState,
  ErrorState,
  Icon,
  IconButton,
  iconPixels,
  lophnSpaceIcons,
  Tooltip,
} from "@lophn/design/components";
import { formatRelativeTime, t } from "@lophn/wording";

import { isLatest } from "../model.ts";
import type { LophnSource, SavedView, ViewPage } from "../source.ts";
import { CoverageNotices } from "./notices.tsx";
import type { ReaderTarget } from "./reader.tsx";
import styles from "./documents.module.css";

export interface ViewsPanelProps {
  source: LophnSource;
  /** 저장한 보기가 바뀌면 올라간다. 목록을 다시 읽는다. */
  revision: number;
  current: string | null;
  now: () => number;
  onRead: (target: ReaderTarget) => void;
  /** 저장한 보기가 없을 때 검색으로 간다. */
  onSearch: () => void;
}

type Listed =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly views: readonly SavedView[] };

type Opened =
  | { readonly kind: "none" }
  | { readonly kind: "failed"; readonly view: SavedView }
  | {
    readonly kind: "ready";
    readonly view: SavedView;
    readonly page: ViewPage;
  };

// saved view 목록과 연 view의 문서. 열 때마다 저장한 조건으로 지금 문서를 다시 찾는다
// (outline-and-search#R24). 옛 목록이나 문서 사본을 보이지 않는다.
export function ViewsPanel(
  { source, revision, current, now, onRead, onSearch }: ViewsPanelProps,
) {
  const [listed, setListed] = useState<Listed>({ kind: "loading" });
  const [opened, setOpened] = useState<Opened>({ kind: "none" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    void source.views().then((result) => {
      if (!live) return;
      setListed(
        result.ok ? { kind: "ready", views: result.value } : { kind: "failed" },
      );
    });
    return () => {
      live = false;
    };
  }, [source, attempt, revision]);

  const open = async (view: SavedView) => {
    const result = await source.openView(view.id);
    setOpened(
      result.ok
        ? { kind: "ready", view, page: result.value }
        : { kind: "failed", view },
    );
  };

  const more = async () => {
    if (opened.kind !== "ready" || opened.page.nextCursor === null) return;
    const result = await source.openView(
      opened.view.id,
      opened.page.nextCursor,
    );
    if (!result.ok) return;
    setOpened({
      ...opened,
      page: {
        entries: [...opened.page.entries, ...result.value.entries],
        coverage: result.value.coverage,
        nextCursor: result.value.nextCursor,
      },
    });
  };

  if (listed.kind === "loading") return null;
  if (listed.kind === "failed") {
    return (
      <ErrorState
        target={t("documents.label.target-views")}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  }
  if (listed.views.length === 0) {
    return (
      <EmptyState
        icon={lophnSpaceIcons.savedView}
        message={t("documents.empty.no-views")}
        action={{ label: t("documents.button.go-search"), onSelect: onSearch }}
      />
    );
  }
  const openedId = opened.kind === "none" ? null : opened.view.id;
  const moreLabel = t("documents.button.more-results");
  return (
    <div className={styles.section} data-panel="views">
      <ul className={styles.rows} data-views="">
        {listed.views.map((view) => (
          <li key={view.id}>
            <button
              type="button"
              className={styles.row}
              data-view={view.id}
              aria-current={view.id === openedId ? "true" : undefined}
              onClick={() => void open(view)}
            >
              <span className={styles.rowHead}>
                <Icon
                  icon={lophnSpaceIcons.savedView}
                  pixels={iconPixels("base")}
                  className={styles.rowIcon}
                />
                <span className={styles.rowTitle}>{view.name}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {opened.kind === "failed"
        ? (
          <ErrorState
            target={t("documents.label.target-view", {
              name: opened.view.name,
            })}
            onRetry={() => void open(opened.view)}
          />
        )
        : null}
      {opened.kind === "ready"
        ? (
          <div className={styles.section} data-opened-view={opened.view.id}>
            <h3 className={styles.sectionLabel}>{opened.view.name}</h3>
            <p className={styles.hint}>{t("documents.notice.view-rebuilt")}</p>
            <CoverageNotices coverage={opened.page.coverage} />
            {opened.page.entries.length === 0
              ? <p className={styles.hint}>{t("documents.empty.view-empty")}</p>
              : (
                <ul className={styles.rows}>
                  {opened.page.entries.map((entry) => (
                    <li key={entry.document}>
                      <button
                        type="button"
                        className={styles.row}
                        data-hit={entry.document}
                        aria-current={entry.document === current
                          ? "true"
                          : undefined}
                        onClick={() =>
                          onRead({
                            document: entry.document,
                            version: entry.version,
                            section: null,
                          })}
                      >
                        <span className={styles.rowHead}>
                          <Icon
                            icon={lophnSpaceIcons.documents}
                            pixels={iconPixels("base")}
                            className={styles.rowIcon}
                          />
                          <span className={styles.rowTitle}>{entry.title}</span>
                        </span>
                        {entry.excerpt === null
                          ? null
                          : (
                            <span className={styles.snippet}>
                              {entry.excerpt}
                            </span>
                          )}
                        <span className={styles.meta}>
                          <span>
                            {t("documents.label.saved-when", {
                              when: formatRelativeTime(
                                new Date(entry.savedAt),
                                new Date(now()),
                              ),
                            })}
                          </span>
                          {isLatest(entry.version, entry.latestVersion)
                            ? null
                            : <span>{t("documents.label.newer-version")}</span>}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            {opened.page.nextCursor !== null
              ? (
                <div className={styles.more}>
                  <Tooltip content={moreLabel}>
                    <IconButton
                      icon={lophnSpaceIcons.readMore}
                      label={moreLabel}
                      onClick={() => void more()}
                    />
                  </Tooltip>
                </div>
              )
              : null}
          </div>
        )
        : null}
    </div>
  );
}
