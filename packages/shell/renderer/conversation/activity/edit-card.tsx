import { type ReactElement, useId } from "react";
import { Button, Card } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { EditUndo } from "../agent-source.ts";
import { reasonText } from "../rewind/text.ts";
import type { EditView } from "./model.ts";
import styles from "./activity.module.css";

export interface EditCardProps {
  edit: EditView;
  /** [Undo]를 눌러 되돌린 뒤이다. 카드는 "Undid the edit to <경로>"가 되고 Undo는 없다. */
  undone: boolean;
  /** 지금 Undo할 수 있는가. 아니면 단추는 비활성이고 이유가 단추 곁에 보인다. */
  undo: EditUndo;
  /** [Open]: 그 문서의 탭을 연다. */
  onOpen: (edit: EditView) => void;
  /** [Undo]: 이 편집 하나를 같은 pre-image 기록으로 되돌린다. */
  onUndo: (edit: EditView) => void;
}

// 문서를 바꾼 편집 카드 "Edited <경로> +n −m"와 [Open]·[Undo]. 되돌린 뒤에는
// "Undid the edit to <경로>"와 [Open]뿐이다. Undo를 다시 되돌리는 기능은 없다.
export function EditCard(
  { edit, undone, undo, onOpen, onUndo }: EditCardProps,
): ReactElement {
  const reasonId = useId();
  const reason = !undone && !undo.can ? reasonText(undo.reason) : null;
  return (
    <Card>
      <div className={styles.editCard} data-edit-card={edit.id}>
        <span className={styles.editText} data-edit-summary="">
          {t(
            undone
              ? "conversation.label.edit-undone"
              : "conversation.label.edit-made",
          )} <span className={styles.mono}>{edit.path}</span>
          {undone ? null : (
            <>
              {" "}
              <span className={styles.added}>+{edit.added}</span>{" "}
              <span className={styles.removed}>−{edit.removed}</span>
            </>
          )}
        </span>
        <span className={styles.editActions}>
          <Button size="sm" onClick={() => onOpen(edit)}>
            {t("conversation.button.edit-open")}
          </Button>
          {!undone && (
            <Button
              size="sm"
              variant="ghost"
              disabled={!undo.can}
              aria-describedby={reason === null ? undefined : reasonId}
              onClick={() => onUndo(edit)}
            >
              {t("conversation.button.edit-undo")}
            </Button>
          )}
        </span>
        {reason === null ? null : (
          <p
            className={styles.undoReason}
            id={reasonId}
            data-undo-reason=""
          >
            {reason}
          </p>
        )}
      </div>
    </Card>
  );
}
