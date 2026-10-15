import { ok, type Result } from "../../../base/mod.ts";
import type { RecoveryOutcome } from "../waiting-and-recovery/mod.ts";
import {
  type AgentRunCredential,
  beginRun,
  type BeginRunInput,
  type LoopDeps,
  type LoopEnd,
  type RunCredentials,
  type RunInput,
  type RunLoopHandle,
  startRunLoop,
  type StartRunResult,
  type StopReason,
} from "./mod.ts";

// 옛 selector 모양. 입력함의 turn starter(`createTurnStarter`)로 바꾸기 전까지 아무것도 고르지 않는다.
export type Selection = {
  run: string;
  assignment: string;
  session: string | null;
  stateSeq: string;
  reason: "priority" | "yield";
};
export type RunSelector = {
  next(): Promise<Result<Selection | null>>;
};

// 고른 run을 시작하고 loop를 돌리는 연결(lophn-agent/harness/run-loop). selector가 고른 run을
// StartRun으로 확정한 뒤 `agent:<asg>` credential을 받아 loop에 넘기고, run이 끝나거나 멈추거나
// 감독이 끊기면 credential을 끝낸다. credential은 tool 진입에만 쓴다. 실제 core 연결(basis 준비,
// StartRun command, loop의 port)은 `prepare`가 만든다.

export type PreparedRun = {
  begin: BeginRunInput;
  startRun(input: BeginRunInput): Promise<Result<StartRunResult>>;
  // StartRun이 확정되고 credential을 받은 뒤에 loop 재료를 만든다.
  loop(
    credential: AgentRunCredential,
    started: StartRunResult,
  ): {
    // 이 run이 호출하는 provider. Disconnect를 알릴 때 회수할 run을 고른다.
    provider: string;
    deps: LoopDeps;
    input: RunInput;
    // 사람의 결정을 기다리는 run의 결정 반영(기다림 해소기). 고정 call의 실제 입력은 이 process가
    // 들고 있다.
    settle?(): Promise<Result<unknown>>;
  };
};

// 시작한 run을 저장된 경계에서 잇는 재료(lophn-agent/harness/waiting-and-recovery). 재시작 뒤와 사람의
// 결정 뒤가 같은 길이다. loop는 ledger에서 다시 만든 이력·사실로 이어 간다.
export type PreparedResume = {
  assignment: string;
  // 기다림 해소기가 현재 결정을 한 걸음 반영한다.
  settle(): Promise<Result<unknown>>;
  // 경계를 확정하고 재확인한 뒤 같은 run을 잇는다. executing은 사람의 허락으로 진입이 이미 기록된
  // call이다.
  recover(executing?: ReadonlySet<string>): Promise<
    Result<
      | { kind: "ended"; outcome: RecoveryOutcome }
      | {
        kind: "resumed";
        credential: AgentRunCredential;
        provider: string;
        deps: LoopDeps;
        input: RunInput;
        settle(): Promise<Result<unknown>>;
      }
    >
  >;
};

export type DriveDeps = {
  selector: RunSelector;
  credentials: RunCredentials;
  prepare(selection: Selection): Promise<Result<PreparedRun>>;
  // 아직 끝나지 않고 시작한 run(진행 중·사람 기다림). 재시작 뒤 복구의 대상이다.
  liveRuns?(): Promise<
    Result<readonly { run: string; state: "running" | "waiting_user" }[]>
  >;
  prepareResume?(
    run: string,
    credentials: RunCredentials,
  ): Promise<Result<PreparedResume>>;
  // StartRun은 확정됐지만 credential을 받지 못한 run을 failed(configuration_unavailable)로 닫는다.
  closeUnusable(selection: Selection): Promise<void>;
};

export type DriveResult =
  | { kind: "idle" }
  | { kind: "unavailable" }
  | { kind: "not_started"; run: string }
  | { kind: "started"; run: string; done: Promise<LoopEnd> };

export type RecoverReport = {
  run: string;
  result:
    | "resumed"
    | "waiting"
    | "unavailable"
    | RecoveryOutcome["kind"];
  done?: Promise<LoopEnd>;
};

export type RunDriver = {
  // 시작 전에 부른다. 재시작 전에 진행하던 run과 사람을 기다리던 run을 저장된 경계에서 잇는다. 사람이
  // 멈춘 run은 이미 끝나 있어 대상이 아니다.
  recover(): Promise<Result<RecoverReport[]>>;
  // 사람의 결정을 반영한 run을 같은 run으로 잇는다(기다림 해소기 → 복구와 같은 길).
  resume(run: string): Promise<RecoverReport>;
  // 시작할 run 하나를 골라 시작한다. 없으면 idle이다.
  startNext(): Promise<DriveResult>;
  // 사람 멈춤·assignment 멈춤이 접수됐다. 새 진입을 막고 진행 호출에 중단을 요청한다.
  stop(run: string, reason: StopReason): void;
  stopAssignment(assignment: string, reason: StopReason): void;
  // provider를 Disconnect했다는 알림이다. 그 provider로 진행 중인 run 가운데 지금 연결을 더 쓸 수 없는 것의
  // 새 model 진입을 막고 진행 중인 호출에 취소를 요청한다. 알림이 늦게 처리돼 같은 ID로 다시 Connect한 뒤 시작한
  // run은 지금 연결에 묶여 있어 그대로 둔다. 다른 provider의 run은 건드리지 않는다.
  revokeProvider(provider: string): Promise<void>;
  revokeServer(server: string): void;
  // 감독이 끊겼다. 새 진입을 막고 진행 호출을 취소하며 들고 있는 credential을 모두 끝낸다.
  endAll(): void;
  // 기다리는 run의 결정을 한 번 반영한다. 이 process가 기다림에 넣은 run만 있다.
  settle(run: string): Promise<Result<unknown>> | undefined;
  readonly active: number;
};

export function createRunDriver(deps: DriveDeps): RunDriver {
  const waiting = new Map<string, () => Promise<Result<unknown>>>();
  const active = new Map<
    string,
    {
      assignment: string;
      provider: string;
      available(): Promise<boolean>;
      handle: RunLoopHandle;
    }
  >();

  async function resumeRun(run: string): Promise<RecoverReport> {
    if (active.has(run) || deps.prepareResume === undefined) {
      return { run, result: "unavailable" };
    }
    const prepared = await deps.prepareResume(run, deps.credentials);
    if (!prepared.ok) return { run, result: "unavailable" };
    // 기다리는 run은 현재 결정을 먼저 반영한다. 유효하고 미반영인 결정만 한 번 쓰이고, 아직 결정이
    // 없으면 계속 기다린다.
    let executing: ReadonlySet<string> | undefined;
    const step = await prepared.value.settle();
    if (!step.ok) return { run, result: "unavailable" };
    const value = step.value as {
      kind: string;
      state?: string;
      resolution?: { result: string; tool_call: string | null };
    };
    if (value.kind === "pending" || value.kind === "action_pending") {
      waiting.set(run, () => prepared.value.settle());
      return { run, result: "waiting" };
    }
    if (value.kind === "unverified") {
      waiting.set(run, () => prepared.value.settle());
      return { run, result: "waiting" };
    }
    if (value.kind === "resolved") {
      if (value.state !== "running") return { run, result: "finished" };
      const call = value.resolution?.tool_call;
      if (value.resolution?.result === "call_started" && call) {
        executing = new Set([call]);
      }
    }
    const recovered = await prepared.value.recover(executing);
    if (!recovered.ok) return { run, result: "unavailable" };
    if (recovered.value.kind === "ended") {
      return { run, result: recovered.value.outcome.kind };
    }
    const { credential, provider, deps: loopDeps, input, settle } =
      recovered.value;
    const handle = startRunLoop(loopDeps, input);
    active.set(run, {
      assignment: prepared.value.assignment,
      provider,
      available: () => loopDeps.ports.model.available(),
      handle,
    });
    const done = handle.done.then((end) => {
      if (end.kind === "waiting") waiting.set(run, settle);
      return end;
    }).finally(() => {
      deps.credentials.end(credential.run);
      active.delete(run);
    });
    return { run, result: "resumed", done };
  }

  return {
    async recover() {
      if (deps.liveRuns === undefined) return ok([]);
      const live = await deps.liveRuns();
      if (!live.ok) return live;
      const report: RecoverReport[] = [];
      for (const entry of live.value) {
        report.push(await resumeRun(entry.run));
      }
      return ok(report);
    },
    resume: resumeRun,
    async startNext() {
      const picked = await deps.selector.next();
      if (!picked.ok) return { kind: "unavailable" };
      const selection = picked.value;
      if (selection === null) return { kind: "idle" };
      const prepared = await deps.prepare(selection);
      if (!prepared.ok) return { kind: "unavailable" };
      const run = prepared.value;
      const begun = await beginRun(
        { credentials: deps.credentials, startRun: run.startRun },
        run.begin,
      );
      if (!begun.ok) {
        if (begun.started) await deps.closeUnusable(selection);
        return { kind: "not_started", run: selection.run };
      }
      const { provider, deps: loopDeps, input, settle } = run.loop(
        begun.value.credential,
        begun.value.started,
      );
      const handle = startRunLoop(loopDeps, input);
      active.set(selection.run, {
        assignment: selection.assignment,
        provider,
        available: () => loopDeps.ports.model.available(),
        handle,
      });
      const done = handle.done.then((end) => {
        if (end.kind === "waiting" && settle !== undefined) {
          waiting.set(selection.run, settle);
        }
        return end;
      }).finally(() => {
        // run 종료·멈춤·사람 기다림에서 credential을 끝낸다. 재개는 새 credential을 받는다.
        deps.credentials.end(selection.run);
        active.delete(selection.run);
      });
      return { kind: "started", run: selection.run, done };
    },
    stop(run, reason) {
      active.get(run)?.handle.stop(reason);
    },
    stopAssignment(assignment, reason) {
      for (const entry of active.values()) {
        if (entry.assignment === assignment) entry.handle.stop(reason);
      }
      deps.credentials.endAssignment(assignment);
    },
    async revokeProvider(provider) {
      for (const entry of [...active.values()]) {
        if (entry.provider !== provider) continue;
        if (await entry.available()) continue;
        entry.handle.revoke({ provider: true });
      }
    },
    revokeServer(server) {
      for (const entry of active.values()) entry.handle.revoke({ server });
    },
    endAll() {
      for (const entry of active.values()) {
        entry.handle.revoke({ provider: true });
      }
      deps.credentials.endAll();
    },
    settle(run) {
      return waiting.get(run)?.();
    },
    get active() {
      return active.size;
    },
  };
}
