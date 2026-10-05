import { err, ok, type Result } from "../../../base/mod.ts";
import { acceptFrame, emptySides, sideVerdict } from "./ipc.ts";
import type { ObservationSide, SideObservations } from "./ipc.ts";
import { prepareCommand, rejectOutside } from "./prepare.ts";
import type { PreparedCommand, PrepareInput } from "./prepare.ts";
import { admitQueue, recoverLostRunner } from "./recovery.ts";
import type { Admission, AttemptRecord, LostRun } from "./recovery.ts";
import { recoverSpool } from "./spool.ts";
import type { RecoveryDecision, SpoolRecord } from "./spool.ts";
import { startChild } from "./spawn.ts";
import type {
  ChildOutcome,
  MemoryLimitPort,
  RunningChild,
  SpawnPort,
} from "./spawn.ts";

export type RunRequest = {
  request_key: string;
  prepare: PrepareInput;
  // 고정 test hash. 관측 frame의 test_hash와 같아야 한다.
  test_hash: string;
  side: ObservationSide;
  // ledger에 확정된 시작 시도 시각. 없으면 spawn하지 않는다.
  start_attempt_at: string | null;
  running: number;
  preparing: number;
};

export type RunVerdict = {
  result: "pass" | "fail" | "inconclusive";
  reason: string;
  mode: RunningChild["mode"] | null;
  outcome: ChildOutcome | null;
  // stdout의 pass 문자열은 판정에 쓰지 않는다.
  used_stdout: false;
};

const NOT_STARTED = "시작 시도가 확정되지 않아 실행하지 않았다";

export async function runPrepared(
  request: RunRequest,
  options: {
    memory?: MemoryLimitPort;
    spawn?: SpawnPort;
    frames?: Uint8Array[];
    expected_exit_code?: number;
  } = {},
): Promise<Result<RunVerdict>> {
  const seat: Admission = admitQueue(request.running, request.preparing);
  if (seat === "unavailable") {
    return err({ code: "unavailable", message: "준비 대기가 가득 찼다" });
  }
  if (!request.start_attempt_at) {
    return err({ code: "conflict", message: NOT_STARTED });
  }
  const sourceOutside = await rejectOutside(
    request.prepare.source,
    request.prepare.source,
  );
  if (sourceOutside) {
    return err({ code: "invalid_input", message: "source가 묶음 밖이다" });
  }
  const prepared: Result<PreparedCommand> = prepareCommand(request.prepare);
  if (!prepared.ok) return prepared;
  const child = await startChild(prepared.value, {
    memory: options.memory,
    spawn: options.spawn,
  });
  if (!child.ok) return child;
  const outcome = await child.value.finished();
  const sides: Record<ObservationSide, SideObservations> = emptySides();
  let bad = false;
  for (const frame of options.frames ?? []) {
    if (!acceptFrame(sides, frame).ok) bad = true;
  }
  const observed = sideVerdict(sides[request.side], request.test_hash);
  if (
    bad || observed === "inconclusive" || outcome.end_reason !== "exited" ||
    outcome.truncated
  ) {
    return ok({
      result: "inconclusive",
      reason: outcome.end_reason === "timeout"
        ? "timeout"
        : outcome.end_reason === "killed"
        ? "killed"
        : "observation",
      mode: child.value.mode,
      outcome,
      used_stdout: false,
    });
  }
  const expected = options.expected_exit_code ?? 0;
  const passed = outcome.exit_code === expected;
  return ok({
    result: passed ? "pass" : "fail",
    reason: passed ? "exited" : "exit",
    mode: child.value.mode,
    outcome,
    used_stdout: false,
  });
}

export function onRunnerLost(
  attempts: readonly AttemptRecord[],
  deadRunner: string,
): { lost: LostRun[]; unknown: string[] } {
  return recoverLostRunner(attempts, deadRunner);
}

export function onSpool(
  record: SpoolRecord | null,
  started: boolean | null,
  nowMs: number,
): RecoveryDecision {
  return recoverSpool(record, started, nowMs);
}
