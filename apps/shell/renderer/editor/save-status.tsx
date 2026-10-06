// 머리 메타 줄의 저장 상태와 펼치는 상세(shell/editor#R2, R11, R12). 메타 줄에는 지금 결과나
// 다음 행동 하나만 두고, 디스크 저장·기록·version·형식 검사의 단계별 사실과 안 시각은 상세에서
// 펼친다. legacy SaveStatus의 모양(경고·실패만 아이콘, 행동은 글자 버튼)을 옮겼다.
import { useEffect, useRef, useState } from "react";
import {
  Button,
  editorIcons,
  Icon,
  IconButton,
  iconPixels,
} from "@lophn/design/components";
import { formatRelativeTime, t } from "@lophn/wording";

import {
  type SaveAction,
  saveDetails,
  type SaveFacts,
  type SaveHeadline,
  saveHeadline,
} from "./save-state.ts";
import styles from "./save-status.module.css";

/** 화면 낭독은 1초에 한 번까지(legacy UX 5.3.4). */
const ANNOUNCE_MS = 1000;

export function headlineText(headline: SaveHeadline): string {
  switch (headline.kind) {
    case "none":
      return "";
    case "saving":
      return t("document.label.saving");
    case "saved":
      return t("document.label.saved");
    case "version-pending":
      return t("document.status.version-pending");
    case "version-saved":
      return t("document.status.version-saved");
    case "not-tracked":
      return t("document.status.not-tracked");
    case "format-failed":
      return t("document.status.format-failed");
    case "version-conflict":
      return t("document.status.version-conflict");
    case "conflict":
      return t("document.status.conflict");
    case "unknown":
      return t("document.status.unknown");
    case "failed":
      return t("document.status.failed");
    case "offline":
      return t("document.status.offline");
  }
}

function actionText(action: Exclude<SaveAction, null>): string {
  switch (action) {
    case "retry":
      return t("common.button.retry");
    case "check":
      return t("document.button.check-again");
    case "compare":
      return t("document.button.compare");
    case "problems":
      return t("document.button.show-problems");
  }
}

export interface SaveStatusProps {
  facts: SaveFacts;
  detailsOpen: boolean;
  onToggleDetails: () => void;
  onAction: (action: Exclude<SaveAction, null>) => void;
}

/** 메타 줄의 저장 상태. 결과가 없으면 아무것도 그리지 않는다. */
export function SaveStatus(
  { facts, detailsOpen, onToggleDetails, onAction }: SaveStatusProps,
) {
  const headline = saveHeadline(facts);
  const text = headlineText(headline);
  const announced = useAnnounced(text);
  if (headline.kind === "none") return null;
  const icon = headline.tone === "critical"
    ? editorIcons.saveFailed
    : headline.tone === "warning"
    ? editorIcons.saveWarning
    : null;
  const label = t("document.button.save-details");
  return (
    <span
      className={styles.status}
      data-save-status={headline.kind}
      data-tone={headline.tone}
    >
      {icon
        ? (
          <Icon
            icon={icon}
            pixels={iconPixels("small")}
            className={styles[headline.tone]}
          />
        )
        : null}
      <span
        className={headline.tone === "muted" ? styles.muted : styles.strong}
      >
        {text}
      </span>
      {headline.action
        ? (
          <Button
            variant="ghost"
            size="sm"
            data-save-action={headline.action}
            onClick={() => onAction(headline.action!)}
          >
            {actionText(headline.action)}
          </Button>
        )
        : null}
      <IconButton
        icon={detailsOpen ? editorIcons.detailsOpen : editorIcons.detailsClosed}
        label={label}
        variant="ghost"
        size="sm"
        aria-expanded={detailsOpen}
        data-save-details-toggle=""
        onClick={onToggleDetails}
      />
      <span className={styles.srOnly} aria-live="polite">{announced}</span>
    </span>
  );
}

function stageLabel(stage: string): string {
  switch (stage) {
    case "file":
      return t("document.label.detail-file");
    case "record":
      return t("document.label.detail-record");
    case "version":
      return t("document.label.detail-version");
    default:
      return t("document.label.detail-format");
  }
}

function valueLabel(stage: string, value: string, facts: SaveFacts): string {
  if (stage === "file") {
    switch (value) {
      case "saving":
        return t("document.label.file-saving");
      case "saved":
        return t("document.label.file-saved");
      case "failed":
        return t("document.label.file-failed");
      case "offline":
        return t("document.label.file-offline");
      case "conflict":
        return t("document.label.file-conflict");
      case "unknown":
        return t("document.label.file-unknown");
      default:
        return t("document.label.file-none");
    }
  }
  if (stage === "record") {
    return value === "recorded"
      ? t("document.label.record-recorded")
      : value === "unverified"
      ? t("document.label.record-unverified")
      : t("document.label.record-none");
  }
  if (stage === "version") {
    switch (value) {
      case "waiting":
        return t("document.label.version-waiting");
      case "preparing":
        return t("document.label.version-preparing");
      case "confirmed":
        return t("document.label.version-confirmed");
      case "conflict":
        return t("document.label.version-conflict");
      case "validation_failed":
        return t("document.label.version-validation-failed");
      case "not_requested":
        return t("document.label.version-not-requested");
      default:
        return t("document.label.version-none");
    }
  }
  return value === "passed"
    ? t("document.label.format-passed")
    : value === "failed"
    ? t("document.label.format-failed", {
      count: facts.format.problems.filter((item) => item.severity === "error")
        .length,
    })
    : t("document.label.format-none");
}

export interface SaveDetailsProps {
  facts: SaveFacts;
  now: number;
}

/** 단계별 사실과 안 시각. 앞 단계 성공과 뒤 단계 실패를 한 줄로 합치지 않는다. */
export function SaveDetails({ facts, now }: SaveDetailsProps) {
  return (
    <dl className={styles.details} data-save-details="">
      {saveDetails(facts).map((detail) => (
        <div
          key={detail.stage}
          className={styles.row}
          data-save-stage={detail.stage}
          data-save-value={detail.value}
        >
          <dt className={styles.stage}>{stageLabel(detail.stage)}</dt>
          <dd className={styles.value}>
            {valueLabel(detail.stage, detail.value, facts)}
          </dd>
          <dd className={styles.at}>
            {detail.at === null
              ? null
              : formatRelativeTime(new Date(detail.at), new Date(now))}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** text를 1초에 한 번까지만 바꿔 화면 낭독이 넘치지 않게 한다. */
function useAnnounced(text: string): string {
  const [said, setSaid] = useState(text);
  const last = useRef(0);
  useEffect(() => {
    const wait = Math.max(0, last.current + ANNOUNCE_MS - Date.now());
    const id = setTimeout(() => {
      last.current = Date.now();
      setSaid(text);
    }, wait);
    return () => clearTimeout(id);
  }, [text]);
  return said;
}
