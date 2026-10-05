// 질문 칸·things-to-confirm·chip 테스트의 RequestSource. 요청과 notification을 메모리에 두고
// 보낸 것을 기록한다. 답의 결과와 연결 상태는 테스트가 정한다.
import type { ConnectionState } from "../../../connection/connection.ts";
import type {
  Answer,
  ApprovalRequest,
  NotificationRow,
  QuestionRequest,
  Request,
  RequestSource,
  ReviewIntent,
  SourceResult,
} from "../source.ts";

export function questionId(n: number): string {
  return `qst_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;
}

export function approvalId(n: number): string {
  return `apr_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;
}

export function sessionOf(n: number): string {
  return `ses_01h455vb4pex5v6nkc6gd5fd${String(n).padStart(2, "0")}`;
}

export function question(
  n: number,
  patch: Partial<QuestionRequest> = {},
): QuestionRequest {
  return {
    kind: "question",
    id: questionId(n),
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
    options: [
      { key: "keep", label: "Keep both files", action: false },
      { key: "merge", label: "Merge them", action: false },
    ],
    recommended: "keep",
    answer: null,
    closedReason: null,
    applied: false,
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

export interface FakeRequests {
  requests: Request[];
  notifications: NotificationRow[];
  reasons: Record<string, string | null>;
  /** 다음 답·미루기·취소의 결과. 비면 접수한다. */
  replies: SourceResult<void>[];
  /** review가 열리는지. false면 이 창에 보호 창 통로가 없다. */
  reviewOpens: boolean;
  readsFail: boolean;
  answered: { question: string; answer: Answer }[];
  deferred: string[];
  cancelled: { question: string; reason: string }[];
  marked: string[];
  reviewed: ReviewIntent[];
  reads: number;
}

export function fakeRequests(initial: Partial<FakeRequests> = {}) {
  const state: FakeRequests = {
    requests: [],
    notifications: [],
    reasons: {},
    replies: [],
    reviewOpens: true,
    readsFail: false,
    answered: [],
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
  const close = (id: string, patch: Partial<QuestionRequest>) => {
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
          requests: [...state.requests],
          notifications: [...state.notifications],
        },
      });
    },
    pending(session) {
      state.reads += 1;
      if (state.readsFail) return Promise.resolve(failed);
      return Promise.resolve({
        ok: true,
        value: state.requests.filter((request) =>
          request.status === "pending" && request.session === session
        ),
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
    answer(target, answer) {
      state.answered.push({ question: target.id, answer });
      const result = reply();
      if (result.ok) {
        close(target.id, {
          status: "answered",
          answer: answer.kind === "option"
            ? { kind: "option", option: answer.option }
            : { kind: "text" },
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
      state.cancelled.push({ question: target.id, reason });
      const result = reply();
      if (result.ok) {
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
