// 탭 안 정보 panel. 본문 위에 떠서 그 칸 오른쪽에 붙고 본문 폭은 줄지 않는다. 탭은 Info와
// Contexts 둘이고 Outline은 Info 안에 있다. Contexts 탭의 내용은 부른 쪽이 끼운다.
import type { ReactNode } from "react";
import { Button, Tab, TabList, TabPanel, Tabs } from "@lophn/design/components";
import { formatRelativeTime, t } from "@lophn/wording";

import { formatSize, type OutlineSection } from "../model.ts";
import styles from "./info-panel.module.css";

export type InfoTabId = "info" | "contexts";

export interface FileInfoPanelProps {
  tab: InfoTabId;
  onTab: (tab: InfoTabId) => void;
  path: string;
  /** 크기(byte). 아직 모르면 null이다. */
  size: number | null;
  /** 바뀐 시각(ms). 통로가 알려 주지 않으면 없다. */
  modifiedAt?: number;
  outside: boolean;
  /** md 파일의 목차. md가 아니면 null이다. */
  outline: readonly OutlineSection[] | null;
  /** 지금 읽는 절의 key. */
  currentKey?: string;
  onJump: (section: OutlineSection) => void;
  /** Contexts 탭의 내용. 통로가 없으면 탭을 두지 않는다. */
  contexts?: ReactNode;
  now?: () => number;
}

export function FileInfoPanel(
  {
    tab,
    onTab,
    path,
    size,
    modifiedAt,
    outside,
    outline,
    currentKey,
    onJump,
    contexts,
    now = Date.now,
  }: FileInfoPanelProps,
) {
  return (
    <aside className={styles.panel} aria-label={t("document.title.info")}>
      <Tabs value={tab} onValueChange={(value) => onTab(value as InfoTabId)}>
        <TabList>
          <Tab value="info">{t("document.button.info")}</Tab>
          {contexts === undefined
            ? null
            : <Tab value="contexts">{t("document.label.contexts")}</Tab>}
        </TabList>
        <TabPanel value="info">
          <dl className={styles.facts} data-info-facts="">
            <dt>{t("document.label.info-path")}</dt>
            <dd className={styles.mono}>{path}</dd>
            {size === null ? null : (
              <>
                <dt>{t("document.label.info-size")}</dt>
                <dd>{formatSize(size)}</dd>
              </>
            )}
            {modifiedAt === undefined ? null : (
              <>
                <dt>{t("document.label.info-modified")}</dt>
                <dd>
                  {formatRelativeTime(new Date(modifiedAt), new Date(now()))}
                </dd>
              </>
            )}
          </dl>
          {outside
            ? <p className={styles.note}>{t("document.notice.info-outside")}</p>
            : null}
          {outline === null || outline.length === 0 ? null : (
            <>
              <h3 className={styles.caption}>
                {t("document.label.info-outline")}
              </h3>
              <ul
                className={styles.outline}
                aria-label={t("document.label.info-outline")}
              >
                {outline.map((section, index) => (
                  <li
                    key={`${section.key}-${index}`}
                    style={{
                      paddingLeft: `calc(var(--space-5) * ${
                        section.level - 1
                      })`,
                    }}
                    aria-current={section.key === currentKey
                      ? "location"
                      : undefined}
                    className={section.key === currentKey
                      ? styles.current
                      : undefined}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onJump(section)}
                    >
                      {section.title}
                    </Button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </TabPanel>
        {contexts === undefined
          ? null
          : <TabPanel value="contexts">{contexts}</TabPanel>}
      </Tabs>
    </aside>
  );
}
