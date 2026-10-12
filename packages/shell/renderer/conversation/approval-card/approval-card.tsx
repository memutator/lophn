import type { KeyboardEvent } from "react";
import {
  Button,
  Icon,
  IconButton,
  iconPixels,
  Menu,
} from "@lophn/design/components";
import { editorIcons, lophnSpaceIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import type {
  ApprovalCardRequest,
  ApprovalChoice,
  ApprovalPreviewLine,
} from "./model.ts";
import styles from "./approval-card.module.css";

export interface ApprovalCardProps {
  request: ApprovalCardRequest;
  /**
   * [Allow](= allow_once)·[Allow ▾]의 항목·[Deny]를 누르면 고른 것을 미리 고른 confirmation window를
   * 여는 callback만 부른다. 카드는 결정을 제출하지 않는다(platform/approvals#Q4, shell/desktop#R47).
   * Esc도 deny를 미리 고른 채 부른다([Deny] 옆에 Esc 안내).
   */
  onOpenConfirmation: (preselect: ApprovalChoice) => void;
}

const PREVIEW_MARK: Record<ApprovalPreviewLine["kind"], string> = {
  add: "+ ",
  remove: "− ",
  context: "  ",
};

const PREVIEW_STYLE: Record<ApprovalPreviewLine["kind"], string> = {
  add: styles.add,
  remove: styles.remove,
  context: styles.context,
};

// composer 바로 위에 붙는 승인 카드. 요청 요약(제목·한 줄 이유·작은 변경 미리보기)과
// [Allow ▾](Allow once, Allow for this session)·[Deny](옆에 Esc 안내)를 둔다. 일을 멈추는 Stop은
// 카드가 아니라 composer에 있고 거절과 다르다. request.allowSession이
// false이면 ▾ 없이 Allow once만 있다.
export function ApprovalCard(
  { request, onOpenConfirmation }: ApprovalCardProps,
) {
  // 범위 menu 안의 Esc는 menu를 닫을 뿐이다. menu는 portal이라 card DOM 밖에 있다.
  const keyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    if (!event.currentTarget.contains(event.target as Node)) return;
    event.preventDefault();
    onOpenConfirmation("deny");
  };

  return (
    <section
      className={styles.card}
      aria-label={t("conversation.label.approval")}
      data-approval-id={request.id}
      onKeyDown={keyDown}
    >
      <div className={styles.summary}>
        <p className={styles.title}>
          <Icon icon={editorIcons.problem} pixels={iconPixels("base")} />
          {request.title}
        </p>
        <p className={styles.reason}>{request.reason}</p>
        {request.preview
          ? (
            <pre
              className={styles.preview}
              aria-label={t("conversation.label.approval-preview")}
            >
              {request.preview.map((line, index) => (
                <span
                  key={index}
                  className={PREVIEW_STYLE[line.kind]}
                  data-preview-line={line.kind}
                >
                  {PREVIEW_MARK[line.kind]}
                  {line.text}
                  {"\n"}
                </span>
              ))}
            </pre>
          )
          : null}
      </div>
      <footer className={styles.actions}>
        <span className={styles.split}>
          <Button
            size="sm"
            variant="primary"
            onClick={() => onOpenConfirmation("allow_once")}
          >
            {t("conversation.button.approval-allow")}
          </Button>
          {request.allowSession
            ? (
              <Menu
                trigger={
                  <IconButton
                    icon={lophnSpaceIcons.collapse}
                    label={t("conversation.button.approval-allow-scope")}
                    variant="secondary"
                    size="sm"
                  />
                }
                items={[
                  {
                    id: "allow_once",
                    label: t("conversation.button.approval-allow-once"),
                  },
                  {
                    id: "allow_session",
                    label: t("conversation.button.approval-allow-session"),
                  },
                ]}
                onSelect={(id) => onOpenConfirmation(id as ApprovalChoice)}
              />
            )
            : null}
        </span>
        <span className={styles.deny}>
          <Button size="sm" onClick={() => onOpenConfirmation("deny")}>
            {t("conversation.button.approval-deny")}
          </Button>
          <span className={styles.escHint} data-esc-hint="">
            {t("conversation.label.approval-esc")}
          </span>
        </span>
      </footer>
    </section>
  );
}
