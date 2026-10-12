import { assert, assertEquals } from "@std/assert";
import { routePath } from "../server/mod.ts";
import {
  archiveSession,
  changeSessionModel,
  changeSessionModelInputSchema,
  closeSession,
  closeSessionCompareSchema,
  closeSessionInputSchema,
  COMPACT_FAILURE_REASONS,
  compactionOutputSchema,
  compactSession,
  deleteSession,
  failSessionCompact,
  forkOriginOutputSchema,
  forkSession,
  forkSessionInputSchema,
  openingContextSchema,
  openSession,
  openSessionCompareSchema,
  openSessionInputSchema,
  renameSession,
  renameSessionInputSchema,
  requestSessionCompact,
  SESSION_COMMANDS,
  SESSION_EVENTS,
  sessionArchived,
  sessionCompacted,
  sessionCompactFailed,
  sessionCompactRequested,
  sessionCompactRequests,
  sessionDeleted,
  sessionForked,
  sessionList,
  sessionListInputSchema,
  sessionModelChanged,
  sessionOpened,
  sessionRead,
  sessionRecordSchema,
  sessionRenamed,
  sessionSummary,
  sessionTitleLength,
  unarchiveSession,
} from "./sessions.ts";

const session = "ses_01arz3ndektsv4rrffq69g5fav";
const other = "ses_01arz3ndektsv4rrffq69g5faw";
const assignment = "asg_01arz3ndektsv4rrffq69g5fav";
const app = "app_01arz3ndektsv4rrffq69g5fav";
const project = "prj_01arz3ndektsv4rrffq69g5fav";
const provider = "pvd_01arz3ndektsv4rrffq69g5fav";
const call = "mcl_01arz3ndektsv4rrffq69g5fav";
const problem = "prb_01arz3ndektsv4rrffq69g5fav";
const projectPlace = { kind: "project", id: project };

const open = {
  id: session,
  assignment,
  work_place: projectPlace,
  title: null,
  archived: false,
  state: "open",
  forked_from: null,
  opening_context: null,
  model_selection: null,
  compaction: null,
  closed_reason: null,
  closed_at: null,
  state_seq: "1",
};

Deno.test("lophn-agent/conversation#R1 [agent-I16b]: fifteen session routes and eleven session events", () => {
  assertEquals(SESSION_COMMANDS.map(routePath), [
    "/v1/sessions/open",
    "/v1/sessions/rename",
    "/v1/sessions/archive",
    "/v1/sessions/unarchive",
    "/v1/sessions/delete",
    "/v1/sessions/fork",
    "/v1/sessions/request-compact",
    "/v1/sessions/compact",
    "/v1/sessions/fail-compact",
    "/v1/sessions/change-model",
    "/v1/sessions/close",
    "/v1/sessions/read",
    "/v1/sessions/list",
    "/v1/sessions/compact-requests",
    "/v1/sessions/summary",
  ]);
  assertEquals(SESSION_EVENTS.map((event) => event.type), [
    "SessionOpened",
    "SessionRenamed",
    "SessionArchived",
    "SessionUnarchived",
    "SessionDeleted",
    "SessionForked",
    "SessionCompactRequested",
    "SessionCompacted",
    "SessionCompactFailed",
    "SessionModelChanged",
    "SessionClosed",
  ]);
  assert(sessionRecordSchema.safeParse(open).success);
  // 옛 칸은 지웠다: 자리 revision, 이어가기, 사람 종료 이유.
  for (const key of ["work_place_revision", "continued_from", "role"]) {
    assert(!(key in sessionRecordSchema.shape));
  }
});

Deno.test("lophn-agent/conversation#R1: open takes an agent and a project or app place and no role to change", () => {
  const input = {
    id: session,
    assignment,
    work_place: { kind: "app", id: app },
    opening_context: null,
  };
  assert(openSessionInputSchema.safeParse(input).success);
  assert(
    openSessionInputSchema.safeParse({ ...input, work_place: projectPlace })
      .success,
  );
  for (
    const extra of [{ role: "lophn" }, { trusted: true }, { summary: "x" }]
  ) {
    assert(!openSessionInputSchema.safeParse({ ...input, ...extra }).success);
  }
  // 이어가기 출처는 없다: 새 session으로 가는 길은 Fork다.
  assert(
    !openSessionInputSchema.safeParse({
      ...input,
      continued_from: { session: other, through_seq: "1" },
    }).success,
  );
  assertEquals(openSession.actors, ["user"]);
});

Deno.test("lophn-agent/conversation#R16: a session place is a project or an app and never global", () => {
  const input = {
    id: session,
    assignment,
    work_place: { kind: "global", id: null },
    opening_context: null,
  };
  assert(!openSessionInputSchema.safeParse(input).success);
  assert(
    !sessionRecordSchema.safeParse({
      ...open,
      work_place: { kind: "global", id: null },
    }).success,
  );
  assert(
    !openSessionInputSchema.safeParse({
      ...input,
      work_place: { kind: "app", id: project },
    }).success,
  );
  // 자리를 바꾸는 command와 compare가 없다.
  const methods = SESSION_COMMANDS.map((route) => route.method);
  assert(!methods.includes("change-work-place"));
  assert(!("work_place" in renameSessionInputSchema.shape));
});

Deno.test("lophn-agent/conversation#R8: open compares an enabled assignment and close is the machine's withdrawn path only", () => {
  const compare = { assignment_revision: 1, assignment_state: "enabled" };
  assert(openSessionCompareSchema.safeParse(compare).success);
  for (const assignment_state of ["paused", "withdrawn"]) {
    assert(
      !openSessionCompareSchema.safeParse({ ...compare, assignment_state })
        .success,
    );
  }
  assert(
    !openSessionCompareSchema.safeParse({
      ...compare,
      assignment_revision: "1",
    }).success,
  );
  assertEquals(closeSession.actors, ["machine"]);
  assert(
    closeSessionInputSchema.safeParse({
      session,
      reason: "assignment_withdrawn",
    }).success,
  );
  // 사람이 닫는 이유와 일시 멈춤·자정 같은 표시 수명은 닫는 이유가 아니다.
  for (
    const reason of [
      "user_closed",
      "assignment_paused",
      "connection_lost",
      "midnight",
    ]
  ) {
    assert(!closeSessionInputSchema.safeParse({ session, reason }).success);
    assert(
      !sessionRecordSchema.safeParse({
        ...open,
        state: "closed",
        closed_reason: reason,
        closed_at: "2026-10-04T00:00:00.000Z",
      }).success,
    );
  }
  assert(
    closeSessionCompareSchema.safeParse({ state: "open", state_seq: "5" })
      .success,
  );
  assert(
    !closeSessionCompareSchema.safeParse({ state: "closed", state_seq: "5" })
      .success,
  );
  const closed = {
    ...open,
    state: "closed",
    closed_reason: "assignment_withdrawn",
    closed_at: "2026-10-04T00:00:00.000Z",
  };
  assert(sessionRecordSchema.safeParse(closed).success);
  assert(
    !sessionRecordSchema.safeParse({ ...closed, closed_at: null }).success,
  );
  assert(
    !sessionRecordSchema.safeParse({
      ...open,
      closed_reason: "assignment_withdrawn",
    }).success,
  );
  assert(!sessionRecordSchema.safeParse({ ...open, state: "closed" }).success);
});

Deno.test("lophn-agent/conversation#R2: persisted session read keeps additive values and has no expiry state", () => {
  assert(
    sessionRead.output.safeParse({
      session: {
        ...open,
        future: true,
        work_place: { ...open.work_place, future: true },
      },
      as_of_seq: "1",
      next_cursor: null,
      future: true,
    }).success,
  );
  // archived는 state가 아니라 별개 칸이다. 자동 만료 상태는 없다.
  for (const state of ["archived", "expired"]) {
    assert(!sessionRecordSchema.safeParse({ ...open, state }).success);
  }
  assert(!sessionRead.input.safeParse({ session, reopen: true }).success);
  const output = { session: open, as_of_seq: "1", next_cursor: null };
  assert(sessionRead.output.safeParse(output).success);
  assert(!sessionRead.output.safeParse({ ...output, as_of_seq: "0" }).success);
  assert(
    !sessionRead.output.safeParse({ ...output, as_of_seq: "bad" }).success,
  );
});

Deno.test("lophn-agent/conversation#R18: a title is nonblank, 120 characters at most, and never a number name", () => {
  assert(
    sessionRecordSchema.safeParse({ ...open, title: "Plan the cart" }).success,
  );
  // 메시지가 없는 session은 제목이 null이다(번호 이름을 만들지 않는다).
  assertEquals(sessionRecordSchema.parse(open).title, null);
  for (const title of ["", "   ", "\n\t "]) {
    assert(!sessionRecordSchema.safeParse({ ...open, title }).success);
    assert(
      !renameSessionInputSchema.safeParse({ session, title }).success,
    );
  }
  const max = "가".repeat(120);
  assert(renameSessionInputSchema.safeParse({ session, title: max }).success);
  // 앞뒤 공백은 길이에 세지 않는다.
  assert(
    renameSessionInputSchema.safeParse({ session, title: ` ${max}\n` })
      .success,
  );
  assert(
    !renameSessionInputSchema.safeParse({ session, title: max + "나" })
      .success,
  );
  // 글자는 사람이 보는 글자다: 결합 문자와 이모지 묶음은 하나로 센다.
  assertEquals(sessionTitleLength("é"), 1);
  assertEquals(sessionTitleLength("👨‍👩‍👧"), 1);
  assertEquals(sessionTitleLength("가나다"), 3);
  const emoji = "👨‍👩‍👧".repeat(120);
  assert(renameSessionInputSchema.safeParse({ session, title: emoji }).success);
  assertEquals(renameSession.actors, ["user"]);
  assert(
    !renameSessionInputSchema.safeParse({ session, title: "x", extra: 1 })
      .success,
  );
  assert(
    sessionRenamed.payload.safeParse({ before: null, after: "Plan" }).success,
  );
  assert(
    !sessionRenamed.payload.safeParse({ before: "Plan", after: " " }).success,
  );
});

Deno.test("lophn-agent/conversation#R19: archive and unarchive only flip the list flag", () => {
  assertEquals(archiveSession.actors, ["user"]);
  assertEquals(unarchiveSession.actors, ["user"]);
  assert(
    archiveSession.output.safeParse({
      id: session,
      archived: true,
      state_seq: "2",
    }).success,
  );
  assert(
    !archiveSession.output.safeParse({
      id: session,
      archived: false,
      state_seq: "2",
    }).success,
  );
  assert(
    unarchiveSession.output.safeParse({
      id: session,
      archived: false,
      state_seq: "3",
    }).success,
  );
  assert(
    !unarchiveSession.output.safeParse({
      id: session,
      archived: true,
      state_seq: "3",
    }).success,
  );
  assert(
    sessionRecordSchema.safeParse({ ...open, archived: true }).success,
  );
  // archive한 session도 열린 채다.
  assert(
    sessionRecordSchema.safeParse({ ...open, archived: true, state: "open" })
      .success,
  );
  assert(sessionArchived.payload.safeParse({}).success);
  assert(
    !archiveSession.input.safeParse({ session, delete_runs: true }).success,
  );
});

Deno.test("lophn-agent/conversation#R20: delete names a session and reports only the minimal fact", () => {
  assertEquals(deleteSession.actors, ["user"]);
  assert(deleteSession.input.safeParse({ session }).success);
  assert(!deleteSession.input.safeParse({ session, keep_runs: true }).success);
  assert(
    deleteSession.output.safeParse({
      id: session,
      deleted_at: "2026-10-04T00:00:00.000Z",
    }).success,
  );
  assert(
    sessionDeleted.payload.safeParse({
      assignment,
      deleted_at: "2026-10-04T00:00:00.000Z",
    }).success,
  );
  // 진행 중인 run이 있으면 conflict로 거절한다. 지운 내용은 event에 싣지 않는다.
  assert(deleteSession.errors.includes("conflict"));
  assert(!("messages" in sessionDeleted.payload.shape));
});

Deno.test("lophn-agent/conversation#R21: list is per agent and place, archived is filterable and nothing searches bodies", () => {
  const base = { assignment, work_place: projectPlace };
  assert(sessionListInputSchema.safeParse(base).success);
  for (const archived of ["exclude", "include", "only"]) {
    assert(sessionListInputSchema.safeParse({ ...base, archived }).success);
  }
  assert(
    !sessionListInputSchema.safeParse({ ...base, archived: "all" }).success,
  );
  // agent와 자리는 필수다: 다른 agent나 다른 자리의 session이 섞이지 않는다.
  assert(
    !sessionListInputSchema.safeParse({ work_place: projectPlace }).success,
  );
  assert(!sessionListInputSchema.safeParse({ assignment }).success);
  assert(
    !sessionListInputSchema.safeParse({
      ...base,
      work_place: { kind: "global", id: null },
    }).success,
  );
  // 본문 검색 입력은 없다.
  for (const extra of [{ query: "x" }, { body: "x" }, { search: "x" }]) {
    assert(!sessionListInputSchema.safeParse({ ...base, ...extra }).success);
  }
  assert(
    sessionList.output.safeParse({
      sessions: [open],
      as_of_seq: "1",
      next_cursor: null,
    }).success,
  );
  assert(
    !sessionList.output.safeParse({
      sessions: [open],
      as_of_seq: "0",
      next_cursor: null,
    }).success,
  );
});

Deno.test("lophn-agent/conversation#R22: the opening context is a fixed event reference set only at open", () => {
  const context = { source_seq: "9007199254740993", target: problem };
  assert(openingContextSchema.safeParse(context).success);
  for (
    const target of [
      app,
      "ctx_01arz3ndektsv4rrffq69g5fav",
      "rel_01arz3ndektsv4rrffq69g5fav",
    ]
  ) {
    assert(openingContextSchema.safeParse({ ...context, target }).success);
  }
  // 사건 글을 복사하지 않고 참조만 둔다.
  for (
    const extra of [{ text: "copied" }, { body: "copied" }, { title: "x" }]
  ) {
    assert(!openingContextSchema.safeParse({ ...context, ...extra }).success);
  }
  assert(
    !openingContextSchema.safeParse({ ...context, source_seq: 1 }).success,
  );
  assert(
    !openingContextSchema.safeParse({ ...context, target: session }).success,
  );
  const input = {
    id: session,
    assignment,
    work_place: projectPlace,
    opening_context: context,
  };
  assert(openSessionInputSchema.safeParse(input).success);
  assert(
    sessionRecordSchema.safeParse({ ...open, opening_context: context })
      .success,
  );
  assert(
    sessionOpened.payload.safeParse({
      assignment,
      work_place: projectPlace,
      opening_context: context,
      future: true,
    }).success,
  );
  // 열고 나서 바꾸는 command가 없다.
  assert(
    !SESSION_COMMANDS.some((route) => route.name.includes("OpeningContext")),
  );
});

Deno.test("lophn-agent/conversation#R23: a model selection is a nullable ModelChoice stored on the session only", () => {
  const model = {
    provider,
    model_name: "claude-fable",
    option_values: { effort: "high" },
  };
  assert(
    changeSessionModelInputSchema.safeParse({ session, model }).success,
  );
  // null은 agent 기본값으로 돌아간다.
  assert(
    changeSessionModelInputSchema.safeParse({ session, model: null }).success,
  );
  assert(!changeSessionModelInputSchema.safeParse({ session }).success);
  assert(
    !changeSessionModelInputSchema.safeParse({
      session,
      model: { ...model, account: "primary" },
    }).success,
  );
  assert(
    !changeSessionModelInputSchema.safeParse({
      session,
      model,
      agent_default: true,
    }).success,
  );
  assert(
    sessionRecordSchema.safeParse({ ...open, model_selection: model }).success,
  );
  assert(
    changeSessionModel.output.safeParse({
      id: session,
      model_selection: null,
      state_seq: "2",
    }).success,
  );
  assert(
    sessionModelChanged.payload.safeParse({ before: null, after: model })
      .success,
  );
  assert(
    sessionModelChanged.payload.safeParse({ before: model, after: null })
      .success,
  );
  assertEquals(changeSessionModel.actors, ["user"]);
});

Deno.test("lophn-agent/conversation#R9: fork names a new session, a source and a chosen seq", () => {
  const input = { id: other, source: session, through_seq: "9007199254740993" };
  assert(forkSessionInputSchema.safeParse(input).success);
  assert(!forkSessionInputSchema.safeParse({ ...input, id: session }).success);
  assert(
    !forkSessionInputSchema.safeParse({ ...input, through_seq: 5 }).success,
  );
  // 복사하는 것은 확정 메시지뿐이다: 복제할 run·질문·approval을 입력으로 받지 않는다.
  for (
    const extra of [
      { messages: [] },
      { runs: true },
      { approval: "apr_01arz3ndektsv4rrffq69g5fav" },
      { title: "x" },
    ]
  ) {
    assert(!forkSessionInputSchema.safeParse({ ...input, ...extra }).success);
  }
  const origin = { session, through_seq: "9" };
  assert(forkOriginOutputSchema.safeParse({ ...origin, future: true }).success);
  assert(
    sessionRecordSchema.safeParse({ ...open, id: other, forked_from: origin })
      .success,
  );
  // 자기 자신에서 갈라진 session은 없다.
  assert(
    !sessionRecordSchema.safeParse({
      ...open,
      forked_from: origin,
      id: session,
    })
      .success,
  );
  assert(
    forkSession.output.safeParse({
      id: other,
      state: "open",
      forked_from: origin,
      copied_messages: 3,
      state_seq: "7",
    }).success,
  );
  assert(
    !forkSession.output.safeParse({
      id: other,
      state: "open",
      forked_from: origin,
      copied_messages: -1,
      state_seq: "7",
    }).success,
  );
  assert(
    sessionForked.payload.safeParse({
      forked_from: origin,
      copied_messages: 0,
    }).success,
  );
  assertEquals(forkSession.actors, ["user"]);
});

Deno.test("lophn-agent/conversation#R10 [agent-I16b]: compaction is a range and a summary call reference, never summary bytes", () => {
  const compaction = { through_seq: "12", summary_call: call };
  assert(compactionOutputSchema.safeParse(compaction).success);
  assert(
    sessionRecordSchema.safeParse({ ...open, compaction }).success,
  );
  // 요약 본문과 token 수는 caller가 주장하지 않는다(derived).
  assert(
    !sessionRecordSchema.safeParse({
      ...open,
      compaction: { ...compaction, through_seq: 12 },
    }).success,
  );
  assert(
    !compactionOutputSchema.safeParse({ through_seq: "12" }).success,
  );
  assert(
    sessionCompacted.payload.safeParse({
      before: null,
      after: compaction,
    }).success,
  );
  assert(
    sessionCompacted.payload.safeParse({
      before: compaction,
      after: { ...compaction, through_seq: "20" },
    }).success,
  );
  assert(
    !sessionCompacted.payload.safeParse({ before: null, after: null }).success,
  );
});

Deno.test("lophn-agent/conversation#R10 [agent-I16b]: a person requests Compact and the runtime ends it with the finished summary call", () => {
  // 요청은 사람이 하고 session의 상태를 바꾸지 않으므로 요청 기준은 session 상태다.
  assertEquals(requestSessionCompact.actors, ["user"]);
  assert(requestSessionCompact.input.safeParse({ session }).success);
  assert(
    !requestSessionCompact.input.safeParse({ session, summary: "supplied" })
      .success,
  );
  assert(
    requestSessionCompact.compare?.safeParse({
      state: "open",
      state_seq: "3",
    }).success,
  );
  assert(
    !requestSessionCompact.compare?.safeParse({
      state: "closed",
      state_seq: "3",
    }).success,
  );
  // 끝내는 쪽은 runtime(machine)이다. 어느 요청의 어느 요약 call이 어느 메시지까지 덮는지 싣는다.
  assertEquals(compactSession.actors, ["machine"]);
  const done = { session, summary_call: call, through_seq: "12" };
  assert(compactSession.input.safeParse(done).success);
  assert(!compactSession.input.safeParse({ session }).success);
  assert(
    !compactSession.input.safeParse({ ...done, summary: "supplied" }).success,
  );
  assert(
    compactSession.compare?.safeParse({ state: "open", request_seq: "9" })
      .success,
  );
  assert(compactSession.errors.includes("unavailable"));
  assertEquals(failSessionCompact.actors, ["machine"]);
});

Deno.test("lophn-agent/conversation#R10 [agent-I16b]: a failed Compact names a safe reason and keeps the session record", () => {
  assertEquals([...COMPACT_FAILURE_REASONS], [
    "nothing_to_summarize",
    "model_unavailable",
    "model_failed",
    "too_large",
    "summary_too_long",
    "session_changed",
  ]);
  for (const reason of COMPACT_FAILURE_REASONS) {
    assert(failSessionCompact.input.safeParse({ session, reason }).success);
    assert(
      sessionCompactFailed.payload.safeParse({ request: "9", reason }).success,
    );
  }
  assert(
    !failSessionCompact.input.safeParse({ session, reason: "boom: secret" })
      .success,
  );
  assert(
    failSessionCompact.compare?.safeParse({ request_seq: "9" }).success,
  );
  // 요청 event는 싣는 것이 없고 subject가 session이다.
  assert(sessionCompactRequested.payload.safeParse({}).success);
  // 실패는 session record에 칸을 더하지 않는다.
  assert(!("compact_failure" in sessionRecordSchema.shape));
  assert(!("compaction_request" in sessionRecordSchema.shape));
});

Deno.test("lophn-agent/conversation#R10 [agent-I16b]: the runtime lists open requests and reads a summary text, and only the machine lists", () => {
  assertEquals(sessionCompactRequests.actors, ["machine"]);
  assert(sessionCompactRequests.input.safeParse({}).success);
  const request = {
    session,
    assignment,
    work_place: projectPlace,
    request_seq: "9",
  };
  assert(
    sessionCompactRequests.output.safeParse({
      requests: [request],
      as_of_seq: "10",
      next_cursor: null,
    }).success,
  );
  assert(
    !sessionCompactRequests.output.safeParse({
      requests: [{ ...request, request_seq: 9 }],
      as_of_seq: "10",
      next_cursor: null,
    }).success,
  );
  // 요약 본문은 사람(출처 표시)·그 agent·runtime이 읽는다.
  assertEquals(sessionSummary.actors, ["user", "agent", "machine"]);
  assert(sessionSummary.input.safeParse({ session }).success);
  assert(
    sessionSummary.output.safeParse({
      session,
      compaction: { through_seq: "12", summary_call: call },
      text: "summary",
      as_of_seq: "13",
      next_cursor: null,
    }).success,
  );
});
