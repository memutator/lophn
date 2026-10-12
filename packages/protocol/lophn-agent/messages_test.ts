import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../base/route.ts";
import {
  MESSAGE_TEXT_CONTENT_MAX_BYTES,
  serializeMessageContent,
} from "./message-content.ts";
import {
  applyMessages,
  assignMessage,
  assignMessageCompareSchema,
  assignMessageInputSchema,
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

const ctx = apr.replace("apr_", "ctx_");

const unassigned = {
  id: msg,
  session: ses,
  actor: "user",
  body,
  run: null,
  mode: "request",
  applied_at_call: null,
  links: [],
  copied_from: null,
};

Deno.test("lophn-agent/conversation#R3: six message routes and four events reject a closed compare", () => {
  assertEquals(MESSAGE_ROUTES.map(routePath), [
    "/v1/messages/receive",
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
  assert(messageSchema.safeParse(unassigned).success);
  assert(
    messageSchema.safeParse({
      ...unassigned,
      mode: "correction",
      run,
    }).success,
  );
  assert(!messageSchema.safeParse({ ...unassigned, mode: null }).success);
  assert(
    !messageSchema.safeParse({
      ...unassigned,
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

Deno.test("lophn-agent/conversation#R4 [ctx-I58j]: a context link names one context and nothing else", () => {
  const record = (links: unknown[]) =>
    recordMessageInputSchema.safeParse({
      id: msg,
      session: ses,
      run,
      content,
      links,
    }).success;
  assert(record([{ kind: "context", context: ctx }]));
  assert(!record([{ kind: "context", context: doc }]));
  assert(!record([{ kind: "context" }]));
  assert(!record([{ kind: "context", context: ctx, project: "prj" }]));
  // 읽는 쪽(저장된 message)은 모르는 필드를 막지 않지만 kind와 context ID는 확인한다.
  const stored = (links: unknown[]) =>
    messageSchema.safeParse({
      id: msg,
      session: ses,
      actor: `agent:${asg}`,
      body,
      run,
      mode: null,
      applied_at_call: null,
      links,
      copied_from: null,
    }).success;
  assert(stored([{ kind: "context", context: ctx }]));
  assert(!stored([{ kind: "context", context: doc }]));
});

Deno.test("lophn-agent/conversation#R4: links are real targets and a plan is not a created link", () => {
  const links = [
    { kind: "document", document: doc },
    { kind: "version", document: doc, version: ver },
    { kind: "question", question: qst },
    { kind: "approval_request", approval_request: apr },
    { kind: "context", context: ctx },
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
      ...unassigned,
      actor: "machine",
      mode: null,
      run,
      links,
    }).success,
  );
  assert(
    !messageSchema.safeParse({
      ...unassigned,
      actor: `agent:${asg}`,
      mode: "request",
    }).success,
  );
});

Deno.test("lophn-agent/conversation#R8: paused and withdrawn assignments take no new input", () => {
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
  const compare = {
    session_state: "open",
    session_state_seq: "2",
    assignment_revision: 3,
    assignment_state: "enabled",
  };
  assert(receiveMessageCompareSchema.safeParse(compare).success);
  for (const assignment_state of ["paused", "withdrawn"]) {
    assert(
      !receiveMessageCompareSchema.safeParse({ ...compare, assignment_state })
        .success,
    );
  }
  assert(
    !receiveMessageCompareSchema.safeParse({
      ...compare,
      assignment_revision: "3",
    }).success,
  );
  assert(
    !receiveMessageCompareSchema.safeParse({
      ...compare,
      session_state: "closed",
    }).success,
  );
  // 보존한 요청을 사람이 골라 실행하는 길은 없다(paused에서는 입력을 받지 않는다).
  assert(!MESSAGE_ROUTES.some((route) => route.method === "execute-stored"));
});

Deno.test("lophn-agent/conversation#R9: a fork copy is a past utterance without run, mode or application", () => {
  const original = "msg_01arz3ndektsv4rrffq69g5faw";
  const copy = {
    ...unassigned,
    mode: null,
    copied_from: original,
  };
  assert(messageSchema.safeParse(copy).success);
  // 복사본은 지난 발언이다: 새 run이나 correction의 대상, 미반영 입력이 되지 않는다.
  assert(!messageSchema.safeParse({ ...copy, mode: "request" }).success);
  assert(!messageSchema.safeParse({ ...copy, run }).success);
  assert(!messageSchema.safeParse({ ...copy, applied_at_call: mcl }).success);
  assert(
    messageSchema.safeParse({
      ...copy,
      actor: `agent:${asg}`,
    }).success,
  );
  // 입력 접수에는 복사 출처가 없다: 복사는 ForkSession만 한다.
  assert(
    !receiveMessageInputSchema.safeParse({
      id: msg,
      session: ses,
      content,
      mode: "request",
      copied_from: original,
    }).success,
  );
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
      ...unassigned,
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

Deno.test("lophn-agent/conversation#R16: message assign compare is run seq, not a place change", () => {
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
