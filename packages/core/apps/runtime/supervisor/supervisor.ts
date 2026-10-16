// 공유 supervisor의 앱 프로세스 수명. 앱마다 운영 자식을 많아야 하나 둔다.
// 이전 자식의 종료를 확인하기 전에는 다음 자식을 띄우지 않는다.
import type { Clock } from "../../../../base/mod.ts";
import type { AppProcessStartInput } from "../../../../protocol/apps/calls/mod.ts";
import type { FlagSet } from "../../permissions/mod.ts";
import type { CoreLink, RuntimeRecord } from "../core-link.ts";
import type { ChildIdentity } from "../processes/identity.ts";
import { sameChild } from "../processes/identity.ts";
import type { AppEnvironment } from "../processes/spawn.ts";
import type { StopReason } from "../processes/terminate.ts";
import { unexpected } from "../processes/terminate.ts";
import { TERMINATING } from "../model.ts";
import {
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

type ProbeResult =
  | {
    ok: true;
    app_api: string[];
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
  app_api: string[];
  // 현재 blueprint가 선언한 화면과 크기. connection은 이 선언과의 교집합만 받는다.
  screens?: Record<string, ("full" | "panel" | "card")[]>;
  dataSchema: number;
  flags: FlagSet;
  entry: string;
  importMap: string;
  dataPath: string;
};

// 프로세스 실패의 근거가 되는 사실. 조립이 problems 관측(crash)으로 바꾼다.
export type SupervisorEvent =
  | {
    kind: "exit";
    app: string;
    desired: DesiredApp;
    processNonce: string;
    // 정지 요청 전에 의도된 종료로 표시한 종료다.
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
  socketPaths: (app: string) => { broker: string; control: string };
  nonce: () => string;
  // 자식마다 받는 broker credential이다. supervisor 자신의 machine credential을 자식에게
  // 주지 않는다. 발급이 거절되면 그 시작은 실패한다.
  credential: (request: {
    desired: DesiredApp;
    nonce: string;
  }) => Promise<string> | string;
  // 앱 시작이 DB를 바꿨을 때 앱 process가 broker `ready`로 보낸 changeset(base64). 시작 사실에 싣는다.
  startChangeset?: (processNonce: string) => string | undefined;
  spawn: (request: SpawnRequest) => Promise<AppChild>;
  probe: (
    child: AppChild,
    control: string,
    desired: DesiredApp,
  ) => Promise<ProbeResult> | ProbeResult;
  // 테스트가 시간을 건너뛰게 한다. 운영에서는 실제 대기.
  wait: (ms: number) => Promise<void>;
  readyTimeoutMs?: number;
  // probe가 통과한 프로세스에 통로를 연다(control/open). 연결하지 않으면 probe 통과가
  // 곧 연 것이다. false를 돌려주면 시작 실패다.
  open?: (
    child: AppChild,
    control: string,
    desired: DesiredApp,
  ) => Promise<boolean>;
  // 사람의 멈춤·release 교체에서 새 command·clock을 닫고 진행 호출 종료를 요청한다.
  // 연결하지 않으면 요청할 통로가 없으므로 유예 없이 바로 강제 종료한다.
  requestStop?: (
    child: AppChild,
    control: string,
    desired: DesiredApp,
  ) => Promise<void>;
  stopGraceMs?: number;
  // 실패 근거 사실을 받는다. 던져도 supervisor는 계속 돈다.
  onEvent?: (event: SupervisorEvent) => void;
  // 자식 종료를 관측하면 알린다. 결과를 못 받은 invocation을 미확인으로 확정하는 쪽이 쓴다.
  // 어떤 이유의 종료든 부른다.
  childExited?: (processNonce: string) => void;
};

// 진행 호출 종료 요청 뒤 강제 종료까지의 유예다.
const STOP_GRACE_MS = 10_000;

type SpawnRequest = {
  app: string;
  release: string;
  // 이번 시작의 두 socket. flag에는 없으니 띄우는 쪽이 socketFlags로 더한다.
  sockets: { brokerSocket: string; controlSocket: string };
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
  control: string;
  intended: StopReason | undefined;
  // record_started가 core에 닿았을 때만 종료 확인을 record_stopped로 남긴다.
  started: boolean;
  // hash·handler·schema·실제 연결 검사를 통과했다(ReadyAttestation). 그 전에는 ready가 아니다.
  probed: boolean;
  // control/open까지 끝나 새 호출을 받는다.
  opened: boolean;
  // probe가 확인한 실제 등록 command. probe 전에는 선언한 목록이다.
  app_api: string[];
  // 준비 모드(activation 후보)로 probe만 통과하고 아직 열지 않았다. 열 때 시작 사실에 쓴다.
  attestation?: {
    release: string;
    bundleHash: string;
    app_api: string[];
    dataSchema: number;
  };
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
  // 회수된 credential·줄어든 agent 허락의 이전 통로를 닫는 길이다.
  restart(app: string, nonce: string): Promise<boolean>;
  // activation: 그 앱의 자식을 의도된 종료로 끝내고 OS 종료를 확인한 뒤 새 시작을 막는다. true만 종료
  // 확인이다. 자식이 없으면 곧바로 true다. 이미 붙들고 있으면 남은 자식(후보)의 종료만 다시 확인한다.
  pause(app: string): Promise<boolean>;
  // activation: 붙든 앱에 후보를 준비 모드로 띄운다. 검사(probe)까지만 하고 업무 통로·clock은 열지 않고
  // 실행 상태도 알리지 않는다. 붙들고 있지 않거나 자식이 남아 있으면 시작하지 않는다.
  prepare(desired: DesiredApp): Promise<CandidateStart>;
  // activation: 성공 commit 뒤에만 부른다. 준비 모드 후보의 통로를 열고 시작을 알린다.
  open(app: string): Promise<boolean>;
  // activation: 붙들기를 풀고 core가 알린 원하는 상태로 맞춘다.
  resume(app: string): Promise<void>;
  // core 호출을 중계할 수 있는 live 자식의 control socket. probe와 open을 마쳤고 멈추는 중이 아닌 자식만이다.
  control(app: string): ControlTarget | undefined;
  // core 제어 연결이 끊겼다. 새 호출을 닫고 자식을 모두 끝낸다.
  coreClosed(): Promise<void>;
  // 관측. 테스트와 runtime read가 본다.
  observation(app: string): AppObservation | undefined;
  stop(): Promise<void>;
};

type AppObservation = {
  app: string;
  release: string;
  mode: "live";
  bundleHash: string;
  processNonce: string;
  app_api: string[];
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
  // crash loop로 멈춘 것을 core에 알렸다. 다시 돌 수 있게 될 때까지 한 번만 알린다.
  haltReported: boolean;
  // 진행 중인 reconcile이 있으면 다음 요청은 그 뒤로 붙는다.
  pending: Promise<void>;
  // activation이 이 앱을 붙들고 있다. 이전 자식은 종료를 확인했고 core가 알리는 원하는 상태는
  // 저장만 하며 시작하지 않는다. `resume`이 풀고 그때의 원하는 상태로 맞춘다.
  paused: boolean;
};

export type ControlTarget = {
  socket: string;
  release: string;
  processNonce: string;
};

// 후보 시작의 결과다. 준비 모드의 자식이 hash·handler·schema·연결 검사를 통과했다는 확인이다.
type CandidateStart =
  | {
    ok: true;
    processNonce: string;
    attestation: {
      release: string;
      bundleHash: string;
      app_api: string[];
      dataSchema: number;
    };
  }
  | { ok: false; reason: string };

function startLine(input: {
  desired: DesiredApp;
  nonce: string;
  broker: string;
  control: string;
  credential: string;
}): string {
  const line: AppProcessStartInput = {
    app: input.desired.app,
    release: input.desired.release,
    bundle_hash: input.desired.bundleHash,
    mode: "live",
    process_nonce: input.nonce,
    broker_socket: input.broker,
    control_socket: input.control,
    data_path: input.desired.dataPath,
    broker_credential: input.credential,
  };
  return JSON.stringify(line);
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
      haltReported: false,
      pending: Promise.resolve(),
      paused: false,
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
          tracked.control,
          tracked.desired,
        );
      } catch {
        // 요청이 닿지 않아도 유예 뒤 강제 종료가 이어진다.
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

  async function launch(
    runtime: AppRuntime,
    desired: DesiredApp,
    mode: { open: boolean } = { open: true },
  ): Promise<CandidateStart> {
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
      return { ok: false, reason: "app credential is unavailable" };
    }
    const child = await deps.spawn({
      app: desired.app,
      release: desired.release,
      sockets: { brokerSocket: sockets.broker, controlSocket: sockets.control },
      deno: deps.deno(),
      entry: desired.entry,
      flags: desired.flags,
      importMap: desired.importMap,
      environment: deps.environment,
      startLine: startLine({
        desired,
        nonce,
        broker: sockets.broker,
        control: sockets.control,
        credential,
      }),
      identity,
    });
    identity.pid = child.identity.pid;
    identity.startedAtMs = child.identity.startedAtMs;
    const tracked: Tracked = {
      child,
      desired,
      control: sockets.control,
      intended: undefined,
      started: false,
      probed: false,
      opened: false,
      app_api: [...desired.app_api],
    };
    runtime.tracked = tracked;
    // 자식이 스스로 끝나면 재시작 정책을 적용한다. 정지 요청 뒤의 종료는 여기 오지 않는다.
    void child.exited.then(() => {
      deps.childExited?.(nonce);
      return onChildExit(runtime, tracked);
    });
    const probe = await Promise.race([
      deps.probe(child, sockets.control, desired),
      deps.wait(timeout).then(() => ({
        ok: false as const,
        reason: "ready timeout",
      })),
    ]);
    if (!sameChild(identity, child.identity)) {
      return { ok: false, reason: "the child was replaced" };
    }
    if (!probe.ok || probe.bundleHash !== desired.bundleHash) {
      const reason = probe.ok ? "bundle mismatch" : probe.reason;
      await failStart(runtime, tracked, {
        code: "start_failed",
        summary: reason,
      });
      return { ok: false, reason };
    }
    const declared = [...desired.app_api].sort();
    const reported = [...probe.app_api].sort();
    const commandsMatch = declared.length === reported.length &&
      declared.every((key, index) => key === reported[index]);
    if (!commandsMatch || probe.dataSchema !== desired.dataSchema) {
      await failStart(runtime, tracked, {
        code: "start_failed",
        summary: "handler or schema mismatch",
      });
      return { ok: false, reason: "handler or schema mismatch" };
    }
    tracked.probed = true;
    tracked.app_api = [...probe.app_api];
    const attestation = {
      release: desired.release,
      bundleHash: probe.bundleHash,
      app_api: [...probe.app_api],
      dataSchema: probe.dataSchema,
    };
    // activation 후보는 검사까지만 한다. 통로를 열고 시작을 알리는 일은 commit 뒤의 `open`이다.
    if (!mode.open) {
      tracked.attestation = attestation;
      return { ok: true, processNonce: nonce, attestation };
    }
    const opened = await openTracked(runtime, tracked, attestation);
    return opened
      ? { ok: true, processNonce: nonce, attestation }
      : { ok: false, reason: "open failed" };
  }

  // probe를 통과한 자식의 통로를 열고 시작 사실을 core에 알린다. 열지 못하면 시작 실패다.
  async function openTracked(
    runtime: AppRuntime,
    tracked: Tracked,
    attestation: NonNullable<Tracked["attestation"]>,
  ): Promise<boolean> {
    const { child, desired, control } = tracked;
    const identity = child.identity;
    const nonce = identity.processNonce;
    // open 연결이 없으면 probe 통과가 곧 연 것이다. 연결했는데 열지 못하면 시작 실패다.
    if (deps.open) {
      let opened = false;
      try {
        opened = await deps.open(child, control, desired);
      } catch {
        opened = false;
      }
      if (!sameChild(identity, child.identity)) return false;
      if (!opened) {
        await failStart(runtime, tracked, {
          code: "start_failed",
          summary: "open failed",
        });
        return false;
      }
    }
    tracked.opened = true;
    const startChangeset = deps.startChangeset?.(nonce);
    tracked.started = await record(runtime, {
      method: "record_started",
      app: desired.app,
      process_nonce: nonce,
      started_at: startedAt(identity.startedAtMs),
      attestation: {
        release: desired.release,
        bundle_hash: attestation.bundleHash,
        app_api: attestation.app_api,
        data_schema: attestation.dataSchema,
        process_nonce: nonce,
        connection_ok: true,
      },
      ...(startChangeset === undefined
        ? {}
        : { start_changeset: startChangeset }),
    });
    return true;
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

  // crash loop로 멈춘다. core에는 한 번만 알린다(reconcile이 다시 와도 같은 멈춤은 되풀이하지 않는다).
  async function halt(
    runtime: AppRuntime,
    desired: DesiredApp,
    exited?: Tracked,
  ) {
    runtime.held = CRASH_LOOP;
    if (runtime.haltReported) return;
    runtime.haltReported = true;
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
      ...(exited === undefined ? {} : {
        process_nonce: exited.child.identity.processNonce,
        started_at: startedAt(exited.child.identity.startedAtMs),
      }),
      reason: CRASH_LOOP,
    });
  }

  async function apply(runtime: AppRuntime) {
    // activation이 붙든 앱은 core가 알린 상태를 저장만 한다.
    if (runtime.paused && !closed) return;
    const desired = runtime.desired;
    if (closed || !desired || !desired.runEnabled || desired.archived) {
      await stopTracked(runtime, closed ? "core_eof" : "user_stop");
      return;
    }
    runtime.exits = recentExits(runtime.exits, deps.clock.nowMs());
    if (crashLoop(runtime.exits, deps.clock.nowMs())) {
      await halt(runtime, desired);
      return;
    }
    runtime.haltReported = false;
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
        await halt(runtime, desired, tracked);
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
    async pause(app) {
      const runtime = runtimeOf(app);
      let confirmed = false;
      await enqueue(runtime, async () => {
        runtime.paused = true;
        // 새 호출·clock을 닫고(requestStop) 유예 뒤 강제 종료해 OS 종료를 확인한다.
        confirmed = await stopTracked(runtime, "release_change");
      });
      return confirmed;
    },
    async prepare(desired) {
      const runtime = runtimeOf(desired.app);
      let outcome: CandidateStart = { ok: false, reason: "not paused" };
      await enqueue(runtime, async () => {
        if (closed || !runtime.paused || runtime.tracked !== undefined) return;
        outcome = await launch(runtime, desired, { open: false });
      });
      return outcome;
    },
    async open(app) {
      const runtime = apps.get(app);
      if (!runtime) return false;
      let opened = false;
      await enqueue(runtime, async () => {
        const tracked = runtime.tracked;
        if (
          closed || tracked === undefined || tracked.intended !== undefined ||
          !tracked.probed || tracked.opened || tracked.attestation === undefined
        ) return;
        opened = await openTracked(runtime, tracked, tracked.attestation);
        // 채택된 release의 자식이 열렸다. 붙들기를 풀 때 이 자식을 이전 상태로 되돌리지 않는다.
        if (opened) runtime.desired = tracked.desired;
      });
      return opened;
    },
    async resume(app) {
      const runtime = apps.get(app);
      if (!runtime) return;
      await enqueue(runtime, async () => {
        runtime.paused = false;
        await apply(runtime);
      });
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
    control(app) {
      const runtime = apps.get(app);
      const tracked = runtime?.tracked;
      if (
        tracked === undefined || tracked.intended !== undefined ||
        !tracked.probed || !tracked.opened
      ) return undefined;
      return {
        socket: tracked.control,
        release: tracked.desired.release,
        processNonce: tracked.child.identity.processNonce,
      };
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
        app_api: [...(tracked?.app_api ?? desired?.app_api ?? [])],
        screens: { ...(desired?.screens ?? {}) },
        // 검사를 통과한 자식만 ready다. 띄운 직후나 probe 중에는 아니다.
        ready: live && tracked.probed,
        accepting: live && tracked.probed && tracked.opened && !runtime.held,
        // 정지를 요청했지만 OS 종료를 아직 확인하지 못한 자식이다.
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

export { backoffMs };
