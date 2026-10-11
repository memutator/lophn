import { assert, assertEquals } from "@std/assert";
import { err, manualClock, ok } from "../../packages/base/mod.ts";
import type {
  ChildMessage,
  ParentMessage,
} from "../../packages/contracts/platform/mod.ts";
import {
  anthropicSystem,
  anthropicTools,
} from "../../packages/lophn-agent/harness/prompt-assemble/mod.ts";
import {
  createRunCredentials,
  type LoopDeps,
  type RunPorts,
  type Selection,
} from "../../packages/lophn-agent/harness/run-loop/mod.ts";
import { createCredentialLink } from "./credential-link.ts";
import { OPTION_ACTION_OPERATIONS } from "../../packages/lophn-agent/questions/mod.ts";
import { RUNTIME_MACHINE_OPERATIONS } from "./core-http.ts";
import { createRunDriver } from "./run-driver.ts";
import { createContractCall } from "./toolkit.ts";

const RUN = "run_01arz3ndektsv4rrffq69g5fav";
const ASG = "asg_01arz3ndektsv4rrffq69g5fav";
const SELECTION: Selection = {
  run: RUN,
  assignment: ASG,
  session: null,
  stateSeq: "3",
  reason: "priority",
};
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
function loopMaterial() {
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
        continuation_summary: null,
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
    deps,
    input: {
      run: RUN,
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
