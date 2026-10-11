import type { ReactElement } from "react";
import { Button, Card } from "@lophn/design/components";

import type { EditView } from "./model.ts";
import styles from "./activity.module.css";

export interface EditCardProps {
  edit: EditView;
  /** [Undo]를 눌러 되돌린 뒤이다. 카드는 "Undid the edit to <경로>"가 되고 Undo는 없다. */
  undone: boolean;
  /** redo가 가능한 동안만 true다: 다음 사람 메시지를 보내기 전까지(lophn-agent/revert#R16). */
  canRedo: boolean;
  /** [Open]: 그 문서의 탭을 연다. */
  onOpen: (edit: EditView) => void;
  /** [Undo]: lophn-agent/revert가 정한 되돌리기를 부른다. */
  onUndo: (edit: EditView) => void;
  /** [Redo]: 되돌리기를 다시 돌린다. canRedo일 때만 단추가 있다. */
  onRedo: (edit: EditView) => void;
}

// 문서를 바꾼 편집 카드 "Edited <경로> +n −m"와 [Open]·[Undo](shell/desktop#R41). 되돌린 뒤에는
// "Undid the edit to <경로>"와 [Open], canRedo이면 [Redo]다.
export function EditCard(
  { edit, undone, canRedo, onOpen, onUndo, onRedo }: EditCardProps,
): ReactElement {
  return (
    <Card>
      <div className={styles.editCard} data-edit-card={edit.id}>
        <span className={styles.editText} data-edit-summary="">
          {undone ? "Undid the edit to " : "Edited "}
          <span className={styles.mono}>{edit.path}</span>
          {undone ? null : (
            <>
              {" "}
              <span className={styles.added}>+{edit.added}</span>{" "}
              <span className={styles.removed}>−{edit.removed}</span>
            </>
          )}
        </span>
        <span className={styles.editActions}>
          <Button size="sm" onClick={() => onOpen(edit)}>Open</Button>
          {!undone && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onUndo(edit)}
            >
              Undo
            </Button>
          )}
          {undone && canRedo && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onRedo(edit)}
            >
              Redo
            </Button>
          )}
        </span>
      </div>
    </Card>
  );
}
