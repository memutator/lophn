import {
  type ChildMessage,
  childMessageSchema,
  type Frame,
} from "../../contracts/platform/mod.ts";
import { launchArgv } from "../security/mod.ts";
import {
  armTimer,
  type Deadline,
  settledWithin,
  valueWithin,
} from "./deadline.ts";
import { createFrameWriter, readFrames } from "./frames.ts";
import { PipeFault } from "./pipe.ts";
import type { Spawned, SpawnRequest } from "./process.ts";
import {
  type Attempt,
  DRAIN_MS,
  isLive,
  safeCall,
  settle,
  type Slot,
  STDERR_LINE_MAX,
} from "./slot.ts";

export type Outcome = "failed" | "ready-ended" | "stopped";

type ReadStep = ChildMessage | "ended" | "violated" | "faulted";
type Frames = AsyncGenerator<Frame, "eof" | "closed">;

export type RunDeps = {
  denoCommand: string;
  readyMs: number;
  teardownMs: number;
  writeMs: number;
  env?: (kind: string) => Record<string, string>;
  spawn: (request: SpawnRequest) => Spawned;
};

const FAILURE_REASONS = {
  timeout: "ready timed out",
  "exited-before-ready": "exited before ready",
  ended: "exited before ready",
  faulted: "stdio failed",
} as const;

// ready 전 실패는 재기동 대상이다. ready 이후의 끝은 작업을 반복하지 않는다(R17).
export async function runOnce(slot: Slot, deps: RunDeps): Promise<Outcome> {
  let process: Spawned;
  try {
    process = deps.spawn({
      command: deps.denoCommand,
      args: launchArgv(slot.spec),
      env: deps.env?.(slot.spec.kind) ?? {},
    });
  } catch {
    slot.reason = "spawn failed";
    return "failed";
  }
  const attempt = openAttempt(slot, process, deps);
  const frames = readFrames(process.stdout);
  const exitedCode = process.exited.then((code) => code, () => null);
  const readyTimer = armTimer(deps.readyMs);
  let outcome: Outcome = "failed";
  try {
    // hello를 쓰는 중에도 ready 기한은 깨어 있다. 막힌 쓰기는 이 race에서 진다.
    const helloThenReady = attempt.writer.writeJson(slot.hello).then(
      () => untilReady(frames, slot, attempt),
      () => "faulted" as const,
    );
    const raced = await Promise.race([
      helloThenReady,
      readyTimer.promise,
      exitedCode.then(() => "exited-before-ready" as const),
    ]);
    readyTimer.cancel();
    if (typeof raced !== "string") {
      outcome = await afterReady(frames, slot, attempt, exitedCode);
    } else {
      attempt.live = false;
      outcome = raced === "violated" ? violation(slot) : failure(slot, raced);
    }
  } catch {
    attempt.live = false;
    slot.reason ??= "attempt failed";
    outcome = "failed";
  } finally {
    readyTimer.cancel();
    attempt.live = false;
    const confirmed = await attempt.teardown();
    if (!confirmed) {
      // 종료를 확인 못 한 old handle은 slot이 계속 쥔다. 그 kind는 새 child를 띄우지 않는다.
      slot.phase = "unavailable";
      slot.reason = "teardown unconfirmed";
      settle(slot, false);
      outcome = "stopped";
    } else if (slot.attempt === attempt) {
      slot.attempt = undefined;
    }
  }
  return outcome;
}

function failure(slot: Slot, step: keyof typeof FAILURE_REASONS): Outcome {
  if (slot.generation === slot.attempt?.generation) {
    slot.reason = FAILURE_REASONS[step];
  }
  return "failed";
}

function violation(slot: Slot): Outcome {
  slot.phase = "unavailable";
  slot.reason = "protocol violation";
  settle(slot, false);
  return "stopped";
}

async function afterReady(
  frames: Frames,
  slot: Slot,
  attempt: Attempt,
  exitedCode: Promise<number | null>,
): Promise<Outcome> {
  // ready를 읽은 순간 leader가 이미 끝났으면 ready로 세지 않는다. 열린 stdout을 붙들지 않는다.
  if (await settledWithin(exitedCode, 0)) {
    attempt.live = false;
    slot.reason = "exited after ready";
    return "failed";
  }
  if (!isLive(slot, attempt)) return "stopped";
  slot.phase = "ready";
  slot.reason = undefined;
  settle(slot, true);
  const step = await readRest(frames, slot, attempt, exitedCode);
  if (slot.generation !== attempt.generation) return "stopped";
  if (step === "violated") return violation(slot);
  slot.phase = "starting";
  slot.reason = step === "faulted" ? "stdio failed" : "exited after ready";
  return "ready-ended";
}

// 한 기동의 수명. slot.attempt는 teardown이 종료를 확인할 때까지 남는다.
function openAttempt(slot: Slot, process: Spawned, deps: RunDeps) {
  let tearing: Promise<boolean> | undefined;
  const attempt: Attempt = {
    process,
    generation: slot.generation,
    // child가 stdin을 읽지 않으면 쓰기가 끝나지 않는다. 기한을 넘기면 그 child를 끝낸다: 끊긴 frame이
    // 있을 수 있어 그 pipe는 다시 쓰지 못하고, 끝난 child는 감독의 재기동 경로로 간다.
    writer: createFrameWriter(rawWriter(process), {
      writeMs: deps.writeMs,
      onTimeout: () => void attempt.teardown(),
    }),
    live: true,
    closed: false,
    teardown: () =>
      tearing ??= (async () => {
        attempt.live = false;
        // 이 child에게 보낸 요청은 이제 답이 오지 않는다. 종료 확인을 기다리지 않고 알린다.
        safeCall(() => slot.callbacks.onEnd?.());
        const reaped = await valueWithin(
          () => process.terminate(),
          deps.teardownMs,
          false,
        );
        // 막힌 stdin close는 기다리지 않는다. group이 끝났으면 OS가 닫는다.
        void Promise.resolve().then(() => process.stdin.close()).catch(
          () => {},
        );
        await settledWithin(stderrDone, DRAIN_MS);
        safeCall(() => process.stdout.cancel());
        safeCall(() => process.stderr.cancel());
        attempt.closed = true;
        return reaped === true;
      })(),
  };
  slot.attempt = attempt;
  const stderrDone = drainStderr(process, slot, attempt);
  return attempt;
}

async function nextMessage(
  frames: Frames,
  slot: Slot,
  attempt: Attempt,
): Promise<ReadStep> {
  try {
    while (true) {
      if (!isLive(slot, attempt)) return "ended";
      const next = await frames.next();
      if (!isLive(slot, attempt) || next.done) return "ended";
      const frame = next.value;
      if (frame.kind !== "json") {
        safeCall(() => slot.callbacks.onFrame?.(frame));
        continue;
      }
      const parsed = childMessageSchema.safeParse(frame.payload);
      if (!parsed.success) return "violated";
      return parsed.data;
    }
  } catch (error) {
    // stdio 오류는 protocol 위반도 EOF도 아니다.
    return error instanceof PipeFault ? "faulted" : "violated";
  }
}

async function untilReady(
  frames: Frames,
  slot: Slot,
  attempt: Attempt,
): Promise<ReadStep> {
  while (true) {
    const step = await nextMessage(frames, slot, attempt);
    if (typeof step === "string" || step.type === "ready") return step;
    if (!isLive(slot, attempt)) return "ended";
    safeCall(() => slot.callbacks.onMessage(step));
  }
}

// leader가 끝나도 이미 쓰인 stdout 꼬리는 읽는다. 다만 DRAIN_MS 뒤에는 열린 pipe를 버린다.
async function readRest(
  frames: Frames,
  slot: Slot,
  attempt: Attempt,
  exited: Promise<number | null>,
): Promise<"ended" | "violated" | "faulted"> {
  let finished = false;
  let drain: Deadline | undefined;
  const drained = new Promise<"ended">((resolve) => {
    void exited.then(() => {
      if (finished) return;
      drain = armTimer(DRAIN_MS);
      drain.promise.then(() => resolve("ended"));
    });
  });
  try {
    while (true) {
      const step = await Promise.race([
        nextMessage(frames, slot, attempt),
        drained,
      ]);
      if (typeof step === "string") return step;
      if (!isLive(slot, attempt)) return "ended";
      safeCall(() => slot.callbacks.onMessage(step));
    }
  } finally {
    finished = true;
    drain?.cancel();
    // 진 branch(대기 중인 frame 읽기)가 나중에 깨어나도 callback을 부르지 않는다.
    attempt.live = false;
  }
}

function rawWriter(process: Spawned) {
  return {
    write: async (bytes: Uint8Array) => {
      await process.stdin.write(bytes);
      return bytes.length;
    },
  };
}

// stderr는 줄 단위로 넘길 뿐 성공·실패 판정에 쓰지 않고 원문을 보관하지 않는다.
function drainStderr(process: Spawned, slot: Slot, attempt: Attempt) {
  const decoder = new TextDecoder();
  const emit = (line: string) => {
    if (attempt.closed) return;
    safeCall(() => slot.callbacks.onStderr?.(line.slice(0, STDERR_LINE_MAX)));
  };
  return (async () => {
    const buffer = new Uint8Array(STDERR_LINE_MAX);
    let pending = "";
    while (!attempt.closed) {
      const count = await process.stderr.read(buffer);
      if (count === null) break;
      pending += decoder.decode(buffer.subarray(0, count), { stream: true });
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        emit(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
      }
      if (pending.length > STDERR_LINE_MAX) {
        emit(pending.slice(0, STDERR_LINE_MAX));
        pending = "";
      }
    }
  })().catch(() => {});
}
