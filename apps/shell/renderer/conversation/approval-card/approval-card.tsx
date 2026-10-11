import type { ReactElement } from "react";

import type { ApprovalCardRequest, ApprovalChoice } from "./model.ts";

export interface ApprovalCardProps {
  request: ApprovalCardRequest;
  /**
   * [Allow](= allow_once)·[Allow ▾]의 항목·[Deny]를 누르면 고른 것을 미리 고른 confirmation window를
   * 여는 callback만 부른다. 카드는 결정을 제출하지 않는다(platform/approvals#Q4, shell/desktop#R47).
   * Esc도 deny를 미리 고른 채 부른다([Deny] 옆에 Esc 안내).
   */
  onOpenConfirmation: (preselect: ApprovalChoice) => void;
}

// composer 바로 위에 붙는 승인 카드. 요청 요약(제목·한 줄 이유·작은 변경 미리보기)과
// [Allow ▾](Allow once, Allow for this session)·[Deny](옆에 Esc 안내)를 둔다. 일을 멈추는 Stop은
// 카드가 아니라 composer에 있고 거절과 다르다. request.allowSession이
// false이면 ▾ 없이 Allow once만 있다.
export function ApprovalCard(_props: ApprovalCardProps): ReactElement {
  throw new Error("not implemented: agent-I26");
}
