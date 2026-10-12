// 문서 옆 notice. 높이 32px·아이콘 14px·아래 여백 12px에 가장 높은 우선순위
// 하나만 보인다. 충돌 막대는 해결까지 남고 해결 화면으로 가는 행동 하나를 둔다. 디스크 재읽기
// 안내만 3초 뒤 사라진다.
import { useEffect } from "react";
import { Button, Icon, iconPixels } from "@lophn/design/components";
import { editorIcons } from "../icons/mod.ts";
import { t } from "@lophn/wording";

import { type NoticeKind, RELOADED_NOTICE_MS } from "./save-state.ts";
import styles from "./notice-bar.module.css";

export interface NoticeBarProps {
  kind: NoticeKind;
  /** 충돌 notice의 해결 화면 열기. */
  onCompare?: () => void;
  /** 잠시 보이는 notice가 사라질 때. */
  onDismiss?: () => void;
  /** 테스트가 주입한다. */
  dismissAfterMs?: number;
}

function messageOf(kind: NoticeKind): string {
  switch (kind) {
    case "conflict":
      return t("document.notice.conflict");
    case "version-conflict":
      return t("document.notice.version-conflict");
    case "reloaded":
      return t("document.notice.reloaded");
    case "compare-failed":
      return t("document.error.compare-failed");
    case "edit-offline":
      return t("document.error.edit-offline");
    case "edit-too-large":
      return t("document.error.edit-too-large");
    case "edit-unsupported":
      return t("document.error.edit-unsupported");
    case "edit-unavailable":
      return t("document.error.edit-unavailable");
    case "width-failed":
      return t("document.error.width-failed");
    case "menu-unavailable":
      return t("common.overlay.unavailable");
  }
}

export function NoticeBar(
  {
    kind,
    onCompare,
    onDismiss,
    dismissAfterMs = RELOADED_NOTICE_MS,
  }: NoticeBarProps,
) {
  const brief = kind === "reloaded";
  useEffect(() => {
    if (!brief || !onDismiss) return;
    const id = setTimeout(onDismiss, dismissAfterMs);
    return () => clearTimeout(id);
  }, [brief, onDismiss, dismissAfterMs]);
  const conflict = kind === "conflict" || kind === "version-conflict";
  const icon = conflict
    ? editorIcons.conflict
    : brief
    ? editorIcons.reloaded
    : editorIcons.saveWarning;
  return (
    <div
      className={styles.notice}
      data-notice={kind}
      data-tone={brief ? "neutral" : "warning"}
      role={conflict ? "alert" : "status"}
    >
      <Icon icon={icon} pixels={iconPixels("small")} className={styles.icon} />
      <span className={styles.text}>{messageOf(kind)}</span>
      {conflict && onCompare
        ? (
          <Button
            variant="ghost"
            size="sm"
            data-notice-compare=""
            onClick={onCompare}
          >
            {t("document.button.compare")}
          </Button>
        )
        : null}
    </div>
  );
}
