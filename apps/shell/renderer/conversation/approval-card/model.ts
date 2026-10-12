// 승인 카드가 받는 값. platform/approvals의 요청(GetApproval, ReadApprovalText)에서 만든 화면 값이다.
// 글은 이미 읽어 문자열로 들어온다.

export interface ApprovalPreviewLine {
  kind: "add" | "remove" | "context";
  text: string;
}

export interface ApprovalCardRequest {
  /** approval request ID(apr_…). */
  id: string;
  /** 요청 제목. */
  title: string;
  /** 한 줄 이유. */
  reason: string;
  /** 작은 변경 미리보기. 없으면 null이다. */
  preview: readonly ApprovalPreviewLine[] | null;
  /**
   * session 허락을 고를 수 있는지. agent tool call의 ask만 true이고 앱 command의 confirm 같은
   * 정확한 대상 하나를 보고 결정해야 하는 request는 false다(platform/approvals#R20).
   */
  allowSession: boolean;
}

/**
 * 카드에서 고른 것. 결정이 아니라 confirmation window에 미리 고를 값이다. 계속 허락(Always)은
 * 두지 않는다(platform/approvals#R18).
 */
export type ApprovalChoice = "allow_once" | "allow_session" | "deny";
