// automation 회차의 앱 쪽 조립: 직접 호출과 같은 handler·입력 검사, trigger·caller 사실, timeout, 기록 전달
// 실패, 수동 확인. 시각과 타이머는 가짜이고 실제 OS scheduler는 쓰지 않는다.
import { assert, assertEquals } from "@std/assert";
import { handleControl } from "./control.ts";
import { handleInvoke } from "./invoke.ts";
import { startRuntime } from "./startup.ts";
import { verifyConnection } from "./verify.ts";
import {
  type AutomationTimers,
  createAutomationPorts,
  installAutomations,
} from "./automation.ts";
import {
  clockAt,
  connection,
  installHandlers,
  shaKey,
  sign,
} from "./testing.ts";
import { startLine } from "./testing.ts";
import type { AppConnection } from "./wire.ts";
import { validateBlueprint } from "../../blueprint/mod.ts";
import type { Blueprint } from "../../blueprint/mod.ts";

const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const MINUTE = 60_000;

function command(
  key: string,
  effect: "read" | "write" | "external",
  extra: Record<string, unknown> = {},
) {
  return {
    key,
    label: key,
    description: `${key} purpose`,
    effect,
    confirm: false,
    input: null,
    revert: { supported: false },
    ...extra,
  };
}

function blueprintOf(tasks: Record<string, unknown>[]): Blueprint {
  const parsed = validateBlueprint({
    name: "Usage",
    description: "Reads usage",
    screens: [{
      key: "usage",
      label: "Usage",
      path: "/usage",
      sizes: ["full"],
    }],
    commands: [
      command("lookup", "read", {
        input: {
          type: "object",
          properties: { limit: { type: "integer", default: 10, minimum: 1 } },
          additionalProperties: false,
        },
      }),
      command("push", "external"),
      command("purge", "write", { confirm: true }),
    ],
    automatic_tasks: tasks.map((task) => ({ label: task.key, ...task })),
    permissions: [],
    problem_codes: [],
    documents: [],
    agent_context: [],
    app_connections: [],
    sdk_dependencies: [],
  });
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.value;
}

// handler는 한 번만 등록된다. 시험마다 동작을 바꿔 끼운다.
const behavior = {
  lookup: (_input: unknown): unknown | Promise<unknown> => ({ rows: [] }),
  push: (_input: unknown): unknown | Promise<unknown> => ({ sent: true }),
};
const calls: { command: string; input: unknown }[] = [];
installHandlers([
  {
    command: "lookup",
    handle: (input: unknown) => {
      calls.push({ command: "lookup", input });
      return behavior.lookup(input);
    },
  },
  {
    command: "push",
    handle: (input: unknown) => {
      calls.push({ command: "push", input });
      return behavior.push(input);
    },
  },
  { command: "purge", handle: () => ({ purged: true }) },
]);

async function settle() {
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
}

function fakeTimers() {
  let tick = 10_000;
  const intervals: { fn: () => void; live: boolean }[] = [];
  const timeouts: { at: number; fn: () => void; live: boolean }[] = [];
  const timers: AutomationTimers = {
    tick: () => tick,
    every(_ms, fn) {
      const entry = { fn, live: true };
      intervals.push(entry);
      return () => {
        entry.live = false;
      };
    },
    after(ms, fn) {
      const entry = { at: tick + ms, fn, live: true };
      timeouts.push(entry);
      return () => {
        entry.live = false;
      };
    },
  };
  return {
    timers,
    async advance(ms: number) {
      const target = tick + ms;
      while (tick < target) {
        tick = Math.min(tick + 1000, target);
        for (const timeout of timeouts) {
          if (timeout.live && timeout.at <= tick) {
            timeout.live = false;
            timeout.fn();
          }
        }
        for (const interval of intervals) if (interval.live) interval.fn();
        await settle();
      }
    },
  };
}

type Fact = { path: string; body: Record<string, unknown> };

function boot(
  tasks: Record<string, unknown>[],
  options: {
    mode?: "live" | "preview";
    acquire?: () => { status: number; body: unknown };
    submitFails?: boolean;
  } = {},
) {
  const facts: Fact[] = [];
  const permits: { acquired: number; released: string[] } = {
    acquired: 0,
    released: [],
  };
  let sequence = 0;
  const started = startRuntime({
    line: startLine({ mode: options.mode ?? "live" }),
    blueprint: blueprintOf(tasks),
    key: shaKey(),
    clock: clockAt(),
    ids: {
      newId: (prefix) => {
        sequence += 1;
        return `${prefix}_01h455vb4pex5v6nkc6gd5fd${
          sequence.toString().padStart(2, "0")
        }`;
      },
    },
    broker: (request) => {
      const body = request.body as Record<string, unknown>;
      if (request.path.endsWith("/invocations/submit")) {
        if (options.submitFails) {
          return Promise.reject(new Error("delivery is down"));
        }
        facts.push({ path: request.path, body });
        return Promise.resolve({ status: 200, body: { accepted: true } });
      }
      if (request.path.endsWith("/automations/try_acquire")) {
        permits.acquired += 1;
        return Promise.resolve(
          options.acquire?.() ?? {
            status: 200,
            body: { permit: true, limit: 4, timeout_ms: 600_000 },
          },
        );
      }
      if (request.path.endsWith("/automations/release")) {
        permits.released.push(String(body.invocation));
        return Promise.resolve({ status: 200, body: { released: true } });
      }
      return Promise.resolve({ status: 404, body: null });
    },
    dataSchema: 0,
  });
  const time = fakeTimers();
  const lifecycle = installAutomations(started.state, time.timers);
  started.state.ready = true;
  const machine = connection({
    actor: "machine",
    commands: [],
  }) as AppConnection;
  const open = () =>
    handleControl(
      started.state,
      "/_lophn/control/open",
      { process_nonce: "nonce-1", release: REL },
      machine,
    );
  const submitted = (
    fact: "start" | "finish" | "deny",
  ): (Record<string, unknown> & { invocation: string })[] =>
    facts.filter((entry) => entry.body.fact === fact).map((entry) => ({
      invocation: entry.body.invocation as string,
      ...(entry.body.summary as Record<string, unknown>),
    }));
  return {
    state: started.state,
    lifecycle,
    time,
    facts,
    permits,
    open,
    machine,
    submitted,
  };
}

const poll = {
  key: "poll",
  when: { kind: "interval", interval_ms: MINUTE },
  command: "lookup",
  input: {},
};
const boots = {
  key: "boot",
  when: { kind: "on_start" },
  command: "lookup",
  input: {},
};

Deno.test("apps/automations#R1: 직접 호출과 automation이 같은 handler를 같은 정규 입력으로 부르고 start 사실은 automation trigger를 싣는다", async () => {
  calls.length = 0;
  const world = boot([poll]);
  world.open();
  // 직접 호출: 입력을 생략하면 선언 default로 채운 정규 입력이 handler에 간다.
  const direct = await handleInvoke(
    world.state,
    "/_lophn/commands/invoke",
    new TextEncoder().encode(JSON.stringify({
      request_key: "manual-1",
      release: REL,
      command: "lookup",
    })),
    connection({ commands: ["lookup"] }) as AppConnection,
  );
  assertEquals(direct.status, 200);
  await world.time.advance(MINUTE);
  assertEquals(calls, [
    { command: "lookup", input: { limit: 10 } },
    { command: "lookup", input: { limit: 10 } },
  ]);

  // T12에서 넘어온 것: automation 호출의 start·finish 사실은 trigger와 caller가 automation key이고
  // actor는 machine이며 읽기라도 항상 남는다.
  const start = world.submitted("start");
  assertEquals(start.length, 1);
  assertEquals(start[0].trigger, { kind: "automation", key: "poll" });
  assertEquals(start[0].caller, { kind: "automation", key: "poll" });
  assertEquals(start[0].actor, "machine");
  assertEquals(start[0].operation, { kind: "command", command: "lookup" });
  const finish = world.submitted("finish");
  assertEquals(finish.length, 1);
  assertEquals(finish[0].status, "succeeded");
  assertEquals(finish[0].invocation, start[0].invocation);
  // 직접 호출 쪽 일반 성공 읽기는 남기지 않는다(apps/invocations#R2).
  assertEquals(world.facts.length, 2);
  world.lifecycle?.close();
});

Deno.test("apps/automations#R1: 미선언 command와 잘못된 고정 입력과 confirm=true는 handler 없이 거절하고 거절 사실에 automation trigger를 싣는다", async () => {
  calls.length = 0;
  const world = boot([poll]);
  world.open();
  const ports = createAutomationPorts(world.state, world.time.timers);
  const refused = (spec: Record<string, unknown>) =>
    ports.prepare({
      key: "x",
      when: { kind: "on_start" },
      command: "lookup",
      ...spec,
    } as never);
  const undeclared = refused({ command: "missing" });
  assert(!undeclared.ok);
  assertEquals(undeclared.reason, "undeclared_command");
  const invalid = refused({ input: { limit: 0 } });
  assert(!invalid.ok);
  assertEquals(invalid.reason, "invalid_input");
  const extra = refused({ input: { unknown: 1 } });
  assert(!extra.ok);
  assertEquals(extra.reason, "invalid_input");
  const confirming = refused({ command: "purge" });
  assert(!confirming.ok);
  assertEquals(confirming.reason, "confirm_required");
  await settle();
  assertEquals(calls, []);
  // 선언 없는 command는 어떤 호출인지 모르므로 거절 사실도 만들지 않는다.
  const denied = world.submitted("deny");
  assertEquals(denied.length, 3);
  assertEquals(denied.map((fact) => fact.summary), [
    {
      command: "lookup",
      effect: "read",
      automation: "x",
      code: "invalid_input",
    },
    {
      command: "lookup",
      effect: "read",
      automation: "x",
      code: "invalid_input",
    },
    { command: "purge", effect: "write", automation: "x", code: "confirm" },
  ]);
  for (const fact of denied) {
    assertEquals(fact.trigger, { kind: "automation", key: "x" });
    assertEquals(fact.caller, { kind: "automation", key: "x" });
    assertEquals(fact.actor, "machine");
  }
  world.lifecycle?.close();
});

Deno.test("apps/automations#R4: preview·test 프로세스에는 clock이 없고 통로가 열리기 전에는 handler를 부르지 않는다", async () => {
  calls.length = 0;
  const preview = boot([boots, poll], { mode: "preview" });
  assertEquals(preview.lifecycle, undefined);

  const world = boot([boots, poll]);
  // 업무 통로가 열리기 전에는 시작하지 않는다.
  await world.time.advance(2 * MINUTE);
  assertEquals(calls, []);
  assertEquals(world.permits.acquired, 0);
  world.open();
  await settle();
  // 시작 회차 한 번. 열린 시각이 기준이다.
  assertEquals(calls.length, 1);
  await world.time.advance(MINUTE);
  assertEquals(calls.length, 2);
  // 통로를 닫으면 새 회차가 없다.
  handleControl(
    world.state,
    "/_lophn/control/close",
    { process_nonce: "nonce-1", reason: "stop" },
    world.machine,
  );
  await world.time.advance(3 * MINUTE);
  assertEquals(calls.length, 2);
  assertEquals(world.permits.acquired, 2);
});

Deno.test("apps/automations#R9: timeout이면 결과 모름과 취소 요청을 남기고 handler가 끝나기 전에는 permit을 돌려주지 않는다", async () => {
  calls.length = 0;
  let finishHandler: (() => void) | undefined;
  behavior.lookup = () =>
    new Promise((resolve) => {
      finishHandler = () => resolve({ late: true });
    });
  try {
    const world = boot([poll]);
    world.open();
    await world.time.advance(MINUTE);
    assertEquals(calls.length, 1);
    await world.time.advance(10 * MINUTE);
    const finish = world.submitted("finish");
    assertEquals(finish.length, 1);
    assertEquals(finish[0].status, "unknown");
    assertEquals(finish[0].summary, {
      command: "lookup",
      effect: "read",
      timeout: true,
      cancel_requested: true,
    });
    const [record] = [...world.state.invocations.values()];
    assertEquals(record.progress, "unknown");
    assertEquals(record.cancelRequested, true);
    // 응답하지 않는 handler가 남아 있으니 permit도 같은 automation 점유도 풀지 않았다.
    assertEquals(world.permits.released, []);
    assertEquals(
      world.lifecycle?.clock.status()[0].running_invocation,
      record.id,
    );
    // 늦게 끝나도 결과 모름이 성공으로 바뀌지 않고 종료 사실을 다시 보내지 않는다.
    finishHandler?.();
    await settle();
    assertEquals(world.submitted("finish").length, 1);
    assertEquals(record.progress, "unknown");
    assertEquals(world.permits.released, [record.id]);
    world.lifecycle?.close();
  } finally {
    behavior.lookup = () => ({ rows: [] });
  }
});

Deno.test("apps/automations#R8: handler가 실패하면 실패 사실만 남기고 다음 정해진 회차만 새 호출이다", async () => {
  calls.length = 0;
  behavior.lookup = () => {
    throw new Error("boom");
  };
  try {
    const world = boot([poll]);
    world.open();
    await world.time.advance(MINUTE);
    assertEquals(calls.length, 1);
    assertEquals(world.submitted("finish").map((fact) => fact.status), [
      "failed",
    ]);
    await world.time.advance(MINUTE - 1000);
    assertEquals(calls.length, 1);
    await world.time.advance(1000);
    assertEquals(calls.length, 2);
    // 매 회차는 handler가 끝난 직후 permit을 돌려준다.
    assertEquals(world.permits.released.length, 2);
    world.lifecycle?.close();
  } finally {
    behavior.lookup = () => ({ rows: [] });
  }
});

Deno.test("apps/automations#R11: 기록 전달이 실패해도 업무를 다시 돌리지 않고 재시작은 새 시작으로 시작 회차만 다시 낸다", async () => {
  calls.length = 0;
  const failing = boot([boots, poll], { submitFails: true });
  failing.open();
  await settle();
  assertEquals(calls.length, 1);
  await failing.time.advance(MINUTE - 1000);
  // 전달이 끊겨 기록이 없어도 지난 회차를 보충하거나 반복하지 않는다.
  assertEquals(calls.length, 1);
  assertEquals(failing.facts.length, 0);
  await failing.time.advance(1000);
  assertEquals(calls.length, 2);
  failing.lifecycle?.close();

  // 재시작: 새 프로세스의 새 시작이다. 시작 회차는 한 번 다시 돌고 간격 회차는 새 기준에서 센다.
  calls.length = 0;
  const restarted = boot([boots, poll]);
  restarted.open();
  await settle();
  assertEquals(calls.length, 1);
  await restarted.time.advance(MINUTE - 1000);
  assertEquals(calls.length, 1);
  restarted.lifecycle?.close();
});

Deno.test("apps/automations#R12: 수동 확인은 직접 호출이라 주기 회차가 아니고 preview 연결은 운영 프로세스가 대신 받지 않는다", async () => {
  calls.length = 0;
  const world = boot([poll]);
  world.open();
  const call = (request_key: string) =>
    handleInvoke(
      world.state,
      "/_lophn/commands/invoke",
      new TextEncoder().encode(JSON.stringify({
        request_key,
        release: REL,
        command: "lookup",
        input: { limit: 3 },
      })),
      connection({ commands: ["lookup"] }) as AppConnection,
    );
  const manual = await call("manual-1");
  assertEquals(manual.status, 200);
  assertEquals(calls, [{ command: "lookup", input: { limit: 3 } }]);
  // 수동 확인은 permit도 회차도 만들지 않는다.
  assertEquals(world.permits.acquired, 0);
  assertEquals(world.lifecycle?.clock.status()[0].started_turns, 0);
  assertEquals(
    [...world.state.invocations.values()].map((record) => record.caller),
    [{ kind: "direct" }],
  );

  // preview를 가리키는 연결은 운영 프로세스에서 거절된다. 운영 앱으로 대신 부르지 않는다.
  const verified = await verifyConnection(
    shaKey(),
    await sign(connection({ mode: "preview", commands: ["lookup"] })),
    world.state.identity,
    world.state.clock,
  );
  assert(!verified.ok);
  assertEquals(verified.error.code, "conflict");
  assertEquals(calls.length, 1);
  world.lifecycle?.close();
});

Deno.test("apps/automations#R13: 켜는 승인이 없어 permit이 거절되면 handler도 invocation도 없고 승인 뒤 다음 회차부터 돈다", async () => {
  calls.length = 0;
  let approved = false;
  const world = boot(
    [{
      key: "sync",
      when: { kind: "interval", interval_ms: MINUTE },
      command: "push",
    }],
    {
      acquire: () =>
        approved
          ? {
            status: 200,
            body: { permit: true, limit: 4, timeout_ms: 600_000 },
          }
          : {
            status: 403,
            body: {
              error: {
                code: "forbidden",
                message: "automation.run is not approved for this automation",
              },
            },
          },
    },
  );
  world.open();
  await world.time.advance(2 * MINUTE);
  assertEquals(calls, []);
  assertEquals(world.facts.length, 0);
  assertEquals(world.state.invocations.size, 0);
  assertEquals(
    world.lifecycle?.clock.status()[0].skipped.permission_required,
    2,
  );
  approved = true;
  await world.time.advance(MINUTE);
  assertEquals(calls, [{ command: "push", input: undefined }]);
  // external 호출이라 시작·종료 사실이 남고 trigger는 automation이다.
  assertEquals(world.submitted("start")[0].trigger, {
    kind: "automation",
    key: "sync",
  });
  world.lifecycle?.close();
});
