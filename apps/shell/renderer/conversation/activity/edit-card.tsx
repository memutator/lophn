import type { ReactElement } from "react";

import type { EditView } from "./model.ts";

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
export function EditCard(_props: EditCardProps): ReactElement {
  throw new Error("not implemented: agent-I27");
}
