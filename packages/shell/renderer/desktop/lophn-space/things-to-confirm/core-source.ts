// RequestSource를 main의 core 통로로 만든다. 응답은 main의 contract client가 route output
// schema로 이미 검사했다. 아래 모양은 그 schema(assignments·runs·sessions·questions list,
// runs.read, approvals.list, events.list, blobs.read, questions text·
// answer·defer·cancel)에서 이 화면들이 읽는 field만 옮긴 것이다. command
// 성공 응답은 route output 그대로다(envelope 없음).
//
// 질문은 묶음 단위다(questions list·text·answer·defer·cancel). 이 통로는 세션 없는 run의 묶음만
// 싣는다. 세션 있는 run의 묶음은 그 세션의 대화 안 카드가 맡고,
// 문서가 이 화면에 같이 보이라고 정하지 않았다.
import type { CoreCall } from "../../../../ipc/core.ts";
import type { GroupAnswer } from "../../../conversation/question-card/model.ts";
import type { CoreSource } from "../../connection/connection.ts";
import { confirmsWithoutWindow } from "./model.ts";
import type {
  ApprovalRequest,
  Place,
  QuestionGroupRequest,
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

interface GroupValue {
  id: string;
  run: string;
  session: string | null;
  expires_at: string | null;
  status: QuestionGroupRequest["status"];
  closed_reason: QuestionGroupRequest["closedReason"];
  created_seq: string;
  closed_seq: string | null;
  questions: {
    id: string;
    options: { key: string; label: string; action: unknown | null }[];
    recommendation: { option_key: string | null } | null;
    answer:
      | { kind: "option"; option_key: string }
      | { kind: "text"; text_blob: string }
      | null;
    applied: boolean;
  }[];
}

interface GroupTextValue {
  questions: {
    question: string;
    prompt: string;
    reason: string;
    options: { key: string; description: string }[];
    recommendation: { option_key: string | null; explanation: string } | null;
    answer_text: string | null;
  }[];
  closed_reason_text: string | null;
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

// 같은 답을 다시 보내면 같은 key가 되도록 답을 줄인 값. core로 가는 글이나 blob hash가
// 아니라 idempotency key의 꼬리일 뿐이다.
async function keyTag(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
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

function commandOf(action: unknown): string | null {
  if (action === null || typeof action !== "object") return null;
  const command = (action as { command?: unknown }).command;
  return typeof command === "string" ? command : null;
}

// 세션 없는 run의 묶음. 자리는 세션에서 오므로 없다. 역할과 run을 멈췄는지는 run에서 온다.
function groupOf(value: GroupValue, links: Links): QuestionGroupRequest {
  const run = links.runs.get(value.run);
  return {
    kind: "question",
    id: value.id,
    run: value.run,
    session: value.session,
    role: run ? links.roles.get(run.assignment) ?? null : null,
    place: null,
    blocking: links.waiting.has(value.id),
    createdSeq: value.created_seq,
    closedSeq: value.closed_seq,
    createdAt: links.times.get(value.created_seq) ?? null,
    closedAt: value.closed_seq === null
      ? null
      : links.times.get(value.closed_seq) ?? null,
    expiresAt: value.expires_at,
    status: value.status,
    closedReason: value.closed_reason,
    questions: value.questions.map((entry) => ({
      id: entry.id,
      options: entry.options.map((option) => ({
        key: option.key,
        label: option.label,
        action: option.action !== null,
        command: commandOf(option.action),
      })),
      recommended: entry.recommendation?.option_key ?? null,
      answer: entry.answer === null
        ? null
        : entry.answer.kind === "option"
        ? { kind: "option", option: entry.answer.option_key }
        : { kind: "text" },
      applied: entry.applied,
    })),
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

type ConfirmWithoutWindow = (input: {
  group: string;
  option_key: string;
}) => Promise<{ ok: true } | { ok: false; code: string }>;

/** app.create·apply_settings 확정. 확인 창을 열지 않는 main 통로다. 이 창에 없으면 undefined다. */
function windowlessConfirmation(): ConfirmWithoutWindow | undefined {
  const shell = (globalThis as {
    lophnShell?: { confirmWithoutWindow?: ConfirmWithoutWindow };
  }).lophnShell;
  return typeof shell?.confirmWithoutWindow === "function"
    ? (input) => shell.confirmWithoutWindow!(input)
    : undefined;
}

async function confirmWithoutWindow(
  group: string,
  option: string,
): Promise<SourceResult<void>> {
  const confirm = windowlessConfirmation();
  if (confirm === undefined) return { ok: false, code: "unavailable" };
  try {
    const sent = await confirm({ group, option_key: option });
    return sent.ok
      ? { ok: true, value: undefined }
      : { ok: false, code: sent.code };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

// 확인 창 없이 확정하는 고정 action 답이면 그 묶음과 선택지. 질문 하나짜리 묶음에만 있다.
function windowlessChoice(
  group: QuestionGroupRequest,
  answers: readonly GroupAnswer[],
): { group: string; option: string } | null {
  if (group.questions.length !== 1) return null;
  const only = group.questions[0]!;
  const given = answers.find((entry) => entry.question === only.id);
  if (given === undefined || given.answer.kind !== "option") return null;
  const optionKey = given.answer.option_key;
  const chosen = only.options.find((option) => option.key === optionKey);
  return chosen !== undefined && chosen.action &&
      confirmsWithoutWindow(chosen.command)
    ? { group: group.id, option: optionKey }
    : null;
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

// 보호 창의 부모. main은 이 값이 아니라 IPC를 보낸 창을 부모로 쓴다.
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
      const questions = await pages<
        GroupValue,
        Page & { groups: GroupValue[] }
      >(
        core,
        "questions",
        "list",
        {},
        (value) => value.groups,
      );
      if (!questions.ok) return questions;
      const approvals = await call<{ requests: ApprovalValue[] }>(
        core,
        "read",
        "approvals",
        "list",
        {},
      );
      // 세션 있는 run의 묶음은 대화 안 카드가 맡는다. 세션 없는 묶음만 이 화면에 싣는다.
      const groupRows = questions.value.filter((item) => item.session === null);
      // 못 읽은 쪽은 0으로 보이지 않게 표시한다.
      const approvalRows = approvals.ok ? approvals.value.requests : [];
      const subjects: { id: string; seq: string }[] = [];
      for (const item of [...groupRows, ...approvalRows]) {
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
      const requests: Request[] = [
        ...groupRows.map((value) => groupOf(value, links)),
        ...approvalRows.map((value) => approvalOf(value, links)),
      ];
      return {
        ok: true,
        value: {
          requests,
          approvalsRead: approvals.ok,
        },
      };
    },

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

    async text(group) {
      const read = await call<GroupTextValue>(
        core,
        "read",
        "questions",
        "text",
        { group: group.id },
      );
      if (!read.ok) return read;
      const value = read.value;
      return {
        ok: true,
        value: {
          questions: value.questions.map((entry) => ({
            id: entry.question,
            prompt: entry.prompt,
            reason: entry.reason,
            options: new Map(
              entry.options.map((option) => [option.key, option.description]),
            ),
            recommendation: entry.recommendation?.explanation ?? null,
            answer: entry.answer_text,
          })),
          closedReason: value.closed_reason_text,
        },
      };
    },

    async answer(group, answers) {
      // action 없는 답은 확인 handle 없이 일반 답 경로로 간다. 자유 답은 글을 값으로 싣고
      // core가 redaction을 거쳐 blob으로 둔다. app.create·apply_settings만 확인 창 없이
      // main이 정본을 다시 읽어 접수한다. 그 밖 action은 화면이 [Review]로 보호 창을 연다.
      const windowless = windowlessChoice(group, answers);
      if (windowless !== null) {
        return await confirmWithoutWindow(windowless.group, windowless.option);
      }
      const tag = await keyTag(JSON.stringify(answers));
      return command(core, "questions", "answer", {
        input: {
          group: group.id,
          created_seq: group.createdSeq,
          answers,
        },
        compare: { created_seq: group.createdSeq },
        key: `questions-answer-${group.id}-${tag}`,
      });
    },

    defer: (group) =>
      command(core, "questions", "defer", {
        input: { group: group.id, created_seq: group.createdSeq },
        compare: { created_seq: group.createdSeq },
        key: `questions-defer-${group.id}`,
      }),

    cancel: (group, reason) =>
      command(core, "questions", "cancel", {
        input: {
          group: group.id,
          created_seq: group.createdSeq,
          closed_reason: "cancelled",
          // 이유는 글을 값으로 싣는다. core가 blob으로 둔다.
          closed_reason_text: reason,
        },
        compare: { created_seq: group.createdSeq },
        key: `questions-cancel-${group.id}`,
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
