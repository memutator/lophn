// 공유 supervisor의 앱 프로세스 수명. 앱마다 운영 자식을 많아야 하나 둔다.
// 이전 자식의 종료를 확인하기 전에는 다음 자식을 띄우지 않는다.
import type { Clock } from "../../../base/mod.ts";
import type { FlagSet } from "../../permissions/mod.ts";
import type { CoreLink, RuntimeRecord } from "../core-link.ts";
import type { ChildIdentity } from "../processes/identity.ts";
import { sameChild } from "../processes/identity.ts";
import type { AppEnvironment } from "../processes/spawn.ts";
import type { StopReason } from "../processes/terminate.ts";
import { unexpected } from "../processes/terminate.ts";
import {
  BACKOFF_MAX_MS,
  backoffMs,
  crashLoop,
  recentExits,
  type UnexpectedExit,
} from "./restart-policy.ts";

export type AppChild = {
  identity: ChildIdentity;
  exited: Promise<number | null>;
  // group 전체 종료를 확인하고 true만 종료 확인으로 돌려준다.
  terminate(): Promise<boolean>;
};

export type ProbeResult =
  | {
    ok: true;
    commands: string[];
    dataSchema: number;
    bundleHash: string;
  }
  | { ok: false; reason: string };

export type DesiredApp = {
  app: string;
  release: string;
  bundleHash: string;
  runEnabled: boolean;
  archived: boolean;
  commands: string[];
  dataSchema: number;
  flags: FlagSet;
  entry: string;
  importMap: string;
  dataPath: string;
};

export type SupervisorDeps = {
  clock: Clock;
  core: CoreLink;
  deno: () => string;
  environment: AppEnvironment;
  socketPaths: () => { broker: string; direct: string };
  nonce: () => string;
  credential: () => string;
  // hello 뒤에 채워지므로 기동 시점에 읽는다.
  verifyKey: () => string;
  spawn: (request: SpawnRequest) => Promise<AppChild>;
  probe: (
    child: AppChild,
    direct: string,
  ) => Promise<ProbeResult> | ProbeResult;
  // 테스트가 시간을 건너뛰게 한다. 운영에서는 실제 대기.
  wait: (ms: number) => Promise<void>;
  readyTimeoutMs?: number;
};

export type SpawnRequest = {
  deno: string;
  entry: string;
  flags: FlagSet;
  importMap: string;
  environment: AppEnvironment;
  startLine: string;
  identity: ChildIdentity;
};

type Tracked = {
  child: AppChild;
  desired: DesiredApp;
  direct: string;
  intended: StopReason | undefined;
};

const CRASH_LOOP = {
  code: "crash_loop",
  summary: "unexpected exits exceeded five within ten minutes",
};

export type Supervisor = {
  // 원하는 상태를 반영한다. 겹쳐 불러도 같은 앱의 자식은 하나다.
  reconcile(desired: DesiredApp): Promise<void>;
  // core 제어 연결이 끊겼다. 새 호출을 닫고 자식을 모두 끝낸다.
  coreClosed(): Promise<void>;
  // 관측. 테스트와 runtime read가 본다.
  observation(app: string): AppObservation | undefined;
  stop(): Promise<void>;
};

export type AppObservation = {
  app: string;
  release: string;
  processNonce: string;
  ready: boolean;
  accepting: boolean;
  reason?: { code: string; summary: string };
  recordFailed?: string;
};

type AppRuntime = {
  desired: DesiredApp | undefined;
  tracked: Tracked | undefined;
  exits: UnexpectedExit[];
  held: { code: string; summary: string } | undefined;
  // 마지막 record가 실패하면 그 앱의 관측 실패로 남긴다. supervisor는 계속 돈다.
  recordFailed: string | undefined;
  // 진행 중인 reconcile이 있으면 다음 요청은 그 뒤로 붙는다.
  pending: Promise<void>;
};

function startLine(input: {
  desired: DesiredApp;
  nonce: string;
  broker: string;
  direct: string;
  credential: string;
  verifyKey: string;
}): string {
  return JSON.stringify({
    app: input.desired.app,
    release: input.desired.release,
    bundle_hash: input.desired.bundleHash,
    mode: "live",
    process_nonce: input.nonce,
    broker_socket: input.broker,
    direct_socket: input.direct,
    data_path: input.desired.dataPath,
    broker_credential: input.credential,
    verify_key: input.verifyKey,
  });
}

export function createSupervisor(deps: SupervisorDeps): Supervisor {
  const apps = new Map<string, AppRuntime>();
  const timeout = deps.readyTimeoutMs ?? 30_000;
  let closed = false;

  function startedAt(ms: number): string {
    return new Date(ms).toISOString();
  }

  // record 실패는 그 앱의 관측 실패다. throw하지 않아 다른 앱으로 번지지 않는다.
  async function record(runtime: AppRuntime, entry: RuntimeRecord) {
    try {
      const result = await deps.core.record(entry);
      if (!result.ok) runtime.recordFailed = result.error.message;
    } catch (error) {
      runtime.recordFailed = error instanceof Error
        ? error.message
        : "record failed";
    }
  }

  function runtimeOf(app: string): AppRuntime {
    const found = apps.get(app);
    if (found) return found;
    const created: AppRuntime = {
      desired: undefined,
      tracked: undefined,
      exits: [],
      held: undefined,
      recordFailed: undefined,
      pending: Promise.resolve(),
    };
    apps.set(app, created);
    return created;
  }

  async function stopTracked(
    runtime: AppRuntime,
    reason: StopReason,
  ): Promise<boolean> {
    const tracked = runtime.tracked;
    if (!tracked) return true;
    tracked.intended = reason;
    const confirmed = await tracked.child.terminate();
    if (!confirmed) return false;
    const code = await tracked.child.exited;
    if (unexpected({ intended: tracked.intended, exitCode: code })) {
      runtime.exits.push({ atMs: deps.clock.nowMs() });
    }
    runtime.tracked = undefined;
    return true;
  }

  async function launch(runtime: AppRuntime, desired: DesiredApp) {
    const nonce = deps.nonce();
    const sockets = deps.socketPaths();
    const identity: ChildIdentity = {
      pid: 0,
      startedAtMs: deps.clock.nowMs(),
      processNonce: nonce,
    };
    const child = await deps.spawn({
      deno: deps.deno(),
      entry: desired.entry,
      flags: desired.flags,
      importMap: desired.importMap,
      environment: deps.environment,
      startLine: startLine({
        desired,
        nonce,
        broker: sockets.broker,
        direct: sockets.direct,
        credential: deps.credential(),
        verifyKey: deps.verifyKey(),
      }),
      identity,
    });
    identity.pid = child.identity.pid;
    identity.startedAtMs = child.identity.startedAtMs;
    const tracked: Tracked = {
      child,
      desired,
      direct: sockets.direct,
      intended: undefined,
    };
    runtime.tracked = tracked;
    // 자식이 스스로 끝나면 재시작 정책을 적용한다. 정지 요청 뒤의 종료는 여기 오지 않는다.
    void child.exited.then(() => onChildExit(runtime, tracked));
    const probe = await Promise.race([
      deps.probe(child, sockets.direct),
      deps.wait(timeout).then(() => ({
        ok: false as const,
        reason: "ready timeout",
      })),
    ]);
    if (!sameChild(identity, child.identity)) return;
    if (!probe.ok || probe.bundleHash !== desired.bundleHash) {
      await failStart(runtime, tracked, {
        code: "start_failed",
        summary: probe.ok ? "bundle mismatch" : probe.reason,
      });
      return;
    }
    const declared = [...desired.commands].sort();
    const reported = [...probe.commands].sort();
    const commandsMatch = declared.length === reported.length &&
      declared.every((key, index) => key === reported[index]);
    if (!commandsMatch || probe.dataSchema !== desired.dataSchema) {
      await failStart(runtime, tracked, {
        code: "start_failed",
        summary: "handler or schema mismatch",
      });
      return;
    }
    await record(runtime, {
      method: "record_started",
      app: desired.app,
      process_nonce: nonce,
      started_at: startedAt(identity.startedAtMs),
      attestation: {
        release: desired.release,
        bundle_hash: probe.bundleHash,
        commands: probe.commands,
        data_schema: probe.dataSchema,
        process_nonce: nonce,
        connection_ok: true,
      },
    });
  }

  // 시작 실패는 종료를 확인한 뒤에만 자식을 놓는다. 확인되지 않으면 다음 시작을 막는다.
  async function failStart(
    runtime: AppRuntime,
    tracked: Tracked,
    reason: { code: string; summary: string },
  ) {
    tracked.intended = "restart";
    const confirmed = await tracked.child.terminate();
    if (!confirmed) return;
    runtime.tracked = undefined;
    await record(runtime, {
      method: "record_unavailable",
      app: tracked.desired.app,
      release: tracked.desired.release,
      process_nonce: tracked.child.identity.processNonce,
      started_at: startedAt(tracked.child.identity.startedAtMs),
      reason,
    });
  }

  async function apply(runtime: AppRuntime) {
    const desired = runtime.desired;
    if (closed || !desired || !desired.runEnabled || desired.archived) {
      await stopTracked(runtime, closed ? "core_eof" : "user_stop");
      return;
    }
    runtime.exits = recentExits(runtime.exits, deps.clock.nowMs());
    if (crashLoop(runtime.exits, deps.clock.nowMs())) {
      runtime.held = CRASH_LOOP;
      await record(runtime, {
        method: "record_unavailable",
        app: desired.app,
        release: desired.release,
        reason: CRASH_LOOP,
      });
      return;
    }
    const current = runtime.tracked;
    // 종료를 확인하지 못한 자식이 남아 있으면 재허용이어도 그 종료를 먼저 다시 확인한다.
    if (current && current.intended !== undefined) {
      const confirmed = await stopTracked(runtime, current.intended);
      if (!confirmed) return;
    }
    if (
      runtime.tracked && runtime.tracked.desired.release === desired.release &&
      runtime.tracked.desired.bundleHash === desired.bundleHash
    ) return;
    if (runtime.tracked) {
      const confirmed = await stopTracked(runtime, "release_change");
      if (!confirmed) return;
    }
    await launch(runtime, desired);
  }

  // 예상 밖 종료만 센다. 의도된 종료는 crash도 backoff도 아니다.
  function onChildExit(runtime: AppRuntime, tracked: Tracked) {
    if (runtime.tracked !== tracked || tracked.intended !== undefined) return;
    void enqueue(runtime, async () => {
      if (runtime.tracked !== tracked || tracked.intended !== undefined) return;
      const code = await tracked.child.exited;
      const confirmed = await tracked.child.terminate();
      if (!confirmed) return;
      runtime.tracked = undefined;
      if (!unexpected({ intended: tracked.intended, exitCode: code })) return;
      const now = deps.clock.nowMs();
      runtime.exits = [...recentExits(runtime.exits, now), { atMs: now }];
      const desired = runtime.desired;
      if (!desired || !desired.runEnabled || desired.archived || closed) return;
      if (crashLoop(runtime.exits, now)) {
        runtime.held = CRASH_LOOP;
        await record(runtime, {
          method: "record_unavailable",
          app: desired.app,
          release: desired.release,
          process_nonce: tracked.child.identity.processNonce,
          started_at: startedAt(tracked.child.identity.startedAtMs),
          reason: CRASH_LOOP,
        });
        return;
      }
      await record(runtime, {
        method: "record_unavailable",
        app: desired.app,
        release: desired.release,
        process_nonce: tracked.child.identity.processNonce,
        started_at: startedAt(tracked.child.identity.startedAtMs),
        reason: { code: "unexpected_exit", summary: "the app process exited" },
      });
      await deps.wait(backoffMs(runtime.exits.length));
      if (runtime.desired?.runEnabled) await apply(runtime);
    });
  }

  function enqueue(runtime: AppRuntime, work: () => Promise<unknown>) {
    runtime.pending = runtime.pending.then(work, work).then(() => {});
    return runtime.pending;
  }

  return {
    reconcile(desired) {
      const runtime = runtimeOf(desired.app);
      runtime.desired = desired;
      if (desired.runEnabled) runtime.held = undefined;
      return enqueue(runtime, () => apply(runtime));
    },
    async coreClosed() {
      closed = true;
      const stops = [...apps.values()].map((runtime) =>
        enqueue(runtime, () => stopTracked(runtime, "core_eof"))
      );
      await Promise.all(stops);
    },
    observation(app) {
      const runtime = apps.get(app);
      if (!runtime) return undefined;
      const tracked = runtime.tracked;
      return {
        app,
        release: tracked?.desired.release ?? runtime.desired?.release ?? "",
        processNonce: tracked?.child.identity.processNonce ?? "",
        ready: tracked !== undefined && tracked.intended === undefined,
        accepting: tracked !== undefined && tracked.intended === undefined &&
          !runtime.held,
        ...(runtime.held ? { reason: runtime.held } : {}),
        ...(runtime.recordFailed ? { recordFailed: runtime.recordFailed } : {}),
      };
    },
    async stop() {
      closed = true;
      await Promise.all(
        [...apps.values()].map((runtime) =>
          enqueue(runtime, () => stopTracked(runtime, "daemon_shutdown"))
        ),
      );
    },
  };
}

export { BACKOFF_MAX_MS, backoffMs };
