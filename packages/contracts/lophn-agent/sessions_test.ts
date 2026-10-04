import { assert, assertEquals } from "@std/assert";
import { routePath } from "../platform/mod.ts";
import {
  changeSessionWorkPlaceCompareSchema,
  changeSessionWorkPlaceInputSchema,
  closeSessionCompareSchema,
  continuationOutputSchema,
  continuationSchema,
  openSession,
  openSessionCompareSchema,
  openSessionInputSchema,
  SESSION_COMMANDS,
  SESSION_EVENTS,
  sessionList,
  sessionOpened,
  sessionRead,
  sessionRecordSchema,
} from "./sessions.ts";

const session = "ses_01arz3ndektsv4rrffq69g5fav";
const assignment = "asg_01arz3ndektsv4rrffq69g5fav";
const app = "app_01arz3ndektsv4rrffq69g5fav";

const open = {
  id: session,
  assignment,
  role: "lophn",
  work_place: { kind: "global", id: null },
  continued_from: null,
  closed_reason: null,
  closed_at: null,
  work_place_revision: 1,
  state: "open",
  state_seq: "1",
};

Deno.test("lophn-agent/conversation#R1: five session routes and three session events", () => {
  assertEquals(SESSION_COMMANDS.map(routePath), [
    "/v1/sessions/open",
    "/v1/sessions/change-work-place",
    "/v1/sessions/close",
    "/v1/sessions/read",
    "/v1/sessions/list",
  ]);
  assertEquals(SESSION_EVENTS.map((event) => event.type), [
    "SessionOpened",
    "SessionWorkPlaceChanged",
    "SessionClosed",
  ]);
  assert(sessionRecordSchema.safeParse(open).success);
  assert(
    sessionRecordSchema.safeParse({
      ...open,
      state: "closed",
      closed_reason: "user_closed",
      closed_at: "2026-10-04T00:00:00.000Z",
    }).success,
  );
  assert(
    !sessionRecordSchema.safeParse({
      ...open,
      closed_reason: "user_closed",
    }).success,
  );
});

Deno.test("lophn-agent/conversation#R16: open rejects a self continuation and an operator global place", () => {
  assert(
    openSessionInputSchema.safeParse({
      id: session,
      assignment,
      role: "app_engineer",
      work_place: { kind: "app", id: app },
      continued_from: null,
    }).success,
  );
  assert(
    !openSessionInputSchema.safeParse({
      id: session,
      assignment,
      role: "lophn",
      work_place: { kind: "global", id: null },
      continued_from: { session, through_seq: "1" },
    }).success,
  );
  assert(
    !openSessionInputSchema.safeParse({
      id: session,
      assignment,
      role: "operator",
      work_place: { kind: "global", id: null },
      continued_from: null,
    }).success,
  );
  assert(
    !openSessionInputSchema.safeParse({
      id: session,
      assignment,
      role: "lophn",
      work_place: { kind: "global", id: null },
      continued_from: null,
      trusted: true,
    }).success,
  );
});

Deno.test("lophn-agent/conversation#R2: persisted session read keeps explicit state and additive values without automatic expiry", () => {
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
  assert(
    !sessionRecordSchema.safeParse({ ...open, state: "archived" }).success,
  );
  assert(!sessionRecordSchema.safeParse({ ...open, state: "expired" }).success);
  assert(!sessionRead.input.safeParse({ session, reopen: true }).success);
});

Deno.test("lophn-agent/conversation#R8: close contract compares open state and records only canonical closing reasons", () => {
  assert(
    closeSessionCompareSchema.safeParse({ state: "open", state_seq: "5" })
      .success,
  );
  assert(
    !closeSessionCompareSchema.safeParse({ state: "closed", state_seq: "5" })
      .success,
  );
  for (
    const closed_reason of ["assignment_paused", "connection_lost", "midnight"]
  ) {
    assert(
      !sessionRecordSchema.safeParse({
        ...open,
        state: "closed",
        closed_reason,
        closed_at: "2026-10-04T00:00:00.000Z",
      }).success,
    );
  }
  assert(!sessionRecordSchema.safeParse({ ...open, state: "closed" }).success);
});

Deno.test("lophn-agent/conversation#R9: continuation is a fixed original session range, not copied messages or approvals", () => {
  const continuation = {
    session: "ses_01arz3ndektsv4rrffq69g5faw",
    through_seq: "9007199254740993",
  };
  const input = {
    id: session,
    assignment,
    role: "lophn",
    work_place: open.work_place,
    continued_from: continuation,
  };
  assert(openSessionInputSchema.safeParse(input).success);
  assert(
    !openSessionInputSchema.safeParse({
      ...input,
      continued_from: { session, through_seq: "1" },
    }).success,
  );
  assert(
    !continuationSchema.safeParse({ ...continuation, messages: [] }).success,
  );
  assert(
    !continuationSchema.safeParse({
      ...continuation,
      approval: "apr_01arz3ndektsv4rrffq69g5fav",
    }).success,
  );
  assert(
    !continuationSchema.safeParse({ ...continuation, through_seq: 1 }).success,
  );
  assert(
    continuationOutputSchema.safeParse({ ...continuation, future: true })
      .success,
  );
});

Deno.test("lophn-agent/conversation#R10: opening and closing schema do not require an organizing summary result", () => {
  assert(
    openSessionInputSchema.safeParse({
      id: session,
      assignment,
      role: "lophn",
      work_place: open.work_place,
      continued_from: null,
    }).success,
  );
  assert(
    !openSessionInputSchema.safeParse({
      id: session,
      assignment,
      role: "lophn",
      work_place: open.work_place,
      continued_from: null,
      summary: "required",
    }).success,
  );
  assert(
    closeSessionCompareSchema.safeParse({ state: "open", state_seq: "1" })
      .success,
  );
});

Deno.test("lophn-agent/conversation#R17: work-place change is strict explicit user input with numeric revision CAS", () => {
  assert(
    changeSessionWorkPlaceInputSchema.safeParse({
      session,
      work_place: { kind: "app", id: app },
    }).success,
  );
  assert(
    !changeSessionWorkPlaceInputSchema.safeParse({
      session,
      work_place: open.work_place,
      tab: app,
    }).success,
  );
  const compare = {
    state_seq: "1",
    work_place_revision: 1,
    role: "context_engineer",
  };
  assert(changeSessionWorkPlaceCompareSchema.safeParse(compare).success);
  for (const role of ["app_engineer", "operator"]) {
    assert(
      !changeSessionWorkPlaceCompareSchema.safeParse({ ...compare, role })
        .success,
    );
  }
  for (
    const work_place_revision of ["1", 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]
  ) {
    assert(
      !changeSessionWorkPlaceCompareSchema.safeParse({
        ...compare,
        work_place_revision,
      }).success,
    );
  }
  assert(
    openSessionCompareSchema.safeParse({
      assignment_revision: 1,
      assignment_state: "paused",
    }).success,
  );
  assert(
    !openSessionCompareSchema.safeParse({
      assignment_revision: 1,
      assignment_state: "withdrawn",
    }).success,
  );
  assert(
    !openSessionCompareSchema.safeParse({
      assignment_revision: "1",
      assignment_state: "enabled",
    }).success,
  );
  const output = {
    id: session,
    state: "open",
    work_place: { ...open.work_place, future: true },
    work_place_revision: 1,
    state_seq: "1",
    future: true,
  };
  assert(openSession.output.safeParse(output).success);
  assert(
    !openSession.output.safeParse({ ...output, work_place_revision: "1" })
      .success,
  );
  assert(
    !openSession.output.safeParse({ ...output, work_place_revision: 2 })
      .success,
  );
  assert(
    sessionOpened.payload.safeParse({
      assignment,
      role: "lophn",
      work_place: open.work_place,
      work_place_revision: 1,
      continued_from: null,
      future: true,
    }).success,
  );
});

Deno.test("lophn-agent/harness/prompt-assemble#R19: continuation carries original range references rather than replacement summary bytes", () => {
  assert(continuationSchema.safeParse({ session, through_seq: "3" }).success);
  assert(
    !continuationSchema.safeParse({
      session,
      through_seq: "3",
      summary_blob: "a".repeat(64),
    }).success,
  );
});

Deno.test("lophn-agent/harness/prompt-assemble#R20: continuation boundary has no caller-claimed summary token count", () => {
  assert(
    !continuationSchema.safeParse({
      session,
      through_seq: "3",
      summary_tokens: 400,
    }).success,
  );
  assert(
    !continuationSchema.safeParse({
      session,
      through_seq: "3",
      summary: "truncated",
    }).success,
  );
});

Deno.test("lophn-agent/conversation#R2: session read and list states cannot be newer than their snapshot", () => {
  const output = { session: open, as_of_seq: "1", next_cursor: null };
  assert(sessionRead.output.safeParse(output).success);
  assert(!sessionRead.output.safeParse({ ...output, as_of_seq: "0" }).success);
  assert(
    !sessionRead.output.safeParse({ ...output, as_of_seq: "bad" }).success,
  );
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
