// R15 supervisor 정지 순서: 새 호출을 닫고 진행 호출 종료를 요청한 뒤 10초 유예,
// 그래도 안 끝나면 강제 종료, OS 종료 확인 전에는 종료 중 관측.
import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../base/mod.ts";
import type { CoreLink, RuntimeRecord } from "./core-link.ts";
import {
  type AppChild,
  createSupervisor,
  type DesiredApp,
  STOP_GRACE_MS,
} from "./supervisor/mod.ts";
import { TERMINATING } from "./model.ts";

const APP = "app_00000000000000000000000001";
const RELEASE = "rel_00000000000000000000000001";

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

type Probe = {
  ok: true;
  commands: string[];
  dataSchema: number;
  bundleHash: string;
};
const okProbe: Probe = {
  ok: true,
  commands: ["ping"],
  dataSchema: 1,
  bundleHash: "ab".repeat(32),
};

function build(options: {
  spawn: (nonce: string, startedAtMs: number) => Promise<AppChild>;
  wait: (ms: number) => Promise<void>;
  requestStop?: (child: AppChild) => Promise<void>;
  graceMs?: number;
}) {
  const records: RuntimeRecord[] = [];
  const core: CoreLink = {
    record(record) {
      records.push(record);
      return Promise.resolve({ ok: true, value: { state: "recorded" } });
    },
  };
  let n = 0;
  const supervisor = createSupervisor({
    clock: manualClock(0),
    core,
    deno: () => "deno",
    environment: {},
    socketPaths: () => ({ broker: "/run/b", direct: "/run/a" }),
    nonce: () => `nonce-${n++}`,
    credential: () => "c",
    verifyKey: () => "v",
    spawn: (request) =>
      options.spawn(
        request.identity.processNonce,
        request.identity.startedAtMs,
      ),
    probe: () => Promise.resolve(okProbe),
    wait: options.wait,
    requestStop: options.requestStop,
    ...(options.graceMs === undefined ? {} : { stopGraceMs: options.graceMs }),
  });
  return { records, supervisor };
}

Deno.test("apps/runtime#R15: 사람의 멈춤은 종료 요청을 먼저 보내고 10초 유예 뒤에 강제 종료하며 종료 확인 전에는 종료 중으로 관측된다", async () => {
  assertEquals(STOP_GRACE_MS, 10_000);
  const order: string[] = [];
  let graceElapsed: () => void = () => {};
  const grace = new Promise<void>((resolve) => (graceElapsed = resolve));
  let waitedMs = -1;
  let resolveExit: (code: number | null) => void = () => {};
  let confirmTerminate: (ok: boolean) => void = () => {};
  const env = build({
    spawn: (nonce, startedAtMs) =>
      Promise.resolve<AppChild>({
        identity: { pid: 10, startedAtMs, processNonce: nonce },
        exited: new Promise((resolve) => (resolveExit = resolve)),
        terminate() {
          order.push("terminate");
          return new Promise<boolean>((resolve) => {
            confirmTerminate = (confirmed) => {
              if (confirmed) resolveExit(null);
              resolve(confirmed);
            };
          });
        },
      }),
    wait: (ms) => {
      // 유예 대기만 멈춰 두고, 시작 timeout 경쟁은 probe가 먼저 이기므로 영향이 없다.
      if (ms === STOP_GRACE_MS) {
        waitedMs = ms;
        order.push("grace");
        return grace;
      }
      return new Promise(() => {});
    },
    requestStop() {
      order.push("request");
      return Promise.resolve();
    },
  });
  await env.supervisor.reconcile(desired());
  assertEquals(env.supervisor.observation(APP)?.ready, true);
  const stopping = env.supervisor.reconcile(desired({ runEnabled: false }));
  // 요청이 먼저 가고 유예 동안 종료는 시도하지 않는다.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assertEquals(order, ["request", "grace"]);
  assertEquals(waitedMs, 10_000);
  const during = env.supervisor.observation(APP);
  assertEquals(during?.accepting, false);
  assertEquals(during?.reason, TERMINATING);
  graceElapsed();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assertEquals(order, ["request", "grace", "terminate"]);
  // OS 종료를 확인하기 전에는 아직 종료 중이고 record_stopped도 없다.
  assertEquals(env.supervisor.observation(APP)?.reason, TERMINATING);
  assert(!env.records.some((r) => r.method === "record_stopped"));
  confirmTerminate(true);
  await stopping;
  const stopped = env.records.find((r) => r.method === "record_stopped");
  assert(stopped && stopped.method === "record_stopped");
  assertEquals(stopped.process_nonce, "nonce-0");
  assertEquals(env.supervisor.observation(APP)?.ready, false);
  assertEquals(env.supervisor.observation(APP)?.reason, undefined);
});

Deno.test("apps/runtime#R15: 앱이 유예 안에 스스로 끝나면 기다리지 않고 종료를 확인한다", async () => {
  let resolveExit: (code: number | null) => void = () => {};
  const env = build({
    spawn: (nonce, startedAtMs) =>
      Promise.resolve<AppChild>({
        identity: { pid: 11, startedAtMs, processNonce: nonce },
        exited: new Promise((resolve) => (resolveExit = resolve)),
        terminate() {
          resolveExit(0);
          return Promise.resolve(true);
        },
      }),
    wait: (ms) =>
      ms === STOP_GRACE_MS ? new Promise(() => {}) : new Promise(() => {}),
    requestStop() {
      // 요청을 받은 앱이 곧 끝난다.
      queueMicrotask(() => resolveExit(0));
      return Promise.resolve();
    },
  });
  await env.supervisor.reconcile(desired());
  await env.supervisor.reconcile(desired({ runEnabled: false }));
  assert(env.records.some((r) => r.method === "record_stopped"));
});

Deno.test("apps/runtime#R15: 끝나지 않는 실제 자식은 유예 뒤 강제 종료된다", async () => {
  // 종료 요청을 무시하는 실제 Deno 자식. 유예만 짧게 줄여 같은 순서를 본다.
  const command = new Deno.Command(Deno.execPath(), {
    args: ["eval", "setInterval(() => {}, 1000)"],
    stdin: "null",
    stdout: "null",
    stderr: "null",
  });
  let process: Deno.ChildProcess | undefined;
  const requested: number[] = [];
  const env = build({
    graceMs: 300,
    spawn: (nonce, startedAtMs) => {
      process = command.spawn();
      const child = process;
      return Promise.resolve<AppChild>({
        identity: { pid: child.pid, startedAtMs, processNonce: nonce },
        exited: child.status.then((status) =>
          status.signal ? null : status.code
        ),
        async terminate() {
          child.kill("SIGKILL");
          await child.status;
          return true;
        },
      });
    },
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    requestStop() {
      requested.push(Date.now());
      return Promise.resolve();
    },
  });
  try {
    await env.supervisor.reconcile(desired());
    const startedAt = Date.now();
    await env.supervisor.reconcile(desired({ runEnabled: false }));
    const elapsed = Date.now() - startedAt;
    assertEquals(requested.length, 1);
    // 유예(300ms)를 기다린 뒤에야 강제 종료됐다.
    assert(elapsed >= 280, `forced after ${elapsed}ms`);
    const status = await process!.status;
    assertEquals(status.signal, "SIGKILL");
    assert(env.records.some((r) => r.method === "record_stopped"));
  } finally {
    try {
      process?.kill("SIGKILL");
    } catch {
      // 이미 끝났다.
    }
  }
});
