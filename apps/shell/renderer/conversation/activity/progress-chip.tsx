import type { ReactElement } from "react";

import type { TaskView } from "./model.ts";

export interface ProgressChipProps {
  /** 일하는 중의 할 일 목록. 비어 있으면 chip을 그리지 않는다. */
  tasks: readonly TaskView[];
}

// header의 진행 chip("2/4" = 끝낸 수/전체). 누르면 Tasks popover가 열리고 줄마다
// ✓ 끝남, ● 지금, ○ 남음을 보인다(shell/desktop#R42).
export function ProgressChip(_props: ProgressChipProps): ReactElement | null {
  throw new Error("not implemented: agent-I27");
}
