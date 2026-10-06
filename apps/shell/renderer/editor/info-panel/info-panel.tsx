// 정보 패널의 내용(shell/editor#R6). 틀(320px, 머리 36px, 탭, 기본 닫힘, 공간별 열림·마지막 탭
// 기억, overlay 닫기)은 작업대의 정보 패널 자리가 두고, 여기는 focus 칸의 문서에 대한 정보·
// 버전·컨텍스트 탭 본문을 그린다. 안 여백 16px·목록 행 32px·절 간격 20px는 CSS가 정한다.
import { useEffect, useRef, useState } from "react";
import {
  editorIcons,
  ErrorState,
  Icon,
  iconPixels,
  Skeleton,
} from "@lophn/design/components";
import { formatRelativeTime, t } from "@lophn/wording";

import type {
  DocumentContext,
  DocumentFacts,
  VersionSource,
} from "../versions/source.ts";
import { saverLabel, VersionsTab } from "../versions/versions-tab.tsx";
import styles from "./info-panel.module.css";

export type InfoTabId = "info" | "versions" | "contexts";

export interface DocumentInfoPanelProps {
  tab: InfoTabId;
  /** focus 칸의 활성 문서 탭. 문서가 아니면 null이다. */
  document: string | null;
  source: VersionSource;
  /** 문서 탭이 지금 보이는 판. */
  viewing?: string | null;
  /** 복원 뒤 다시 읽게 바꾸는 값. */
  refresh?: number;
  onCompare: (document: string, before: string, after: string) => void;
  now?: () => number;
}

type Loaded<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly value: T };

// key가 바뀔 때만 다시 읽는다. read는 가장 최근 것을 쓴다.
function useLoaded<T>(
  read: () => Promise<{ ok: true; value: T } | { ok: false; code: string }>,
  key: string,
): [Loaded<T>, () => void] {
  const [state, setState] = useState<Loaded<T>>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(read);
  latest.current = read;
  useEffect(() => {
    let live = true;
    setState({ kind: "loading" });
    void latest.current().then((result) => {
      if (!live) return;
      setState(
        result.ok ? { kind: "ready", value: result.value } : { kind: "failed" },
      );
    });
    return () => {
      live = false;
    };
  }, [key, attempt]);
  return [state, () => setAttempt((value) => value + 1)];
}

function InfoTab(
  { document, source, refresh, now }: {
    document: string;
    source: VersionSource;
    refresh: number;
    now: () => number;
  },
) {
  const [facts, retry] = useLoaded<DocumentFacts>(
    () => source.facts(document),
    `${document}:${refresh}`,
  );
  if (facts.kind === "loading") return <Skeleton shape="line" lines={5} />;
  if (facts.kind === "failed") {
    return (
      <ErrorState target={t("document.label.info-target")} onRetry={retry} />
    );
  }
  const value = facts.value;
  return (
    <div className={styles.stack} data-info-facts="">
      <section className={styles.section}>
        <h3 className={styles.caption}>{t("document.label.info-file")}</h3>
        <p className={styles.value} data-info-file="">
          {value.primaryPath ?? value.title}
        </p>
      </section>
      <section className={styles.section}>
        <h3 className={styles.caption}>{t("document.label.info-source")}</h3>
        <p className={styles.value}>
          {value.linked
            ? t("document.label.info-linked")
            : t("document.label.info-unlinked")}
        </p>
        {value.archived
          ? <p className={styles.muted}>{t("document.label.info-archived")}</p>
          : null}
      </section>
      <section className={styles.section}>
        <h3 className={styles.caption}>{t("document.label.info-format")}</h3>
        <p className={styles.value}>
          {value.formatExplicit
            ? t("document.label.info-format-explicit", {
              name: value.formatName,
            })
            : value.formatName}
        </p>
      </section>
      <section className={styles.section}>
        <h3 className={styles.caption}>{t("document.label.info-saved")}</h3>
        <p className={styles.value}>
          {t("document.label.version-number", { number: value.latestNumber })}
        </p>
        <p className={styles.muted}>
          {saverLabel(value.savedBy)}
          {" · "}
          {formatRelativeTime(new Date(value.savedAt), new Date(now()))}
        </p>
        <p className={styles.muted}>
          {t("document.label.info-versions", { count: value.latestNumber })}
        </p>
      </section>
    </div>
  );
}

function ContextsTab(
  { document, source }: { document: string; source: VersionSource },
) {
  const [contexts, retry] = useLoaded<readonly DocumentContext[]>(
    () => source.contexts(document),
    document,
  );
  if (contexts.kind === "loading") return <Skeleton shape="line" lines={3} />;
  if (contexts.kind === "failed") {
    return (
      <ErrorState
        target={t("document.label.contexts-target")}
        onRetry={retry}
      />
    );
  }
  if (contexts.value.length === 0) {
    return <p className={styles.muted}>{t("document.empty.contexts")}</p>;
  }
  return (
    <ul className={styles.list} data-info-contexts="">
      {contexts.value.map((context) => (
        <li key={context.id} className={styles.row}>
          <Icon
            icon={editorIcons.context}
            pixels={iconPixels("small")}
            className={styles.rowIcon}
          />
          <span className={styles.who}>{context.title}</span>
        </li>
      ))}
    </ul>
  );
}

export function DocumentInfoPanel(
  {
    tab,
    document,
    source,
    viewing = null,
    refresh = 0,
    onCompare,
    now = Date.now,
  }: DocumentInfoPanelProps,
) {
  if (document === null) {
    return <p className={styles.muted}>{t("document.notice.no-document")}</p>;
  }
  if (tab === "versions") {
    return (
      <VersionsTab
        document={document}
        source={source}
        viewing={viewing}
        refresh={refresh}
        onCompare={(before, after) => onCompare(document, before, after)}
        now={now}
      />
    );
  }
  if (tab === "contexts") {
    return <ContextsTab document={document} source={source} />;
  }
  return (
    <InfoTab document={document} source={source} refresh={refresh} now={now} />
  );
}
