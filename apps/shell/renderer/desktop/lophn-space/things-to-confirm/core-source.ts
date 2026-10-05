// RequestSource를 main의 core 통로로 만든다. 응답은 main의 contract client가 route output
// schema로 이미 검사했다. 아래 모양은 그 schema(assignments·runs·sessions·questions list,
// runs.read, approvals.list, notifications.list, events.list, blobs.read, questions
// answer·defer·cancel, notifications.read)에서 이 화면들이 읽는 field만 옮긴 것이다.
import type { CoreCall } from "../../../../ipc/core.ts";
import type { CoreSource } from "../../connection/connection.ts";
import type {
  ApprovalRequest,
  NotificationRow,
  Place,
  QuestionRequest,
  Request,
  RequestSource,
  ReviewIntent,
  Role,
  SourceResult,
} from "./source.ts";

interface Page {
  next_cursor: string | null;
}

interface AssignmentValue {
  id: string;
  role: Role;
}

interface RunValue {
  id: string;
  assignment: string;
  session: string | null;
  waiting_on: string | null;
}

interface SessionValue {
  id: string;
  work_place:
    | { kind: "global"; id: null }
    | { kind: "project"; id: string }
    | { kind: "app"; id: string };
}

interface QuestionValue {
  id: string;
  run: string;
  session: string | null;
  options: { key: string; label: string; action: unknown | null }[];
  recommendation: { option_key: string | null } | null;
  expires_at: string | null;
  status: QuestionRequest["status"];
  answer:
    | { kind: "option"; option_key: string }
    | { kind: "text"; text_blob: string }
    | null;
  closed_reason: QuestionRequest["closedReason"];
  created_seq: string;
  closed_seq: string | null;
  applied: boolean;
}

interface ApprovalValue {
  id: string;
  run: string | null;
  effect: { reversible: boolean };
  expires_at: string | null;
  status: ApprovalRequest["status"];
  created_seq: string;
  closed_seq: string | null;
}

interface NotificationValue {
  notification: { id: string; source_seq: string; read_at: string | null };
  source_event: string;
}

interface EventValue {
  seq: string;
  at: string;
}

/** preload의 보호 창 열기. 없는 창에서는 undefined다. */
export type OpenConfirmation = (
  intent: { request: ReviewIntent; parentWindow: string },
) => Promise<unknown>;

/** 목록을 끝까지 모을 때 page 상한. 넘으면 모은 것까지만 보인다. */
const PAGE_LIMIT = 50;
/** notification 한 번에 읽는 수. */
const NOTIFICATION_PAGE = 200;
/** events.list 한 번의 subject 수. */
const SUBJECT_CHUNK = 100;
/** approval 설명은 앞부분만 읽는다. */
const REASON_BYTES = 4096;

const QUESTION_EVENTS = [
  "QuestionCreated",
  "QuestionAnswered",
  "QuestionExpired",
  "QuestionCancelled",
];
const APPROVAL_EVENTS = [
  "ApprovalRequestCreated",
  "ApprovalRequestGranted",
  "ApprovalRequestRejected",
  "ApprovalRequestExpired",
  "ApprovalRequestCancelled",
];

async function call<T>(
  core: CoreSource,
  kind: CoreCall["kind"],
  resource: string,
  method: string,
  body: unknown,
): Promise<SourceResult<T>> {
  try {
    const reply = await core.call({ kind, resource, method, body });
    if (!reply.ok) return { ok: false, code: reply.error?.code ?? "internal" };
    return { ok: true, value: reply.value as T };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

async function command(
  core: CoreSource,
  resource: string,
  method: string,
  body: { input: unknown; compare: unknown; key: string },
): Promise<SourceResult<void>> {
  const result = await call<unknown>(core, "command", resource, method, {
    input: body.input,
    idempotency_key: body.key,
    compare: body.compare,
    prepared: [],
  });
  return result.ok ? { ok: true, value: undefined } : result;
}

async function pages<T, V extends Page>(
  core: CoreSource,
  resource: string,
  method: string,
  input: Record<string, unknown>,
  rows: (value: V) => readonly T[],
): Promise<SourceResult<readonly T[]>> {
  const found: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    const result: SourceResult<V> = await call<V>(
      core,
      "read",
      resource,
      method,
      cursor === null ? input : { ...input, cursor },
    );
    if (!result.ok) return result;
    found.push(...rows(result.value));
    cursor = result.value.next_cursor;
    if (cursor === null) break;
  }
  return { ok: true, value: found };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function placeOf(session: SessionValue | undefined): Place | null {
  if (session === undefined) return null;
  const place = session.work_place;
  return place.kind === "global"
    ? { kind: "global" }
    : { kind: place.kind, id: place.id };
}

interface Links {
  readonly runs: ReadonlyMap<string, RunValue>;
  readonly roles: ReadonlyMap<string, Role>;
  readonly sessions: ReadonlyMap<string, SessionValue>;
  readonly waiting: ReadonlySet<string>;
  readonly times: ReadonlyMap<string, number>;
}

function questionOf(value: QuestionValue, links: Links): QuestionRequest {
  const run = links.runs.get(value.run);
  const session = value.session ?? run?.session ?? null;
  return {
    kind: "question",
    id: value.id,
    run: value.run,
    session,
    role: run ? links.roles.get(run.assignment) ?? null : null,
    place: placeOf(session === null ? undefined : links.sessions.get(session)),
    blocking: links.waiting.has(value.id),
    createdSeq: value.created_seq,
    closedSeq: value.closed_seq,
    createdAt: links.times.get(value.created_seq) ?? null,
    closedAt: value.closed_seq === null
      ? null
      : links.times.get(value.closed_seq) ?? null,
    expiresAt: value.expires_at,
    status: value.status,
    options: value.options.map((option) => ({
      key: option.key,
      label: option.label,
      action: option.action !== null,
    })),
    recommended: value.recommendation?.option_key ?? null,
    answer: value.answer === null
      ? null
      : value.answer.kind === "option"
      ? { kind: "option", option: value.answer.option_key }
      : { kind: "text" },
    closedReason: value.closed_reason,
    applied: value.applied,
  };
}

function approvalOf(value: ApprovalValue, links: Links): ApprovalRequest {
  const run = value.run === null ? undefined : links.runs.get(value.run);
  const session = run?.session ?? null;
  return {
    kind: "approval",
    id: value.id,
    run: value.run,
    session,
    role: run ? links.roles.get(run.assignment) ?? null : null,
    place: placeOf(session === null ? undefined : links.sessions.get(session)),
    blocking: links.waiting.has(value.id),
    createdSeq: value.created_seq,
    closedSeq: value.closed_seq,
    createdAt: links.times.get(value.created_seq) ?? null,
    closedAt: value.closed_seq === null
      ? null
      : links.times.get(value.closed_seq) ?? null,
    expiresAt: value.expires_at,
    status: value.status,
    reversible: value.effect.reversible,
  };
}

function notificationOf(value: NotificationValue): NotificationRow {
  return {
    id: value.notification.id,
    sourceEvent: value.source_event,
    sourceSeq: value.notification.source_seq,
    readAt: value.notification.read_at,
  };
}

function decodeText(base64: string): string | null {
  try {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

// 질문·approval의 생성·닫힘 event 시각. seq마다 at을 모은다. 읽지 못하면 빈 표다.
async function eventTimes(
  core: CoreSource,
  subjects: readonly { id: string; seq: string }[],
): Promise<Map<string, number>> {
  const times = new Map<string, number>();
  for (let start = 0; start < subjects.length; start += SUBJECT_CHUNK) {
    const chunk = subjects.slice(start, start + SUBJECT_CHUNK);
    let after = chunk.reduce(
      (least, item) => {
        const value = BigInt(item.seq) - 1n;
        return value < least ? value : least;
      },
      BigInt(chunk[0]!.seq),
    );
    for (let page = 0; page < PAGE_LIMIT; page += 1) {
      const read = await call<{
        events: EventValue[];
        scanned_through_seq: string;
        head_seq: string;
      }>(core, "read", "events", "list", {
        after_seq: String(after < 0n ? 0n : after),
        types: [...QUESTION_EVENTS, ...APPROVAL_EVENTS],
        subjects: [...new Set(chunk.map((item) => item.id))],
      });
      if (!read.ok) return times;
      for (const event of read.value.events) {
        const at = Date.parse(event.at);
        if (Number.isFinite(at)) times.set(event.seq, at);
      }
      const scanned = BigInt(read.value.scanned_through_seq);
      if (scanned <= after || scanned >= BigInt(read.value.head_seq)) break;
      after = scanned;
    }
  }
  return times;
}

/** preload의 보호 창 열기를 찾는다. 이 창에 없으면 undefined다. */
export function windowConfirmation(): OpenConfirmation | undefined {
  const shell = (globalThis as {
    lophnShell?: { openConfirmation?: OpenConfirmation };
  }).lophnShell;
  return typeof shell?.openConfirmation === "function"
    ? (intent) => shell.openConfirmation!(intent)
    : undefined;
}

// 보호 창의 부모. main은 이 값이 아니라 IPC를 보낸 창을 부모로 쓴다(contracts#T13).
const PARENT_WINDOW = "requesting-window";

export function coreRequestSource(
  core: CoreSource,
  openConfirmation: OpenConfirmation | undefined = windowConfirmation(),
): RequestSource {
  return {
    watch: (listener) => core.subscribe(listener),

    async overview() {
      const [assignments, runs, sessions, questions, approvals, notifications] =
        await Promise.all([
          pages<AssignmentValue, Page & { assignments: AssignmentValue[] }>(
            core,
            "assignments",
            "list",
            {},
            (value) => value.assignments,
          ),
          pages<RunValue, Page & { runs: RunValue[] }>(
            core,
            "runs",
            "list",
            {},
            (value) => value.runs,
          ),
          pages<SessionValue, Page & { sessions: SessionValue[] }>(
            core,
            "sessions",
            "list",
            {},
            (value) => value.sessions,
          ),
          pages<QuestionValue, Page & { questions: QuestionValue[] }>(
            core,
            "questions",
            "list",
            {},
            (value) => value.questions,
          ),
          call<{ requests: ApprovalValue[] }>(
            core,
            "read",
            "approvals",
            "list",
            {},
          ),
          readNotifications(core, false),
        ]);
      if (!assignments.ok) return assignments;
      if (!runs.ok) return runs;
      if (!sessions.ok) return sessions;
      if (!questions.ok) return questions;
      if (!approvals.ok) return approvals;
      if (!notifications.ok) return notifications;
      const subjects: { id: string; seq: string }[] = [];
      for (const item of [...questions.value, ...approvals.value.requests]) {
        subjects.push({ id: item.id, seq: item.created_seq });
      }
      const links: Links = {
        runs: new Map(runs.value.map((run) => [run.id, run])),
        roles: new Map(assignments.value.map((item) => [item.id, item.role])),
        sessions: new Map(sessions.value.map((item) => [item.id, item])),
        waiting: new Set(
          runs.value.flatMap((run) =>
            run.waiting_on === null ? [] : [run.waiting_on]
          ),
        ),
        times: subjects.length === 0
          ? new Map()
          : await eventTimes(core, subjects),
      };
      const requests: Request[] = [
        ...questions.value.map((value) => questionOf(value, links)),
        ...approvals.value.requests.map((value) => approvalOf(value, links)),
      ];
      return {
        ok: true,
        value: { requests, notifications: notifications.value },
      };
    },

    async pending(session) {
      const [questions, approvals, waiting] = await Promise.all([
        pages<QuestionValue, Page & { questions: QuestionValue[] }>(
          core,
          "questions",
          "list",
          { status: "pending" },
          (value) => value.questions,
        ),
        call<{ requests: ApprovalValue[] }>(
          core,
          "read",
          "approvals",
          "list",
          { status: "pending" },
        ),
        pages<RunValue, Page & { runs: RunValue[] }>(
          core,
          "runs",
          "list",
          { state: "waiting_user" },
          (value) => value.runs,
        ),
      ]);
      if (!questions.ok) return questions;
      if (!approvals.ok) return approvals;
      if (!waiting.ok) return waiting;
      // approval은 run의 세션으로 고른다. 칸에 보일 것만 run을 하나씩 읽는다.
      const runs = new Map(waiting.value.map((run) => [run.id, run]));
      for (const approval of approvals.value.requests) {
        if (approval.run === null || runs.has(approval.run)) continue;
        const read = await call<{ run: RunValue }>(
          core,
          "read",
          "runs",
          "read",
          { run: approval.run },
        );
        if (!read.ok) return read;
        runs.set(read.value.run.id, read.value.run);
      }
      const links: Links = {
        runs,
        roles: new Map(),
        sessions: new Map(),
        waiting: new Set(
          waiting.value.flatMap((run) =>
            run.waiting_on === null ? [] : [run.waiting_on]
          ),
        ),
        times: new Map(),
      };
      const requests: Request[] = [
        ...questions.value.map((value) => questionOf(value, links)),
        ...approvals.value.requests.map((value) => approvalOf(value, links)),
      ];
      return {
        ok: true,
        value: requests.filter((request) => request.session === session),
      };
    },

    unread: () => readNotifications(core, true),

    async reason(request) {
      const read = await call<
        { status: "available"; bytes: string } | { status: "unavailable" }
      >(core, "read", "blobs", "read", {
        owner_kind: "approval_request",
        owner_key: request.id,
        field: "reason",
        offset_bytes: 0,
        length_bytes: REASON_BYTES,
      });
      if (!read.ok) return read;
      return {
        ok: true,
        value: read.value.status === "available"
          ? decodeText(read.value.bytes)
          : null,
      };
    },

    async answer(question, answer) {
      // 자유 답은 글의 hash만 보낸다. 사람 글을 blob으로 올리는 길은 아직 없다(shell Q15).
      const value = answer.kind === "option"
        ? { kind: "option", option_key: answer.option, text_blob: null }
        : {
          kind: "text",
          option_key: null,
          text_blob: await sha256(answer.text),
        };
      const tag = await sha256(JSON.stringify(value));
      return command(core, "questions", "answer", {
        input: {
          question: question.id,
          created_seq: question.createdSeq,
          answer: value,
          binding_hash: null,
          evidence: null,
        },
        compare: { created_seq: question.createdSeq },
        key: `questions-answer-${question.id}-${tag.slice(0, 32)}`,
      });
    },

    defer: (question) =>
      command(core, "questions", "defer", {
        input: { question: question.id, created_seq: question.createdSeq },
        compare: { created_seq: question.createdSeq },
        key: `questions-defer-${question.id}`,
      }),

    async cancel(question, reason) {
      return command(core, "questions", "cancel", {
        input: {
          question: question.id,
          created_seq: question.createdSeq,
          closed_reason: "cancelled",
          closed_reason_blob: await sha256(reason),
        },
        compare: { created_seq: question.createdSeq },
        key: `questions-cancel-${question.id}`,
      });
    },

    markRead: (notification) =>
      command(core, "notifications", "read", {
        input: { notification: notification.id },
        compare: {},
        key: `notifications-read-${notification.id}`,
      }),

    async review(intent) {
      if (openConfirmation === undefined) {
        return { ok: false, code: "unavailable" };
      }
      try {
        const opened = await openConfirmation({
          request: intent,
          parentWindow: PARENT_WINDOW,
        }) as { windowId?: string; code?: string };
        return typeof opened?.windowId === "string"
          ? { ok: true, value: undefined }
          : { ok: false, code: opened?.code ?? "internal" };
      } catch {
        return { ok: false, code: "unavailable" };
      }
    },
  };
}

async function readNotifications(
  core: CoreSource,
  unreadOnly: boolean,
): Promise<SourceResult<readonly NotificationRow[]>> {
  const found: NotificationRow[] = [];
  let after: string | null = null;
  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    const read: SourceResult<{ notifications: NotificationValue[] }> =
      await call(core, "read", "notifications", "list", {
        ...(unreadOnly ? { unread_only: true } : {}),
        ...(after === null ? {} : { after_source_seq: after }),
        limit: NOTIFICATION_PAGE,
      });
    if (!read.ok) return read;
    const rows: NotificationRow[] = read.value.notifications.map(
      notificationOf,
    );
    found.push(...rows);
    if (rows.length < NOTIFICATION_PAGE) break;
    after = rows[rows.length - 1]!.sourceSeq;
  }
  return { ok: true, value: found };
}
