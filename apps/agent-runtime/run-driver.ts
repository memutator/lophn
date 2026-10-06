import type { Result } from "../../packages/base/mod.ts";
import {
  type AgentRunCredential,
  beginRun,
  type BeginRunInput,
  type LoopDeps,
  type LoopEnd,
  type RunCredentials,
  type RunInput,
  type RunLoopHandle,
  type RunSelector,
  type Selection,
  startRunLoop,
  type StartRunResult,
  type StopReason,
} from "../../packages/lophn-agent/harness/run-loop/mod.ts";

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
    deps: LoopDeps;
    input: RunInput;
    // 사람의 결정을 기다리는 run의 결정 반영(기다림 해소기). 고정 call의 실제 입력은 이 process가
    // 들고 있다.
    settle?(): Promise<Result<unknown>>;
  };
};

export type DriveDeps = {
  selector: RunSelector;
  credentials: RunCredentials;
  prepare(selection: Selection): Promise<Result<PreparedRun>>;
  // StartRun은 확정됐지만 credential을 받지 못한 run을 failed(configuration_unavailable)로 닫는다.
  closeUnusable(selection: Selection): Promise<void>;
};

export type DriveResult =
  | { kind: "idle" }
  | { kind: "unavailable" }
  | { kind: "not_started"; run: string }
  | { kind: "started"; run: string; done: Promise<LoopEnd> };

export type RunDriver = {
  // 시작할 run 하나를 골라 시작한다. 없으면 idle이다.
  startNext(): Promise<DriveResult>;
  // 사람 멈춤·assignment 멈춤이 접수됐다. 새 진입을 막고 진행 호출에 중단을 요청한다.
  stop(run: string, reason: StopReason): void;
  stopAssignment(assignment: string, reason: StopReason): void;
  // provider를 껐다. 모든 진행 run의 새 model 진입을 막는다.
  revokeProvider(): void;
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
    { assignment: string; handle: RunLoopHandle }
  >();

  return {
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
      const { deps: loopDeps, input, settle } = run.loop(
        begun.value.credential,
        begun.value.started,
      );
      const handle = startRunLoop(loopDeps, input);
      active.set(selection.run, { assignment: selection.assignment, handle });
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
    revokeProvider() {
      for (const entry of active.values()) {
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
