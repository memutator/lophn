import { assert, assertEquals } from "@std/assert";
import { err, manualClock, ok } from "../../../base/mod.ts";
import type {
  ChildMessage,
  ParentMessage,
} from "../../../protocol/server/mod.ts";
import { anthropicSystem, anthropicTools } from "../prompt-assembly/mod.ts";
import {
  createRunCredentials,
  type LoopDeps,
  type RunPorts,
  type Selection,
} from "./mod.ts";
import { createCredentialLink } from "../../main/agent-runtime/credential-link.ts";
import { OPTION_ACTION_OPERATIONS } from "../tools/questions/mod.ts";
import { RUNTIME_MACHINE_OPERATIONS } from "../../main/agent-runtime/core-http.ts";
import { createRunDriver } from "./driver.ts";
import { createContractCall } from "../tools/toolkit.ts";

const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const ASG = "asg_01arz3ndektsv4rrffq69g5fav";
const SELECTION: Selection = {
  run: RUN,
  assignment: ASG,
  session: null,
  stateSeq: "3",
  reason: "priority",
};
// 두 run이 서로 다른 provider를 쓰는 시험의 재료다.
const PROVIDER_A = "pvd_01arz3ndektsv4rrffq69g5fav";
const PROVIDER_B = "pvd_01arz3ndektsv4rrffq69g5fb0";
const RUN_B = "run_01arz3ndektsv4rrffq69g5fb0";
const ASG_B = "asg_01arz3ndektsv4rrffq69g5fb0";
const SCOPE = {
  role: "lophn" as const,
  assignment: ASG,
  apps: [],
};

// core를 대신하는 감독 쪽. 받은 child message를 기록하고 credential 요청에 답한다.
function fakeCore(options: { answer?: boolean } = {}) {
  const seen: ChildMessage[] = [];
  const link = createCredentialLink({
    send(message) {
      seen.push(message);
      if (message.type === "agent_credential_request") {
        if (options.answer !== false) {
          queueMicrotask(() =>
            link.onParent(
              {
                type: "agent_credential_response",
                request_id: message.request_id,
                credential: `token-${message.run}`,
                credential_ref: "cred_ref_1",
              } satisfies ParentMessage,
            )
          );
        }
      }
      return Promise.resolve();
    },
    timeoutMs: 20,
  });
  const credentials = createRunCredentials({
    issuer: link.issuer,
    operations: ["ReadRun"],
    process: "agent-runtime",
  });
  return { seen, link, credentials };
}

Deno.test("lophn-agent/harness/run-loop#R15: agent credential은 감독 pipe로 run마다 받고 run 종료·assignment 멈춤에 끝낸다", async () => {
  const core = fakeCore();
  const issued = await core.credentials.open({
    run: RUN,
    assignment: ASG,
    scope: SCOPE,
  });
  assert(issued.ok);
  assertEquals(issued.value.token, `token-${RUN}`);
  const request = core.seen[0];
  assert(request.type === "agent_credential_request");
  assertEquals(request.run, RUN);
  assertEquals(request.assignment, ASG);
  assertEquals(request.operations, ["ReadRun"]);
  // 같은 run에 둘은 없다.
  const again = await core.credentials.open({
    run: RUN,
    assignment: ASG,
    scope: SCOPE,
  });
  assert(!again.ok);
  assertEquals(core.credentials.end(RUN), 1);
  assertEquals(core.seen[1], { type: "agent_credential_end", run: RUN });

  const second = await core.credentials.open({
    run: RUN,
    assignment: ASG,
    scope: SCOPE,
  });
  assert(second.ok);
  assertEquals(core.credentials.endAssignment(ASG), 1);
  assertEquals(core.seen.at(-1), { type: "agent_credential_end", run: RUN });
});

Deno.test("lophn-agent/harness/run-loop#R15: core가 답하지 않으면 발급 실패이고 credential을 들고 있지 않는다", async () => {
  const core = fakeCore({ answer: false });
  const issued = await core.credentials.open({
    run: RUN,
    assignment: ASG,
    scope: SCOPE,
  });
  assert(!issued.ok);
  assertEquals(core.credentials.live(), []);
});

// 완료하는 가장 작은 loop 재료. 실제 provider·core를 부르지 않는다.
function loopMaterial(provider = PROVIDER_A, run = RUN) {
  const clock = manualClock(Date.parse("2026-10-06T00:00:00.000Z"));
  const ports: RunPorts = {
    stop: () => Promise.resolve({ stopped: false }),
    inputs: () => Promise.resolve(ok({ request: "REQUEST", steering: [] })),
    context: () =>
      Promise.resolve(ok({
        product: { instructions: "PRODUCT" },
        role: { instructions: "ROLE" },
        tools: [],
        work: {
          role: "lophn" as const,
          session: {
            kind: "project" as const,
            id: "prj_01arz3ndektsv4rrffq69g5fav",
          },
          scope: { kind: "all" as const, id: null },
        },
        purpose: null,
        run_facts: null,
        session: { compaction: null, messages: [] },
        sources: [],
        skills: [],
        timezone: null,
        limits: {
          context_limit: 200000,
          input_limit: 150000,
          output_limit: 32000,
        },
        reserved_output: 8000,
      })),
    view: () => Promise.resolve(err({ code: "unavailable", message: "no" })),
    model: {
      pack: (request) => ({
        body: {
          tools: anthropicTools(request),
          system: anthropicSystem(request),
          messages: request.messages,
        },
        opaque_bytes: 0,
      }),
      available: () => Promise.resolve(true),
      call: () =>
        Promise.resolve(ok({
          id: "mcl_01arz3ndektsv4rrffq69g5fav",
          outcome: {
            kind: "complete" as const,
            code: null,
            retry_at: null,
            finish_reason: "end_turn",
            http_status: 200,
            provider_code: null,
          },
          text: "done",
          toolCalls: [],
        })),
    },
    tools: {
      info: () => undefined,
      attempt: () => Promise.reject(new Error("no tool")),
      resume: () => Promise.reject(new Error("no tool")),
      close: () => Promise.reject(new Error("no tool")),
    },
    checkpoint: () => Promise.resolve(),
    answer: () => Promise.resolve(ok(undefined)),
    wait: () => Promise.resolve(ok(undefined)),
    finish: () => Promise.resolve(ok({ finished: true as const })),
  };
  const deps: LoopDeps = {
    clock,
    wait: () => Promise.resolve("elapsed"),
    random: () => 0.5,
    instructions: {
      files: {
        read: () => Promise.resolve(ok(null)),
      },
      redact: (text) => text,
    },
    ports,
  };
  return {
    provider,
    deps,
    input: {
      run,
      session: null,
      limits: { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 },
      elapsed: { active_ms: 0, stall_ms: 0, checkpoint_at: null },
      attempts: 0,
    },
  };
}

function driverOf(
  core: ReturnType<typeof fakeCore>,
  options: { startOk?: boolean; log?: string[] } = {},
) {
  const log = options.log ?? [];
  const closed: string[] = [];
  const credentialsUsed: string[] = [];
  const driver = createRunDriver({
    selector: { next: () => Promise.resolve(ok(SELECTION)) },
    credentials: core.credentials,
    prepare: () =>
      Promise.resolve(ok({
        begin: {
          run: RUN,
          assignment: ASG,
          stateSeq: "3",
          basis: "a".repeat(64),
          limits: {
            model_attempts: 30,
            stall_ms: 300_000,
            active_ms: 1_800_000,
          },
          scope: SCOPE,
        },
        startRun: () => {
          log.push("start_run");
          return Promise.resolve(
            options.startOk === false
              ? err({ code: "conflict" as const, message: "no" })
              : ok({ run: RUN, state_seq: "4", basis: "a".repeat(64) }),
          );
        },
        loop: (credential) => {
          credentialsUsed.push(credential.token);
          return loopMaterial();
        },
      })),
    closeUnusable: (selection) => {
      closed.push(selection.run);
      return Promise.resolve();
    },
  });
  return { driver, closed, credentialsUsed, log };
}

Deno.test("lophn-agent/harness/run-loop#R8: 고른 run은 StartRun이 확정된 뒤에 credential을 받아 loop에 넘기고 끝나면 credential을 끝낸다", async () => {
  const core = fakeCore();
  const { driver, credentialsUsed, log } = driverOf(core);
  const started = await driver.startNext();
  assert(started.kind === "started");
  assertEquals(log, ["start_run"]);
  assertEquals(credentialsUsed, [`token-${RUN}`]);
  const end = await started.done;
  assertEquals(end.kind, "finished");
  assertEquals(core.seen.map((message) => message.type), [
    "agent_credential_request",
    "agent_credential_end",
  ]);
  assertEquals(driver.active, 0);
  assertEquals(core.credentials.live(), []);
});

Deno.test("lophn-agent/harness/run-loop#R8: StartRun이 거절되면 credential을 만들지 않고 credential을 못 받으면 run을 닫는다", async () => {
  const rejected = fakeCore();
  const refused = driverOf(rejected, { startOk: false });
  assertEquals(await refused.driver.startNext(), {
    kind: "not_started",
    run: RUN,
  });
  assertEquals(rejected.seen, []);
  assertEquals(refused.closed, []);

  const silent = fakeCore({ answer: false });
  const unusable = driverOf(silent);
  assertEquals(await unusable.driver.startNext(), {
    kind: "not_started",
    run: RUN,
  });
  // StartRun은 확정됐으므로 run을 failed로 닫아 달라고 맡긴다.
  assertEquals(unusable.closed, [RUN]);
});

Deno.test("lophn-agent/harness/run-loop#R15: 감독이 끊기면 진행 loop의 새 진입을 막고 들고 있는 credential을 모두 끝낸다", async () => {
  const core = fakeCore();
  const gate = { release: () => {} };
  const held = new Promise<void>((resolve) => (gate.release = resolve));
  const material = loopMaterial();
  const original = material.deps.ports.model.call;
  material.deps.ports.model.call = async (request, signal) => {
    await held;
    return await original(request, signal);
  };
  const driver = createRunDriver({
    selector: { next: () => Promise.resolve(ok(SELECTION)) },
    credentials: core.credentials,
    prepare: () =>
      Promise.resolve(ok({
        begin: {
          run: RUN,
          assignment: ASG,
          stateSeq: "3",
          basis: "a".repeat(64),
          limits: {
            model_attempts: 30,
            stall_ms: 300_000,
            active_ms: 1_800_000,
          },
          scope: SCOPE,
        },
        startRun: () =>
          Promise.resolve(
            ok({ run: RUN, state_seq: "4", basis: "a".repeat(64) }),
          ),
        loop: () => material,
      })),
    closeUnusable: () => Promise.resolve(),
  });
  const started = await driver.startNext();
  assert(started.kind === "started");
  assertEquals(core.credentials.live(), [RUN]);
  driver.endAll();
  assertEquals(core.credentials.live(), []);
  gate.release();
  const end = await started.done;
  // 진행 호출이 취소돼 끝난다. 끝난 run에 credential이 남지 않는다.
  assert(end.kind === "finished" || end.kind === "finish_failed");
  assertEquals(core.credentials.live(), []);
});

Deno.test("lophn-agent/harness/run-loop#R8: 사람의 결정을 기다리는 run은 이 process가 들고 있는 기다림 해소기로 결정을 반영한다", async () => {
  const core = fakeCore();
  const material = loopMaterial();
  material.deps.ports.model.call = () =>
    Promise.resolve(ok({
      id: "mcl_01arz3ndektsv4rrffq69g5fav",
      outcome: {
        kind: "complete" as const,
        code: null,
        retry_at: null,
        finish_reason: "tool_use",
        http_status: 200,
        provider_code: null,
      },
      text: "",
      toolCalls: [{ id: "t1", name: "doc.write", args: "{}" }],
    }));
  material.deps.ports.tools.info = () => ({
    effect: "write",
    idempotent: false,
    server: null,
  });
  material.deps.ports.tools.attempt = () =>
    Promise.resolve({
      kind: "waiting" as const,
      tool_call: "tcl_01arz3ndektsv4rrffq69g5fav",
      approval: "apr_01arz3ndektsv4rrffq69g5fav",
      result: {
        status: "not_executed" as const,
        summary: "waiting",
        content: null,
        complete: true,
        source: null,
        continuation: null,
        pending: [],
      },
    });
  let settled = 0;
  const driver = createRunDriver({
    selector: { next: () => Promise.resolve(ok(SELECTION)) },
    credentials: core.credentials,
    prepare: () =>
      Promise.resolve(ok({
        begin: {
          run: RUN,
          assignment: ASG,
          stateSeq: "3",
          basis: "a".repeat(64),
          limits: {
            model_attempts: 30,
            stall_ms: 300_000,
            active_ms: 1_800_000,
          },
          scope: SCOPE,
        },
        startRun: () =>
          Promise.resolve(
            ok({ run: RUN, state_seq: "4", basis: "a".repeat(64) }),
          ),
        loop: () => ({
          ...material,
          settle: () => {
            settled += 1;
            return Promise.resolve(ok("resolved"));
          },
        }),
      })),
    closeUnusable: () => Promise.resolve(),
  });
  assertEquals(driver.settle(RUN), undefined);
  const started = await driver.startNext();
  assert(started.kind === "started");
  assertEquals((await started.done).kind, "waiting");
  // 기다림에 들어간 run의 credential은 끝났다. 결정 반영은 같은 process의 해소기가 한다.
  assertEquals(core.credentials.live(), []);
  assertEquals(await driver.settle(RUN), ok("resolved"));
  assertEquals(settled, 1);
});

Deno.test("lophn-agent/questions#R13: runtime machine credential의 operation 기준에는 option action 소유 command의 operation이 모두 들어 있다", () => {
  for (const operation of OPTION_ACTION_OPERATIONS) {
    assert(RUNTIME_MACHINE_OPERATIONS.includes(operation), operation);
  }
  for (
    const operation of [
      "StartRun",
      "ApplyQuestionOption",
    ]
  ) {
    assert(RUNTIME_MACHINE_OPERATIONS.includes(operation), operation);
  }
});

Deno.test("lophn-agent/harness/run-loop#R8: 내장 tool handler의 소유 contract 호출은 열린 route만 agent 자격의 loopback으로 보내고 없는 이름은 없는 것과 같다", async () => {
  const sent: { path: string; body: unknown }[] = [];
  const agent = (path: string, body: unknown) => {
    sent.push({ path, body });
    return Promise.resolve(ok({ ok: true }));
  };
  const link = createContractCall([
    { name: "ReadThing", kind: "read", resource: "things", method: "read" },
    { name: "SaveThing", kind: "command", resource: "things", method: "save" },
  ], agent);
  await link.call("ReadThing", { id: 1 }, RUN);
  await link.call("SaveThing", { id: 2 }, RUN, {
    compare: { revision: 3 },
    idempotency_key: "k1",
  });
  assertEquals(sent, [
    { path: "/v1/things/read", body: { id: 1 } },
    {
      path: "/v1/things/save",
      body: {
        input: { id: 2 },
        idempotency_key: "k1",
        compare: { revision: 3 },
        prepared: [],
      },
    },
  ]);
  const missing = await link.call("ApplySettings", {}, RUN);
  assert(!missing.ok);
  assertEquals(missing.error.code, "not_found");
  assertEquals(sent.length, 2);
});

// ---- provider Disconnect와 진행 중인 run [agent-I53] ----

const CANCELLED = {
  id: "mcl_01arz3ndektsv4rrffq69g5fav",
  outcome: {
    kind: "cancelled" as const,
    code: null,
    retry_at: null,
    finish_reason: null,
    http_status: null,
    provider_code: null,
  },
  text: "",
  toolCalls: [],
};

// model call이 풀어 주거나 중단 신호를 받을 때까지 도는 run. 신호를 받았는지와 call 수, FinishRun
// 요청을 남긴다. `connected`가 false면 provider가 Disconnect된 것이다.
function liveRun(provider: string, run: string, release: Promise<void>) {
  const material = loopMaterial(provider, run);
  const state = { aborted: false, calls: 0, connected: true };
  const finishes: Parameters<RunPorts["finish"]>[0][] = [];
  const complete = material.deps.ports.model.call;
  material.deps.ports.model.available = () => Promise.resolve(state.connected);
  material.deps.ports.model.call = (request, signal) => {
    state.calls += 1;
    return new Promise((resolve) => {
      signal.addEventListener("abort", () => {
        state.aborted = true;
        resolve(ok(CANCELLED));
      }, { once: true });
      void release.then(() => resolve(complete(request, signal)));
    });
  };
  material.deps.ports.finish = (request) => {
    finishes.push(request);
    return Promise.resolve(ok({ finished: true as const }));
  };
  return { material, state, finishes };
}

async function until(done: () => boolean): Promise<void> {
  for (let tick = 0; tick < 200 && !done(); tick++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  assert(done(), "조건이 채워지지 않았다");
}

function driverOfRuns(
  core: ReturnType<typeof fakeCore>,
  runs: Map<string, ReturnType<typeof loopMaterial>>,
) {
  const queue = [
    { ...SELECTION },
    { ...SELECTION, run: RUN_B, assignment: ASG_B },
  ];
  return createRunDriver({
    selector: { next: () => Promise.resolve(ok(queue.shift() ?? null)) },
    credentials: core.credentials,
    prepare: (selection) =>
      Promise.resolve(ok({
        begin: {
          run: selection.run,
          assignment: selection.assignment,
          stateSeq: "3",
          basis: "a".repeat(64),
          limits: {
            model_attempts: 30,
            stall_ms: 300_000,
            active_ms: 1_800_000,
          },
          scope: { ...SCOPE, assignment: selection.assignment },
        },
        startRun: () =>
          Promise.resolve(
            ok({ run: selection.run, state_seq: "4", basis: "a".repeat(64) }),
          ),
        loop: () => runs.get(selection.run)!,
      })),
    closeUnusable: () => Promise.resolve(),
  });
}

Deno.test("lophn-agent/harness/provider#R4 lophn-agent/harness/run-loop#R25 [agent-I53]: Disconnect를 알리면 그 provider로 진행 중인 run의 call을 멈추고 이유를 남기며 다른 provider의 run은 그대로 둔다", async () => {
  const core = fakeCore();
  const release = Promise.withResolvers<void>();
  const a = liveRun(PROVIDER_A, RUN, release.promise);
  const b = liveRun(PROVIDER_B, RUN_B, release.promise);
  const driver = driverOfRuns(
    core,
    new Map([[RUN, a.material], [RUN_B, b.material]]),
  );
  const startedA = await driver.startNext();
  const startedB = await driver.startNext();
  assert(startedA.kind === "started" && startedB.kind === "started");
  await until(() => a.state.calls === 1 && b.state.calls === 1);

  a.state.connected = false;
  await driver.revokeProvider(PROVIDER_A);

  // 진행 중인 call이 중단 신호를 받고 run은 설정을 쓸 수 없다는 이유로 끝난다. 다른 provider·model로
  // 옮겨 가지 않아 call은 처음 하나뿐이다(provider#R10).
  assertEquals(await startedA.done, {
    kind: "finished",
    outcome: { kind: "failed", reason: "configuration_unavailable" },
  });
  assert(a.state.aborted);
  assertEquals(a.state.calls, 1);
  assertEquals(a.finishes.map((request) => request.outcome), [
    { kind: "failed", reason: "configuration_unavailable" },
  ]);
  assertEquals(core.credentials.live(), [RUN_B]);

  // 다른 provider의 run은 중단되지 않고 계속 돌다가 제 결과로 끝난다.
  assertEquals(b.state.aborted, false);
  assertEquals(driver.active, 1);
  release.resolve();
  const endB = await startedB.done;
  assertEquals(endB.kind, "finished");
  assertEquals(b.finishes.map((request) => request.outcome), [
    { kind: "completed", reason: "answer_completed" },
  ]);
  assertEquals(core.credentials.live(), []);
});

Deno.test("lophn-agent/harness/provider#R4 [agent-I53]: 같은 ID로 다시 Connect한 뒤 시작한 run은 옛 Disconnect 알림에 회수되지 않는다", async () => {
  const core = fakeCore();
  const release = Promise.withResolvers<void>();
  // 이 run의 provider는 지금 연결돼 있다(available). 옛 Disconnect event가 늦게 처리돼도 그대로다.
  const fresh = liveRun(PROVIDER_A, RUN, release.promise);
  const driver = driverOfRuns(core, new Map([[RUN, fresh.material]]));
  const started = await driver.startNext();
  assert(started.kind === "started");
  await until(() => fresh.state.calls === 1);

  await driver.revokeProvider(PROVIDER_A);
  await driver.revokeProvider("pvd_01arz3ndektsv4rrffq69g5fb1");
  assertEquals(fresh.state.aborted, false);
  assertEquals(driver.active, 1);
  release.resolve();
  assertEquals((await started.done).kind, "finished");
  assertEquals(fresh.finishes.map((request) => request.outcome), [
    { kind: "completed", reason: "answer_completed" },
  ]);
});
