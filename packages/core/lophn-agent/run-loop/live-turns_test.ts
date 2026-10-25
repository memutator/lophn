import { assert, assertEquals } from "@std/assert";
import { type Clock, ok } from "../../../base/mod.ts";
import {
  createKnownSecretRegistry,
  REDACTION_REPLACEMENT,
} from "../../../base/redaction/mod.ts";
import type { AgentEvent } from "../../../protocol/events/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { KnownSecretMatch, Writer } from "../../storage/ledger/mod.ts";
import { createLiveTurns, withLiveTurns } from "./live-turns.ts";

const SESSION = "ses_0aaaaaaaaaaaaaaaaaaaaaaaaa";
const TURN = "trn_0aaaaaaaaaaaaaaaaaaaaaaaaa";
const CALL_A = "mcl_0aaaaaaaaaaaaaaaaaaaaaaaaa";
const CALL_B = "mcl_0bbbbbbbbbbbbbbbbbbbbbbbbb";
const NOW = "2026-01-01T00:00:00.000Z";

const clock: Clock = { now: () => NOW, nowMs: () => 0 };

function matcherOf(
  registry: ReturnType<typeof createKnownSecretRegistry>,
): KnownSecretMatch {
  return {
    ready: true,
    match: (text) => registry.match(text),
    prefixFrom: (text) => registry.prefixFrom(text),
  };
}

function noSecrets(): KnownSecretMatch {
  return {
    ready: true,
    match: () => undefined,
    prefixFrom: () => undefined,
  };
}

Deno.test("두 batch에 걸친 secret도 live delta에 나오지 않는다", () => {
  const registry = createKnownSecretRegistry();
  // 지금 상수로 붙잡는 길이보다 긴 값이다. 상수로 붙잡으면 앞부분이 live 글에 나간다.
  const secret = "q".repeat(340);
  registry.register([secret]);
  const events: AgentEvent[] = [];
  const live = createLiveTurns({
    known: () => matcherOf(registry),
    publish: (event) => events.push(event),
    clock,
  });
  const before = "앞글";
  const after = "뒷글.";
  live.output({
    session: SESSION,
    turn: TURN,
    model_call: CALL_A,
    kind: "text",
    text: before + secret.slice(0, 170),
  });
  live.output({
    session: SESSION,
    turn: TURN,
    model_call: CALL_A,
    kind: "text",
    text: secret.slice(170) + after,
  });

  let offset = 0;
  let joined = "";
  for (const event of events) {
    if (event.type !== "ModelOutputStreamed") continue;
    assertEquals(event.payload.kind, "text");
    assertEquals(event.payload.offset, offset);
    offset += event.payload.text.length;
    joined += event.payload.text;
  }
  assertEquals(joined, before + REDACTION_REPLACEMENT + after);
  assert(!joined.includes(secret.slice(0, 170)));
  assert(!joined.includes(secret.slice(170)));
  assertEquals(live.writing(SESSION)?.text, joined);
});

Deno.test("retry된 attempt의 글은 쓰는 중인 글에 남지 않는다", () => {
  // A 뒤에 B의 조각이 오면 B의 글만 남고, B로 바뀐 뒤 늦게 온 A의 조각은 버린다.
  {
    const events: AgentEvent[] = [];
    const live = createLiveTurns({
      known: noSecrets,
      publish: (event) => events.push(event),
      clock,
    });
    live.output({
      session: SESSION,
      turn: TURN,
      model_call: CALL_A,
      kind: "text",
      text: "first ",
    });
    live.output({
      session: SESSION,
      turn: TURN,
      model_call: CALL_B,
      kind: "text",
      text: "second",
    });
    assertEquals(live.writing(SESSION)?.model_call, CALL_B);
    assertEquals(live.writing(SESSION)?.text, "second");
    const published = events.length;
    live.output({
      session: SESSION,
      turn: TURN,
      model_call: CALL_A,
      kind: "text",
      text: "late",
    });
    assertEquals(events.length, published);
    assertEquals(live.writing(SESSION)?.text, "second");
  }

  // 글이 없는 응답의 tool call이 시작되면 그 turn의 쓰는 중인 글을 버린다.
  {
    const live = createLiveTurns({
      known: noSecrets,
      publish: () => {},
      clock,
    });
    live.output({
      session: SESSION,
      turn: TURN,
      model_call: CALL_A,
      kind: "text",
      text: "first ",
    });
    assert(live.writing(SESSION) !== null);
    live.apply({
      session: SESSION,
      type: "ToolCallStarted",
      at: NOW,
      payload: {
        turn: TURN,
        tool_call: "tcl_0aaaaaaaaaaaaaaaaaaaaaaaaa",
        tool: "shell.run",
        display: { category: "other", title: "shell.run" },
      },
    } as AgentEvent);
    assertEquals(live.writing(SESSION), null);
  }
});

Deno.test("멈추면 사람이 본 글이 turn이 끝나기 전에 agent message로 남는다", async () => {
  const events: AgentEvent[] = [];
  const live = createLiveTurns({
    known: noSecrets,
    publish: (event) => events.push(event),
    clock,
  });
  live.output({
    session: SESSION,
    turn: TURN,
    model_call: CALL_A,
    kind: "text",
    text: "Hello wor",
  });

  const recorded: { command: string; input: unknown }[] = [];
  const writer: Writer = {
    command(_ctx, envelope) {
      recorded.push({ command: envelope.command, input: envelope.input });
      return Promise.resolve(
        ok({
          result: {},
          replayed: false,
          first_seq: null,
          last_seq: null,
        }),
      );
    },
    readResult: () => Promise.resolve(ok(null)),
    close: () => Promise.resolve(),
  };
  const context: AuthenticatedContext = {
    principal: "machine:live-turns",
    actor: "machine",
    scope: { operations: ["RecordMessage"], targets: {} },
    conditions: {},
    credential_ref: "machine:live-turns",
  };
  const wrapped = withLiveTurns(writer, {
    live,
    context,
    writer: () => writer,
    ids: { newId: (prefix) => `${prefix}_0ccccccccccccccccccccccccc` },
    clock,
    publish: (event) => events.push(event),
  });
  const stopped = await wrapped.command(context, {
    command: "StopTurn",
    input: { turn: TURN, request_key: "stop", reason: "user_stopped" },
    idempotency_key: "idk-1",
    compare: { state_seq: "1" },
    prepared: [],
  });
  assert(stopped.ok);

  const record = recorded.findIndex((entry) =>
    entry.command === "RecordMessage"
  );
  const stop = recorded.findIndex((entry) => entry.command === "StopTurn");
  assert(record >= 0 && stop >= 0 && record < stop);
  assertEquals(recorded[record].input, {
    id: "msg_0aaaaaaaaaaaaaaaaaaaaaaaaa",
    session: SESSION,
    turn: TURN,
    content: {
      schema_version: 1,
      parts: [{ kind: "text", text: "Hello wor" }],
    },
  });
  let messageRecorded = 0;
  for (const event of events) {
    if (event.type !== "MessageRecorded") continue;
    messageRecorded += 1;
    assertEquals(event.payload.turn, TURN);
    assertEquals(event.payload.message, "msg_0aaaaaaaaaaaaaaaaaaaaaaaaa");
    assertEquals(event.payload.model_call, CALL_A);
  }
  assertEquals(messageRecorded, 1);
  assertEquals(live.writing(SESSION), null);
});
