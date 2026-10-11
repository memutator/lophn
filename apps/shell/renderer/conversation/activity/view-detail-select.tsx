import type { ReactElement } from "react";

import type { ViewDetail } from "./model.ts";

export interface ViewDetailSelectProps {
  value: ViewDetail;
  onChange: (value: ViewDetail) => void;
}

// header의 보기 상세 select. Messages·Compact·Everything을 이 순서로 고른다(shell/desktop#R42).
// 고른 값은 tool 줄의 detail만 바꾸고 메시지와 카드는 그대로다.
export function ViewDetailSelect(_props: ViewDetailSelectProps): ReactElement {
  throw new Error("not implemented: agent-I27");
}
