// 이 컴퓨터의 project 줄 아래, 다른 컴퓨터의 agent가 남긴 handoff note 한 줄(아이콘 없이 위 이름 "From other computers"의 글 자리에 맞춘다). 누르면 그 note로 새 session을 열고,
// hover하면 오른쪽 끝의 x가 age 자리에서 note를 목록에서 뺀다(session 줄의 Stop과 같은 자리). branch와 commit은 hover 글에 있다.
// 꼬리표와 상대 시각은 sidebar가 만드는 같은 조각이라 받는다.
import { t } from "@lophn/i18n";
import { Tooltip } from "@lophn/ui/overlay";
import { Icon } from "@lophn/ui/primitives";
import { type ReactNode, useRef } from "react";

import type { HandoffNote } from "../../../../protocol/lophn-agent/handoff.ts";
import { shellIcons } from "../../icons/mod.ts";
import styles from "../../shell/left-sidebar.module.css";

// 32 KiB까지 올 수 있는 글을 tooltip에 다 그리지 않는다.
const TIP_CHARS = 1200;

function formatAttachmentBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function HandoffRow({
  note,
  tag,
  age,
  onOpen,
  onDismiss,
}: {
  note: HandoffNote;
  /** 그 컴퓨터의 꼬리표. */
  tag: ReactNode;
  age: string;
  /** 끝날 때까지 이 줄의 다른 click은 무시한다(두 번 눌러 session이 둘 열리지 않게). */
  onOpen: () => Promise<void>;
  onDismiss: () => void;
}) {
  const opening = useRef(false);
  const first =
    note.text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? "";
  const attachments = note.attachments ?? [];
  const tip = (
    <div className={styles.handoffTip}>
      <strong>
        {t("left-sidebar.label.handoff-from", { computer: note.computer })}
      </strong>
      {"\n"}
      {note.text.length > TIP_CHARS
        ? `${note.text.slice(0, TIP_CHARS)}…`
        : note.text}
      {attachments.length === 0 ? null : (
        <>
          {"\n\n"}
          {t("settings-sync.label.attachments-count", {
            count: attachments.length,
          })}
          {attachments.map((att) => (
            <div key={`${att.transfer}:${att.rel_path ?? att.name}`}>
              {`• ${att.name} (${formatAttachmentBytes(att.size)}) · ${t(
                "settings-sync.label.attachment-inbox",
                {
                  transfer: att.transfer,
                  path: att.rel_path ?? att.name,
                },
              )}`}
            </div>
          ))}
        </>
      )}
      {note.branch === null ? null : (
        <>
          {"\n\n"}
          {t("left-sidebar.label.handoff-branch", { branch: note.branch })}
        </>
      )}
      {note.commit === null ? null : (
        <>
          {note.branch === null ? "\n\n" : "\n"}
          {t("left-sidebar.label.handoff-commit", { commit: note.commit })}
        </>
      )}
      {"\n\n"}
      {t("left-sidebar.label.handoff-continue")}
    </div>
  );
  return (
    <div className={styles.handoffLine} data-handoff-line={note.session}>
      <Tooltip content={tip} placement="beside">
        <button
          type="button"
          className={styles.sessionRow}
          data-handoff={note.session}
          onClick={() => {
            if (opening.current) return;
            opening.current = true;
            void onOpen().finally(() => {
              opening.current = false;
            });
          }}
        >
          <span className={`${styles.rowLabel} ${styles.handoffLabel}`}>
            {first}
          </span>
          {attachments.length === 0 ? null : (
            <span
              className={styles.handoffTag}
              data-handoff-attachments={attachments.length}
            >
              {t("settings-sync.label.attachments-count", {
                count: attachments.length,
              })}
            </span>
          )}
          <span className={styles.handoffTag}>{tag}</span>
          <span className={styles.handoffAge}>{age}</span>
        </button>
      </Tooltip>
      <Tooltip
        content={t("left-sidebar.button.dismiss-handoff")}
        placement="beside"
      >
        <button
          type="button"
          className={`${styles.rowAction} ${styles.handoffDismiss}`}
          aria-label={t("left-sidebar.button.dismiss-handoff")}
          data-handoff-dismiss=""
          onClick={onDismiss}
        >
          <Icon icon={shellIcons.close} pixels={14} />
        </button>
      </Tooltip>
    </div>
  );
}
