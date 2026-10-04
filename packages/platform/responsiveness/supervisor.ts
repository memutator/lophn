import type { Clock } from "../../base/mod.ts";
import {
  childMessageSchema,
  type ChildMessage,
  type Frame,
  helloSchema,
  type HealthObservation,
  type KindLaunchSpec,
  type ParentMessage,
} from "../../contracts/platform/mod.ts";
import { checkLaunchSpec, launchArgv } from "../security/mod.ts";
import { readFrames, writeJson, type ByteWriter } from "./frames.ts";
import { spawnProcess, type Spawned, type SpawnRequest } from "./process.ts";

const RESTART_DELAYS_MS = [1_000, 2_000, 4_000];
const STDERR_LINE_MAX = 8 * 1024;
const STDERR_LINES_MAX = 32;

export type ChildCallbacks = {
  // 재기동은 진행 중이던 작업을 다시 보내지 않는다. 요청 보관은 호출자의 몫이다.
  onMessage(message: ChildMessage): void;
  // byte chunk frame은 제어 메시지가 아니다. entry가 채널로 받는다.
  onFrame?(frame: Frame): void;
  onStderr?(line: string): void;
};

export type StartResult =
  | { ok: true }
  | { ok: false; code: "invalid_input" | "unavailable" };

export type SupervisorOptions = {
  clock: Clock;
  denoCommand: string;
  sleep?: (ms: number) => Promise<void>;
  spawn?: (request: SpawnRequest) => Spawned;
  // kind별로 좁혀 넘길 환경. 전체 환경은 복사하지 않는다.
  env?: (kind: string) => Record<string, string>;
  readyMs?: number;
  stopMs?: number;
};

type Phase = "starting" | "ready" | "stopping" | "unavailable";

type Slot = {
  spec: KindLaunchSpec;
  stderr: string[];
  phase: Phase;
  failures: number;
  reason?: string;
  generation: number;
  // ready를 받기 전 재시도가 이 시각을 넘기면 그 kind만 사용 불가다.
  readyUntil: number;
  process?: Spawned;
  callbacks: ChildCallbacks;
  hello: ParentMessage;
  // 이번 기동이 ready가 됐는지, 실패로 끝났는지 첫 결과를 알린다.
  settle?: (ready: boolean) => void;
  done: Promise<void>;
  finish: () => void;
};

export type Supervisor = {
  start(
    spec: unknown,
    hello: ParentMessage,
    callbacks: ChildCallbacks,
  ): Promise<StartResult>;
  // 그 kind만 정상 정지 뒤 새 spec으로 띄운다. 다른 kind는 건드리지 않는다.
  updateSpec(
    spec: unknown,
    hello: ParentMessage,
    callbacks?: ChildCallbacks,
  ): Promise<StartResult>;
  stop(kind: string): Promise<void>;
  stopAll(): Promise<void>;
  observation(kind: string): HealthObservation;
};

export function createSupervisor(options: SupervisorOptions): Supervisor {
  const slots = new Map<string, Slot>();
  const sleep = options.sleep ??
    ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const spawn = options.spawn ?? spawnProcess;

  const supervisor: Supervisor = {
    start: (spec, hello, callbacks) =>
      begin(slots, options, sleep, spawn, spec, hello, callbacks),
    async updateSpec(spec, hello, callbacks) {
      const checked = checkLaunchSpec(spec);
      if (!checked.ok) return { ok: false, code: "invalid_input" };
      const current = slots.get(checked.value.kind);
      if (!current) return { ok: false, code: "unavailable" };
      const next = callbacks ?? current.callbacks;
      await stopSlot(current, sleep, options);
      slots.delete(checked.value.kind);
      return begin(slots, options, sleep, spawn, spec, hello, next);
    },
    async stop(kind) {
      const slot = slots.get(kind);
      if (!slot) return;
      await stopSlot(slot, sleep, options);
    },
    async stopAll() {
      await Promise.all(
        [...slots.values()].map((slot) => stopSlot(slot, sleep, options)),
      );
    },
    observation(kind) {
      const slot = slots.get(kind);
      const available = slot?.phase === "ready";
      return {
        component: kind,
        available,
        reason: available ? undefined : slot?.reason ?? slot?.phase ??
          "not started",
        observed_at: options.clock.now(),
      };
    },
  };
  return supervisor;
}

async function begin(
  slots: Map<string, Slot>,
  options: SupervisorOptions,
  sleep: (ms: number) => Promise<void>,
  spawn: (request: SpawnRequest) => Spawned,
  spec: unknown,
  hello: ParentMessage,
  callbacks: ChildCallbacks,
): Promise<StartResult> {
  const checked = checkLaunchSpec(spec);
  if (!checked.ok) return { ok: false, code: "invalid_input" };
  const parsed = helloSchema.safeParse(hello);
  if (!parsed.success) return { ok: false, code: "invalid_input" };
  const kind = checked.value.kind;
  const current = slots.get(kind);
  if (current) {
    if (current.phase === "unavailable") {
      return { ok: false, code: "unavailable" };
    }
    return { ok: false, code: "invalid_input" };
  }
  let finish = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const first = new Promise<boolean>((resolve) => {
    const slot: Slot = {
      spec: checked.value,
      stderr: [],
      phase: "starting",
      failures: 0,
      generation: 1,
      readyUntil: options.clock.nowMs() + (options.readyMs ?? 10_000),
      callbacks,
      hello: parsed.data,
      settle: resolve,
      done,
      finish,
    };
    slots.set(kind, slot);
    void supervise(slot, options, sleep, spawn);
  });
  return (await first) ? { ok: true } : { ok: false, code: "unavailable" };
}

async function supervise(
  slot: Slot,
  options: SupervisorOptions,
  sleep: (ms: number) => Promise<void>,
  spawn: (request: SpawnRequest) => Spawned,
) {
  try {
    while (slot.phase === "starting" || slot.phase === "ready") {
      const generation = slot.generation;
      const outcome = await runOnce(slot, options, spawn, generation);
      if (slot.generation !== generation) return;
      const phase = slot.phase as Phase;
      if (phase === "stopping" || phase === "unavailable") return;
      // 정상 정지가 아닌 끝만 재기동한다. 진행 중이던 요청은 다시 보내지 않는다.
      if (outcome === "stopped") return;
      slot.phase = "starting";
      slot.failures += 1;
      if (
        slot.failures > RESTART_DELAYS_MS.length ||
        options.clock.nowMs() >= slot.readyUntil
      ) {
        slot.phase = "unavailable";
        slot.reason = slot.reason === "ready timed out" &&
            options.clock.nowMs() >= slot.readyUntil
          ? "ready timed out"
          : "restart limit reached";
        slot.settle?.(false);
        slot.settle = undefined;
        return;
      }
      await sleep(RESTART_DELAYS_MS[slot.failures - 1]);
      if (slot.generation !== generation || slot.phase !== "starting") return;
    }
  } finally {
    slot.finish();
  }
}

// ready가 되기 전 실패는 재기동 대상이다. ready 이후의 끝은 작업을 반복하지 않는다.
async function runOnce(
  slot: Slot,
  options: SupervisorOptions,
  spawn: (request: SpawnRequest) => Spawned,
  generation: number,
): Promise<"failed" | "ready-ended" | "stopped"> {
  let process: Spawned;
  try {
    process = spawn({
      command: options.denoCommand,
      args: launchArgv(slot.spec),
      env: options.env?.(slot.spec.kind) ?? {},
    });
  } catch {
    slot.reason = "spawn failed";
    return "failed";
  }
  slot.process = process;
  const stderr = drainStderr(process, slot);
  let becameReady = false;
  const readyTimer = armTimer(options.readyMs ?? 10_000, options.clock);
  const frames = readFrames(process.stdout);
  try {
    await writeJson(stdinWriter(process), slot.hello);
    const outcome = await Promise.race([
      untilReady(frames, slot, generation),
      readyTimer.promise,
    ]);
    if (outcome === "timeout") {
      slot.reason = "ready timed out";
      process.killGroup("SIGKILL");
      await process.exited.catch(() => {});
      return "failed";
    }
    if (outcome === "ended" || outcome === "violated") {
      slot.reason = outcome === "violated"
        ? "protocol violation"
        : "exited before ready";
      process.killGroup("SIGKILL");
      await process.exited.catch(() => {});
      // frame이 아닌 바이트는 재기동으로 덮지 않고 그 child를 바로 멈춘다.
      if (outcome === "violated") {
        slot.phase = "unavailable";
        slot.settle?.(false);
        slot.settle = undefined;
        return "stopped";
      }
      return "failed";
    }
    if (typeof outcome !== "string" && outcome.type !== "ready") {
      slot.callbacks.onMessage(outcome);
    }
    becameReady = true;
    slot.phase = "ready";
    // ready 뒤 crash는 새 기한으로 다시 센다. 재기동 횟수는 지우지 않는다.
    slot.readyUntil = options.clock.nowMs() + (options.readyMs ?? 10_000);
    slot.reason = undefined;
    slot.settle?.(true);
    slot.settle = undefined;
    await readRest(frames, slot, generation);
    return (slot.phase as Phase) === "stopping" ? "stopped" : "ready-ended";
  } catch {
    if (!becameReady && !slot.reason) slot.reason = "spawn failed";
    return becameReady && slot.phase === "stopping" ? "stopped" : becameReady
      ? "ready-ended"
      : "failed";
  } finally {
    readyTimer.cancel();
    if (slot.process === process) slot.process = undefined;
    await stderr;
    await frames.return("closed").catch(() => {});
  }
}

type ReadStep = ChildMessage | "ended" | "violated";

function armTimer(
  ms: number,
  clock: Clock,
): { promise: Promise<"timeout">; cancel: () => void } {
  const start = clock.nowMs();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settle: ((value: "timeout") => void) | undefined;
  const promise = new Promise<"timeout">((resolve) => {
    settle = resolve;
    const tick = () => {
      if (clock.nowMs() - start >= ms) {
        settle?.("timeout");
        return;
      }
      timer = setTimeout(tick, 5);
    };
    timer = setTimeout(tick, 5);
  });
  return {
    promise,
    cancel: () => {
      settle = undefined;
      clearTimeout(timer);
    },
  };
}

async function nextMessage(
  frames: AsyncGenerator<Frame, "eof" | "closed">,
  slot: Slot,
  generation: number,
): Promise<ReadStep> {
  try {
    while (true) {
      const next = await frames.next();
      if (next.done) return "ended";
      if (slot.generation !== generation) return "ended";
      const frame = next.value;
      if (frame.kind !== "json") {
        slot.callbacks.onFrame?.(frame);
        continue;
      }
      const parsed = childMessageSchema.safeParse(frame.payload);
      if (!parsed.success) return "violated";
      return parsed.data;
    }
  } catch {
    return "violated";
  }
}

async function untilReady(
  frames: AsyncGenerator<Frame, "eof" | "closed">,
  slot: Slot,
  generation: number,
): Promise<ReadStep> {
  while (true) {
    const step = await nextMessage(frames, slot, generation);
    if (typeof step === "string" || step.type === "ready") return step;
    slot.callbacks.onMessage(step);
  }
}

async function readRest(
  frames: AsyncGenerator<Frame, "eof" | "closed">,
  slot: Slot,
  generation: number,
) {
  let step = await nextMessage(frames, slot, generation);
  while (typeof step !== "string") {
    slot.callbacks.onMessage(step);
    if (slot.phase === "stopping") return;
    step = await nextMessage(frames, slot, generation);
  }
  if (step === "violated") {
    slot.reason = "protocol violation";
    slot.process?.killGroup("SIGKILL");
    throw new Error("protocol violation");
  }
}

function stdinWriter(process: Spawned): ByteWriter {
  return {
    write: async (bytes) => {
      await process.stdin.write(bytes);
      return bytes.length;
    },
  };
}

// stderr는 최근 몇 줄만 넘길 뿐 성공·실패 판정에 쓰지 않고 원문을 보관하지 않는다.
function drainStderr(process: Spawned, slot: Slot) {
  const decoder = new TextDecoder();
  return (async () => {
    const buffer = new Uint8Array(STDERR_LINE_MAX);
    const record = (line: string) => {
      slot.stderr.push(line.slice(0, STDERR_LINE_MAX));
      if (slot.stderr.length > STDERR_LINES_MAX) slot.stderr.shift();
      slot.callbacks.onStderr?.(line.slice(0, STDERR_LINE_MAX));
    };
    let pending = "";
    while (true) {
      const count = await process.stderr.read(buffer);
      if (count === null) break;
      pending += decoder.decode(buffer.subarray(0, count), { stream: true });
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        record(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        newline = pending.indexOf("\n");
      }
      if (pending.length > STDERR_LINE_MAX) {
        record(pending.slice(0, STDERR_LINE_MAX));
        pending = "";
      }
    }
  })().catch(() => {});
}

async function stopSlot(
  slot: Slot,
  sleep: (ms: number) => Promise<void>,
  options: SupervisorOptions,
) {
  if (slot.phase === "stopping" || slot.phase === "unavailable") {
    slot.process?.killGroup("SIGKILL");
    await slot.done;
    return;
  }
  slot.phase = "stopping";
  slot.generation += 1;
  slot.settle?.(false);
  slot.settle = undefined;
  const process = slot.process;
  if (process) {
    await writeJson(stdinWriter(process), {
      type: "stop",
      grace_ms: options.stopMs ?? 5_000,
    }).catch(() => {});
    const exited = await Promise.race([
      process.exited.then(() => true).catch(() => false),
      sleep(options.stopMs ?? 5_000).then(() => false),
    ]);
    if (!exited) process.killGroup("SIGKILL");
    await process.exited.catch(() => {});
  }
  await slot.done;
}
