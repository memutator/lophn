// 질문·approval 읽기 결과의 사람·모델용 모양이다. MCP tool과
// CLI command가 같은 상태 이름·문장·결정 화면 링크를 쓰도록 한 곳에 둔다. 읽기 결과만
// 다루고 결정하지 않는다: 답·허락·거절·사용은 이 파일에 없다.
import { decisionLink } from "../../protocol/coding-agent/mod.ts";

// 질문 묶음(qgr) 하나의 읽기 결과다. 적용은 질문마다 기록되고, 고정 action이 있는
// 질문은 질문 하나짜리 묶음이므로 질문 하나라도 적용됐으면 묶음은 적용된 것이다.
export type QuestionRecord = {
  id: string;
  status: "pending" | "answered" | "expired" | "cancelled";
  closed_reason: "deferred" | "cancelled" | "superseded" | "expired" | null;
  questions: ({ applied: boolean } & Record<string, unknown>)[];
} & Record<string, unknown>;

// 대기와 적용을 한 이름으로 섞지 않는다. 답 접수는 적용 완료가 아니다.
export type QuestionState =
  | "waiting"
  | "answered"
  | "applied"
  | "deferred"
  | "cancelled"
  | "superseded"
  | "expired";

export function questionState(record: QuestionRecord): QuestionState {
  switch (record.status) {
    case "pending":
      return "waiting";
    case "answered":
      return record.questions.some((question) => question.applied)
        ? "applied"
        : "answered";
    case "expired":
      return "expired";
    default:
      return record.closed_reason === "deferred"
        ? "deferred"
        : record.closed_reason === "superseded"
        ? "superseded"
        : "cancelled";
  }
}

const QUESTION_TEXT: Record<QuestionState, string> = {
  waiting: "사람의 답을 기다린다",
  answered: "답을 받았고 아직 적용하지 않았다",
  applied: "답을 받아 적용했다",
  deferred: "사람이 미뤘다",
  cancelled: "취소했다",
  superseded: "새 질문이 대신했다",
  expired: "기한이 지났다",
};

export function questionStateText(state: QuestionState): string {
  return QUESTION_TEXT[state];
}

// 질문 묶음 하나의 읽기 모양이다. 대기 중이면 사람이 결정하는 화면 링크가 붙는다.
export function questionView(record: QuestionRecord) {
  const state = questionState(record);
  return {
    ...record,
    state,
    waiting: state === "waiting",
    decision_link: state === "waiting" ? decisionLink(record.id) : null,
  };
}

export type ApprovalRequest = {
  id: string;
  status: "pending" | "granted" | "rejected" | "expired" | "cancelled";
} & Record<string, unknown>;

// 대기·허락·사용을 구별한다. 허락은 사용(적용)이 아니다. 사용 기록은 show에만 있다.
export type ApprovalState =
  | "waiting"
  | "granted"
  | "used"
  | "rejected"
  | "expired"
  | "cancelled";

export function approvalState(
  request: ApprovalRequest,
  use: unknown,
): ApprovalState {
  if (request.status === "granted") {
    return use === null || use === undefined ? "granted" : "used";
  }
  return request.status === "pending" ? "waiting" : request.status;
}

const APPROVAL_TEXT: Record<ApprovalState, string> = {
  waiting: "사람의 결정을 기다린다",
  granted: "허락했고 아직 쓰이지 않았다",
  used: "허락을 받아 쓰였다",
  rejected: "거절했다",
  expired: "기한이 지났다",
  cancelled: "취소했다",
};

export function approvalStateText(state: ApprovalState): string {
  return APPROVAL_TEXT[state];
}

export function approvalView(request: ApprovalRequest, use: unknown) {
  const state = approvalState(request, use);
  return {
    ...request,
    state,
    waiting: state === "waiting",
    decision_link: state === "waiting" ? decisionLink(request.id) : null,
  };
}
