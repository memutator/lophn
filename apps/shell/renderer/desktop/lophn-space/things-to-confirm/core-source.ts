// RequestSource를 main의 core 통로로 만든다. 응답은 main의 contract client가 route output
// schema로 이미 검사했다. 아래 모양은 그 schema(assignments·runs·sessions list, runs.read,
// approvals.list, notifications.list, events.list, blobs.read, notifications.read)에서 이
// 화면들이 읽는 field만 옮긴 것이다. command 성공 응답은 route output 그대로다(envelope
// 없음, platform/api#R3).
//
// 질문은 묶음(questions list·text·answer·defer·cancel이 묶음 단위)이고 이 화면의 요청 모양은
// 질문 하나다. 묶음을 이 화면에 맞추려면 화면 동작을 새로 만들어야 하므로 질문 묶음은 아직
// 읽지 않는다. 질문 묶음은 대화 안 카드(shell/desktop#R46)가 맡는다.
import type { CoreCall } from "../../../../ipc/core.ts";
import type { CoreSource } from "../../connection/connection.ts";
import type {
  ApprovalRequest,
  NotificationRow,
  Place,
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
  work_place: { kind: "project"; id: string } | { kind: "app"; id: string };
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
  occurred_at?: string;
  document?: string | null;
  delivery?: { state: string; reason?: string };
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

// 세션 목록은 담당과 자리를 모두 알아야 읽을 수 있어 모두 읽을 수 없다. 요청이 걸린 run의
// 세션만 하나씩 읽는다. 읽지 못한 세션의 요청은 자리 없이 보인다.
async function sessionsOf(
  core: CoreSource,
  approvals: readonly ApprovalValue[],
  runs: ReadonlyMap<string, RunValue>,
): Promise<Map<string, SessionValue>> {
  const found = new Map<string, SessionValue>();
  for (const approval of approvals) {
    const session = approval.run === null
      ? null
      : runs.get(approval.run)?.session ?? null;
    if (session === null || found.has(session)) continue;
    const read = await call<{ session: SessionValue }>(
      core,
      "read",
      "sessions",
      "read",
      { session },
    );
    if (read.ok) found.set(session, read.value.session);
  }
  return found;
}

function placeOf(session: SessionValue | undefined): Place | null {
  if (session === undefined) return null;
  const place = session.work_place;
  return { kind: place.kind, id: place.id };
}

interface Links {
  readonly runs: ReadonlyMap<string, RunValue>;
  readonly roles: ReadonlyMap<string, Role>;
  readonly sessions: ReadonlyMap<string, SessionValue>;
  readonly waiting: ReadonlySet<string>;
  readonly times: ReadonlyMap<string, number>;
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
    ...lineOf(value),
    ...osFailureOf(value.delivery),
  };
}

function lineOf(
  value: NotificationValue,
): Pick<NotificationRow, "occurredAt" | "document"> {
  const facts: { occurredAt?: string; document?: string } = {};
  if (typeof value.occurred_at === "string" && value.occurred_at.length > 0) {
    facts.occurredAt = value.occurred_at;
  }
  if (typeof value.document === "string" && value.document.length > 0) {
    facts.document = value.document;
  }
  return facts;
}

function osFailureOf(
  delivery: NotificationValue["delivery"],
): Pick<NotificationRow, "osFailure"> {
  if (delivery?.state !== "failed") return {};
  return delivery.reason === "unsupported"
    ? { osFailure: "unsupported" }
    : { osFailure: "show_failed" };
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
        types: APPROVAL_EVENTS,
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
      // 읽기는 하나씩 보낸다. core reader는 한 사람(principal)의 대기 읽기를 8개까지만 받고
      // 넘으면 unavailable로 답한다. 칸·chip·도크가 같은 사람 token으로 같이 읽으므로 한
      // 화면이 한꺼번에 여러 개를 내지 않는다.
      const assignments = await pages<
        AssignmentValue,
        Page & { assignments: AssignmentValue[] }
      >(core, "assignments", "list", {}, (value) => value.assignments);
      if (!assignments.ok) return assignments;
      const runs = await pages<RunValue, Page & { runs: RunValue[] }>(
        core,
        "runs",
        "list",
        {},
        (value) => value.runs,
      );
      if (!runs.ok) return runs;
      const approvals = await call<{ requests: ApprovalValue[] }>(
        core,
        "read",
        "approvals",
        "list",
        {},
      );
      const notifications = await readNotifications(core, false);
      // 못 읽은 쪽은 0으로 보이지 않게 표시한다(desktop#R7).
      const approvalRows = approvals.ok ? approvals.value.requests : [];
      const subjects: { id: string; seq: string }[] = [];
      for (const item of approvalRows) {
        subjects.push({ id: item.id, seq: item.created_seq });
      }
      const runById = new Map(runs.value.map((run) => [run.id, run]));
      const links: Links = {
        runs: runById,
        roles: new Map(assignments.value.map((item) => [item.id, item.role])),
        sessions: await sessionsOf(core, approvalRows, runById),
        waiting: new Set(
          runs.value.flatMap((run) =>
            run.waiting_on === null ? [] : [run.waiting_on]
          ),
        ),
        times: subjects.length === 0
          ? new Map()
          : await eventTimes(core, subjects),
      };
      const requests: Request[] = approvalRows.map((value) =>
        approvalOf(value, links)
      );
      return {
        ok: true,
        value: {
          requests,
          notifications: notifications.ok ? notifications.value : [],
          approvalsRead: approvals.ok,
          notificationsRead: notifications.ok,
        },
      };
    },

    async pending(session) {
      // 하나씩 읽는다(overview와 같은 이유).
      const approvals = await call<{ requests: ApprovalValue[] }>(
        core,
        "read",
        "approvals",
        "list",
        { status: "pending" },
      );
      const waiting = await pages<RunValue, Page & { runs: RunValue[] }>(
        core,
        "runs",
        "list",
        { state: "waiting_user" },
        (value) => value.runs,
      );
      if (!waiting.ok) return waiting;
      const approvalRows = approvals.ok ? approvals.value.requests : [];
      // approval은 run의 세션으로 고른다. 칸에 보일 것만 run을 하나씩 읽는다.
      const runs = new Map(waiting.value.map((run) => [run.id, run]));
      for (const approval of approvalRows) {
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
      const requests: Request[] = approvalRows.map((value) =>
        approvalOf(value, links)
      );
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

    // 질문 요청은 만들지 않으므로(위 설명) 질문 쪽 통로는 닿지 않는다. 닿으면 못 한다고 답한다.
    text: () => Promise.resolve({ ok: false, code: "unavailable" }),
    answer: () => Promise.resolve({ ok: false, code: "unavailable" }),
    defer: () => Promise.resolve({ ok: false, code: "unavailable" }),
    cancel: () => Promise.resolve({ ok: false, code: "unavailable" }),

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
