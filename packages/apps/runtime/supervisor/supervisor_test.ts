import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../../base/mod.ts";
import type { Result } from "../../../base/mod.ts";
import type { CoreLink, RuntimeRecord } from "../core-link.ts";
import type { AppChild, DesiredApp, ProbeResult } from "./supervisor.ts";
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
  probe?: (index: number) => ProbeResult;
  confirm?: boolean;
} = {}): Harness {
  const clock = manualClock(0);
  const records: RuntimeRecord[] = [];
  const children: FakeChild[] = [];
  let nonce = 0;
  const core: CoreLink = {
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
    socketPaths: () => ({ broker: "/run/b.sock", direct: "/run/a.sock" }),
    nonce: () => `nonce-${nonce++}`,
    credential: () => "broker-credential",
    verifyKey: "v".repeat(43),
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
    wait: () => Promise.resolve(),
  });
  return {
    records,
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
