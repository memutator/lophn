import assert from "node:assert/strict";
import { test } from "node:test";
import { runWithFallback } from "./fallback.ts";
import { createFlowRuntime } from "./runtime.ts";
import {
  type Checkpoint,
  FLOW_PORT,
  type FlowEvent,
  type FlowPort,
  type Outcome,
  parseStartLine,
  type WireRequestBody,
} from "./wire.ts";

function makeMockPort(options?: {
  checkpoints?: Checkpoint[];
  onRequest?: (body: WireRequestBody) => Promise<Outcome> | Outcome;
}) {
  const sent: WireRequestBody[] = [];
  const listeners = new Map<string, (event: FlowEvent) => void>();
  const port: FlowPort = {
    instance: "wfi_test",
    input: "hello",
    inputs: Object.freeze({ mode: "full" }),
    checkpoints: Object.freeze([...(options?.checkpoints ?? [])]),
    async request(body) {
      sent.push(body);
      if (options?.onRequest !== undefined) {
        return await options.onRequest(body);
      }
      return { ok: true, result: null };
    },
    registerEventListener(subscriptionId, handler) {
      listeners.set(subscriptionId, handler);
      return () => {
        if (listeners.get(subscriptionId) === handler) {
          listeners.delete(subscriptionId);
        }
      };
    },
  };
  return {
    port,
    sent,
    emitEvent(subscriptionId: string, event: FlowEvent) {
      listeners.get(subscriptionId)?.(event);
    },
    listenerCount: () => listeners.size,
  };
}

test("parseStartLine populates frozen inputs and checkpoints", () => {
  const withoutExtras = parseStartLine(
    JSON.stringify({ type: "start", instance: "wfi_1", input: "hello" }),
  );
  assert.ok(withoutExtras.ok);
  assert.deepStrictEqual(withoutExtras.value.inputs, {});
  assert.deepStrictEqual(withoutExtras.value.checkpoints, []);
  assert.ok(Object.isFrozen(withoutExtras.value.inputs));
  assert.ok(Object.isFrozen(withoutExtras.value.checkpoints));

  const cp: Checkpoint = {
    instance: "wfi_2",
    key: "plan",
    kind: "step",
    state: "completed",
    handle_ref: null,
    output: { ok: true },
    error: null,
    started_at: "2026-11-23T00:00:00.000Z",
    finished_at: "2026-11-23T00:00:01.000Z",
  };
  const withExtras = parseStartLine(
    JSON.stringify({
      type: "start",
      instance: "wfi_2",
      input: "hello",
      inputs: { mode: "full", budget: 10 },
      checkpoints: [cp],
    }),
  );
  assert.ok(withExtras.ok);
  assert.deepStrictEqual(withExtras.value.inputs, { mode: "full", budget: 10 });
  assert.deepStrictEqual(withExtras.value.checkpoints, [cp]);
});

test("parseStartLine rejects invalid inputs or checkpoints", () => {
  for (const bad of [null, [], "str", 42]) {
    assert.equal(
      parseStartLine(
        JSON.stringify({
          type: "start",
          instance: "wfi_1",
          input: "hello",
          inputs: bad,
        }),
      ).ok,
      false,
    );
  }
  assert.equal(
    parseStartLine(
      JSON.stringify({
        type: "start",
        instance: "wfi_1",
        input: "hello",
        checkpoints: [{ bad: true }],
      }),
    ).ok,
    false,
  );
});

test("step(key, fn) replays completed checkpoint without re-running fn", async () => {
  const mock = makeMockPort({
    checkpoints: [
      {
        instance: "wfi_test",
        key: "analyze",
        kind: "step",
        state: "completed",
        handle_ref: null,
        output: { score: 99 },
        error: null,
        started_at: "2026-11-23T00:00:00.000Z",
        finished_at: "2026-11-23T00:00:01.000Z",
      },
    ],
  });
  const rt = createFlowRuntime(mock.port);
  let ran = false;
  const result = await rt.step("analyze", () => {
    ran = true;
    return { score: 0 };
  });
  assert.equal(ran, false);
  assert.deepStrictEqual(result, { score: 99 });
  assert.equal(mock.sent.length, 0);
});

test("step(key, fn) isolates concurrent AsyncLocalStorage scopes and assigns deterministic sub-keys", async () => {
  const mock = makeMockPort({
    onRequest(body) {
      if (body.type === "agent") {
        return { ok: true, result: { summary: `agent:${body.key}` } };
      }
      if (body.type === "tool") {
        return { ok: true, result: `tool:${body.key}` };
      }
      return { ok: true, result: null };
    },
  });
  const rt = createFlowRuntime(mock.port);
  const tick = () => new Promise<void>((r) => setTimeout(r, 5));

  const [a, b] = await Promise.all([
    rt.step("branch-a", async () => {
      const r1 = await rt.agent({ agent: { agent: "lophn" }, prompt: "p1" });
      await tick();
      const r2 = await rt.tool({ app: "notes", tool: "notes.list" });
      const r3 = await rt.agent({ agent: { agent: "lophn" }, prompt: "p2" });
      return { r1, r2, r3 };
    }),
    rt.step("branch-b", async () => {
      await tick();
      const r1 = await rt.agent({ agent: { agent: "lophn" }, prompt: "p1" });
      const r2 = await rt.tool({ app: "notes", tool: "notes.list" });
      return { r1, r2 };
    }),
  ]);

  assert.equal(a.r1.ok && a.r1.result.summary, "agent:branch-a/agent#1");
  assert.equal(a.r2.ok && a.r2.result, "tool:branch-a/tool#1");
  assert.equal(a.r3.ok && a.r3.result.summary, "agent:branch-a/agent#2");
  assert.equal(b.r1.ok && b.r1.result.summary, "agent:branch-b/agent#1");
  assert.equal(b.r2.ok && b.r2.result, "tool:branch-b/tool#1");

  const begins = mock.sent
    .filter((m) => m.type === "step_begin")
    .map((m) => m.key)
    .sort();
  const ends = mock.sent
    .filter((m) => m.type === "step_end")
    .map((m) => m.key)
    .sort();
  assert.deepStrictEqual(begins, ["branch-a", "branch-b"]);
  assert.deepStrictEqual(ends, ["branch-a", "branch-b"]);
});

test("primitives reject calls outside step() without an explicit key", async () => {
  const mock = makeMockPort();
  const rt = createFlowRuntime(mock.port);

  assert.throws(
    () => rt.agent({ agent: { agent: "lophn" }, prompt: "hi" }),
    /requires an explicit key or must be called inside step/,
  );
  assert.throws(
    () => rt.human({ with: "lophn", prompt: "hi" }),
    /requires an explicit key or must be called inside step/,
  );
  assert.throws(
    () => rt.workflow({ workflow: "child" }),
    /requires an explicit key or must be called inside step/,
  );
  assert.throws(
    () => rt.tool({ app: "notes", tool: "notes.add" }),
    /requires an explicit key or must be called inside step/,
  );
  assert.equal(mock.sent.length, 0);

  // Explicit key works outside step()
  const out = await rt.tool({
    app: "notes",
    tool: "notes.list",
    key: "list-notes",
  });
  assert.equal(out.ok, true);
  assert.equal(mock.sent.length, 1);
  assert.equal(mock.sent[0]!.type, "tool");
  if (mock.sent[0]!.type === "tool") {
    assert.equal(mock.sent[0]!.key, "list-notes");
  }
});

test("AbortSignal sends a cancel frame with matching cancel_id", async () => {
  let resolveAgent!: (outcome: Outcome) => void;
  let capturedCancelId: string | undefined;
  const mock = makeMockPort({
    onRequest(body) {
      if (body.type === "agent") {
        capturedCancelId = body.cancel_id;
        return new Promise((resolve) => {
          resolveAgent = resolve;
        });
      }
      if (body.type === "cancel") {
        resolveAgent({
          ok: false,
          reason: "cancelled",
          message: "aborted by signal",
        });
        return { ok: true, result: null };
      }
      return { ok: true, result: null };
    },
  });
  const rt = createFlowRuntime(mock.port);
  const controller = new AbortController();

  const pending = rt.agent({
    key: "long-task",
    agent: { agent: "lophn" },
    prompt: "work",
    signal: controller.signal,
  });
  assert.ok(capturedCancelId !== undefined);
  controller.abort("stop now");

  const outcome = await pending;
  assert.deepStrictEqual(outcome, {
    ok: false,
    reason: "cancelled",
    message: "aborted by signal",
  });
  const cancelFrame = mock.sent.find((m) => m.type === "cancel");
  assert.ok(cancelFrame !== undefined && cancelFrame.type === "cancel");
  assert.equal(cancelFrame.cancel_id, capturedCancelId);

  // Pre-aborted signal returns cancelled immediately without sending wire frames
  const before = mock.sent.length;
  const preAborted = await rt.tool({
    key: "never-sent",
    app: "notes",
    tool: "notes.list",
    signal: AbortSignal.abort("already gone"),
  });
  assert.deepStrictEqual(preAborted, {
    ok: false,
    reason: "cancelled",
    message: "already gone",
  });
  assert.equal(mock.sent.length, before);
});

test("onEvent subscribes, routes events by subscription_id, and unsubscribes on dispose", () => {
  const mock = makeMockPort();
  const rt = createFlowRuntime(mock.port);
  const received: FlowEvent[] = [];

  const dispose = rt.onEvent(
    { source: "quota", event: "limit_reached" },
    (ev) => {
      received.push(ev);
    },
  );
  const sub = mock.sent.find((m) => m.type === "subscribe");
  assert.ok(sub !== undefined && sub.type === "subscribe");
  assert.equal(sub.source, "quota");
  assert.equal(sub.event, "limit_reached");
  assert.equal(mock.listenerCount(), 1);

  mock.emitEvent(sub.subscription_id, {
    source: "quota",
    event: "limit_reached",
    payload: { remaining: 0 },
  });
  mock.emitEvent("other_sub", {
    source: "quota",
    event: "limit_reached",
    payload: { remaining: 5 },
  });
  assert.equal(received.length, 1);
  assert.deepStrictEqual(received[0]!.payload, { remaining: 0 });

  dispose();
  // Double dispose is idempotent
  dispose();
  assert.equal(mock.listenerCount(), 0);
  const unsubs = mock.sent.filter((m) => m.type === "unsubscribe");
  assert.equal(unsubs.length, 1);
  assert.equal(unsubs[0]!.subscription_id, sub.subscription_id);
});

test("withFallback handles ok pass-through and retry / substitute / throw / escalate", async () => {
  const fallbackAgent = { agent: "helper" };
  let agentCalls = 0;

  // ok pass-through: does not invoke fallback agent
  const okRes = await runWithFallback(
    {
      agent: async () => {
        agentCalls += 1;
        return { ok: true, result: { summary: "{}" } };
      },
      escalate: async () => ({ ok: true, result: undefined }),
    },
    { ok: true, result: 42 },
    { fallbackAgent },
  );
  assert.deepStrictEqual(okRes, { ok: true, result: 42 });
  assert.equal(agentCalls, 0);

  const failed: Outcome<string> = {
    ok: false,
    reason: "stalled",
    message: "worker stalled",
    session: "ses_1",
  };

  // retry
  let retryHint: unknown;
  const retried = await runWithFallback(
    {
      agent: async (req) => {
        assert.deepStrictEqual(req.agent, fallbackAgent);
        return {
          ok: true,
          result: {
            summary: JSON.stringify({ action: "retry", input: "try smaller" }),
          },
        };
      },
      escalate: async () => ({ ok: true, result: undefined }),
    },
    failed,
    {
      fallbackAgent,
      context: "step=build",
      retry: (hint) => {
        retryHint = hint;
        return { ok: true, result: "recovered" };
      },
    },
  );
  assert.equal(retryHint, "try smaller");
  assert.deepStrictEqual(retried, { ok: true, result: "recovered" });

  // substitute
  const substituted = await runWithFallback(
    {
      agent: async () => ({
        ok: true,
        result: {
          summary:
            '```json\n{"action":"substitute","result":"fallback-val"}\n```',
        },
      }),
      escalate: async () => ({ ok: true, result: undefined }),
    },
    failed,
    { fallbackAgent },
  );
  assert.deepStrictEqual(substituted, { ok: true, result: "fallback-val" });

  // throw
  await assert.rejects(
    () =>
      runWithFallback(
        {
          agent: async () => ({
            ok: true,
            result: {
              summary: JSON.stringify({
                action: "throw",
                message: "unrecoverable",
              }),
            },
          }),
          escalate: async () => ({ ok: true, result: undefined }),
        },
        failed,
        { fallbackAgent },
      ),
    /unrecoverable/,
  );

  // escalate
  const escalatedCalls: Array<{ step: string; reason: string }> = [];
  const escalated = await runWithFallback(
    {
      agent: async () => ({
        ok: true,
        result: {
          summary: JSON.stringify({
            action: "escalate",
            step: "review",
            reason: "needs human",
          }),
        },
      }),
      escalate: async (req) => {
        escalatedCalls.push(req);
        return { ok: true, result: undefined };
      },
    },
    failed,
    { fallbackAgent },
  );
  assert.deepStrictEqual(escalatedCalls, [
    { step: "review", reason: "needs human" },
  ]);
  assert.deepStrictEqual(escalated, {
    ok: false,
    reason: "stalled",
    message: "needs human",
    session: "ses_1",
  });
});

test("mod exports frozen inputs and all 2.0.0 primitives from active flow port", async () => {
  const store = globalThis as Record<symbol, unknown>;
  const previous = store[FLOW_PORT];
  const mock = makeMockPort();
  store[FLOW_PORT] = mock.port;
  try {
    const mod = await import("./mod.ts");
    assert.equal(mod.instance, "wfi_test");
    assert.equal(mod.input, "hello");
    assert.deepStrictEqual(mod.inputs, { mode: "full" });
    assert.ok(Object.isFrozen(mod.inputs));
    for (const name of [
      "step",
      "agent",
      "human",
      "workflow",
      "tool",
      "onEvent",
      "report",
      "escalate",
      "withFallback",
    ] as const) {
      assert.equal(typeof mod[name], "function");
    }
  } finally {
    if (previous === undefined) delete store[FLOW_PORT];
    else store[FLOW_PORT] = previous;
  }
});
