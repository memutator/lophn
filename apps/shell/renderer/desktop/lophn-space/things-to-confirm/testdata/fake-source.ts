// things-to-confirm·chip 테스트의 RequestSource. 요청과 notification을 메모리에 두고
// 보낸 것을 기록한다. 답의 결과와 연결 상태는 테스트가 정한다.
import type { ConnectionState } from "../../../connection/connection.ts";
import type { GroupAnswer } from "../../../../conversation/question-card/model.ts";
import type {
  ApprovalRequest,
  GroupQuestion,
  NotificationRow,
  QuestionGroupRequest,
  QuestionGroupText,
  Request,
  RequestSource,
  ReviewIntent,
  SourceResult,
} from "../source.ts";

/** 묶음 n의 ID(qgr_…). 질문 요청의 id다. */
export function groupId(n: number): string {
  return `qgr_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;
}

/** 묶음 n의 index번째(1부터) 질문 ID(qst_…). */
export function questionId(n: number, index = 1): string {
  return `qst_0${index}h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;
}

export function approvalId(n: number): string {
  return `apr_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;
}

export function sessionOf(n: number): string {
  return `ses_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;
}

/** 질문 하나. 고치지 않으면 선택지 둘(추천 keep)이고 답이 없다. */
export function groupQuestion(
  n: number,
  index: number,
  patch: Partial<GroupQuestion> = {},
): GroupQuestion {
  return {
    id: questionId(n, index),
    options: [
      { key: "keep", label: "Keep both files", action: false },
      { key: "merge", label: "Merge them", action: false },
    ],
    recommended: "keep",
    answer: null,
    applied: false,
    ...patch,
  };
}

/**
 * 세션 없는 run의 질문 묶음. 고치지 않으면 질문 하나짜리이고 기다리는 중이다. 이 화면은 세션
 * 없는 묶음만 받으므로 session은 null이다.
 */
export function question(
  n: number,
  patch: Partial<QuestionGroupRequest> = {},
): QuestionGroupRequest {
  return {
    kind: "question",
    id: groupId(n),
    run: `run_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`,
    session: null,
    role: "lophn",
    place: null,
    blocking: false,
    createdSeq: String(n * 10),
    closedSeq: null,
    createdAt: null,
    closedAt: null,
    expiresAt: null,
    status: "pending",
    closedReason: null,
    questions: [groupQuestion(n, 1)],
    ...patch,
  };
}

export function approval(
  n: number,
  patch: Partial<ApprovalRequest> = {},
): ApprovalRequest {
  return {
    kind: "approval",
    id: approvalId(n),
    run: `run_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`,
    session: sessionOf(1),
    role: "lophn",
    place: { kind: "global" },
    blocking: false,
    createdSeq: String(n * 10),
    closedSeq: null,
    createdAt: null,
    closedAt: null,
    expiresAt: null,
    status: "pending",
    reversible: false,
    ...patch,
  };
}

export function notification(
  n: number,
  sourceEvent: string,
  sourceSeq: string,
  readAt: string | null = null,
): NotificationRow {
  return {
    id: `ntf_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`,
    sourceEvent,
    sourceSeq,
    readAt,
  };
}

/**
 * 묶음의 글. 고치지 않으면 질문마다 본문·이유·선택지 설명이 있는 기본 글이다. 첫 질문의 본문은
 * "Which copy of the notes should stay?", 그다음은 "Question 2?"처럼 번호가 붙는다.
 */
export function questionText(
  request: QuestionGroupRequest,
  patch: Partial<QuestionGroupText> = {},
): QuestionGroupText {
  return {
    questions: request.questions.map((entry, index) => ({
      id: entry.id,
      prompt: index === 0
        ? "Which copy of the notes should stay?"
        : `Question ${index + 1}?`,
      reason: index === 0
        ? "Both copies changed since yesterday."
        : `Reason ${index + 1}`,
      options: new Map(
        entry.options.map((option) => [option.key, `About: ${option.label}`]),
      ),
      recommendation: entry.recommended === null
        ? null
        : "The newer copy has this week's numbers.",
      answer: null,
    })),
    closedReason: null,
    ...patch,
  };
}

export interface FakeRequests {
  requests: Request[];
  notifications: NotificationRow[];
  reasons: Record<string, string | null>;
  /** 묶음별 글. 없으면 questionText 기본 글, null이면 읽지 못한다. */
  texts: Record<string, QuestionGroupText | null>;
  /** 다음 답·미루기·취소의 결과. 비면 접수한다. */
  replies: SourceResult<void>[];
  /** review가 열리는지. false면 이 창에 보호 창 통로가 없다. */
  reviewOpens: boolean;
  readsFail: boolean;
  /** approval·notification 목록을 읽지 못한다(그 route가 없는 core). */
  approvalsFail: boolean;
  notificationsFail: boolean;
  /** 보낸 묶음 답. */
  answered: { group: string; answers: readonly GroupAnswer[] }[];
  /** 글을 읽은 묶음 id. */
  textReads: string[];
  /** 미룬 묶음 id. */
  deferred: string[];
  cancelled: { group: string; reason: string }[];
  marked: string[];
  reviewed: ReviewIntent[];
  reads: number;
}

export function fakeRequests(initial: Partial<FakeRequests> = {}) {
  const state: FakeRequests = {
    requests: [],
    notifications: [],
    reasons: {},
    texts: {},
    replies: [],
    reviewOpens: true,
    readsFail: false,
    approvalsFail: false,
    notificationsFail: false,
    answered: [],
    textReads: [],
    deferred: [],
    cancelled: [],
    marked: [],
    reviewed: [],
    reads: 0,
    ...initial,
  };
  const listeners = new Set<(value: ConnectionState) => void>();
  const reply = (): SourceResult<void> =>
    state.replies.shift() ?? { ok: true, value: undefined };
  const failed = { ok: false as const, code: "unavailable" };
  const close = (id: string, patch: Partial<QuestionGroupRequest>) => {
    state.requests = state.requests.map((request) =>
      request.id === id && request.kind === "question"
        ? { ...request, ...patch, closedSeq: "999" }
        : request
    );
  };
  const source: RequestSource = {
    watch(listener) {
      listeners.add(listener);
      listener({ state: "ready", confirmedAt: 1 });
      return () => listeners.delete(listener);
    },
    overview() {
      state.reads += 1;
      if (state.readsFail) return Promise.resolve(failed);
      return Promise.resolve({
        ok: true,
        value: {
          requests: state.approvalsFail
            ? state.requests.filter((request) => request.kind !== "approval")
            : [...state.requests],
          notifications: state.notificationsFail
            ? []
            : [...state.notifications],
          approvalsRead: !state.approvalsFail,
          notificationsRead: !state.notificationsFail,
        },
      });
    },
    unread() {
      state.reads += 1;
      if (state.readsFail) return Promise.resolve(failed);
      return Promise.resolve({
        ok: true,
        value: state.notifications.filter((row) => row.readAt === null),
      });
    },
    reason(request) {
      return Promise.resolve({
        ok: true,
        value: state.reasons[request.id] ?? null,
      });
    },
    text(target) {
      state.textReads.push(target.id);
      const found = state.texts[target.id];
      if (found === null) return Promise.resolve(failed);
      const current = state.requests.find((request) =>
        request.id === target.id
      ) as QuestionGroupRequest | undefined;
      return Promise.resolve({
        ok: true,
        value: found ?? questionText(current ?? target),
      });
    },
    answer(target, answers) {
      state.answered.push({ group: target.id, answers });
      const result = reply();
      if (result.ok) {
        const base = state.texts[target.id] ?? questionText(target);
        state.texts[target.id] = {
          ...base,
          questions: base.questions.map((entry) => {
            const given = answers.find((item) => item.question === entry.id);
            return given?.answer.kind === "text"
              ? { ...entry, answer: given.answer.text }
              : entry;
          }),
        };
        close(target.id, {
          status: "answered",
          questions: target.questions.map((entry) => {
            const given = answers.find((item) => item.question === entry.id);
            return {
              ...entry,
              answer: given === undefined
                ? null
                : given.answer.kind === "option"
                ? { kind: "option" as const, option: given.answer.option_key }
                : { kind: "text" as const },
            };
          }),
        });
      }
      return Promise.resolve(result);
    },
    defer(target) {
      state.deferred.push(target.id);
      const result = reply();
      if (result.ok) {
        close(target.id, { status: "cancelled", closedReason: "deferred" });
      }
      return Promise.resolve(result);
    },
    cancel(target, reason) {
      state.cancelled.push({ group: target.id, reason });
      const result = reply();
      if (result.ok) {
        state.texts[target.id] = questionText(target, { closedReason: reason });
        close(target.id, { status: "cancelled", closedReason: "cancelled" });
      }
      return Promise.resolve(result);
    },
    markRead(row) {
      state.marked.push(row.id);
      state.notifications = state.notifications.map((item) =>
        item.id === row.id
          ? { ...item, readAt: "2026-10-06T09:00:00.000Z" }
          : item
      );
      return Promise.resolve({ ok: true, value: undefined });
    },
    review(intent) {
      state.reviewed.push(intent);
      return Promise.resolve(
        state.reviewOpens
          ? { ok: true, value: undefined }
          : { ok: false, code: "unavailable" },
      );
    },
  };
  return {
    state,
    source,
    push(value: ConnectionState) {
      for (const listener of listeners) listener(value);
    },
  };
}

/** 테스트가 직접 부르는 박자. */
export function manualTicks() {
  const listeners = new Set<() => void>();
  return {
    ticks: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    tick() {
      for (const listener of listeners) listener();
    },
  };
}
