import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../platform/mod.ts";
import {
  applyMessages,
  assignMessage,
  assignMessageCompareSchema,
  assignMessageInputSchema,
  executeStoredRequest,
  executeStoredRequestCompareSchema,
  MESSAGE_EVENTS,
  MESSAGE_ROUTES,
  messageAssigned,
  messageReceived,
  messageRecorded,
  messageSchema,
  messagesList,
  receiveMessage,
  receiveMessageCompareSchema,
  receiveMessageInputSchema,
  recordMessage,
  recordMessageInputSchema,
} from "./messages.ts";
import {
  app,
  apr,
  asg,
  body,
  doc,
  mcl,
  msg,
  qst,
  run,
  ses,
  tcl,
  ver,
} from "./message-fixtures.ts";

const paused = {
  id: msg,
  session: ses,
  actor: "user",
  body,
  run: null,
  mode: "request",
  applied_at_call: null,
  links: [],
};

Deno.test("lophn-agent/conversation#R3: six message routes and four events reject a closed compare", () => {
  assertEquals(MESSAGE_ROUTES.map(routePath), [
    "/v1/messages/receive",
    "/v1/messages/execute-stored",
    "/v1/messages/record",
    "/v1/messages/apply",
    "/v1/messages/assign",
    "/v1/messages/list",
  ]);
  assertEquals(MESSAGE_EVENTS.map((event) => event.type), [
    "MessageReceived",
    "MessageRecorded",
    "MessageApplied",
    "MessageAssigned",
  ]);
  assertEquals(receiveMessage.actors, ["user"]);
  assertEquals(executeStoredRequest.actors, ["user"]);
  assertEquals(recordMessage.actors, ["agent", "machine"]);
  assertEquals(applyMessages.actors, ["machine"]);
  assertEquals(assignMessage.actors, ["machine"]);
  assertEquals(messagesList.actors, ["user", "agent", "machine"]);
  assert(!messagesList.errors.includes("conflict"));
  for (const route of MESSAGE_ROUTES) {
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
    assert(!route.errors.includes("internal"));
  }
});

Deno.test("lophn-agent/conversation#R5: user mode is required and correction names a run", () => {
  assert(messageSchema.safeParse(paused).success);
  assert(
    messageSchema.safeParse({
      ...paused,
      mode: "correction",
      run,
    }).success,
  );
  assert(!messageSchema.safeParse({ ...paused, mode: null }).success);
  assert(
    !messageSchema.safeParse({
      ...paused,
      mode: "correction",
      run: null,
    }).success,
  );
  assert(
    receiveMessageInputSchema.safeParse({
      id: msg,
      session: ses,
      body,
      mode: "correction",
      run,
    }).success,
  );
  assert(
    !receiveMessageInputSchema.safeParse({
      id: msg,
      session: ses,
      body,
      mode: "correction",
    }).success,
  );
  assert(
    !messageReceived.payload.safeParse({
      session: ses,
      run: null,
      mode: "correction",
      body,
    }).success,
  );
  assert(
    messageReceived.payload.safeParse({
      session: ses,
      run,
      mode: "correction",
      body,
      extra: true,
    }).success,
  );
});

Deno.test("lophn-agent/conversation#R7: assignment compare keeps one unapplied run link", () => {
  assertEquals(Object.keys(assignMessageCompareSchema.shape), [
    "previous_run",
    "message_state_seq",
    "applied_at_call",
  ]);
  assert(
    assignMessageCompareSchema.safeParse({
      previous_run: run,
      message_state_seq: "4",
      applied_at_call: null,
    }).success,
  );
  assert(
    assignMessageCompareSchema.safeParse({
      previous_run: null,
      message_state_seq: "4",
      applied_at_call: null,
    }).success,
  );
  assert(
    !assignMessageCompareSchema.safeParse({
      previous_run: null,
      message_state_seq: "4",
      applied_at_call: mcl,
    }).success,
  );
  assert(
    messageAssigned.payload.safeParse({ previous_run: null, run }).success,
  );
  assert(
    !messageAssigned.payload.safeParse({ previous_run: run, run: null })
      .success,
  );
});

Deno.test("lophn-agent/conversation#R4: links are real targets and a plan is not a created link", () => {
  const links = [
    { kind: "document", document: doc },
    { kind: "version", document: doc, version: ver },
    { kind: "question", question: qst },
    { kind: "approval_request", approval_request: apr },
    { kind: "model_call", call: mcl },
    { kind: "tool_call", call: tcl },
  ];
  assert(
    recordMessageInputSchema.safeParse({
      id: msg,
      session: ses,
      run,
      body,
      links,
    }).success,
  );
  assert(
    !recordMessageInputSchema.safeParse({
      id: msg,
      session: ses,
      run,
      body,
      links: [{ kind: "document", document: doc, created: true }],
    }).success,
  );
  assert(
    !recordMessageInputSchema.safeParse({
      id: msg,
      session: ses,
      run,
      body,
      links: [{ kind: "plan", document: doc }],
    }).success,
  );
  assert(
    !recordMessageInputSchema.safeParse({
      id: msg,
      session: ses,
      run,
      body,
      links,
      actor: "agent",
    }).success,
  );
  assert(
    messageRecorded.payload.safeParse({
      session: ses,
      run: null,
      body,
      links: [{ kind: "document", document: doc, note: "kept" }],
    }).success,
  );
  assert(
    messageSchema.safeParse({
      ...paused,
      actor: "machine",
      mode: null,
      run,
      links,
    }).success,
  );
  assert(
    !messageSchema.safeParse({
      ...paused,
      actor: `agent:${asg}`,
      mode: "request",
    }).success,
  );
});

Deno.test("lophn-agent/conversation#R14: paused request stays unrun until the person chooses it", () => {
  assert(messageSchema.safeParse(paused).success);
  assert(
    receiveMessageInputSchema.safeParse({
      id: msg,
      session: ses,
      body,
      mode: "request",
    }).success,
  );
  assertEquals(Object.keys(receiveMessageCompareSchema.shape).sort(), [
    "assignment_revision",
    "assignment_state",
    "session_state",
    "session_state_seq",
  ]);
  assert(
    receiveMessageCompareSchema.safeParse({
      session_state: "open",
      session_state_seq: "2",
      assignment_revision: 3,
      assignment_state: "paused",
    }).success,
  );
  assert(
    !receiveMessageCompareSchema.safeParse({
      session_state: "open",
      session_state_seq: "2",
      assignment_revision: "3",
      assignment_state: "paused",
    }).success,
  );
  assert(
    !receiveMessageCompareSchema.safeParse({
      session_state: "closed",
      session_state_seq: "2",
      assignment_revision: 3,
      assignment_state: "enabled",
    }).success,
  );
  const choice = {
    assignment_revision: 4,
    assignment_state: "enabled",
    session_state: "open",
    session_state_seq: "8",
    message_state_seq: "8",
    actor: "user",
    mode: "request",
    run: null,
    applied_at_call: null,
  };
  assert(executeStoredRequestCompareSchema.safeParse(choice).success);
  assert(
    !executeStoredRequestCompareSchema.safeParse({
      ...choice,
      assignment_state: "paused",
    }).success,
  );
  assert(
    !executeStoredRequestCompareSchema.safeParse({ ...choice, run }).success,
  );
  assert(
    !executeStoredRequestCompareSchema.safeParse({
      ...choice,
      mode: "correction",
    }).success,
  );
  assert(
    !executeStoredRequestCompareSchema.safeParse({
      ...choice,
      resume: true,
    }).success,
  );
  assertEquals(executeStoredRequest.input.shape.message !== undefined, true);
});

Deno.test("lophn-agent/conversation#R9: continuation does not copy a message or its links", () => {
  assert(
    !receiveMessageInputSchema.safeParse({
      id: msg,
      session: ses,
      body,
      mode: "request",
      continued_from: { session: ses, through_seq: "1" },
    }).success,
  );
  assert(
    !messageSchema.safeParse({
      ...paused,
      links: [{ kind: "session", session: ses }],
    }).success,
  );
});

Deno.test("lophn-agent/conversation#R16: message route does not carry a work place", () => {
  assert(
    !receiveMessageInputSchema.safeParse({
      id: msg,
      session: ses,
      body,
      mode: "request",
      work_place: { kind: "app", id: app },
    }).success,
  );
  assert(
    !recordMessageInputSchema.safeParse({
      id: msg,
      session: ses,
      run,
      body,
      links: [],
      work_place: { kind: "global", id: null },
    }).success,
  );
});

Deno.test("lophn-agent/conversation#R17: message assign compare is run seq, not a place change", () => {
  assert(
    !assignMessageInputSchema.safeParse({
      message: msg,
      run,
      work_place: { kind: "global", id: null },
    }).success,
  );
  assert(
    assignMessageCompareSchema.safeParse({
      previous_run: null,
      message_state_seq: "4",
      applied_at_call: null,
    }).success,
  );
});
