// 이 컴퓨터의 project 줄 아래, 다른 컴퓨터의 agent가 남긴 handoff note 한 줄. 누르면 그 note로 새 session을 연다.
// 꼬리표와 상대 시각은 sidebar가 만드는 같은 조각이라 받는다.
import { t } from "@lophn/i18n";
import { Tooltip } from "@lophn/ui/overlay";
import { Icon } from "@lophn/ui/primitives";
import type { ReactNode } from "react";

import type { HandoffNote } from "../../../../protocol/lophn-agent/handoff.ts";
import { actionIcons } from "../../icons/mod.ts";
import styles from "../../shell/left-sidebar.module.css";

// 32 KiB까지 올 수 있는 글을 tooltip에 다 그리지 않는다.
const TIP_CHARS = 1200;

export function HandoffRow({
  note,
  tag,
  age,
  onOpen,
}: {
  note: HandoffNote;
  /** 그 컴퓨터의 꼬리표. */
  tag: ReactNode;
  age: string;
  onOpen: () => void;
}) {
  const first =
    note.text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line !== "") ?? "";
  const tip = (
    <div className={styles.handoffTip}>
      <strong>
        {t("left-sidebar.label.handoff-from", { computer: note.computer })}
      </strong>
      {"\n"}
      {note.text.length > TIP_CHARS
        ? `${note.text.slice(0, TIP_CHARS)}…`
        : note.text}
      {note.commit === null ? null : (
        <>
          {"\n\n"}
          {t("left-sidebar.label.handoff-commit", { commit: note.commit })}
        </>
      )}
      {"\n\n"}
      {t("left-sidebar.label.handoff-continue")}
    </div>
  );
  return (
    <Tooltip content={tip} placement="beside">
      <button
        type="button"
        className={styles.sessionRow}
        data-handoff={note.session}
        onClick={onOpen}
      >
        <span className={styles.rowIcon}>
          <Icon icon={actionIcons.download} pixels={14} />
        </span>
        <span className={`${styles.rowLabel} ${styles.handoffLabel}`}>
          {first}
        </span>
        {tag}
        {note.branch === null ? null : (
          <span className={`${styles.rowMeta} ${styles.handoffBranch}`}>
            {note.branch}
          </span>
        )}
        <span className={styles.rowMeta}>{age}</span>
      </button>
    </Tooltip>
  );
}
