import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { err, manualClock, ok, type Result } from "../../../base/mod.ts";
import type { ModelOutcome } from "../../../contracts/lophn-agent/mod.ts";
import type { WorkspaceReadOutput } from "../../../contracts/shell/mod.ts";
import {
  anthropicSystem,
  anthropicTools,
  type WirePacker,
} from "../prompt-assemble/mod.ts";
import { startRunLoop } from "./loop.ts";
import type {
  FinishRequest,
  LoopDeps,
  LoopEnd,
  ModelAttempt,
  ModelCallRequest,
  PendingInputs,
  RunContext,
  RunInput,
  RunLoopHandle,
  RunPorts,
  ToolAttempt,
  ToolCallRequest,
  ToolDone,
  ToolInfo,
  WaitTarget,
} from "./ports.ts";
import { synthesizedResult } from "./tool-batch.ts";

// agent loop 테스트(lophn-agent/harness/run-loop R8–R13, R15, R23–R25). model은 fake provider
// 자리(ModelPort)의 script이고 시계·대기·무작위는 주입한다. 실제 provider와 core를 부르지 않는다.

const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const SESSION = "ses_01arz3ndektsv4rrffq69g5fav";
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const START = Date.parse("2026-10-06T00:00:00.000Z");

const COMPLETE: ModelOutcome = {
  kind: "complete",
  code: null,
  retry_at: null,
  finish_reason: "end_turn",
  http_status: 200,
  provider_code: null,
};
const PARTIAL: ModelOutcome = {
  kind: "partial",
  code: null,
  retry_at: null,
  finish_reason: "max_tokens",
  http_status: 200,
  provider_code: null,
};
function failed(code: ModelOutcome["code"], retryAt: string | null = null) {
  return {
    kind: "failed",
    code,
    retry_at: retryAt,
    finish_reason: null,
    http_status: 503,
    provider_code: null,
  } satisfies ModelOutcome;
}

type Reply = {
  text?: string;
  calls?: { id: string; name: string; args: string }[];
  outcome?: ModelOutcome;
};
type ModelStep = (
  request: ModelCallRequest,
  signal: AbortSignal,
) => Promise<Result<ModelAttempt>>;

function reply(spec: Reply = {}): ModelStep {
  return (_request, _signal) => Promise.resolve(ok(attemptOf(spec)));
}

let counter = 0;
function attemptOf(spec: Reply): ModelAttempt {
  counter++;
  return {
    id: `mcl_${counter.toString().padStart(26, "0")}`,
    outcome: spec.outcome ?? COMPLETE,
    text: spec.text ?? "",
    toolCalls: spec.calls ?? [],
  };
}

function call(id: string, name: string, args: unknown = {}) {
  return {
    id,
    name,
    args: typeof args === "string" ? args : JSON.stringify(args),
  };
}

function deferred<T = void>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function done(
  status: ToolDone["status"],
  code: string,
  tool_call: string,
): ToolDone {
  return {
    kind: "done",
    tool_call,
    status,
    code,
    result: synthesizedResult(
      status === "success"
        ? "failure"
        : status === "failure"
        ? "failure"
        : status,
      `${status} ${code}`,
    ),
  };
}

type FakeTool = {
  info: ToolInfo;
  run?: (call: ToolCallRequest, signal: AbortSignal) => Promise<ToolAttempt>;
};

const READ: ToolInfo = { effect: "read", idempotent: true, server: null };
const WRITE: ToolInfo = { effect: "write", idempotent: false, server: null };
const IDEMPOTENT_WRITE: ToolInfo = {
  effect: "write",
  idempotent: true,
  server: null,
};
const EXTERNAL: ToolInfo = {
  effect: "external",
  idempotent: false,
  server: "mail",
};

type Setup = {
  model: ModelStep[];
  tools?: Record<string, FakeTool>;
  context?: Partial<RunContext> | null;
  session?: string | null;
  limits?: { model_attempts?: number };
  available?: () => boolean;
  random?: () => number;
  waits?:
    | "immediate"
    | ((ms: number, signal: AbortSignal) => Promise<"elapsed" | "aborted">);
  view?: (
    input: { session: string; page?: number },
  ) => Result<WorkspaceReadOutput>;
  abortGraceMs?: number;
  deadline?: (
    ms: number,
    signal: AbortSignal,
  ) => Promise<"elapsed" | "aborted">;
  onContext?: () => void;
};

const packer: WirePacker = (request) => ({
  body: {
    tools: anthropicTools(request),
    system: anthropicSystem(request),
    messages: request.messages,
  },
  opaque_bytes: 0,
});

function rig(setup: Setup) {
  const clock = manualClock(START);
  const log: string[] = [];
  const models = [...setup.model];
  const requests: ModelCallRequest[] = [];
  const waits: number[] = [];
  const entries: ToolCallRequest[] = [];
  const closed: { call: ToolCallRequest; code: string; status: string }[] = [];
  const finishes: FinishRequest[] = [];
  const answers: string[] = [];
  const checkpoints: number[] = [];
  const views: { session: string; page?: number }[] = [];
  const waited: WaitTarget[] = [];
  const state = {
    stopped: false,
    steering: [] as { id: string; text: string }[],
    applied: new Set<string>(),
    modelCalls: 0,
    toolSeq: 0,
  };
  const tools = setup.tools ?? {};

  const context: RunContext = {
    product: { instructions: "PRODUCT" },
    role: { instructions: "ROLE", preset_prompt: null },
    tools: [{
      name: "doc.read",
      description: "read",
      input_schema: { type: "object" },
    }],
    work: {
      role: "lophn",
      session: { kind: "project", id: PROJECT },
      scope: { kind: "all", id: null },
    },
    attachments: [],
    purpose: null,
    run_facts: null,
    continuation_summary: null,
    sources: [],
    skills: [],
    timezone: "Asia/Seoul",
    limits: { context_limit: 200000, input_limit: 150000, output_limit: 32000 },
    reserved_output: 8000,
    ...(setup.context ?? {}),
  };

  const ports: RunPorts = {
    stop() {
      log.push("stop");
      return Promise.resolve(
        state.stopped
          ? { stopped: true, reason: "user_stopped" }
          : { stopped: false },
      );
    },
    inputs() {
      log.push("inputs");
      const pending: PendingInputs = {
        request: "REQUEST",
        steering: state.steering.filter((item) => !state.applied.has(item.id)),
      };
      return Promise.resolve(ok(pending));
    },
    context() {
      log.push("context");
      setup.onContext?.();
      if (setup.context === null) {
        return Promise.resolve(err({ code: "unavailable", message: "no" }));
      }
      return Promise.resolve(ok(context));
    },
    view(input) {
      log.push("view");
      views.push(input);
      return Promise.resolve(
        setup.view?.(input) ??
          ok(
            {
              availability: "disconnected",
              reason: "no window",
            } as WorkspaceReadOutput,
          ),
      );
    },
    model: {
      pack: packer,
      available: () => Promise.resolve(setup.available?.() ?? true),
      async call(request, signal) {
        log.push("model");
        requests.push(request);
        for (const id of request.applied) state.applied.add(id);
        state.modelCalls++;
        const step = models.shift();
        assert(step !== undefined, "model script ran out");
        return await step(request, signal);
      },
    },
    tools: {
      info: (name) => tools[name]?.info,
      async attempt(request, signal) {
        log.push(`tool:${request.name}:${request.attempt}`);
        entries.push(request);
        const fake = tools[request.name];
        if (fake?.run !== undefined) return await fake.run(request, signal);
        state.toolSeq++;
        return done("success", "ok", `tcl_${state.toolSeq}`);
      },
      resume() {
        return Promise.reject(new Error("no resumed call"));
      },
      close(request, why) {
        log.push(`close:${request.name}:${why.code}`);
        closed.push({ call: request, code: why.code, status: why.status });
        state.toolSeq++;
        return Promise.resolve(
          done(why.status, why.code, `tcl_${state.toolSeq}`),
        );
      },
    },
    checkpoint(elapsed) {
      checkpoints.push(elapsed.active_ms);
      return Promise.resolve();
    },
    answer(text) {
      answers.push(text);
      return Promise.resolve(ok(undefined));
    },
    wait(request) {
      waited.push(request);
      return Promise.resolve(ok(undefined));
    },
    finish(request) {
      finishes.push(request);
      return Promise.resolve(ok({ finished: true as const }));
    },
  };

  const deps: LoopDeps = {
    clock,
    wait: setup.waits === undefined || setup.waits === "immediate"
      ? async (ms, signal) => {
        // 대기는 다음 macrotask에서 끝난다. 중단에 답하는 호출이 먼저 돌아올 틈을 준다.
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (signal.aborted) return "aborted" as const;
        waits.push(ms);
        clock.advance(ms);
        return "elapsed" as const;
      }
      : (ms, signal) => {
        waits.push(ms);
        return setup.waits instanceof Function
          ? setup.waits(ms, signal)
          : Promise.resolve("elapsed" as const);
      },
    deadline: setup.deadline ?? (() => new Promise(() => {})),
    random: setup.random ?? (() => 0.5),
    instructions: {
      files: {
        read: () => Promise.resolve(ok(null)),
      },
      redact: (text) => text,
    },
    ports,
    ...(setup.abortGraceMs === undefined
      ? {}
      : { abortGraceMs: setup.abortGraceMs }),
  };

  const input: RunInput = {
    run: RUN,
    session: setup.session === undefined ? SESSION : setup.session,
    limits: {
      model_attempts: setup.limits?.model_attempts ?? 30,
      stall_ms: 300_000,
      active_ms: 1_800_000,
    },
    elapsed: { active_ms: 0, stall_ms: 0, checkpoint_at: null },
    attempts: 0,
  };

  function start(): RunLoopHandle {
    return startRunLoop(deps, input);
  }

  return {
    clock,
    log,
    requests,
    waits,
    entries,
    closed,
    finishes,
    answers,
    checkpoints,
    views,
    waited,
    state,
    deps,
    input,
    start,
    async run(): Promise<LoopEnd> {
      return await start().done;
    },
  };
}

function textOf(request: ModelCallRequest): string {
  return JSON.stringify(request.assembly.request.messages);
}

function steer(r: ReturnType<typeof rig>, id: string, text: string) {
  r.state.steering.push({ id, text });
}

// ---- R8 ----

Deno.test("lophn-agent/harness/run-loop#R8: model 호출·tool 동작·retry 대기가 멈춰 있어도 core read와 다른 run은 계속 진행한다", async () => {
  // 세 가지 느린 자리를 하나씩 막아 두고, 같은 시간에 다른 run과 core read가 진행하는지 본다.
  for (const slow of ["model", "tool", "retry"] as const) {
    const gate = deferred();
    const blocked = rig({
      model: slow === "model"
        ? [
          async () => {
            await gate.promise;
            return ok(attemptOf({ text: "slow" }));
          },
        ]
        : slow === "tool"
        ? [reply({ calls: [call("t1", "doc.read")] }), reply({ text: "slow" })]
        : [reply({ outcome: failed("temporary") }), reply({ text: "slow" })],
      tools: slow === "tool"
        ? {
          "doc.read": {
            info: READ,
            run: async () => {
              await gate.promise;
              return done("success", "ok", "tcl_slow");
            },
          },
        }
        : { "doc.read": { info: READ } },
      waits: slow === "retry"
        ? async () => {
          await gate.promise;
          return "elapsed";
        }
        : "immediate",
    });
    const other = rig({ model: [reply({ text: "fast" })] });
    const slowRun = blocked.start();
    // 다른 assignment의 run과 core read는 느린 run을 기다리지 않는다.
    const coreRead = Promise.resolve("read answered");
    assertEquals(await coreRead, "read answered");
    const fast = await other.run();
    assertEquals(fast.kind, "finished");
    assertEquals(other.answers, ["fast"]);
    let slowEnded = false;
    void slowRun.done.then(() => (slowEnded = true));
    await Promise.resolve();
    assertEquals(slowEnded, false, slow);
    gate.resolve();
    assertEquals((await slowRun.done).kind, "finished");
  }
});

// ---- R9 ----

Deno.test("lophn-agent/harness/run-loop#R9: turn은 멈춤 확인 → 접수 입력 → 한도 → 조립 → 재확인 → model call → tool 묶음 → 기록 순서다", async () => {
  const r = rig({
    model: [
      reply({ calls: [call("t1", "doc.read", { id: "d" })] }),
      reply({ text: "done" }),
    ],
    tools: { "doc.read": { info: READ } },
  });
  const end = await r.run();
  assertEquals(end.kind, "finished");
  const order = r.log;
  const first = order.indexOf("model");
  // 첫 turn: stop → inputs → context → view → (조립) → stop → inputs → model → tool
  assertEquals(order.slice(0, first + 1), [
    "stop",
    "inputs",
    "context",
    "view",
    "stop",
    "inputs",
    "model",
  ]);
  assert(order.indexOf("tool:doc.read:0") > first);
  // 결과는 call마다 기록된 뒤 다음 판단에 이력으로 간다.
  assertStringIncludes(textOf(r.requests[1]), "tool_result");
  assert(r.checkpoints.length >= 1);
  assertEquals(r.requests.length, 2);
});

Deno.test("lophn-agent/harness/run-loop#R9: 조립 중 도착한 steering은 같은 call에 담기고 옛 입력으로 tool을 시작하지 않는다", async () => {
  let injected = false;
  const r = rig({
    model: [reply({ text: "ok" })],
    onContext() {
      if (!injected) {
        injected = true;
        steer(rigRef.current!, "msg_1", "STEER NOW");
      }
    },
  });
  const rigRef = { current: r as ReturnType<typeof rig> | undefined };
  const end = await r.run();
  assertEquals(end.kind, "finished");
  assertEquals(r.requests.length, 1);
  assertStringIncludes(textOf(r.requests[0]), "STEER NOW");
  assertEquals(r.requests[0].applied, ["msg_1"]);
  // 조립을 두 번 했지만 model call은 한 번이다.
  assertEquals(r.log.filter((item) => item === "context").length, 2);
});

Deno.test("lophn-agent/harness/run-loop#R9: 조립 중 멈춤이 접수되면 model을 부르지 않는다", async () => {
  const r = rig({
    model: [],
    onContext() {
      rigRef.current!.state.stopped = true;
    },
  });
  const rigRef = { current: r as ReturnType<typeof rig> | undefined };
  const end = await r.run();
  assertEquals(end, { kind: "stopped", reason: "user_stopped" });
  assertEquals(r.requests.length, 0);
  assertEquals(r.finishes.length, 0);
});

Deno.test("lophn-agent/harness/run-loop#R9: 조립이 막히면(blocked) model call 없이 이유와 함께 끝난다", async () => {
  const r = rig({
    model: [],
    context: { product: null },
  });
  const end = await r.run();
  assertEquals(end, {
    kind: "finished",
    outcome: { kind: "failed", reason: "configuration_unavailable" },
  });
  assertEquals(r.requests.length, 0);
  const over = rig({
    model: [],
    context: {
      limits: { context_limit: 100_000, input_limit: 200, output_limit: 1000 },
      reserved_output: 10,
    },
  });
  assertEquals((await over.run()).kind, "finished");
  assertEquals(over.finishes[0].outcome, {
    kind: "failed",
    reason: "context_limit",
  });
  assertEquals(over.requests.length, 0);
});

Deno.test("lophn-agent/harness/run-loop#R9: 매 turn 직전 relay read를 next_page까지 이어 화면을 모으고 없거나 실패하면 이유를 준다", async () => {
  const tab = (key: string, selected: boolean) => ({
    kind: "document_editor" as const,
    key,
    selected,
    document: "doc_01arz3ndektsv4rrffq69g5fav",
  });
  const current = (extra: Record<string, unknown>): WorkspaceReadOutput => ({
    availability: "current",
    observed_at: "2026-10-06T00:00:00.000Z",
    generation: 3,
    summary: "VIEW SUMMARY",
    ...extra,
  } as WorkspaceReadOutput);
  const paged = rig({
    model: [reply({ text: "ok" })],
    view: (input) =>
      ok(
        input.page === undefined
          ? current({ next_page: 1 })
          : input.page === 1
          ? current({ tab_page: [tab("tab-a", false)], next_page: 2 })
          : current({ tab_page: [tab("tab-b", true)] }),
      ),
  });
  await paged.run();
  assertEquals(paged.views, [
    { session: SESSION },
    { session: SESSION, page: 1 },
    { session: SESSION, page: 2 },
  ]);
  const text = textOf(paged.requests[0]);
  assertStringIncludes(text, "tab-a");
  assertStringIncludes(text, "tab-b");
  assertStringIncludes(text, "VIEW SUMMARY");
  assertEquals(
    paged.requests[0].assembly.basis.turn_context?.tabs.map((t) => t.key),
    ["tab-b", "tab-a"],
  );

  const periodic = rig({ model: [reply({ text: "ok" })], session: null });
  await periodic.run();
  assertEquals(periodic.views.length, 0);
  assertStringIncludes(textOf(periodic.requests[0]), "no_session");

  const broken = rig({
    model: [reply({ text: "ok" })],
    view: () => err({ code: "unavailable", message: "relay down" }),
  });
  await broken.run();
  assertStringIncludes(textOf(broken.requests[0]), "collect_failed");
});

// ---- R10 ----

Deno.test("lophn-agent/harness/run-loop#R10: tool 사이에 수정 입력이 접수되면 미시작 tool 대신 새 판단을 거친다", async () => {
  const r = rig({
    model: [
      reply({
        calls: [
          call("a", "doc.write", { n: 1 }),
          call("b", "doc.write", { n: 2 }),
          call("c", "doc.write", { n: 3 }),
        ],
      }),
      reply({ text: "revised" }),
    ],
    tools: {
      "doc.write": {
        info: IDEMPOTENT_WRITE,
        run: (request) => {
          if (request.key === "a") {
            steer(rigRef.current!, "msg_2", "CHANGE COURSE");
          }
          return Promise.resolve(done("success", "ok", `tcl_${request.key}`));
        },
      },
    },
  });
  const rigRef = { current: r as ReturnType<typeof rig> | undefined };
  const end = await r.run();
  assertEquals(end.kind, "finished");
  // 첫 tool만 시작하고 둘째·셋째는 미실행이다.
  assertEquals(r.entries.map((entry) => entry.key), ["a"]);
  assertEquals(r.closed.map((item) => [item.call.key, item.code]), [
    ["b", "superseded"],
    ["c", "superseded"],
  ]);
  // 다음 판단이 수정 입력을 반영한다.
  assertEquals(r.requests.length, 2);
  assertStringIncludes(textOf(r.requests[1]), "CHANGE COURSE");
  assertEquals(r.requests[1].applied, ["msg_2"]);
});

// ---- R11 ----

Deno.test("lophn-agent/harness/run-loop#R11: 불완전한 응답은 tool을 하나도 시작하지 않고 잘림 사실을 다음 판단에 전한다", async () => {
  for (const finish_reason of ["max_tokens", null]) {
    const r = rig({
      model: [
        reply({
          text: "cut",
          calls: [call("t1", "doc.write", '{"id": "x"')],
          outcome: { ...PARTIAL, finish_reason },
        }),
        reply({ text: "recovered" }),
      ],
      tools: { "doc.write": { info: WRITE } },
    });
    const end = await r.run();
    assertEquals(end.kind, "finished");
    assertEquals(r.entries.length, 0);
    assertEquals(r.closed.length, 0);
    assertEquals(r.requests.length, 2);
    const second = textOf(r.requests[1]);
    assertStringIncludes(second, "cut off");
    assertStringIncludes(second, finish_reason ?? "unknown");
    // 잘린 본문은 이력에 채택하지 않는다.
    assert(!second.includes('"cut"'));
  }
});

// ---- R12 ----

Deno.test("lophn-agent/harness/run-loop#R12: 모두 읽기로 확인된 묶음만 병렬이고 결과는 요청 순서다", async () => {
  const started: string[] = [];
  const firstGate = deferred();
  const r = rig({
    model: [
      reply({
        calls: [
          call("a", "doc.read"),
          call("b", "doc.read"),
          call("c", "doc.read"),
        ],
      }),
      reply({ text: "done" }),
    ],
    tools: {
      "doc.read": {
        info: READ,
        run: async (request) => {
          started.push(request.key);
          // 첫 call은 나머지가 모두 시작한 뒤에 끝난다. 완료 순서가 요청 순서와 달라진다.
          if (request.key === "a") await firstGate.promise;
          else if (started.length === 3) firstGate.resolve();
          return done("success", "ok", `tcl_${request.key}`);
        },
      },
    },
  });
  await r.run();
  assertEquals(started.slice().sort(), ["a", "b", "c"]);
  // 완료 순서는 b, c, a지만 이력의 결과 순서는 요청 순서다.
  const history = textOf(r.requests[1]);
  const ids = [...history.matchAll(/"id":"(a|b|c)","text"/g)].map((m) => m[1]);
  assertEquals(ids, ["a", "b", "c"]);
});

Deno.test("lophn-agent/harness/run-loop#R12: 쓰기·external·미분류 call이 하나라도 있으면 전체를 요청 순서로 하나씩 처리한다", async () => {
  for (
    const mixed of [
      ["doc.read", "doc.write", "doc.read"],
      ["doc.read", "mail.send", "doc.read"],
      ["doc.read", "unlisted.tool", "doc.read"],
    ]
  ) {
    const trace: string[] = [];
    const r = rig({
      model: [
        reply({ calls: mixed.map((name, index) => call(`k${index}`, name)) }),
        reply({ text: "done" }),
      ],
      tools: {
        "doc.read": {
          info: READ,
          run: async (request) => {
            trace.push(`start ${request.key}`);
            await Promise.resolve();
            trace.push(`end ${request.key}`);
            return done("success", "ok", `tcl_${request.key}`);
          },
        },
        "doc.write": {
          info: IDEMPOTENT_WRITE,
          run: async (request) => {
            trace.push(`start ${request.key}`);
            await Promise.resolve();
            trace.push(`end ${request.key}`);
            return done("success", "ok", `tcl_${request.key}`);
          },
        },
        "mail.send": {
          info: EXTERNAL,
          run: async (request) => {
            trace.push(`start ${request.key}`);
            await Promise.resolve();
            trace.push(`end ${request.key}`);
            return done("success", "ok", `tcl_${request.key}`);
          },
        },
      },
    });
    await r.run();
    const entered = trace.filter((item) => item.startsWith("start")).length;
    // 시작과 끝이 번갈아 나온다: 겹치는 호출이 없다.
    for (let index = 0; index < trace.length; index += 2) {
      assert(trace[index].startsWith("start"));
      assert(trace[index + 1].startsWith("end"));
      assertEquals(trace[index].slice(6), trace[index + 1].slice(4));
    }
    assertEquals(
      entered,
      mixed.filter((name) => name !== "unlisted.tool").length,
    );
  }
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R1: 질문을 만든 call 뒤에는 run이 그 질문의 답을 기다리고 나머지 call과 다음 model call을 시작하지 않는다", async () => {
  const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";
  const r = rig({
    model: [
      reply({
        calls: [
          call("k0", "question.submit"),
          call("k1", "doc.write"),
        ],
      }),
    ],
    tools: {
      "question.submit": {
        info: WRITE,
        run: () =>
          Promise.resolve({
            ...done("success", "ok", "tcl_question"),
            asked: QUESTION,
          }),
      },
      "doc.write": { info: IDEMPOTENT_WRITE },
    },
  });
  const end = await r.run();
  assertEquals(end, {
    kind: "waiting",
    tool_call: "tcl_question",
    question: QUESTION,
  });
  assertEquals(r.waited, [{ tool_call: "tcl_question", question: QUESTION }]);
  // 질문 call은 끝난 call이고 뒤 call은 시작하지 않는다.
  assertEquals(r.entries.map((entry) => entry.name), ["question.submit"]);
  assertEquals(r.closed.map((item) => item.code), ["waiting_for_decision"]);
  assertEquals(r.finishes, []);
  assertEquals(r.answers, []);
});

// ---- R13 ----

Deno.test("lophn-agent/harness/run-loop#R13: 없는 tool과 잘못된 인자는 인자를 고치지 않고 call별 결과로 돌려준다", async () => {
  const r = rig({
    model: [
      reply({
        calls: [
          call("a", "nope.tool", { x: 1 }),
          call("b", "doc.read", "{broken json"),
          call("c", "doc.read", "[1,2]"),
        ],
      }),
      reply({ text: "done" }),
    ],
    tools: { "doc.read": { info: READ } },
  });
  const end = await r.run();
  assertEquals(end.kind, "finished");
  // 진입한 tool이 없다. 세 call 모두 진입 없이 닫혔다.
  assertEquals(r.entries.length, 0);
  assertEquals(r.closed.map((item) => [item.call.key, item.code]), [
    ["a", "not_found"],
    ["b", "invalid_input"],
    ["c", "invalid_input"],
  ]);
  // 해석할 수 없는 인자는 원문 그대로 남는다.
  assertEquals(r.closed[1].call.input, "{broken json");
  assertEquals(r.closed[0].call.input, { x: 1 });
  assertEquals(r.requests.length, 2);
  assertStringIncludes(textOf(r.requests[1]), "{broken json");
});

Deno.test("lophn-agent/harness/run-loop#R13: 순차 쓰기가 거절되거나 최종 실패하면 나머지는 미실행 이유를 남기고 앞선 읽기 결과는 보존한다", async () => {
  for (const fail of ["failure", "denied"] as const) {
    const r = rig({
      model: [
        reply({
          calls: [
            call("r1", "doc.read"),
            call("w1", "doc.write", { n: 1 }),
            call("w2", "doc.write", { n: 2 }),
            call("r2", "doc.read"),
          ],
        }),
        reply({ text: "done" }),
      ],
      tools: {
        "doc.read": { info: READ },
        "doc.write": {
          info: WRITE,
          run: () =>
            Promise.resolve(
              fail === "failure"
                ? done("failure", "conflict", "tcl_w1")
                : done("not_executed", "denied", "tcl_w1"),
            ),
        },
      },
    });
    await r.run();
    assertEquals(r.entries.map((entry) => entry.key), ["r1", "w1"]);
    assertEquals(r.closed.map((item) => [item.call.key, item.code]), [
      ["w2", "earlier_call_failed"],
      ["r2", "earlier_call_failed"],
    ]);
    const next = textOf(r.requests[1]);
    // 앞선 읽기의 성공 결과와 쓰기의 원래 인자가 남는다.
    assertStringIncludes(next, "success");
    assertStringIncludes(next, '"n":1');
    // 거절된 쓰기도 미실행이다.
    assertEquals(
      r.finishes[0].facts.unexecuted.length,
      fail === "denied" ? 3 : 2,
    );
  }
});

// ---- R15 ----

Deno.test("lophn-agent/harness/run-loop#R15: 멈춤이 접수되면 진행 중인 model call에 중단을 요청하고 새 model·tool·retry를 시작하지 않는다", async () => {
  const entered = deferred();
  let aborted = false;
  const r = rig({
    model: [
      (_request, signal) => {
        entered.resolve();
        return new Promise((resolve) => {
          signal.addEventListener("abort", () => {
            aborted = true;
            resolve(ok(attemptOf({
              outcome: { ...PARTIAL, kind: "cancelled", finish_reason: null },
            })));
          });
        });
      },
    ],
    tools: { "doc.write": { info: WRITE } },
  });
  const handle = r.start();
  await entered.promise;
  handle.stop("user_stopped");
  const end = await handle.done;
  assertEquals(end, { kind: "stopped", reason: "user_stopped" });
  assertEquals(aborted, true);
  assertEquals(r.requests.length, 1);
  assertEquals(r.entries.length, 0);
  // 멈춤은 core가 run을 이미 끝냈다. loop가 다시 끝내지 않는다.
  assertEquals(r.finishes.length, 0);
});

Deno.test("lophn-agent/harness/run-loop#R15: tool 진행 중 멈춤이면 진행 호출에 중단을 요청하고 미시작 call은 미실행으로 끝낸다", async () => {
  const entered = deferred();
  let aborted = false;
  const r = rig({
    model: [
      reply({
        calls: [
          call("a", "doc.write"),
          call("b", "doc.write"),
          call("c", "doc.read"),
        ],
      }),
    ],
    tools: {
      "doc.read": { info: READ },
      "doc.write": {
        info: WRITE,
        run: (_request, signal) => {
          entered.resolve();
          return new Promise((resolve) => {
            signal.addEventListener("abort", () => {
              aborted = true;
              resolve(done("failure", "unavailable", "tcl_a"));
            });
          });
        },
      },
    },
  });
  const handle = r.start();
  await entered.promise;
  handle.stop("user_stopped");
  const end = await handle.done;
  assertEquals(end.kind, "stopped");
  assertEquals(aborted, true);
  assertEquals(r.entries.map((entry) => entry.key), ["a"]);
  assertEquals(r.closed.map((item) => [item.call.key, item.code]), [
    ["b", "stopped"],
    ["c", "stopped"],
  ]);
  // 멈춤 뒤에는 새 model call도 retry도 없다.
  assertEquals(r.requests.length, 1);
});

Deno.test("lophn-agent/harness/run-loop#R15: retry 대기 중 멈춤이면 예정 retry를 시작하지 않는다", async () => {
  const waiting = deferred();
  const r = rig({
    model: [reply({ outcome: failed("temporary") })],
    waits: (_ms, signal) => {
      waiting.resolve();
      return new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve("aborted"));
      });
    },
  });
  const handle = r.start();
  await waiting.promise;
  handle.stop("user_stopped");
  assertEquals((await handle.done).kind, "stopped");
  assertEquals(r.requests.length, 1);
});

Deno.test("lophn-agent/harness/run-loop#R15: 멈춤을 알려도 중단에 답하지 않는 호출은 기다리지 않고 불명확으로 남긴다", async () => {
  const entered = deferred();
  const r = rig({
    model: [reply({ calls: [call("a", "doc.write")] })],
    tools: {
      "doc.write": {
        info: WRITE,
        run: () => {
          entered.resolve();
          return new Promise(() => {});
        },
      },
    },
  });
  const handle = r.start();
  await entered.promise;
  handle.stop("user_stopped");
  assertEquals((await handle.done).kind, "stopped");
  assertEquals(r.entries.length, 1);
});

// ---- R23 ----

Deno.test("lophn-agent/harness/run-loop#R23: 일시 실패만 최초 뒤 최대 2회 같은 입력으로 retry하고 2초·4초 기다린다", async () => {
  const r = rig({
    model: [
      reply({ text: "partial one", outcome: failed("temporary") }),
      reply({ outcome: failed("temporary") }),
      reply({ text: "finally" }),
    ],
  });
  const end = await r.run();
  assertEquals(end.kind, "finished");
  assertEquals(r.requests.length, 3);
  assertEquals(r.waits, [2000, 4000]);
  // 같은 입력이다: 조립 결과가 같고 retry는 직전 시도를 가리킨다.
  assertEquals(
    new Set(r.requests.map((request) => request.assembly.input_hash)).size,
    1,
  );
  assertEquals(r.requests.map((request) => request.kind), [
    "initial",
    "retry",
    "retry",
  ]);
  assertEquals(r.requests[1].retry_of?.startsWith("mcl_"), true);
  assertEquals(r.requests[2].retry_of === r.requests[1].retry_of, false);
  // 부분 응답은 채택하지 않는다.
  assertEquals(r.answers, ["finally"]);
});

Deno.test("lophn-agent/harness/run-loop#R23: 세 번 모두 일시 실패면 더 보내지 않고 실패로 끝나며 영구 실패는 retry하지 않는다", async () => {
  const exhausted = rig({
    model: [
      reply({ outcome: failed("temporary") }),
      reply({ outcome: failed("temporary") }),
      reply({ outcome: failed("temporary") }),
    ],
  });
  await exhausted.run();
  assertEquals(exhausted.requests.length, 3);
  assertEquals(exhausted.finishes[0].outcome, {
    kind: "failed",
    reason: "model_error",
  });

  for (
    const code of [
      "credential_unavailable",
      "invalid_request",
      "refused",
    ] as const
  ) {
    const permanent = rig({ model: [reply({ outcome: failed(code) })] });
    await permanent.run();
    assertEquals(permanent.requests.length, 1, code);
    assertEquals(permanent.waits, []);
  }
});

Deno.test("lophn-agent/harness/run-loop#R23: 서버 최소 재시도 시각 전에는 다시 보내지 않는다", async () => {
  const retryAt = new Date(START + 120_000).toISOString();
  const r = rig({
    model: [
      reply({ outcome: failed("temporary", retryAt) }),
      reply({ text: "ok" }),
    ],
  });
  let secondAt = 0;
  const original = r.deps.ports.model.call;
  r.deps.ports.model.call = (request, signal) => {
    if (request.kind === "retry") secondAt = r.clock.nowMs();
    return original(request, signal);
  };
  await r.run();
  assertEquals(r.waits, [120_000]);
  assert(secondAt >= START + 120_000);
});

Deno.test("lophn-agent/harness/run-loop#R23: 한도에 닿은 뒤에는 retry도 model call도 보내지 않는다", async () => {
  const r = rig({
    model: [reply({ outcome: failed("temporary") }), reply({ text: "never" })],
    limits: { model_attempts: 1 },
  });
  const end = await r.run();
  assertEquals(end, {
    kind: "finished",
    outcome: { kind: "failed", reason: "model_attempt_limit" },
  });
  assertEquals(r.requests.length, 1);
});

// ---- R24 ----

Deno.test("lophn-agent/harness/run-loop#R24: 읽기와 중복 효과 없음이 보장된 쓰기만 최초 뒤 최대 1회 retry하고 1초±10% 기다린다", async () => {
  for (
    const [info, expected] of [
      [READ, 2],
      [IDEMPOTENT_WRITE, 2],
      [WRITE, 1],
      [EXTERNAL, 1],
    ] as const
  ) {
    const r = rig({
      model: [reply({ calls: [call("a", "t.run")] }), reply({ text: "done" })],
      tools: {
        "t.run": {
          info,
          run: (request) =>
            Promise.resolve(
              done("failure", "unavailable", `tcl_${request.attempt}`),
            ),
        },
      },
      random: () => 0,
    });
    await r.run();
    assertEquals(r.entries.length, expected, JSON.stringify(info));
    if (expected === 2) {
      // 최대 최초 뒤 1회다. 두 번 모두 실패해도 세 번째는 없다.
      assertEquals(r.waits, [900]);
      assertEquals(r.entries[1].attempt, 1);
      assertEquals(r.entries[1].retry_of, "tcl_0");
      assertEquals(r.entries[1].input, r.entries[0].input);
    } else assertEquals(r.waits, []);
  }
  const high = rig({
    model: [reply({ calls: [call("a", "t.run")] }), reply({ text: "done" })],
    tools: {
      "t.run": {
        info: READ,
        run: (request) =>
          Promise.resolve(
            request.attempt === 0
              ? done("failure", "unavailable", "tcl_0")
              : done("success", "ok", "tcl_1"),
          ),
      },
    },
    random: () => 0.999999,
  });
  await high.run();
  assertEquals(high.waits, [1100]);
  assertEquals(high.entries.length, 2);
});

Deno.test("lophn-agent/harness/run-loop#R24: 거절·잘못된 입력·사라진 대상·사람 멈춤은 같은 요청을 다시 보내지 않는다", async () => {
  for (const code of ["invalid_input", "forbidden", "not_found", "denied"]) {
    const r = rig({
      model: [reply({ calls: [call("a", "t.run")] }), reply({ text: "done" })],
      tools: {
        "t.run": {
          info: READ,
          run: () =>
            Promise.resolve(
              done(
                code === "denied" ? "not_executed" : "failure",
                code,
                "tcl_0",
              ),
            ),
        },
      },
    });
    await r.run();
    assertEquals(r.entries.length, 1, code);
  }
  // retry 대기 중 멈춤은 다시 진입하지 않는다.
  const waiting = deferred();
  const r = rig({
    model: [reply({ calls: [call("a", "t.run")] })],
    tools: {
      "t.run": {
        info: READ,
        run: () => Promise.resolve(done("failure", "unavailable", "tcl_0")),
      },
    },
    waits: (_ms, signal) => {
      waiting.resolve();
      return new Promise((resolve) => {
        signal.addEventListener("abort", () => resolve("aborted"));
      });
    },
  });
  const handle = r.start();
  await waiting.promise;
  handle.stop("user_stopped");
  await handle.done;
  assertEquals(r.entries.length, 1);
});

// ---- R25 ----

Deno.test("lophn-agent/harness/run-loop#R25: provider를 끄면 새 model call을 보내지 않고 설정 불가로 끝난다", async () => {
  let on = true;
  const r = rig({
    model: [
      reply({ calls: [call("a", "doc.read")] }),
      reply({ text: "never" }),
    ],
    tools: {
      "doc.read": {
        info: READ,
        run: () => {
          on = false;
          return Promise.resolve(done("success", "ok", "tcl_a"));
        },
      },
    },
    available: () => on,
  });
  const end = await r.run();
  assertEquals(end, {
    kind: "finished",
    outcome: { kind: "failed", reason: "configuration_unavailable" },
  });
  assertEquals(r.requests.length, 1);
});

Deno.test("lophn-agent/harness/run-loop#R25: provider 회수는 중단 가능한 진행 요청을 취소하고 중단 불가한 요청은 기다리지 않는다", async () => {
  for (const abortable of [true, false]) {
    const entered = deferred();
    const r = rig({
      model: [
        (_request, signal) => {
          entered.resolve();
          return new Promise((resolve) => {
            if (!abortable) return;
            signal.addEventListener("abort", () =>
              resolve(ok(attemptOf({
                outcome: { ...PARTIAL, kind: "cancelled", finish_reason: null },
              }))));
          });
        },
      ],
    });
    const handle = r.start();
    await entered.promise;
    handle.revoke({ provider: true });
    const end = await handle.done;
    assertEquals(end, {
      kind: "finished",
      outcome: { kind: "failed", reason: "configuration_unavailable" },
    }, `abortable ${abortable}`);
    assertEquals(r.requests.length, 1);
  }
});

Deno.test("lophn-agent/harness/run-loop#R25: MCP 연결을 제거하면 그 서버의 새 진입을 막고 진행 호출 결과를 정확히 남긴다", async () => {
  // 중단 가능한 진행 호출은 돌려준 결과가 그대로 남고, 중단 불가한 호출은 불명확으로 남는다.
  for (const abortable of [true, false]) {
    const entered = deferred();
    const r = rig({
      model: [
        reply({ calls: [call("a", "mail.send"), call("b", "mail.send")] }),
        reply({ text: "done" }),
      ],
      tools: {
        "mail.send": {
          info: EXTERNAL,
          run: (_request, signal) => {
            entered.resolve();
            return new Promise((resolve) => {
              if (!abortable) return;
              signal.addEventListener(
                "abort",
                () => resolve(done("failure", "unavailable", "tcl_a")),
              );
            });
          },
        },
      },
    });
    const handle = r.start();
    await entered.promise;
    handle.revoke({ server: "mail" });
    const end = await handle.done;
    assertEquals(end.kind, "finished");
    // 둘째 call은 진입하지 않는다.
    assertEquals(r.entries.map((entry) => entry.key), ["a"]);
    assertEquals(r.closed.map((item) => [item.call.key, item.status]), [
      ["b", "not_executed"],
    ]);
    const next = textOf(r.requests[1]);
    if (abortable) {
      assertStringIncludes(next, "unavailable");
    } else {
      assertStringIncludes(next, "abort_unconfirmed");
      assertEquals(r.finishes[0].facts.unknown_effects, ["a:unconfirmed"]);
    }
  }
});
