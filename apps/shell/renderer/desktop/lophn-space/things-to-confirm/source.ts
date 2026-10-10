// 질문·approval·notification을 core에 묻고 보내는 통로. 모양은 lophn-agent questions,
// platform approvals·notifications contract에서 이 화면들이 읽는 field만 옮겼다.
// 질문 칸(conversation/question-strip), things-to-confirm, notification chip이 같이 쓴다.
import type { ConnectionState } from "../../connection/connection.ts";

export type SourceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string };

/** 역할 넷. 화면 이름은 wording이 정한다. */
export type Role = "lophn" | "app_engineer" | "context_engineer" | "operator";

/** 질문·approval이 걸린 작업 자리. 세션이 없으면 null이다. */
export type Place =
  | { readonly kind: "global" }
  | { readonly kind: "project"; readonly id: string }
  | { readonly kind: "app"; readonly id: string };

export interface QuestionOption {
  readonly key: string;
  /** agent가 쓴 이름. 그대로 글로만 그린다. */
  readonly label: string;
  /** 고정 action이 있으면 보통 confirmation window에서만 확정한다. */
  readonly action: boolean;
  /**
   * action의 command. term.define·app.create는 질문 답의 확정으로 적용하고 확인 창을 열지 않는다.
   * action이 없으면 null이다.
   */
  readonly command?: string | null;
}

export type QuestionStatus = "pending" | "answered" | "expired" | "cancelled";
export type ApprovalStatus =
  | "pending"
  | "granted"
  | "rejected"
  | "expired"
  | "cancelled";

/** 두 요청이 같이 갖는 것. seq는 core의 event 번호(10진 문자열)다. */
interface RequestBase {
  readonly id: string;
  readonly run: string | null;
  readonly session: string | null;
  readonly role: Role | null;
  readonly place: Place | null;
  /** 이 요청을 기다리며 멈춘 run이 있다. 칸에서 먼저 보인다(desktop#R6). */
  readonly blocking: boolean;
  readonly createdSeq: string;
  readonly closedSeq: string | null;
  /** event 시각(ms). 읽지 못하면 null이고 기간 filter에서 빼지 않는다. */
  readonly createdAt: number | null;
  readonly closedAt: number | null;
  readonly expiresAt: string | null;
}

export interface QuestionRequest extends RequestBase {
  readonly kind: "question";
  readonly status: QuestionStatus;
  readonly options: readonly QuestionOption[];
  readonly recommended: string | null;
  readonly answer:
    | { readonly kind: "option"; readonly option: string }
    | { readonly kind: "text" }
    | null;
  readonly closedReason:
    | "deferred"
    | "cancelled"
    | "superseded"
    | "expired"
    | null;
  /** 고른 선택지의 action이 실제로 적용됐는지. 답 접수와 따로다(questions#R10). */
  readonly applied: boolean;
}

export interface ApprovalRequest extends RequestBase {
  readonly kind: "approval";
  readonly status: ApprovalStatus;
  readonly reversible: boolean;
}

export type Request = QuestionRequest | ApprovalRequest;

/** notification이 가리키는 원래 사실. 이름은 platform 계기 표의 event다. */
export interface NotificationRow {
  readonly id: string;
  readonly sourceEvent: string;
  readonly sourceSeq: string;
  readonly readAt: string | null;
  /**
   * source event에 저장된 발생 시각. 없으면 시각을 그리지 않는다.
   * (platform/notifications#R3)
   */
  readonly occurredAt?: string;
  /**
   * source event에 저장된 문서. 없으면 링크를 그리지 않는다.
   */
  readonly document?: string;
  /**
   * OS notification으로 올리지 못한 이유. core가 이번 실행에서 본 것만 온다
   * (platform/notifications#R10). 없으면 실패를 본 적이 없다.
   */
  readonly osFailure?: "unsupported" | "show_failed";
}

export interface Overview {
  readonly requests: readonly Request[];
  readonly notifications: readonly NotificationRow[];
  /** approval 목록을 읽었는지. 못 읽었으면 결정 0건으로 보이지 않는다. */
  readonly approvalsRead: boolean;
  /** notification 목록을 읽었는지. */
  readonly notificationsRead: boolean;
}

export type Answer =
  | { readonly kind: "option"; readonly option: string }
  | { readonly kind: "text"; readonly text: string };

/**
 * 질문의 글. core가 redaction을 거쳐 둔 값이다(lophn-agent ReadQuestionText). 화면은 React
 * 글로만 그린다.
 */
export interface QuestionText {
  readonly prompt: string;
  readonly reason: string;
  /** 선택지 key별 설명. */
  readonly options: ReadonlyMap<string, string>;
  readonly recommendation: string | null;
  /** 자유 답의 글. 선택지 답·미답이면 null이다. */
  readonly answer: string | null;
  /** 취소 이유의 글. 미루기·만료·미종료면 null이다. */
  readonly closedReason: string | null;
}

/** 사람이 [Review]로 여는 보호 창의 대상. contracts shell confirmation intent다. */
export type ReviewIntent =
  | { readonly kind: "approval_request"; readonly approval: string }
  | {
    readonly kind: "question_option_action";
    readonly question: string;
    readonly option_key: string;
  };

export interface RequestSource {
  /** main이 미는 연결 상태. 끊겨도 화면은 마지막 내용을 둔다(desktop#R7). */
  watch(listener: (state: ConnectionState) => void): () => void;
  /** 모든 질문·approval과 notification. 종류나 개수로 버리지 않는다. */
  overview(): Promise<SourceResult<Overview>>;
  /** 한 세션에 걸린 기다리는 요청. 질문 칸이 읽는다. */
  pending(session: string): Promise<SourceResult<readonly Request[]>>;
  /** 읽지 않은 notification. chip이 읽는다. */
  unread(): Promise<SourceResult<readonly NotificationRow[]>>;
  /** approval의 설명 글. 읽을 수 없으면 null이다. */
  reason(request: ApprovalRequest): Promise<SourceResult<string | null>>;
  /** 질문의 본문·이유·선택지 설명·추천 이유와 남은 답·취소 글. */
  text(question: QuestionRequest): Promise<SourceResult<QuestionText>>;
  /**
   * action 없는 선택지 답이나 자유 답. 확인 handle 없이 일반 답 경로로 간다. 같은 질문·답이면
   * 같은 key라 다시 보내도 답이 하나다.
   */
  answer(
    question: QuestionRequest,
    answer: Answer,
  ): Promise<SourceResult<void>>;
  /** 미루기. 답 없음으로 닫는다. */
  defer(question: QuestionRequest): Promise<SourceResult<void>>;
  /** 이유 글을 남기는 취소. */
  cancel(
    question: QuestionRequest,
    reason: string,
  ): Promise<SourceResult<void>>;
  /** 읽음 표시. 답·승인·문제 닫힘이 아니다(platform/notifications#R6). */
  markRead(notification: NotificationRow): Promise<SourceResult<void>>;
  /** confirmation window를 연다. 결정은 그 창에서만 받는다. */
  review(intent: ReviewIntent): Promise<SourceResult<void>>;
}
