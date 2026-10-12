// things-to-confirm·chip·공간 크롬의 순수 규칙. 화면은 이 값을 그대로 그린다.
import type { GroupAnswer } from "../../../conversation/question-card/model.ts";
import type {
  NotificationRow,
  Place,
  QuestionGroupRequest,
  Request,
  Role,
} from "./source.ts";

function seq(value: string | null): bigint {
  if (value === null) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export function isPending(request: Request): boolean {
  return request.status === "pending";
}

/**
 * 기다리는 요청의 순서. 기다리는 것만, run을 멈춘 요청이 먼저고 나머지는 접수(생성 event)
 * 순이다(desktop#R6). 목록을 오가도 이 순서와 요청 자체는 바뀌지 않는다.
 */
export function stripOrder(requests: readonly Request[]): readonly Request[] {
  return requests.filter(isPending).sort((a, b) => {
    if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
    const order = seq(a.createdSeq) - seq(b.createdSeq);
    return order < 0n ? -1 : order > 0n ? 1 : 0;
  });
}

export interface WaitingCounts {
  readonly questions: number;
  readonly decisions: number;
}

/** 기다리는 것의 종류별 개수(desktop#R9). */
export function waitingCounts(requests: readonly Request[]): WaitingCounts {
  let questions = 0;
  let decisions = 0;
  for (const request of requests) {
    if (!isPending(request)) continue;
    if (request.kind === "question") questions += 1;
    else decisions += 1;
  }
  return { questions, decisions };
}

/** 지난 일. 닫힌 것만 최신(닫힌 event가 늦은 것)부터 둔다(desktop#R9). */
export function pastOrder(requests: readonly Request[]): readonly Request[] {
  return requests.filter((request) => !isPending(request)).sort((a, b) => {
    const order = seq(b.closedSeq) - seq(a.closedSeq);
    return order < 0n ? -1 : order > 0n ? 1 : 0;
  });
}

export type RoleFilter = "all" | Role;
export type PeriodFilter = "all" | "day" | "week" | "month";

export interface Filter {
  readonly role: RoleFilter;
  readonly period: PeriodFilter;
}

export const ALL: Filter = { role: "all", period: "all" };

const DAY_MS = 24 * 60 * 60 * 1000;

const PERIOD_MS: Record<Exclude<PeriodFilter, "all">, number> = {
  day: DAY_MS,
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
};

/**
 * 역할·기간 filter. 역할을 모르는 요청은 "모든 역할"에서만 보인다. 시각을 읽지 못한 요청은
 * 기간으로 빼지 않는다. 모른다는 이유로 숨기지 않는다.
 */
export function passes(request: Request, filter: Filter, now: number): boolean {
  if (filter.role !== "all" && request.role !== filter.role) return false;
  if (filter.period === "all") return true;
  const at = request.closedAt ?? request.createdAt;
  if (at === null) return true;
  return now - at <= PERIOD_MS[filter.period];
}

/** notification이 가리키는 질문·approval. 원래 event가 그 요청의 생성 event다. */
export function notificationTarget(
  notification: NotificationRow,
  requests: readonly Request[],
): Request | null {
  if (
    notification.sourceEvent !== "QuestionCreated" &&
    notification.sourceEvent !== "ApprovalRequestCreated"
  ) {
    return null;
  }
  const kind = notification.sourceEvent === "QuestionCreated"
    ? "question"
    : "approval";
  return requests.find((request) =>
    request.kind === kind && request.createdSeq === notification.sourceSeq
  ) ?? null;
}

/** notification 목록. 최신 원래 사실부터 둔다. 읽음 여부로 버리지 않는다. */
export function notificationOrder(
  notifications: readonly NotificationRow[],
): readonly NotificationRow[] {
  return [...notifications].sort((a, b) => {
    const order = seq(b.sourceSeq) - seq(a.sourceSeq);
    return order < 0n ? -1 : order > 0n ? 1 : 0;
  });
}

/**
 * chip에 올릴 notification. 읽지 않았고 이 창에서 닫지 않은 것만, 먼저 온 것부터다. 닫기는
 * 이 창의 표시일 뿐 읽음이 아니다(desktop#R10).
 */
export function chipQueue(
  unread: readonly NotificationRow[],
  dismissed: ReadonlySet<string>,
): readonly NotificationRow[] {
  return unread
    .filter((row) => row.readAt === null && !dismissed.has(row.id))
    .sort((a, b) => {
      const order = seq(a.sourceSeq) - seq(b.sourceSeq);
      return order < 0n ? -1 : order > 0n ? 1 : 0;
    });
}

function samePlace(a: Place | null, b: Place): boolean {
  if (a === null) return false;
  if (a.kind === "global" || b.kind === "global") return a.kind === b.kind;
  return a.kind === b.kind && a.id === b.id;
}

/**
 * 한 공간에서 기다리는 결정 수. 런처 카드는 approval만(desktop#R26), 프로젝트·앱 공간의
 * 크롬은 그 공간의 질문과 approval 모두를 센다(desktop#R27).
 */
export function placeWaiting(
  requests: readonly Request[],
  place: Place,
  kinds: "approvals" | "all",
): number {
  return requests.filter((request) =>
    isPending(request) && samePlace(request.place, place) &&
    (kinds === "all" || request.kind === "approval")
  ).length;
}

/**
 * 확인 창 없이 질문 답의 확정으로 적용하는 고정 action command. 사람이 질문에서 그 선택지를
 * 고르는 것이 결정이다(flow new-app 3, documents/terms#R2). 그 밖 action은 확인 창을 연다.
 */
export function confirmsWithoutWindow(command: string | null | undefined) {
  return command === "term.define" || command === "app.create" ||
    command === "apply_settings";
}

/**
 * 묶음에서 고른 답이 confirmation window에서만 확정하는 action 선택지이면 그 질문과 선택지.
 * 고정 action은 질문 하나짜리 묶음에만 있다(questions#R13). term.define·app.create·apply_settings는
 * 되돌릴 수 있는 안쪽 동작이라 확인 창 없이 확정하므로 여기에 걸리지 않는다. 자유 답은 동작으로
 * 해석하지 않는다(R15).
 */
export function reviewTarget(
  group: QuestionGroupRequest,
  answers: readonly GroupAnswer[],
): { question: string; option_key: string } | null {
  if (group.questions.length !== 1) return null;
  const only = group.questions[0]!;
  const given = answers.find((entry) => entry.question === only.id);
  if (given === undefined || given.answer.kind !== "option") return null;
  const optionKey = given.answer.option_key;
  const chosen = only.options.find((item) => item.key === optionKey);
  if (chosen === undefined || !chosen.action) return null;
  if (confirmsWithoutWindow(chosen.command)) return null;
  return { question: only.id, option_key: optionKey };
}

/** 보낼 수 있는 자유 답. 공백뿐인 글은 답이 아니다(questions#R6). */
export function usableText(text: string): boolean {
  return text.trim().length > 0;
}

/**
 * 자유 답·취소 이유 하나의 상한(UTF-8 bytes). lophn-agent contract의
 * QUESTION_TEXT_MAX_BYTES와 같아야 한다(테스트가 비교한다). renderer는 contract schema를
 * bundle에 넣지 않으므로 값만 둔다.
 */
export const QUESTION_TEXT_MAX_BYTES = 32768;

/** core가 받지 않을 만큼 긴 글. 보내기 전에 막고 쓴 글은 그대로 둔다. */
export function textTooLong(text: string): boolean {
  return new TextEncoder().encode(text).length > QUESTION_TEXT_MAX_BYTES;
}
