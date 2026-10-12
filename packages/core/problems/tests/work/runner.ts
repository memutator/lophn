import { err, ok, type Result } from "../../../../base/mod.ts";
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

// ledger 시작 시도. 확정(ok)된 뒤에만 spawn한다.
// 거절·실패면 자식을 띄우지 않고 Verification도 없다.
export type StartAttemptCommit = () => Promise<Result<string>>;

export type RunVerdict = {
  result: "pass" | "fail" | "inconclusive";
  reason: string;
  mode: RunningChild["mode"] | null;
  outcome: ChildOutcome | null;
  // stdout의 pass 문자열은 판정에 쓰지 않는다.
  used_stdout: false;
  started_at: string;
  frames: SideObservations["frames"];
};

const NOT_STARTED = "시작 시도가 확정되지 않아 실행하지 않았다";

export async function runPrepared(
  request: RunRequest,
  options: {
    memory?: MemoryLimitPort;
    spawn?: SpawnPort;
    frames?: Uint8Array[];
    expected_exit_code?: number;
    // 시작 시도를 ledger에 확정한다. spawn은 이 결과가 ok인 뒤에만 한다.
    commit?: StartAttemptCommit;
    // 자식이 실제로 시작한 것을 관측한 직후, 끝나기를 기다리기 전에 부른다. 실제 시작 시각을 ledger에 남기는 자리다.
    started?: (
      child: { started_at: string; mode: RunningChild["mode"] },
    ) => Promise<void>;
  } = {},
): Promise<Result<RunVerdict>> {
  const seat: Admission = admitQueue(request.running, request.preparing);
  if (seat === "unavailable") {
    return err({ code: "unavailable", message: "준비 대기가 가득 찼다" });
  }
  if (!request.start_attempt_at) {
    return err({ code: "conflict", message: NOT_STARTED });
  }
  // 확정 전에 spawn하지 않는다. commit이 거절하면 자식도 결과도 없다.
  if (options.commit) {
    const committed = await options.commit();
    if (!committed.ok) return committed;
  }
  const source = request.prepare.source;
  const cwd = request.prepare.method.cwd === "."
    ? source
    : `${source.replace(/\/$/, "")}/${request.prepare.method.cwd}`;
  const paths = [
    [source, source],
    [source, cwd],
    [request.prepare.scratch, request.prepare.scratch],
    ...request.prepare.reads.map((path) => [path, path]),
  ] as const;
  for (const [root, path] of paths) {
    if (await rejectOutside(root, path)) {
      return err({ code: "invalid_input", message: "경로가 묶음 밖이다" });
    }
  }
  const prepared: Result<PreparedCommand> = prepareCommand(request.prepare);
  if (!prepared.ok) return prepared;
  const child = await startChild(prepared.value, {
    memory: options.memory,
    spawn: options.spawn,
  });
  if (!child.ok) return child;
  if (options.started) {
    await options.started({
      started_at: child.value.started_at,
      mode: child.value.mode,
    });
  }
  const outcome = await child.value.finished();
  const sides: Record<ObservationSide, SideObservations> = emptySides();
  let bad = false;
  let frames = options.frames;
  if (frames === undefined) {
    // 자식 scratch만 읽는다. stdout은 관측 통로가 아니다.
    const path = `${request.prepare.scratch}/frames.jsonl`;
    frames = [];
    try {
      const stat = await Deno.lstat(path);
      if (!stat.isFile || stat.size > 1_048_576 + 65_536) {
        bad = true;
      } else {
        const text = await Deno.readTextFile(path);
        if (!text.endsWith("\n")) bad = true;
        frames = text.trimEnd().split("\n").map((line) =>
          new TextEncoder().encode(line)
        );
      }
    } catch {
      bad = true;
    }
  }
  for (const frame of frames) {
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
      started_at: child.value.started_at,
      frames: sides[request.side].frames,
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
    started_at: child.value.started_at,
    frames: sides[request.side].frames,
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
