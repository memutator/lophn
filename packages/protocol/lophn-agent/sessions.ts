import { z } from "zod";
import {
  atSchema,
  positiveRevisionSchema,
  readCursorSchema,
  seqSchema,
} from "../base/values.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { defineEvent } from "../base/event.ts";
import { idSchema } from "../base/ids.ts";
import { withReadCommon } from "../base/envelope.ts";
import { agentRefOutputSchema, placeOutputSchema } from "./places.ts";
import { workPlaceOutputSchema, workPlaceSchema } from "./scope.ts";
import { modelChoiceOutputSchema, modelChoiceSchema } from "./models.ts";

// Session은 agent(assignment) 하나와 자리(project 또는 app) 하나에 고정된다.
// role이나 자리를 바꾸는 command가 없고, 사람이 `closed`로 만드는
// command도 없다: 사람이 session을 치우는 길은 archive와 delete다.

// 제목의 글자는 사람이 보는 글자(grapheme cluster)다. 이모지나 결합 문자를 중간에서
// 자르지 않는다. 자동 제목은 앞 60자, 사람이 rename한 제목은 120자 이하다.
export const SESSION_AUTO_TITLE_MAX = 60;
export const SESSION_RENAME_TITLE_MAX = 120;

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function sessionTitleLength(text: string): number {
  let count = 0;
  for (const _ of segmenter.segment(text)) count += 1;
  return count;
}

// 비어 있거나 공백뿐인 제목은 제목이 아니다. 길이는 앞뒤 공백을 뺀 글로 센다. 번호 이름("Conversation N")은 만들지 않는다.
export const sessionTitleSchema = z.string()
  .refine((value) => value.trim().length > 0, {
    message: "expected a nonblank title",
  })
  .refine(
    (value) => sessionTitleLength(value.trim()) <= SESSION_RENAME_TITLE_MAX,
    { message: "title is longer than 120 characters" },
  );

export const SESSION_STATES = ["open", "closed"] as const;
// 사람이 닫는 이유는 없다. assignment 회수만 session을 닫는다.
export const SESSION_CLOSED_REASONS = ["assignment_withdrawn"] as const;

const forkOriginFields = {
  session: idSchema("ses"),
  through_seq: seqSchema,
};
export const forkOriginSchema = z.strictObject(forkOriginFields);
export const forkOriginOutputSchema = z.object(forkOriginFields);

// toast에서 연 첫 context. 사건 글을 복사하지 않고 참조만 둔다. 대상은
// 사건이 가리키는 소유 concern의 ID다: 문제·앱·context·release.
const openingTargetSchema = z.union([
  idSchema("prb"),
  idSchema("app"),
  idSchema("ctx"),
  idSchema("rel"),
]);
const openingContextFields = {
  source_seq: seqSchema,
  target: openingTargetSchema,
};
export const openingContextSchema = z.strictObject(openingContextFields);
export const openingContextOutputSchema = z.object(openingContextFields);

// 사람이 부른 Compact의 마지막 구간. 요약 본문은 derived이고 원문을 대체하지 않는다.
const compactionFields = {
  through_seq: seqSchema,
  summary_call: idSchema("mcl"),
};
export const compactionOutputSchema = z.object(compactionFields);

const sessionFields = {
  id: idSchema("ses"),
  assignment: idSchema("asg"),
  work_place: workPlaceOutputSchema,
  title: sessionTitleSchema.nullable(),
  archived: z.boolean(),
  state: z.enum(SESSION_STATES),
  forked_from: forkOriginOutputSchema.nullable(),
  opening_context: openingContextOutputSchema.nullable(),
  // null이면 agent 기본값을 따른다. 다음 run부터 resolve한다.
  model_selection: modelChoiceOutputSchema.nullable(),
  compaction: compactionOutputSchema.nullable(),
  closed_reason: z.enum(SESSION_CLOSED_REASONS).nullable(),
  closed_at: atSchema.nullable(),
  state_seq: seqSchema,
};

export const sessionRecordSchema = z.object(sessionFields).refine((value) => {
  const closed = value.state === "closed";
  if ((value.closed_reason !== null) !== closed) return false;
  if ((value.closed_at !== null) !== closed) return false;
  return value.forked_from === null || value.forked_from.session !== value.id;
}, { message: "session close or fork origin is not coupled" });

export type SessionRecord = z.infer<typeof sessionRecordSchema>;
export type Session = SessionRecord;

// 열기: assignment가 enabled일 때만(paused·withdrawn 거절). 자리가 role 규칙(AE=담당 app,
// Operator=scope, lophn=project/app, CE=project)에 맞는지는 assignment를 아는 owner가 검사한다.
export const openSessionInputSchema = z.strictObject({
  id: idSchema("ses"),
  assignment: idSchema("asg"),
  work_place: workPlaceSchema,
  opening_context: openingContextSchema.nullable(),
});

export const openSessionCompareSchema = z.strictObject({
  assignment_revision: positiveRevisionSchema,
  assignment_state: z.literal("enabled"),
});

const stateSeqCompareSchema = z.strictObject({ state_seq: seqSchema });

export const renameSessionInputSchema = z.strictObject({
  session: idSchema("ses"),
  title: sessionTitleSchema,
});
export const renameSessionCompareSchema = stateSeqCompareSchema;

export const archiveSessionInputSchema = z.strictObject({
  session: idSchema("ses"),
});
export const archiveSessionCompareSchema = stateSeqCompareSchema;
export const unarchiveSessionInputSchema = archiveSessionInputSchema;
export const unarchiveSessionCompareSchema = stateSeqCompareSchema;

export const deleteSessionInputSchema = z.strictObject({
  session: idSchema("ses"),
});
export const deleteSessionCompareSchema = stateSeqCompareSchema;

// Fork: 같은 agent·같은 자리의 새 session. 사람이 고른 지점(through_seq)까지의 확정 메시지만
// 복사한다.
export const forkSessionInputSchema = z.strictObject({
  id: idSchema("ses"),
  source: idSchema("ses"),
  through_seq: seqSchema,
}).refine((value) => value.id !== value.source, {
  message: "a session cannot fork from itself",
});

// Compact는 두 걸음이다. 사람이 요청하면(RequestSessionCompact) runtime이 앞 구간을 요약하는 model
// call을 하고, 끝까지 성공한 그 call을 구간과 함께 session에 이어(CompactSession) 요청을 끝낸다.
// 실패하면 이유와 함께 요청만 닫는다(FailSessionCompact). 어느 쪽이든 원문과 session의 나머지는
// 바뀌지 않는다.
export const COMPACT_FAILURE_REASONS = [
  "nothing_to_summarize",
  "model_unavailable",
  "model_failed",
  "too_large",
  "summary_too_long",
  "session_changed",
] as const;
export const compactFailureReasonSchema = z.enum(COMPACT_FAILURE_REASONS);
export type CompactFailureReason = (typeof COMPACT_FAILURE_REASONS)[number];

export const requestSessionCompactInputSchema = z.strictObject({
  session: idSchema("ses"),
});
export const requestSessionCompactCompareSchema = z.strictObject({
  state: z.literal("open"),
  state_seq: seqSchema,
});

export const compactSessionInputSchema = z.strictObject({
  session: idSchema("ses"),
  summary_call: idSchema("mcl"),
  // 요약이 덮는 마지막 메시지의 순번. runtime이 요약 재료를 모은 때의 마지막 메시지다.
  through_seq: seqSchema,
});
export const compactSessionCompareSchema = z.strictObject({
  state: z.literal("open"),
  request_seq: seqSchema,
});

export const failSessionCompactInputSchema = z.strictObject({
  session: idSchema("ses"),
  reason: compactFailureReasonSchema,
});
export const failSessionCompactCompareSchema = z.strictObject({
  request_seq: seqSchema,
});

// null은 agent 기본값으로 돌아간다.
export const changeSessionModelInputSchema = z.strictObject({
  session: idSchema("ses"),
  model: modelChoiceSchema.nullable(),
});
export const changeSessionModelCompareSchema = z.strictObject({
  state: z.literal("open"),
  state_seq: seqSchema,
});

export const closeSessionInputSchema = z.strictObject({
  session: idSchema("ses"),
  reason: z.enum(SESSION_CLOSED_REASONS),
});
export const closeSessionCompareSchema = z.strictObject({
  state_seq: seqSchema,
  state: z.literal("open"),
});

const errors = [
  "invalid_input",
  "forbidden",
  "not_found",
  "conflict",
  "unauthorized",
] as const;

export const openSession = defineCommand({
  resource: "sessions",
  method: "open",
  name: "OpenSession",
  input: openSessionInputSchema,
  output: z.object({
    id: idSchema("ses"),
    state: z.literal("open"),
    work_place: workPlaceOutputSchema,
    state_seq: seqSchema,
  }),
  compare: openSessionCompareSchema,
  actors: ["user"],
  errors: [...errors],
});

export const renameSession = defineCommand({
  resource: "sessions",
  method: "rename",
  name: "RenameSession",
  input: renameSessionInputSchema,
  output: z.object({
    id: idSchema("ses"),
    title: sessionTitleSchema,
    state_seq: seqSchema,
  }),
  compare: renameSessionCompareSchema,
  actors: ["user"],
  errors: ["invalid_input", "not_found", "conflict", "unauthorized"],
});

export const archiveSession = defineCommand({
  resource: "sessions",
  method: "archive",
  name: "ArchiveSession",
  input: archiveSessionInputSchema,
  output: z.object({
    id: idSchema("ses"),
    archived: z.literal(true),
    state_seq: seqSchema,
  }),
  compare: archiveSessionCompareSchema,
  actors: ["user"],
  errors: ["not_found", "conflict", "unauthorized", "invalid_input"],
});

export const unarchiveSession = defineCommand({
  resource: "sessions",
  method: "unarchive",
  name: "UnarchiveSession",
  input: unarchiveSessionInputSchema,
  output: z.object({
    id: idSchema("ses"),
    archived: z.literal(false),
    state_seq: seqSchema,
  }),
  compare: unarchiveSessionCompareSchema,
  actors: ["user"],
  errors: ["not_found", "conflict", "unauthorized", "invalid_input"],
});

// 되돌릴 수 없다. 진행 중·대기 중 run이 있으면 conflict, 그 run이 만든 문서·앱 변경은 지우지
// 않는다. 결과는 지운 사실의 최소 기록뿐이다.
export const deleteSession = defineCommand({
  resource: "sessions",
  method: "delete",
  name: "DeleteSession",
  input: deleteSessionInputSchema,
  output: z.object({
    id: idSchema("ses"),
    deleted_at: atSchema,
  }),
  compare: deleteSessionCompareSchema,
  actors: ["user"],
  errors: [
    "not_found",
    "conflict",
    "forbidden",
    "unauthorized",
    "invalid_input",
  ],
});

export const forkSession = defineCommand({
  resource: "sessions",
  method: "fork",
  name: "ForkSession",
  input: forkSessionInputSchema,
  output: z.object({
    id: idSchema("ses"),
    state: z.literal("open"),
    forked_from: forkOriginOutputSchema,
    copied_messages: z.number().int().nonnegative().max(
      Number.MAX_SAFE_INTEGER,
    ),
    state_seq: seqSchema,
  }),
  actors: ["user"],
  errors: [...errors],
});

export const requestSessionCompact = defineCommand({
  resource: "sessions",
  method: "request-compact",
  name: "RequestSessionCompact",
  input: requestSessionCompactInputSchema,
  output: z.object({
    id: idSchema("ses"),
    // 요청 event의 순번이 요청의 이름이다.
    request_seq: seqSchema,
  }),
  compare: requestSessionCompactCompareSchema,
  actors: ["user"],
  errors: [...errors],
});

export const compactSession = defineCommand({
  resource: "sessions",
  method: "compact",
  name: "CompactSession",
  input: compactSessionInputSchema,
  output: z.object({
    id: idSchema("ses"),
    compaction: compactionOutputSchema,
    state_seq: seqSchema,
  }),
  compare: compactSessionCompareSchema,
  actors: ["machine"],
  errors: [...errors, "unavailable"],
});

export const failSessionCompact = defineCommand({
  resource: "sessions",
  method: "fail-compact",
  name: "FailSessionCompact",
  input: failSessionCompactInputSchema,
  output: z.object({
    id: idSchema("ses"),
    request_seq: seqSchema,
    reason: compactFailureReasonSchema,
  }),
  compare: failSessionCompactCompareSchema,
  actors: ["machine"],
  errors: [...errors],
});

export const changeSessionModel = defineCommand({
  resource: "sessions",
  method: "change-model",
  name: "ChangeSessionModel",
  input: changeSessionModelInputSchema,
  output: z.object({
    id: idSchema("ses"),
    model_selection: modelChoiceOutputSchema.nullable(),
    state_seq: seqSchema,
  }),
  compare: changeSessionModelCompareSchema,
  actors: ["user"],
  errors: ["invalid_input", "not_found", "conflict", "unauthorized"],
});

export const closeSession = defineCommand({
  resource: "sessions",
  method: "close",
  name: "CloseSession",
  input: closeSessionInputSchema,
  output: z.object({
    id: idSchema("ses"),
    state: z.literal("closed"),
    reason: z.enum(SESSION_CLOSED_REASONS),
    closed_at: atSchema,
    state_seq: seqSchema,
  }),
  compare: closeSessionCompareSchema,
  actors: ["machine"],
  errors: [
    "conflict",
    "forbidden",
    "unauthorized",
    "invalid_input",
    "not_found",
  ],
});

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

// 목록은 agent(assignment)와 자리별이다: 둘은 필수이고 다른 agent나 다른 자리의 session은
// 섞이지 않는다. archived는 기본에서 뺀다(`exclude`, 생략과 같다);
// Archived 보기는 `only`다. 제목 검색은 이 결과에서 제목만 대상으로 하는 화면의 거름이며
// 메시지 본문은 읽지 않는다.
export const SESSION_ARCHIVED_FILTERS = ["exclude", "include", "only"] as const;
export const sessionListInputSchema = z.strictObject({
  assignment: idSchema("asg"),
  work_place: workPlaceSchema,
  archived: z.enum(SESSION_ARCHIVED_FILTERS).optional(),
  cursor: readCursorSchema.optional(),
});

export const sessionList = defineRead({
  resource: "sessions",
  method: "list",
  name: "ListSessions",
  input: sessionListInputSchema,
  output: withReadCommon(z.object({ sessions: z.array(sessionRecordSchema) }))
    .refine(
      (value) =>
        seqSchema.safeParse(value.as_of_seq).success &&
        value.sessions.every((session) =>
          seqSchema.safeParse(session.state_seq).success &&
          BigInt(session.state_seq) <= BigInt(value.as_of_seq)
        ),
      { message: "session state is newer than read snapshot" },
    ),
  actors: ["user", "agent", "machine", "coding_agent"],
  errors: [...readErrors],
});

// runtime이 요약을 시작할 요청을 읽는다. 끝나지 않은 run이 있는 session의 요청은 그 run이 끝날 때까지
// 나오지 않는다. 가장 오래된 요청부터 나온다.
export const sessionCompactRequests = defineRead({
  resource: "sessions",
  method: "compact-requests",
  name: "ListSessionCompactRequests",
  input: z.strictObject({}),
  output: withReadCommon(z.object({
    requests: z.array(z.object({
      session: idSchema("ses"),
      agent: agentRefOutputSchema,
      place: placeOutputSchema.nullable(),
      request_seq: seqSchema,
    })),
  })),
  actors: ["machine"],
  errors: [...readErrors],
});

// Compact가 session에 이은 요약의 본문이다. 요약은 원문을 대체하지 않는 derived라 호출의 출력이
// 정본이고, 사람 화면은 이 본문을 일반 agent 답과 구별해 보인다. `revert`를 주면 그
// rewind("Summarize from here")가 접은 구간의 요약을 읽는다: compaction은 접힌 구간의 끝(result_seq)과
// 그 요약 call이다.
export const sessionSummary = defineRead({
  resource: "sessions",
  method: "summary",
  name: "ReadSessionSummary",
  input: z.strictObject({
    session: idSchema("ses"),
    revert: idSchema("rvt").optional(),
  }),
  output: withReadCommon(z.object({
    session: idSchema("ses"),
    compaction: compactionOutputSchema,
    text: z.string(),
  })),
  actors: ["user", "agent", "machine"],
  errors: [...readErrors],
});

const sessionSubject = idSchema("ses");

export const sessionOpened = defineEvent("SessionOpened", {
  subject: sessionSubject,
  payload: z.object({
    assignment: idSchema("asg"),
    work_place: workPlaceOutputSchema,
    opening_context: openingContextOutputSchema.nullable(),
  }),
});

export const sessionRenamed = defineEvent("SessionRenamed", {
  subject: sessionSubject,
  payload: z.object({
    before: sessionTitleSchema.nullable(),
    after: sessionTitleSchema,
  }),
});

export const sessionArchived = defineEvent("SessionArchived", {
  subject: sessionSubject,
  payload: z.object({}),
});

export const sessionUnarchived = defineEvent("SessionUnarchived", {
  subject: sessionSubject,
  payload: z.object({}),
});

// 지운 내용은 싣지 않는다.
export const sessionDeleted = defineEvent("SessionDeleted", {
  subject: sessionSubject,
  payload: z.object({
    assignment: idSchema("asg"),
    deleted_at: atSchema,
  }),
});

// subject는 새 session이다.
export const sessionForked = defineEvent("SessionForked", {
  subject: sessionSubject,
  payload: z.object({
    forked_from: forkOriginOutputSchema,
    copied_messages: z.number().int().nonnegative().max(
      Number.MAX_SAFE_INTEGER,
    ),
  }),
});

// 요청한 순간의 사실이다. subject가 session이고 event 순번이 요청의 이름이다.
export const sessionCompactRequested = defineEvent("SessionCompactRequested", {
  subject: sessionSubject,
  payload: z.object({}),
});

export const sessionCompactFailed = defineEvent("SessionCompactFailed", {
  subject: sessionSubject,
  payload: z.object({
    request: seqSchema,
    reason: compactFailureReasonSchema,
  }),
});

export const sessionCompacted = defineEvent("SessionCompacted", {
  subject: sessionSubject,
  payload: z.object({
    before: compactionOutputSchema.nullable(),
    after: compactionOutputSchema,
  }),
});

export const sessionModelChanged = defineEvent("SessionModelChanged", {
  subject: sessionSubject,
  payload: z.object({
    before: modelChoiceOutputSchema.nullable(),
    after: modelChoiceOutputSchema.nullable(),
  }),
});

export const sessionClosed = defineEvent("SessionClosed", {
  subject: sessionSubject,
  payload: z.object({
    reason: z.enum(SESSION_CLOSED_REASONS),
    closed_at: atSchema,
  }),
});

export const SESSION_COMMANDS = [
  openSession,
  renameSession,
  archiveSession,
  unarchiveSession,
  deleteSession,
  forkSession,
  requestSessionCompact,
  compactSession,
  failSessionCompact,
  changeSessionModel,
  closeSession,
  sessionList,
  sessionCompactRequests,
  sessionSummary,
] as const;

export const SESSION_EVENTS = [
  sessionOpened,
  sessionRenamed,
  sessionArchived,
  sessionUnarchived,
  sessionDeleted,
  sessionForked,
  sessionCompactRequested,
  sessionCompacted,
  sessionCompactFailed,
  sessionModelChanged,
  sessionClosed,
] as const;
