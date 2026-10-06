import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../../base/mod.ts";
import type { Result } from "../../../base/mod.ts";
import type { CoreLink, RuntimeRecord } from "../core-link.ts";
import type {
  AppChild,
  DesiredApp,
  ProbeResult,
  SupervisorEvent,
} from "./supervisor.ts";
import { createSupervisor } from "./supervisor.ts";

const RELEASE = "rel_00000000000000000000000001";
const APP = "app_00000000000000000000000001";

function desired(over: Partial<DesiredApp> = {}): DesiredApp {
  return {
    app: APP,
    release: RELEASE,
    bundleHash: "ab".repeat(32),
    runEnabled: true,
    archived: false,
    commands: ["ping"],
    dataSchema: 1,
    flags: { args: ["--cached-only"], limits: [] },
    entry: "/bundle/main.ts",
    importMap: "/bundle/import-map.json",
    dataPath: "/data",
    ...over,
  };
}

type Harness = {
  records: RuntimeRecord[];
  events: SupervisorEvent[];
  socketApps: string[];
  spawned: number;
  alive: () => number;
  child: (index: number) => FakeChild;
  supervisor: ReturnType<typeof createSupervisor>;
  clock: ReturnType<typeof manualClock>;
};

type FakeChild = AppChild & {
  kill: (code: number | null) => void;
  stopRequests: number;
};

function harness(options: {
  probe?: (index: number) => ProbeResult | Promise<ProbeResult>;
  confirm?: boolean;
  core?: CoreLink;
  wait?: (ms: number) => Promise<void>;
  open?: (index: number) => Promise<boolean>;
  credential?: () => Promise<string> | string;
} = {}): Harness {
  const clock = manualClock(0);
  const records: RuntimeRecord[] = [];
  const events: SupervisorEvent[] = [];
  const socketApps: string[] = [];
  const children: FakeChild[] = [];
  let nonce = 0;
  const core: CoreLink = options.core ?? {
    record(record): Promise<Result<{ state: string }>> {
      records.push(record);
      return Promise.resolve({ ok: true, value: { state: "recorded" } });
    },
  };
  const supervisor = createSupervisor({
    clock,
    core,
    deno: () => "/usr/bin/deno",
    environment: { home: "/h", denoDir: "/d", xdgCacheHome: "/c", path: "/p" },
    socketPaths: (app) => {
      socketApps.push(app);
      return { broker: "/run/b.sock", direct: "/run/a.sock" };
    },
    nonce: () => `nonce-${nonce++}`,
    credential: options.credential ?? (() => "broker-credential"),
    ...(options.open ? { open: () => options.open!(children.length - 1) } : {}),
    onEvent: (event) => events.push(event),
    verifyKey: () => "v".repeat(43),
    readyTimeoutMs: 30_000,
    spawn(request): Promise<AppChild> {
      let resolveExit: (code: number | null) => void = () => {};
      const exited = new Promise<number | null>((resolve) => {
        resolveExit = resolve;
      });
      const child: FakeChild = {
        identity: {
          pid: 100 + children.length,
          startedAtMs: request.identity.startedAtMs,
          processNonce: request.identity.processNonce,
        },
        exited,
        stopRequests: 0,
        terminate() {
          child.stopRequests += 1;
          if (options.confirm === false) return Promise.resolve(false);
          resolveExit(0);
          return Promise.resolve(true);
        },
        kill(code) {
          resolveExit(code);
        },
      };
      children.push(child);
      return Promise.resolve(child);
    },
    probe(_child, _direct) {
      const result = options.probe?.(children.length - 1) ?? {
        ok: true as const,
        commands: ["ping"],
        dataSchema: 1,
        bundleHash: "ab".repeat(32),
      };
      return Promise.resolve(result);
    },
    wait: options.wait ?? (() => Promise.resolve()),
  });
  return {
    records,
    events,
    socketApps,
    get spawned() {
      return children.length;
    },
    alive: () => children.filter((child) => child.stopRequests === 0).length,
    child: (index) => children[index],
    supervisor,
    clock,
  };
}

Deno.test("apps/runtime#R1: 재시작이 겹쳐도 이전 자식을 확인하기 전 다음 자식을 띄우지 않는다", async () => {
  const env = harness();
  await env.supervisor.reconcile(desired());
  assertEquals(env.spawned, 1);
  const first = env.child(0).identity.processNonce;
  await env.supervisor.reconcile(
    desired({ release: "rel_00000000000000000000000002" }),
  );
  // 첫 자식은 종료 확인 뒤 교체됐다. 동시에 둘은 없었다.
  assertEquals(env.child(0).stopRequests, 1);
  assertEquals(env.spawned, 2);
  assert(env.child(1).identity.processNonce !== first);
  assertEquals(env.alive(), 1);
});

Deno.test("apps/runtime#R2: 30초 안에 probe가 확인되지 않으면 시작 실패다", async () => {
  const env = harness({
    probe: () => ({ ok: false, reason: "ready timeout" }),
  });
  await env.supervisor.reconcile(desired());
  const failed = env.records.find((record) =>
    record.method === "record_unavailable"
  );
  assert(failed && failed.method === "record_unavailable");
  assertEquals(failed.reason.code, "start_failed");
  assertEquals(env.alive(), 0);
});

Deno.test("apps/runtime#R2: handler 목록이 blueprint와 다르면 시작 실패다", async () => {
  const env = harness({
    probe: () => ({
      ok: true,
      commands: ["other"],
      dataSchema: 1,
      bundleHash: "ab".repeat(32),
    }),
  });
  await env.supervisor.reconcile(desired());
  const failed = env.records.find((record) =>
    record.method === "record_unavailable"
  );
  assert(failed && failed.method === "record_unavailable");
  assertEquals(failed.reason.summary, "handler or schema mismatch");
});

Deno.test("apps/runtime#R16: 사람이 멈춘 앱은 backoff가 지나도 다시 시작하지 않는다", async () => {
  const env = harness();
  await env.supervisor.reconcile(desired());
  await env.supervisor.reconcile(desired({ runEnabled: false }));
  assertEquals(env.child(0).stopRequests, 1);
  env.clock.advance(600_000);
  await env.supervisor.reconcile(desired({ runEnabled: false }));
  assertEquals(env.spawned, 1);
});

Deno.test("apps/runtime#R17: core 제어가 끊기면 자식을 종료하고 새 자식을 띄우지 않는다", async () => {
  const env = harness();
  await env.supervisor.reconcile(desired());
  await env.supervisor.coreClosed();
  assertEquals(env.child(0).stopRequests, 1);
  await env.supervisor.reconcile(desired());
  assertEquals(env.spawned, 1);
});

Deno.test("apps/runtime#R17: 같은 PID라도 nonce가 다르면 다른 자식이다", async () => {
  const env = harness();
  await env.supervisor.reconcile(desired());
  const first = env.child(0).identity;
  await env.supervisor.reconcile(
    desired({ release: "rel_00000000000000000000000002" }),
  );
  const second = env.child(1).identity;
  // PID가 재사용돼도 nonce와 시작 시각이 다르면 같은 자식이 아니다.
  second.pid = first.pid;
  assert(first.processNonce !== second.processNonce);
  const { sameChild } = await import("../processes/identity.ts");
  assertEquals(sameChild(first, second), false);
});

Deno.test("apps/runtime#R18: daemon 종료로 표시된 정지는 crash로 세지 않는다", async () => {
  const env = harness();
  await env.supervisor.reconcile(desired());
  await env.supervisor.stop();
  const crashed = env.records.filter((record) =>
    record.method === "record_unavailable" &&
    record.reason.code === "unexpected_exit"
  );
  assertEquals(crashed.length, 0);
  assertEquals(env.child(0).stopRequests, 1);
});

Deno.test("apps/runtime#R19: 예상 밖 종료가 창 안에서 5회를 넘으면 재시작을 멈춘다", async () => {
  const env = harness();
  await env.supervisor.reconcile(desired());
  for (let count = 0; count < 6; count++) {
    const child = env.child(env.spawned - 1);
    child.kill(1);
    await child.exited;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const held = env.records.filter((record) =>
    record.method === "record_unavailable" &&
    record.reason.code === "crash_loop"
  );
  assert(held.length >= 1);
  const spawned = env.spawned;
  env.clock.advance(1_000);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assertEquals(env.spawned, spawned);
});

Deno.test("apps/runtime#R19: 자동 재시작은 run_enabled를 바꾸지 않는다", async () => {
  const env = harness();
  await env.supervisor.reconcile(desired());
  env.child(0).kill(1);
  await env.child(0).exited;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (const record of env.records) {
    assert(!("run_enabled" in record));
  }
  assertEquals(env.supervisor.observation(APP)?.release, RELEASE);
});

Deno.test("apps/runtime#R20: idle만으로 앱을 종료하지 않는다", async () => {
  const env = harness();
  await env.supervisor.reconcile(desired());
  env.clock.advance(3_600_000);
  await env.supervisor.reconcile(desired());
  assertEquals(env.spawned, 1);
  assertEquals(env.child(0).stopRequests, 0);
});

Deno.test("apps/runtime#R21: 한 앱이 시작에 실패해도 다른 앱은 응답한다", async () => {
  const env = harness({
    probe: (index) =>
      index === 0 ? { ok: false, reason: "hung" } : {
        ok: true,
        commands: ["ping"],
        dataSchema: 1,
        bundleHash: "ab".repeat(32),
      },
  });
  const other = "app_00000000000000000000000002";
  await env.supervisor.reconcile(desired());
  await env.supervisor.reconcile(desired({ app: other }));
  const otherStarted = env.records.find((record) =>
    record.method === "record_started" && record.app === other
  );
  assert(otherStarted);
  assertEquals(env.supervisor.observation(other)?.ready, true);
});

Deno.test("apps/runtime#R1: 종료를 확인하지 못하면 다음 자식을 띄우지 않는다", async () => {
  const env = harness({
    confirm: false,
    probe: () => ({ ok: false, reason: "start failed" }),
  });
  await env.supervisor.reconcile(desired());
  assertEquals(env.spawned, 1);
  assertEquals(env.child(0).stopRequests, 1);
  // 종료 확인이 안 됐으므로 다시 맞춰도 새 자식을 띄우지 않는다.
  await env.supervisor.reconcile(
    desired({ release: "rel_00000000000000000000000002" }),
  );
  assertEquals(env.spawned, 1);
});

Deno.test("apps/runtime#R16: 종료 확인에 실패한 멈춤도 다시 허용하면 종료를 재시도하고 시작한다", async () => {
  let confirm = false;
  const env = harness({
    probe: () => ({
      ok: true,
      commands: ["ping"],
      dataSchema: 1,
      bundleHash: "ab".repeat(32),
    }),
  });
  const real = env.child;
  await env.supervisor.reconcile(desired());
  // 첫 종료 확인은 실패하게 가로챈다.
  const first = real(0);
  const original = first.terminate;
  first.terminate = () => {
    if (!confirm) return Promise.resolve(false);
    return original.call(first);
  };
  await env.supervisor.reconcile(desired({ runEnabled: false }));
  assertEquals(env.spawned, 1);
  // 다시 허용하면 남은 자식의 종료를 확인하고 새 자식을 띄운다.
  confirm = true;
  await env.supervisor.reconcile(desired({ runEnabled: true }));
  assertEquals(env.spawned, 2);
});

Deno.test("apps/runtime#R21: 한 앱의 record 실패가 다른 앱을 멈추지 않는다", async () => {
  const records: RuntimeRecord[] = [];
  const env = harness({
    core: {
      record(record) {
        records.push(record);
        if (record.app === APP) {
          return Promise.resolve({
            ok: false,
            error: { code: "unavailable", message: "core rejected" },
          });
        }
        return Promise.resolve({ ok: true, value: { state: "running" } });
      },
    },
  });
  const other = "app_00000000000000000000000002";
  await env.supervisor.reconcile(desired());
  await env.supervisor.reconcile(desired({ app: other }));
  assert(
    records.some((record) =>
      record.app === other && record.method === "record_started"
    ),
  );
  assertEquals(env.supervisor.observation(other)?.ready, true);
  assertEquals(env.supervisor.observation(APP)?.recordFailed, "core rejected");
});

Deno.test("apps/runtime#R2: probe가 30초 안에 끝나지 않으면 시작 실패다", async () => {
  let waited = 0;
  const env = harness({
    probe: () => new Promise(() => {}),
    wait: (ms) => {
      waited += ms;
      return Promise.resolve();
    },
  });
  await env.supervisor.reconcile(desired());
  assert(waited >= 30_000);
  const failed = env.records.find((record) =>
    record.method === "record_unavailable"
  );
  assert(failed && failed.method === "record_unavailable");
  assertEquals(failed.reason.code, "start_failed");
  assertEquals(env.alive(), 0);
});

Deno.test("apps/runtime#R2: probe가 통과해야 ready이고 통로를 연 뒤에야 accepting이며 open이 실패하면 시작 실패다", async () => {
  let release: (opened: boolean) => void = () => {};
  const gate = new Promise<boolean>((resolve) => {
    release = resolve;
  });
  const env = harness({ open: () => gate });
  const starting = env.supervisor.reconcile(desired());
  // 자식은 떴지만 probe 통과·open 전이다. 띄운 것만으로 ready라고 하지 않는다.
  assertEquals(env.supervisor.observation(APP)?.ready, false);
  for (
    let tick = 0;
    tick < 50 && !env.supervisor.observation(APP)?.ready;
    tick++
  ) await Promise.resolve();
  const during = env.supervisor.observation(APP)!;
  assertEquals(during.ready, true, "probe는 통과했고 open을 기다린다");
  assertEquals(during.accepting, false);
  release(true);
  await starting;
  const after = env.supervisor.observation(APP)!;
  assertEquals(after.ready, true);
  assertEquals(after.accepting, true);
  assertEquals(env.records.map((record) => record.method), ["record_started"]);

  const refused = harness({ open: () => Promise.resolve(false) });
  await refused.supervisor.reconcile(desired());
  assertEquals(refused.records.map((record) => record.method), [
    "record_unavailable",
  ]);
  assertEquals(refused.supervisor.observation(APP)!.ready, false);
  assertEquals(refused.child(0).stopRequests, 1);
});

Deno.test("apps/runtime#R7: 자식 credential 발급이 거절되면 자식을 띄우지 않고 시작 실패로 남긴다", async () => {
  const env = harness({
    credential: () => Promise.reject(new Error("core refused")),
  });
  await env.supervisor.reconcile(desired());
  assertEquals(env.spawned, 0);
  assertEquals(env.records.length, 1);
  assertEquals(env.records[0].method, "record_unavailable");
  const record = env.records[0] as Extract<
    RuntimeRecord,
    { method: "record_unavailable" }
  >;
  assertEquals(record.reason.code, "start_failed");
});

Deno.test("apps/runtime#R6: socket 자리는 앱마다 정해진다", async () => {
  const env = harness();
  await env.supervisor.reconcile(desired());
  assertEquals(env.socketApps, [APP]);
});

Deno.test("apps/permissions#R21: restart는 그 nonce의 자식을 종료 확인한 뒤 새 nonce로 다시 띄우고 다른 nonce면 하지 않는다", async () => {
  const env = harness();
  await env.supervisor.reconcile(desired());
  const first = env.child(0).identity.processNonce;
  assertEquals(await env.supervisor.restart(APP, "another-nonce"), false);
  assertEquals(env.spawned, 1);
  assertEquals(await env.supervisor.restart(APP, first), true);
  assertEquals(env.child(0).stopRequests, 1);
  assertEquals(env.spawned, 2);
  assert(env.child(1).identity.processNonce !== first);
  assertEquals(env.records.map((record) => record.method), [
    "record_started",
    "record_stopped",
    "record_started",
  ]);
  // 이미 교체된 옛 nonce로 다시 부르면 새 자식을 건드리지 않는다.
  assertEquals(await env.supervisor.restart(APP, first), false);
  assertEquals(env.spawned, 2);
  assertEquals(
    await env.supervisor.restart("app_00000000000000000000000009", first),
    false,
  );
});

Deno.test("apps/runtime#R28: 종료·시작 실패·crash loop는 근거 사실로 알리고 의도된 정지는 intended로 표시한다", async () => {
  const stopped = harness();
  await stopped.supervisor.reconcile(desired());
  await stopped.supervisor.reconcile(desired({ runEnabled: false }));
  assertEquals(stopped.events.length, 1);
  assertEquals(stopped.events[0].kind, "exit");
  assertEquals(
    (stopped.events[0] as Extract<SupervisorEvent, { kind: "exit" }>).intended,
    true,
  );

  const crashed = harness();
  await crashed.supervisor.reconcile(desired());
  crashed.child(0).kill(1);
  for (let tick = 0; tick < 20; tick++) await Promise.resolve();
  const exit = crashed.events.find((event) => event.kind === "exit") as
    | Extract<SupervisorEvent, { kind: "exit" }>
    | undefined;
  assert(exit !== undefined);
  assertEquals(exit.intended, false);
  assertEquals(exit.exitCode, 1);
  assertEquals(exit.processNonce, crashed.child(0).identity.processNonce);

  const failed = harness({
    probe: () => ({ ok: false, reason: "ready timeout" }),
  });
  await failed.supervisor.reconcile(desired());
  const start = failed.events.find((event) => event.kind === "start_failed") as
    | Extract<SupervisorEvent, { kind: "start_failed" }>
    | undefined;
  assert(start !== undefined);
  assertEquals(start.reason.summary, "ready timeout");
});

Deno.test("apps/runtime#R19: 멈춘 앱은 지난 crash loop 근거를 관측에 남기지 않는다", async () => {
  const env = harness();
  await env.supervisor.reconcile(desired());
  for (let crash = 0; crash < 6; crash++) {
    env.child(env.spawned - 1).kill(1);
    for (let tick = 0; tick < 50; tick++) await Promise.resolve();
  }
  assertEquals(env.supervisor.observation(APP)!.reason?.code, "crash_loop");
  // 사람이 멈추면 그 근거는 더 이상 이 앱의 현재 상태가 아니다.
  await env.supervisor.reconcile(desired({ runEnabled: false }));
  assertEquals(env.supervisor.observation(APP)!.reason, undefined);
});

Deno.test("apps/releases#R13, R14: activation은 이전 자식 종료를 확인해 붙들고 후보는 검사까지만 하며 commit 뒤 open이 통로를 열고 시작을 알린다", async () => {
  const opened: number[] = [];
  const env = harness({
    open: (index) => {
      opened.push(index);
      return Promise.resolve(true);
    },
  });
  await env.supervisor.reconcile(desired());
  assertEquals(env.spawned, 1);
  assertEquals(opened, [0]);
  const started = env.records.filter((r) => r.method === "record_started");
  assertEquals(started.length, 1);

  // 붙들면 이전 자식은 종료를 확인하고, 그동안 core가 알리는 상태로 새 자식을 띄우지 않는다.
  assertEquals(await env.supervisor.pause(APP), true);
  assertEquals(env.child(0).stopRequests, 1);
  await env.supervisor.reconcile(desired());
  assertEquals(env.spawned, 1);

  // 후보는 검사까지만 한다: 통로를 열지도 시작을 알리지도 않는다.
  const next = desired({ release: "rel_00000000000000000000000002" });
  const candidate = await env.supervisor.prepare(next);
  assert(candidate.ok);
  assertEquals(candidate.attestation.release, next.release);
  assertEquals(opened, [0]);
  assertEquals(
    env.records.filter((r) => r.method === "record_started").length,
    1,
  );
  // 붙들지 않은 앱에는 후보를 띄우지 않는다.
  assertEquals(
    (await env.supervisor.prepare(desired({ app: "app_x" }))).ok,
    false,
  );
  // 자식이 남아 있으면 둘째 후보를 띄우지 않는다(같은 DB를 둘이 쓰지 못한다).
  assertEquals((await env.supervisor.prepare(next)).ok, false);

  // commit 뒤에만 연다.
  assertEquals(await env.supervisor.open(APP), true);
  assertEquals(opened, [0, 1]);
  assertEquals(
    env.records.filter((r) => r.method === "record_started").length,
    2,
  );
  await env.supervisor.resume(APP);
  assertEquals(env.spawned, 2);
  assertEquals(env.alive(), 1);
});

Deno.test("apps/releases#R13: 종료를 확인하지 못하면 붙들기는 확인 아님을 알리고 새 자식을 띄우지 않는다", async () => {
  const env = harness({ confirm: false });
  await env.supervisor.reconcile(desired());
  assertEquals(await env.supervisor.pause(APP), false);
  const candidate = await env.supervisor.prepare(
    desired({ release: "rel_00000000000000000000000002" }),
  );
  assertEquals(candidate.ok, false);
  assertEquals(env.spawned, 1);
});
