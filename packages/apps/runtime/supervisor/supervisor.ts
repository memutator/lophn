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
import { TERMINATING } from "../model.ts";
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
  // 현재 blueprint가 선언한 화면과 크기. connection은 이 선언과의 교집합만 받는다.
  screens?: Record<string, ("full" | "panel" | "card")[]>;
  dataSchema: number;
  flags: FlagSet;
  entry: string;
  importMap: string;
  dataPath: string;
};

// 프로세스 실패의 근거가 되는 사실. 조립이 problems 관측(crash)으로 바꾼다(R28).
export type SupervisorEvent =
  | {
    kind: "exit";
    app: string;
    desired: DesiredApp;
    processNonce: string;
    // 정지 요청 전에 의도된 종료로 표시한 종료다(R18).
    intended: boolean;
    exitCode: number | null;
  }
  | {
    kind: "start_failed";
    app: string;
    desired: DesiredApp;
    processNonce?: string;
    reason: { code: string; summary: string };
  }
  | { kind: "crash_loop"; app: string; desired: DesiredApp; exits: number };

export type SupervisorDeps = {
  clock: Clock;
  core: CoreLink;
  deno: () => string;
  environment: AppEnvironment;
  // 앱마다 정해진 자리의 두 socket이다. 같은 앱은 같은 자리를 쓴다(이전 자식 종료 확인 뒤에만 다시 쓴다).
  socketPaths: (app: string) => { broker: string; direct: string };
  nonce: () => string;
  // 자식마다 받는 broker credential이다. supervisor 자신의 machine credential을 자식에게
  // 주지 않는다. 발급이 거절되면 그 시작은 실패한다.
  credential: (request: {
    desired: DesiredApp;
    nonce: string;
  }) => Promise<string> | string;
  // hello 뒤에 채워지므로 기동 시점에 읽는다.
  verifyKey: () => string;
  spawn: (request: SpawnRequest) => Promise<AppChild>;
  probe: (
    child: AppChild,
    direct: string,
    desired: DesiredApp,
  ) => Promise<ProbeResult> | ProbeResult;
  // 테스트가 시간을 건너뛰게 한다. 운영에서는 실제 대기.
  wait: (ms: number) => Promise<void>;
  readyTimeoutMs?: number;
  // probe가 통과한 프로세스에 통로를 연다(control/open). 연결하지 않으면 probe 통과가
  // 곧 연 것이다. false를 돌려주면 시작 실패다.
  open?: (
    child: AppChild,
    direct: string,
    desired: DesiredApp,
  ) => Promise<boolean>;
  // 사람의 멈춤·release 교체에서 새 command·clock을 닫고 진행 호출 종료를 요청한다(R15).
  // 연결하지 않으면 요청할 통로가 없으므로 유예 없이 바로 강제 종료한다.
  requestStop?: (
    child: AppChild,
    direct: string,
    desired: DesiredApp,
  ) => Promise<void>;
  stopGraceMs?: number;
  // 실패 근거 사실을 받는다. 던져도 supervisor는 계속 돈다.
  onEvent?: (event: SupervisorEvent) => void;
  // 자식 종료를 관측하면 알린다. 결과를 못 받은 invocation을 미확인으로 확정하는 쪽이 쓴다
  // (apps/invocations#R10). 어떤 이유의 종료든 부른다.
  childExited?: (processNonce: string) => void;
};

// 진행 호출 종료 요청 뒤 강제 종료까지의 유예다(R15).
export const STOP_GRACE_MS = 10_000;

export type SpawnRequest = {
  app: string;
  release: string;
  // 이번 시작의 두 socket. flag에는 없으니 띄우는 쪽이 socketFlags로 더한다.
  sockets: { brokerSocket: string; directSocket: string };
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
  // record_started가 core에 닿았을 때만 종료 확인을 record_stopped로 남긴다.
  started: boolean;
  // hash·handler·schema·실제 연결 검사를 통과했다(ReadyAttestation). 그 전에는 ready가 아니다.
  probed: boolean;
  // control/open까지 끝나 새 호출을 받는다.
  opened: boolean;
  // probe가 확인한 실제 등록 command. probe 전에는 선언한 목록이다.
  commands: string[];
};

// 진행 호출이 끝날 시간을 주는 정지. daemon 종료·core 단절은 바로 끝낸다.
function graceful(reason: StopReason): boolean {
  return reason === "user_stop" || reason === "release_change" ||
    reason === "restart";
}

const CRASH_LOOP = {
  code: "crash_loop",
  summary: "unexpected exits exceeded five within ten minutes",
};

export type Supervisor = {
  // 원하는 상태를 반영한다. 겹쳐 불러도 같은 앱의 자식은 하나다.
  reconcile(desired: DesiredApp): Promise<void>;
  // 그 nonce의 자식을 정지 확인 뒤 새 nonce로 다시 띄운다. 이미 다른 자식이면 하지 않는다.
  // 회수된 credential·줄어든 agent 허락의 이전 통로를 닫는 길이다(apps Q5).
  restart(app: string, nonce: string): Promise<boolean>;
  // core 제어 연결이 끊겼다. 새 호출을 닫고 자식을 모두 끝낸다.
  coreClosed(): Promise<void>;
  // 관측. 테스트와 runtime read가 본다.
  observation(app: string): AppObservation | undefined;
  stop(): Promise<void>;
};

export type AppObservation = {
  app: string;
  release: string;
  mode: "live";
  bundleHash: string;
  processNonce: string;
  // 현재 자식의 direct socket. 자식이 없으면 빈 문자열이다.
  endpoint: string;
  commands: string[];
  screens: Record<string, ("full" | "panel" | "card")[]>;
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
  async function record(
    runtime: AppRuntime,
    entry: RuntimeRecord,
  ): Promise<boolean> {
    try {
      const result = await deps.core.record(entry);
      if (!result.ok) runtime.recordFailed = result.error.message;
      return result.ok;
    } catch (error) {
      runtime.recordFailed = error instanceof Error
        ? error.message
        : "record failed";
      return false;
    }
  }

  function emit(event: SupervisorEvent): void {
    try {
      deps.onEvent?.(event);
    } catch { /* 관측 전달 실패가 supervisor를 멈추지 않는다 */ }
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
    if (graceful(reason) && deps.requestStop) {
      try {
        await deps.requestStop(
          tracked.child,
          tracked.direct,
          tracked.desired,
        );
      } catch {
        // 요청이 닿지 않아도 유예 뒤 강제 종료가 이어진다(R15).
      }
      // 앱이 스스로 끝나거나 유예가 지나면 그때 강제 종료로 넘어간다.
      await Promise.race([
        tracked.child.exited,
        deps.wait(deps.stopGraceMs ?? STOP_GRACE_MS),
      ]);
    }
    const confirmed = await tracked.child.terminate();
    if (!confirmed) return false;
    const code = await tracked.child.exited;
    if (unexpected({ intended: tracked.intended, exitCode: code })) {
      runtime.exits.push({ atMs: deps.clock.nowMs() });
    }
    emit({
      kind: "exit",
      app: tracked.desired.app,
      desired: tracked.desired,
      processNonce: tracked.child.identity.processNonce,
      intended: tracked.intended !== undefined,
      exitCode: code,
    });
    runtime.tracked = undefined;
    if (tracked.started && reason !== "core_eof") {
      await record(runtime, {
        method: "record_stopped",
        app: tracked.desired.app,
        release: tracked.desired.release,
        process_nonce: tracked.child.identity.processNonce,
        started_at: startedAt(tracked.child.identity.startedAtMs),
      });
    }
    return true;
  }

  async function launch(runtime: AppRuntime, desired: DesiredApp) {
    const nonce = deps.nonce();
    const sockets = deps.socketPaths(desired.app);
    const identity: ChildIdentity = {
      pid: 0,
      startedAtMs: deps.clock.nowMs(),
      processNonce: nonce,
    };
    let credential: string;
    try {
      credential = await deps.credential({ desired, nonce });
    } catch {
      await record(runtime, {
        method: "record_unavailable",
        app: desired.app,
        release: desired.release,
        reason: {
          code: "start_failed",
          summary: "app credential is unavailable",
        },
      });
      return;
    }
    const child = await deps.spawn({
      app: desired.app,
      release: desired.release,
      sockets: { brokerSocket: sockets.broker, directSocket: sockets.direct },
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
        credential,
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
      started: false,
      probed: false,
      opened: false,
      commands: [...desired.commands],
    };
    runtime.tracked = tracked;
    // 자식이 스스로 끝나면 재시작 정책을 적용한다. 정지 요청 뒤의 종료는 여기 오지 않는다.
    void child.exited.then(() => {
      deps.childExited?.(nonce);
      return onChildExit(runtime, tracked);
    });
    const probe = await Promise.race([
      deps.probe(child, sockets.direct, desired),
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
    tracked.probed = true;
    tracked.commands = [...probe.commands];
    // open 연결이 없으면 probe 통과가 곧 연 것이다. 연결했는데 열지 못하면 시작 실패다.
    if (deps.open) {
      let opened = false;
      try {
        opened = await deps.open(child, sockets.direct, desired);
      } catch {
        opened = false;
      }
      if (!sameChild(identity, child.identity)) return;
      if (!opened) {
        await failStart(runtime, tracked, {
          code: "start_failed",
          summary: "open failed",
        });
        return;
      }
    }
    tracked.opened = true;
    tracked.started = await record(runtime, {
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
    emit({
      kind: "start_failed",
      app: tracked.desired.app,
      desired: tracked.desired,
      processNonce: tracked.child.identity.processNonce,
      reason,
    });
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
      emit({
        kind: "crash_loop",
        app: desired.app,
        desired,
        exits: runtime.exits.length,
      });
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
      emit({
        kind: "exit",
        app: tracked.desired.app,
        desired: tracked.desired,
        processNonce: tracked.child.identity.processNonce,
        intended: false,
        exitCode: code,
      });
      if (!unexpected({ intended: tracked.intended, exitCode: code })) return;
      const now = deps.clock.nowMs();
      runtime.exits = [...recentExits(runtime.exits, now), { atMs: now }];
      const desired = runtime.desired;
      if (!desired || !desired.runEnabled || desired.archived || closed) return;
      if (crashLoop(runtime.exits, now)) {
        runtime.held = CRASH_LOOP;
        emit({
          kind: "crash_loop",
          app: desired.app,
          desired,
          exits: runtime.exits.length,
        });
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
    async restart(app, nonce) {
      const runtime = apps.get(app);
      if (!runtime) return false;
      let restarted = false;
      await enqueue(runtime, async () => {
        const current = runtime.tracked;
        // 그 사이 이미 다른 자식이 됐으면 새 통로를 닫지 않는다.
        if (!current || current.child.identity.processNonce !== nonce) return;
        const confirmed = await stopTracked(runtime, "restart");
        if (!confirmed) return;
        restarted = true;
        await apply(runtime);
      });
      return restarted;
    },
    observation(app) {
      const runtime = apps.get(app);
      if (!runtime) return undefined;
      const tracked = runtime.tracked;
      const desired = tracked?.desired ?? runtime.desired;
      const live = tracked !== undefined && tracked.intended === undefined;
      return {
        app,
        release: desired?.release ?? "",
        mode: "live",
        bundleHash: desired?.bundleHash ?? "",
        processNonce: tracked?.child.identity.processNonce ?? "",
        endpoint: tracked?.direct ?? "",
        commands: [...(tracked?.commands ?? desired?.commands ?? [])],
        screens: { ...(desired?.screens ?? {}) },
        // 검사를 통과한 자식만 ready다. 띄운 직후나 probe 중에는 아니다.
        ready: live && tracked.probed,
        accepting: live && tracked.probed && tracked.opened && !runtime.held,
        // 정지를 요청했지만 OS 종료를 아직 확인하지 못한 자식이다(R15).
        ...(tracked !== undefined && tracked.intended !== undefined
          ? { reason: TERMINATING }
          : runtime.held && desired?.runEnabled
          ? { reason: runtime.held }
          : {}),
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
