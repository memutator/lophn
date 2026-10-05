import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../platform/mod.ts";
import {
  MESSAGE_TEXT_CONTENT_MAX_BYTES,
  serializeMessageContent,
} from "./message-content.ts";
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
  messageBody,
  messageBodyInputSchema,
  messageBodyOutputSchema,
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
  content,
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

Deno.test("lophn-agent/conversation#R3: seven message routes and four events reject a closed compare", () => {
  assertEquals(MESSAGE_ROUTES.map(routePath), [
    "/v1/messages/receive",
    "/v1/messages/execute-stored",
    "/v1/messages/record",
    "/v1/messages/apply",
    "/v1/messages/assign",
    "/v1/messages/list",
    "/v1/messages/body",
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
  assertEquals(messageBody.actors, ["user", "agent", "machine"]);
  assert(!messagesList.errors.includes("conflict"));
  assert(!messageBody.errors.includes("conflict"));
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
      content,
      mode: "correction",
      run,
    }).success,
  );
  assert(
    !receiveMessageInputSchema.safeParse({
      id: msg,
      session: ses,
      content,
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
      content,
      links,
    }).success,
  );
  assert(
    !recordMessageInputSchema.safeParse({
      id: msg,
      session: ses,
      run,
      content,
      links: [{ kind: "document", document: doc, created: true }],
    }).success,
  );
  assert(
    !recordMessageInputSchema.safeParse({
      id: msg,
      session: ses,
      run,
      content,
      links: [{ kind: "plan", document: doc }],
    }).success,
  );
  assert(
    !recordMessageInputSchema.safeParse({
      id: msg,
      session: ses,
      run,
      content,
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
      content,
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
      content,
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
      content,
      mode: "request",
      work_place: { kind: "app", id: app },
    }).success,
  );
  assert(
    !recordMessageInputSchema.safeParse({
      id: msg,
      session: ses,
      run,
      content,
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

Deno.test("lophn-agent/conversation#R2: a request carries the message value, never a hash or a prepared blob", () => {
  const base = { id: msg, session: ses, mode: "request" } as const;
  assert(receiveMessageInputSchema.safeParse({ ...base, content }).success);
  // 호출자는 hash도 준비 증거도 만들지 않는다(plan Q29).
  assert(!receiveMessageInputSchema.safeParse({ ...base, body }).success);
  assert(
    !receiveMessageInputSchema.safeParse({ ...base, content, body }).success,
  );
  assert(
    !receiveMessageInputSchema.safeParse({
      ...base,
      content,
      prepared: { preparation: "p", principal: "u", purpose: "x" },
    }).success,
  );
  const record = { id: msg, session: ses, run, links: [] };
  assert(recordMessageInputSchema.safeParse({ ...record, content }).success);
  assert(!recordMessageInputSchema.safeParse({ ...record, body }).success);
});

Deno.test("lophn-agent/conversation#R4: a person's message holds text parts only and is bounded", () => {
  const text = (value: string) => ({
    schema_version: 1,
    parts: [{ kind: "text", text: value }],
  });
  const base = { id: msg, session: ses, mode: "request" } as const;
  const send = (value: unknown) =>
    receiveMessageInputSchema.safeParse({ ...base, content: value }).success;
  assert(send(text("한 줄")));
  assert(!send({ schema_version: 1, parts: [] }));
  assert(!send({ schema_version: 2, parts: text("x").parts }));
  assert(
    !send({
      schema_version: 1,
      parts: [{ kind: "visual", block: { key: "a" } }],
    }),
  );
  // 정규 직렬화 상한 안과 밖.
  const fits = "a".repeat(MESSAGE_TEXT_CONTENT_MAX_BYTES - 100);
  assert(send(text(fits)));
  assert(!send(text("a".repeat(MESSAGE_TEXT_CONTENT_MAX_BYTES))));
  // UTF-8 바이트로 센다: 글자 수가 같아도 한글은 3배다.
  assert(!send(text("가".repeat(MESSAGE_TEXT_CONTENT_MAX_BYTES / 3))));
  assertEquals(
    serializeMessageContent(text("b")),
    new TextEncoder().encode(
      '{"parts":[{"kind":"text","text":"b"}],"schema_version":1}',
    ),
  );
});

Deno.test("lophn-agent/conversation#R2: the body read names one message and returns the value with its hash", () => {
  assertEquals(messageBody.resource, "messages");
  assertEquals(messageBody.method, "body");
  assert(messageBodyInputSchema.safeParse({ message: msg }).success);
  assert(!messageBodyInputSchema.safeParse({ message: ses }).success);
  assert(
    !messageBodyInputSchema.safeParse({ message: msg, session: ses }).success,
  );
  const output = {
    message: msg,
    session: ses,
    body,
    size_bytes: 57,
    content,
    as_of_seq: "4",
    next_cursor: null,
  };
  assert(messageBodyOutputSchema.safeParse(output).success);
  assert(
    !messageBodyOutputSchema.safeParse({ ...output, body: "short" }).success,
  );
  assert(
    !messageBodyOutputSchema.safeParse({ ...output, content: undefined })
      .success,
  );
});
