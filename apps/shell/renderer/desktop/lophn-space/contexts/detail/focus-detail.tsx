import { useEffect, useState } from "react";
import {
  ErrorState,
  IconButton,
  lophnSpaceIcons,
  OverviewFrame,
  retryIcon,
  Tab,
  TabList,
  Tabs,
  Tooltip,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import {
  exportFileName,
  exportMarkdown,
  perspectiveLabel,
  targetKey,
  watchStateOf,
} from "../model.ts";
import {
  type ContextsSource,
  type Focus,
  type FocusWatch,
  PERSPECTIVES,
} from "../source.ts";
import { FocusItemRow } from "./focus-item.tsx";
import { Meanings } from "../meanings/meanings.tsx";
import styles from "../contexts.module.css";

export interface FocusDetailProps {
  source: ContextsSource;
  id: string;
  /** 연결이 다시 준비되면 오른다. 지금 보이는 것을 둔 채 다시 읽는다. */
  connected?: number;
  onRead: (
    document: string,
    version: string | null,
    section: string | null,
  ) => void;
  /** 대화 도크를 연다. 고치기·판단 요청은 대화에서 한다. */
  onAsk?: () => void;
  /** 보관·해제 뒤 목록을 다시 읽게 한다. */
  onChanged: () => void;
  /** 사람이 고른 곳에 글을 저장한다. */
  save: (name: string, text: string) => void;
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | {
    readonly kind: "ready";
    readonly focus: Focus;
    /** watch 결과를 읽지 못하면 null이다. 변화 없음으로 꾸미지 않는다. */
    readonly watch: FocusWatch | null;
  };

type Change = "idle" | "changed" | "failed" | "export-failed";

// Focus 하나: 사람이 지은 이름과 목적, Baseline·Reference·Follow changes로 나눈 항목, 뜻.
// 항목의 선택 이유와 부족한 자료는 펼쳐 본다. 보관은 Focus만 치우고 원자료를 바꾸지 않는다.
export function FocusDetail(
  { source, id, connected = 0, onRead, onAsk, onChanged, save }:
    FocusDetailProps,
) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [change, setChange] = useState<Change>("idle");
  const [tab, setTab] = useState<"materials" | "meanings">("materials");

  useEffect(() => {
    let live = true;
    void Promise.all([source.focus(id), source.watch(id)]).then(
      ([focus, watch]) => {
        if (!live) return;
        setLoaded(
          focus.ok
            ? {
              kind: "ready",
              focus: focus.value,
              watch: watch.ok ? watch.value : null,
            }
            : { kind: "failed" },
        );
      },
    );
    return () => {
      live = false;
    };
  }, [source, id, attempt, connected]);

  if (loaded.kind === "loading") return null;
  if (loaded.kind === "failed") {
    return (
      <div className={styles.loading}>
        <ErrorState
          target={t("contexts.label.target-focus")}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      </div>
    );
  }

  const { focus, watch } = loaded;
  const reload = () => setAttempt((value) => value + 1);

  const archive = async () => {
    const result = await source.setArchived(focus, !focus.archived);
    if (!result.ok) {
      setChange(result.code === "conflict" ? "changed" : "failed");
      return;
    }
    setChange("idle");
    onChanged();
    reload();
  };

  const exportFocus = async () => {
    const result = await source.exportFocus(focus.id);
    if (!result.ok) {
      setChange("export-failed");
      return;
    }
    const titles = new Map(
      focus.items.map((item) => [targetKey(item.target), item.title]),
    );
    save(exportFileName(focus.title), exportMarkdown(result.value, titles));
  };

  const archiveLabel = focus.archived
    ? t("contexts.button.unarchive")
    : t("contexts.button.archive");

  return (
    <OverviewFrame
      header={
        <div className={styles.head} data-focus-head={focus.id}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>
              {t("contexts.title.focus", { title: focus.title })}
            </h1>
            <span className={styles.actions}>
              {onAsk
                ? (
                  <Tooltip content={t("contexts.button.ask")}>
                    <IconButton
                      icon={lophnSpaceIcons.ask}
                      label={t("contexts.button.ask")}
                      data-ask-focus=""
                      onClick={onAsk}
                    />
                  </Tooltip>
                )
                : null}
              <Tooltip content={t("contexts.button.export")}>
                <IconButton
                  icon={lophnSpaceIcons.exportFile}
                  label={t("contexts.button.export")}
                  data-export-focus=""
                  onClick={() => void exportFocus()}
                />
              </Tooltip>
              <Tooltip content={archiveLabel}>
                <IconButton
                  icon={focus.archived
                    ? lophnSpaceIcons.unarchive
                    : lophnSpaceIcons.archive}
                  label={archiveLabel}
                  data-archive-focus={focus.archived ? "unarchive" : "archive"}
                  onClick={() => void archive()}
                />
              </Tooltip>
            </span>
          </div>
          <p className={styles.purpose} data-focus-purpose="">
            {focus.purpose}
          </p>
          <p className={styles.meta}>
            <span>
              {t("contexts.label.item-count", { count: focus.items.length })}
            </span>
            {focus.archived
              ? <span>{t("contexts.label.archived")}</span>
              : null}
          </p>
        </div>
      }
    >
      <div className={styles.body}>
        {change === "changed"
          ? (
            <p className={styles.changed} data-changed="">
              <span>{t("contexts.error.changed")}</span>
              <Tooltip content={t("contexts.button.show-latest")}>
                <IconButton
                  icon={retryIcon}
                  label={t("contexts.button.show-latest")}
                  size="sm"
                  onClick={() => {
                    setChange("idle");
                    reload();
                  }}
                />
              </Tooltip>
            </p>
          )
          : null}
        {change === "failed"
          ? (
            <p className={styles.error} data-change-failed="">
              {t("contexts.error.change-failed")}
            </p>
          )
          : null}
        {change === "export-failed"
          ? (
            <p className={styles.error} data-export-failed="">
              {t("contexts.error.export-failed")}
            </p>
          )
          : null}
        {focus.archived
          ? (
            <p className={styles.notice} data-focus-archived="">
              {t("contexts.notice.archived")}
            </p>
          )
          : null}
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as "materials" | "meanings")}
        >
          <TabList>
            <Tab value="materials">{t("contexts.label.tab-materials")}</Tab>
            <Tab value="meanings">{t("contexts.label.tab-meanings")}</Tab>
          </TabList>
        </Tabs>
        {tab === "materials"
          ? (
            <div className={styles.body} data-materials="">
              {focus.partial
                ? <p className={styles.hint}>{t("contexts.notice.partial")}</p>
                : null}
              {watch === null
                ? (
                  <p className={styles.notice} data-watch-unavailable="">
                    {t("contexts.notice.watch-unavailable")}
                  </p>
                )
                : null}
              {PERSPECTIVES.map((perspective) => {
                const items = focus.items.filter((item) =>
                  item.perspective === perspective
                );
                return (
                  <section
                    key={perspective}
                    className={styles.perspective}
                    data-perspective={perspective}
                  >
                    <h2 className={styles.perspectiveLabel}>
                      {perspectiveLabel(perspective)}
                      <span className={styles.count}>{items.length}</span>
                    </h2>
                    {items.length === 0
                      ? (
                        <p className={styles.hint}>
                          {t("contexts.empty.perspective")}
                        </p>
                      )
                      : (
                        <ul className={styles.items}>
                          {items.map((item) => (
                            <FocusItemRow
                              key={targetKey(item.target)}
                              item={item}
                              watch={perspective === "watch"
                                ? watchStateOf(item, watch)
                                : null}
                              onRead={onRead}
                            />
                          ))}
                        </ul>
                      )}
                  </section>
                );
              })}
            </div>
          )
          : (
            <Meanings
              source={source}
              focus={focus.id}
              connected={connected}
              onRead={(document, version, section) =>
                onRead(document, version, section)}
            />
          )}
      </div>
    </OverviewFrame>
  );
}
