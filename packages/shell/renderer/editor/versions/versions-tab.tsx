// 정보 패널의 버전 탭(shell/editor#R6, flow restore-document 1단계). 판은 새 것이 위이고 행은
// 32px다. 행마다 저장 주체·시각을 보이고, 그 판에 저장된 run이 있으면 그것만 함께 보인다. 앞 판·
// 최신 판과의 비교를 아이콘으로 연다. 절을 고르면
// documents의 section 이력으로 그 절이 판마다 어떻게 바뀌었는지(바뀜·추가·소실·그대로)를 함께
// 보인다. 복원은 비교 화면에서 고른다(R14: 비교를 거치지 않는 되돌리기 버튼을 두지 않는다).
import { useEffect, useState } from "react";
import {
  ErrorState,
  Field,
  IconButton,
  Select,
  Skeleton,
  Tooltip,
} from "@lophn/design/components";
import { editorIcons } from "../../icons/mod.ts";
import { formatDateTooltip, formatRelativeTime, t } from "@lophn/wording";

import type {
  SaverKind,
  SectionChange,
  SectionEntry,
  SectionHistory,
  VersionRow,
  VersionSource,
} from "./source.ts";
import styles from "../info-panel/info-panel.module.css";

const WHOLE = "*";

export function saverLabel(kind: SaverKind): string {
  switch (kind) {
    case "user":
      return t("document.label.saver-user");
    case "agent":
      return t("document.label.saver-agent");
    case "coding_agent":
      return t("document.label.saver-coding-agent");
    case "app":
      return t("document.label.saver-app");
    case "machine":
      return t("document.label.saver-machine");
    default:
      return t("document.label.saver-other");
  }
}

export function sectionChangeLabel(change: SectionChange): string {
  switch (change) {
    case "modified":
      return t("document.label.section-modified");
    case "added":
      return t("document.label.section-added");
    case "missing":
      return t("document.label.section-missing");
    case "unchanged":
      return t("document.label.section-unchanged");
  }
}

type Loaded<T> =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly value: T };

export interface VersionsTabProps {
  document: string;
  source: VersionSource;
  /** 문서 탭이 지금 보이는 판. 그 행에 표시를 단다. */
  viewing: string | null;
  /** 복원 뒤 다시 읽게 바꾸는 값. */
  refresh: number;
  onCompare: (before: string, after: string) => void;
  now?: () => number;
}

export function VersionsTab(
  { document, source, viewing, refresh, onCompare, now = Date.now }:
    VersionsTabProps,
) {
  const [rows, setRows] = useState<Loaded<readonly VersionRow[]>>({
    kind: "loading",
  });
  const [sections, setSections] = useState<readonly SectionEntry[]>([]);
  const [section, setSection] = useState(WHOLE);
  const [history, setHistory] = useState<Loaded<SectionHistory> | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setRows({ kind: "loading" });
    void source.history(document).then((read) => {
      if (!live) return;
      if (!read.ok) {
        setRows({ kind: "failed" });
        return;
      }
      setRows({ kind: "ready", value: read.value });
      const latest = read.value[0];
      if (!latest) return;
      // 절 고르기는 최신 판의 절로 채운다. 절을 읽지 못하면 고르기를 두지 않는다.
      void source.sections(document, latest.id).then((found) => {
        if (live) setSections(found.ok ? found.value : []);
      });
    });
    return () => {
      live = false;
    };
  }, [document, source, refresh, attempt]);

  useEffect(() => {
    setSection(WHOLE);
    setHistory(null);
  }, [document]);

  useEffect(() => {
    if (section === WHOLE) {
      setHistory(null);
      return;
    }
    let live = true;
    setHistory({ kind: "loading" });
    void source.sectionHistory(document, section).then((read) => {
      if (!live) return;
      setHistory(
        read.ok ? { kind: "ready", value: read.value } : {
          kind: "failed",
        },
      );
    });
    return () => {
      live = false;
    };
  }, [document, section, source, refresh]);

  if (rows.kind === "loading") {
    return <Skeleton shape="line" lines={6} />;
  }
  if (rows.kind === "failed") {
    return (
      <ErrorState
        target={t("document.label.versions-target")}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    );
  }
  const versions = rows.value;
  if (versions.length === 0) {
    return <p className={styles.muted}>{t("document.empty.versions")}</p>;
  }
  const latest = versions[0]!;
  const statusOf = (version: string): SectionChange | null => {
    if (history?.kind !== "ready") return null;
    return history.value.rows.find((row) => row.version === version)
      ?.status ?? null;
  };
  const omitted = history?.kind === "ready" &&
    history.value.omitted.length > 0;
  return (
    <div className={styles.stack} data-versions-tab="">
      {sections.length > 0
        ? (
          <Field label={t("document.label.section-filter")}>
            <Select
              size="sm"
              value={section}
              onValueChange={setSection}
              options={[
                { value: WHOLE, label: t("document.label.section-whole") },
                ...sections.map((entry) => ({
                  value: entry.key,
                  label: entry.title,
                })),
              ]}
            />
          </Field>
        )
        : null}
      {omitted
        ? (
          <p className={styles.muted} role="status">
            {t("document.notice.section-omitted")}
          </p>
        )
        : null}
      <ul className={styles.list}>
        {versions.map((row, index) => {
          const previous = versions[index + 1];
          const status = statusOf(row.id);
          const at = new Date(row.savedAt);
          return (
            <li
              key={row.id}
              className={styles.row}
              data-version-row={row.number}
              data-current={row.id === viewing || undefined}
              aria-current={row.id === viewing ? "true" : undefined}
            >
              <span className={styles.version}>
                {t("document.label.version-number", { number: row.number })}
              </span>
              {row.id === latest.id
                ? (
                  <span className={styles.badge}>
                    {t("document.label.version-newest")}
                  </span>
                )
                : null}
              <span className={styles.who}>
                {status === null
                  ? saverLabel(row.savedBy)
                  : sectionChangeLabel(status)}
              </span>
              {row.run === null
                ? null
                : (
                  <span className={styles.run} data-version-run={row.run}>
                    {t(
                      "document.label.version-run",
                      { id: row.run },
                    )}
                  </span>
                )}
              <Tooltip content={formatDateTooltip(at)}>
                <time className={styles.time} dateTime={at.toISOString()}>
                  {formatRelativeTime(at, new Date(now()))}
                </time>
              </Tooltip>
              <span className={styles.actions}>
                <IconButton
                  icon={editorIcons.compare}
                  size="sm"
                  label={t("document.button.compare-previous")}
                  data-compare-previous={row.number}
                  disabled={previous === undefined}
                  onClick={() => {
                    if (previous) onCompare(previous.id, row.id);
                  }}
                />
                <IconButton
                  icon={editorIcons.compareNewest}
                  size="sm"
                  label={t("document.button.compare-newest")}
                  data-compare-newest={row.number}
                  disabled={row.id === latest.id}
                  onClick={() => onCompare(row.id, latest.id)}
                />
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
