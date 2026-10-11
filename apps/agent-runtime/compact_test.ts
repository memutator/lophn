import { assert, assertEquals } from "@std/assert";
import {
  canonicalize,
  createIdSource,
  err,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../packages/base/mod.ts";
import {
  type CallModel,
  compactSession,
  failSessionCompact,
  finishModelCall,
  modelCallList,
  type ModelChoice,
  sessionCompactRequests,
  startModelCall,
} from "../../packages/contracts/lophn-agent/mod.ts";
import { routePath } from "../../packages/contracts/platform/mod.ts";
import type { ModelCallOutput } from "../../packages/lophn-agent/harness/provider/work.ts";
import { summaryOutputCap } from "../../packages/lophn-agent/harness/prompt-assemble/mod.ts";
import { type Compactor, createCompactor } from "./compact.ts";
import type { CoreCall } from "./core-call.ts";
import type { ModelBinding } from "./model-binding.ts";
import { startRunPump } from "./product-driver.ts";
import type { RunDriver } from "./run-driver.ts";
import {
  ASG,
  MODEL,
  MSGS,
  openWorld,
  PRJ,
  PVD,
  PVD2,
  reply,
  SES,
  type SessionMessageFixture,
  type WorldOptions,
} from "./testing/world.ts";

// Compact의 요약 call(lophn-agent/conversation#R10, harness/prompt-assemble#R19–R22, harness/model#R8).
// 사람이 요청한 Compact를 runtime이 session의 앞 구간을 요약하는 model call로 하고 CompactSession으로
// 끝낸다. 실제 provider와 core를 부르지 않는다: core는 가짜 route이고 model은 정해 둔 답을 준다.

const REQUEST_SEQ = "20";

const TALK: SessionMessageFixture[] = [
  { id: MSGS(0), seq: "10", actor: "user", text: "Please draft the notes." },
  { id: MSGS(1), seq: "11", actor: "agent", text: "I drafted the notes." },
  { id: MSGS(2), seq: "12", actor: "user", text: "Use the short form." },
  { id: MSGS(3), seq: "13", actor: "agent", text: "Done, short form." },
];

type Sent = { choice: ModelChoice; body: Record<string, unknown> };

function bindingFor(
  choice: ModelChoice,
  limits: CallModel["limits"],
  sent: Sent[],
  script: ModelCallOutput[],
): ModelBinding {
  return {
    call: {
      provider: choice.provider,
      name: choice.model_name,
      protocol: "openai-responses",
      credential_key: null,
      credential_revision: null,
      option_values: { requested: {}, applied: {} },
      limits,
      catalog_basis: {},
      price_basis: null,
      billing_route: "unknown",
    },
    endpoint: "http://127.0.0.1:9",
    usageRevision: "unknown",
    timeoutMs: null,
    pack: (request) => ({
      body: {
        instructions: request.system.map((block) => block.text).join("\n"),
        input: request.messages,
        tools: request.tools,
      },
      opaque_bytes: 0,
    }),
    invoke: (input) => {
      sent.push({ choice, body: input.body });
      const next = script.shift();
      return Promise.resolve(
        next === undefined
          ? err({ code: "unavailable", message: "no scripted answer" })
          : ok(next),
      );
    },
    available: () => Promise.resolve(true),
  };
}

function answer(
  text: string,
  kind: "complete" | "failed" = "complete",
): ModelCallOutput {
  return {
    id: "mcl_unused",
    outcome: {
      kind,
      code: kind === "failed" ? "temporary" : null,
      retry_at: null,
      finish_reason: kind === "complete" ? "end_turn" : null,
      http_status: kind === "complete" ? 200 : 503,
      provider_code: null,
    },
    text: kind === "complete" ? text : "",
    toolCalls: [],
    durationMs: 10,
    firstOutputMs: 5,
  };
}

type Rig = Awaited<ReturnType<typeof rig>>;

const BIG = {
  context_limit: 128000,
  input_limit: 120000,
  output_limit: 8000,
  supports_tools: true,
};

function rig(
  options: WorldOptions & {
    script: ModelCallOutput[];
    limits?: CallModel["limits"];
    requests?: "none" | "one";
    unavailable?: boolean;
    redact?: (text: string) => string | null;
    // CompactSession이 거절하는 이유. 없으면 받아들인다.
    refuse?: "conflict";
  },
) {
  const world = openWorld({
    workspaceModels: { lophn: MODEL() },
    sessionMessages: TALK,
    ...options,
  });
  const sent: Sent[] = [];
  const resolved: ModelChoice[] = [];
  const commands: { name: string; input: Record<string, unknown> }[] = [];
  const calls = new Map<string, Record<string, unknown>>();
  const script = [...options.script];

  const machine: CoreCall = (path, body) => {
    if (path === routePath(sessionCompactRequests)) {
      return reply(sessionCompactRequests.output, {
        requests: options.requests === "none" ? [] : [{
          session: SES,
          assignment: ASG,
          work_place: { kind: "project", id: PRJ },
          request_seq: REQUEST_SEQ,
        }],
        as_of_seq: "30",
        next_cursor: null,
      });
    }
    if (path === routePath(modelCallList)) {
      return reply(modelCallList.output, {
        calls: [...calls.values()],
        as_of_seq: "30",
        next_cursor: null,
      });
    }
    const envelope = body as { input: Record<string, unknown> };
    if (path === routePath(startModelCall)) {
      commands.push({ name: "StartModelCall", input: envelope.input });
      const call = envelope.input["call"] as Record<string, unknown>;
      calls.set(String(call["id"]), call);
      return reply(startModelCall.output, { call });
    }
    if (path === routePath(finishModelCall)) {
      commands.push({ name: "FinishModelCall", input: envelope.input });
      const done = envelope.input;
      const started = calls.get(String(done["call"]))!;
      const finished = {
        ...started,
        output: done["output"],
        state: "finished",
        finished_at: "2026-10-06T00:00:01.000Z",
        duration_ms: done["duration_ms"],
        first_output_ms: done["first_output_ms"],
        outcome: done["outcome"],
        usage: done["usage"],
        cost: done["cost"],
      };
      calls.set(String(done["call"]), finished);
      return reply(finishModelCall.output, { call: finished });
    }
    if (path === routePath(compactSession)) {
      commands.push({ name: "CompactSession", input: envelope.input });
      if (options.refuse === "conflict") {
        return Promise.resolve(
          err({ code: "conflict", message: "a run of the session started" }),
        );
      }
      return reply(compactSession.output, {
        id: SES,
        compaction: {
          through_seq: envelope.input["through_seq"],
          summary_call: envelope.input["summary_call"],
        },
        state_seq: "31",
      });
    }
    if (path === routePath(failSessionCompact)) {
      commands.push({ name: "FailSessionCompact", input: envelope.input });
      return reply(failSessionCompact.output, {
        id: SES,
        request_seq: REQUEST_SEQ,
        reason: envelope.input["reason"],
      });
    }
    return world.calls.machine(path, body);
  };

  const compactor = createCompactor({
    clock: manualClock(Date.parse("2026-10-06T00:00:00.000Z")),
    ids: createIdSource({
      clock: manualClock(Date.parse("2026-10-06T00:00:00.000Z")),
      random: seededRandom(7),
    }),
    machine,
    blobs: world.calls.blobs,
    redact: (text) => Promise.resolve((options.redact ?? ((t) => t))(text)),
    resolveModel(input): Promise<Result<ModelBinding>> {
      resolved.push(input.model);
      return Promise.resolve(
        options.unavailable
          ? err({ code: "unavailable", message: "the provider is turned off" })
          : ok(
            bindingFor(input.model, options.limits ?? BIG, sent, script),
          ),
      );
    },
  });
  const named = (name: string) =>
    commands.filter((command) => command.name === name).map((command) =>
      command.input
    );
  return { world, compactor, sent, resolved, commands, calls, named };
}

function started(r: Rig): Record<string, unknown>[] {
  return r.named("StartModelCall").map((input) =>
    input["call"] as Record<string, unknown>
  );
}

Deno.test("lophn-agent/conversation#R10 [agent-I16b]: with no open request the runtime does nothing and calls no model", async () => {
  const r = await rig({ script: [], requests: "none" });
  assertEquals(await r.compactor.next(), { kind: "idle" });
  assertEquals(r.resolved, []);
  assertEquals(r.commands, []);
});

Deno.test("lophn-agent/harness/model#R8 [agent-I16b]: the summary call uses the Model for summaries when one is set", async () => {
  const summaries = MODEL(PVD2, "summary-model");
  const r = await rig({
    summariesModel: summaries,
    sessionModel: MODEL(PVD, "picked-in-composer"),
    script: [answer("Decided: short form.")],
  });
  const result = await r.compactor.next();
  // 요약 model은 session agent의 model이나 composer에서 고른 model이 아니다.
  assertEquals(r.resolved, [summaries]);
  assertEquals(r.sent.map((item) => item.choice), [summaries]);
  const [call] = started(r);
  assertEquals(
    (call!["model"] as { provider: string; name: string }).provider,
    PVD2,
  );
  assertEquals((call!["model"] as { name: string }).name, "summary-model");
  assertEquals(result.kind, "compacted");
});

Deno.test("lophn-agent/harness/model#R8 [agent-I16b]: an empty summaries slot takes the session agent's model, the model picked for the session first", async () => {
  const agent = await rig({
    script: [answer("Decided.")],
  });
  await agent.compactor.next();
  assertEquals(agent.resolved, [MODEL()]);

  const picked = await rig({
    sessionModel: MODEL(PVD2, "picked-in-composer"),
    script: [answer("Decided.")],
  });
  await picked.compactor.next();
  assertEquals(picked.resolved, [MODEL(PVD2, "picked-in-composer")]);
});

Deno.test("lophn-agent/conversation#R10 [agent-I16b]: a session with no run is summarized, the call names the session and no run or agent, and CompactSession ends the request", async () => {
  // 이 가짜 core에는 run이 하나도 없다(Fork 직후의 session과 같다). 요약은 run을 읽지 않는다.
  const r = await rig({ script: [answer("Decided: short form.")] });
  const result = await r.compactor.next();
  const [call] = started(r);
  assertEquals(call!["run"], null);
  assertEquals(call!["session"], SES);
  assertEquals(call!["agent_hash"], null);
  assertEquals(call!["model_use"], "organizing");
  assertEquals(call!["purpose"], "conversation_compression");
  assertEquals(call!["attempt_order"], 1);
  assertEquals(call!["attempt_kind"], "initial");
  // 요약 입력에는 session의 원문이 순서대로 있다.
  const input = JSON.stringify(r.sent[0]!.body);
  const order = TALK.map((message) => input.indexOf(message.text));
  assert(order.every((index) => index >= 0));
  assertEquals(order, [...order].sort((a, b) => a - b));

  const compacts = r.named("CompactSession");
  assertEquals(compacts, [{
    session: SES,
    summary_call: call!["id"],
    through_seq: "13",
  }]);
  assertEquals(result, {
    kind: "compacted",
    session: SES,
    request: REQUEST_SEQ,
    summary_call: String(call!["id"]),
  });
  assertEquals(r.named("FailSessionCompact"), []);
  // 끝난 call에는 출력 본문이 있다.
  const [finish] = r.named("FinishModelCall");
  assert(finish!["output"] !== null);
  assertEquals(
    (finish!["outcome"] as { kind: string }).kind,
    "complete",
  );
});

Deno.test("lophn-agent/harness/prompt-assemble#R19 [agent-I16b]: a second Compact summarizes the earlier summary and only the messages after its span", async () => {
  const r = await rig({
    compaction: {
      through_seq: "11",
      summary_call: "mcl_01arz3ndektsv4rrffq69g5fav",
      text: "OLD SUMMARY",
    },
    script: [answer("NEW SUMMARY")],
  });
  await r.compactor.next();
  const input = JSON.stringify(r.sent[0]!.body);
  assert(input.includes("OLD SUMMARY"));
  assert(input.includes("Use the short form."));
  assert(!input.includes("Please draft the notes."));
  assert(!input.includes("I drafted the notes."));
  assertEquals(r.named("CompactSession")[0]!["through_seq"], "13");
});

// 입력 예산 20,000이면 요약 상한은 2,000 token(UTF-8 byte)이다(R13·R20).
const SMALL_INPUT: CallModel["limits"] = {
  context_limit: 128000,
  input_limit: 20000,
  output_limit: 8000,
  supports_tools: true,
};
const CAP = summaryOutputCap(20000);

Deno.test("lophn-agent/harness/prompt-assemble#R20 [agent-I16b]: a summary exactly at the cap of 2,000 tokens is kept as it is in one call", async () => {
  const exact = "a".repeat(CAP - 1) + ".";
  assertEquals(new TextEncoder().encode(exact).length, CAP);
  const r = await rig({ limits: SMALL_INPUT, script: [answer(exact)] });
  const result = await r.compactor.next();
  assertEquals(r.sent.length, 1);
  assertEquals(result.kind, "compacted");
  assertEquals(
    r.named("CompactSession")[0]!["summary_call"],
    started(r)[0]!["id"],
  );
});

Deno.test("lophn-agent/harness/prompt-assemble#R20 [agent-I16b]: a summary one byte over the cap of 2,000 tokens is shortened again, never cut, and the shortened call is the summary", async () => {
  const long = "a".repeat(CAP) + ".";
  assertEquals(new TextEncoder().encode(long).length, CAP + 1);
  const r = await rig({
    limits: SMALL_INPUT,
    script: [answer(long), answer("Decided: short.")],
  });
  const result = await r.compactor.next();
  assertEquals(r.sent.length, 2);
  // 두 번째 요청은 첫 결과를 주고 줄이게 한다.
  assert(JSON.stringify(r.sent[1]!.body).includes("a".repeat(CAP)));
  const calls = started(r);
  assertEquals(calls.map((call) => call["attempt_order"]), [1, 2]);
  assertEquals(result.kind, "compacted");
  assertEquals(r.named("CompactSession")[0]!["summary_call"], calls[1]!["id"]);
});

Deno.test("lophn-agent/conversation#R10 [agent-I16b]: a summary that stays over the cap of 2,000 tokens fails the request and leaves the session alone", async () => {
  const long = "a".repeat(CAP) + ".";
  const r = await rig({
    limits: SMALL_INPUT,
    script: [answer(long), answer(long), answer(long)],
  });
  const result = await r.compactor.next();
  // 처음과 재축소 둘로 멈춘다.
  assertEquals(r.sent.length, 3);
  assertEquals(result, {
    kind: "failed",
    session: SES,
    request: REQUEST_SEQ,
    reason: "summary_too_long",
  });
  assertEquals(r.named("CompactSession"), []);
  assertEquals(r.named("FailSessionCompact"), [{
    session: SES,
    reason: "summary_too_long",
  }]);
});

Deno.test("lophn-agent/conversation#R10 [agent-I16b]: a model failure closes the request, records the call and never calls CompactSession", async () => {
  const r = await rig({ script: [answer("", "failed")] });
  const result = await r.compactor.next();
  assertEquals(result, {
    kind: "failed",
    session: SES,
    request: REQUEST_SEQ,
    reason: "model_failed",
  });
  assertEquals(r.named("CompactSession"), []);
  assertEquals(r.named("FailSessionCompact"), [{
    session: SES,
    reason: "model_failed",
  }]);
  // 실패한 call도 기록으로 남고, 출력이 없다.
  const [finish] = r.named("FinishModelCall");
  assertEquals((finish!["outcome"] as { kind: string }).kind, "failed");
  assertEquals(finish!["output"], null);
});

Deno.test("lophn-agent/harness/model#R20 [agent-I16b]: a model that cannot be used fails the request without a call and without falling back to another model", async () => {
  const r = await rig({
    summariesModel: MODEL(PVD2, "summary-model"),
    unavailable: true,
    script: [answer("never sent")],
  });
  const result = await r.compactor.next();
  assertEquals(result, {
    kind: "failed",
    session: SES,
    request: REQUEST_SEQ,
    reason: "model_unavailable",
  });
  // 요약용 model을 따로 골랐으면 그 실패를 agent model로 바꿔 처리하지 않는다.
  assertEquals(r.resolved, [MODEL(PVD2, "summary-model")]);
  assertEquals(r.sent, []);
  assertEquals(started(r), []);
  assertEquals(r.named("FailSessionCompact").length, 1);
});

Deno.test("lophn-agent/conversation#R10 [agent-I16b]: nothing after the earlier span, or a session that changed meanwhile, fails the request with its reason", async () => {
  const empty = await rig({
    compaction: {
      through_seq: "13",
      summary_call: "mcl_01arz3ndektsv4rrffq69g5fav",
      text: "OLD SUMMARY",
    },
    script: [],
  });
  assertEquals(await empty.compactor.next(), {
    kind: "failed",
    session: SES,
    request: REQUEST_SEQ,
    reason: "nothing_to_summarize",
  });
  assertEquals(empty.resolved, []);

  // 요약하는 사이 run이 시작돼 core가 끝내기를 거절하면 요약을 쓰지 않는다.
  const busy = await rig({
    script: [answer("Decided.")],
    refuse: "conflict",
  });
  assertEquals(await busy.compactor.next(), {
    kind: "failed",
    session: SES,
    request: REQUEST_SEQ,
    reason: "session_changed",
  });
  assertEquals(busy.named("FailSessionCompact"), [{
    session: SES,
    reason: "session_changed",
  }]);
});

Deno.test("lophn-agent/harness/prompt-assemble#R15 [agent-I16b]: material over half of the input budget is summarized in ordered chunks that carry the earlier summary, and no message is dropped", async () => {
  const messages: SessionMessageFixture[] = Array.from(
    { length: 6 },
    (_, index) => ({
      id: MSGS(index),
      seq: String(10 + index),
      actor: index % 2 === 0 ? "user" as const : "agent" as const,
      text: `M${index}-${"x".repeat(700)}`,
    }),
  );
  const r = await rig({
    sessionMessages: messages,
    // 입력 예산이 작아 한 번에 담지 못한다.
    limits: {
      context_limit: 6000,
      input_limit: 4000,
      output_limit: 2000,
      supports_tools: true,
    },
    script: [
      answer("PART ONE SUMMARY"),
      answer("PART TWO SUMMARY"),
      answer("PART THREE SUMMARY"),
      answer("PART FOUR SUMMARY"),
      answer("PART FIVE SUMMARY"),
      answer("PART SIX SUMMARY"),
    ],
  });
  const result = await r.compactor.next();
  assertEquals(result.kind, "compacted");
  assert(r.sent.length > 1);
  const inputs = r.sent.map((item) => JSON.stringify(item.body));
  // 모든 원문이 어느 call에서든 정확히 한 번 요약에 들어간다.
  for (let index = 0; index < messages.length; index++) {
    const holders = inputs.filter((input) => input.includes(`M${index}-`));
    assertEquals(holders.length, 1, `message ${index}`);
  }
  // 둘째 call부터 앞 call의 요약을 이어받는다.
  assert(inputs[1]!.includes("PART ONE SUMMARY"));
  // 마지막 call이 요약이다.
  const calls = started(r);
  assertEquals(
    r.named("CompactSession")[0]!["summary_call"],
    calls[calls.length - 1]!["id"],
  );
  assertEquals(r.named("CompactSession")[0]!["through_seq"], "15");
  assertEquals(
    calls.map((call) => call["attempt_order"]),
    calls.map((_, index) => index + 1),
  );
});

Deno.test("lophn-agent/harness/prompt-assemble#R15 [agent-I16b]: a message too large for one call fails the request without cutting it or calling a model", async () => {
  const r = await rig({
    sessionMessages: [{
      id: MSGS(0),
      seq: "10",
      actor: "user",
      text: "y".repeat(5000),
    }],
    limits: {
      context_limit: 6000,
      input_limit: 4000,
      output_limit: 2000,
      supports_tools: true,
    },
    script: [answer("never sent")],
  });
  assertEquals(await r.compactor.next(), {
    kind: "failed",
    session: SES,
    request: REQUEST_SEQ,
    reason: "too_large",
  });
  assertEquals(r.sent, []);
  assertEquals(started(r), []);
  assertEquals(r.named("CompactSession"), []);
});

Deno.test("platform/redaction [agent-I16b]: the messages are made safe before they are sent and the stored input is the sent input", async () => {
  const r = await rig({
    sessionMessages: [
      { id: MSGS(0), seq: "10", actor: "user", text: "the token is SECRET-1" },
    ],
    redact: (text) => text.replaceAll("SECRET-1", "[redacted]"),
    script: [answer("Decided.")],
  });
  await r.compactor.next();
  const input = JSON.stringify(r.sent[0]!.body);
  assert(!input.includes("SECRET-1"));
  assert(input.includes("[redacted]"));
  const stored = r.world.blobs.filter((blob) =>
    blob.purpose === "model_call_input"
  );
  assertEquals(stored.length, 1);
  // 저장은 정규 JSON이라 키 순서만 다르다.
  assertEquals(canonicalize(stored[0]!.value), canonicalize(r.sent[0]!.body));
});

Deno.test("lophn-agent/conversation#R10 [agent-I16b]: the pump asks the compactor for the next request each round and one failure does not end it", async () => {
  const stop = new AbortController();
  let rounds = 0;
  const compactor: Compactor = {
    next() {
      rounds++;
      if (rounds === 1) return Promise.reject(new Error("one bad round"));
      if (rounds >= 3) stop.abort();
      return Promise.resolve({ kind: "idle" });
    },
  };
  const driver = {
    startNext: () => Promise.resolve({ kind: "idle" as const }),
  } as unknown as RunDriver;
  await startRunPump({ driver, compactor, signal: stop.signal, idleMs: 1 });
  assert(rounds >= 3);
});
