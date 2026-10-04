import type { Clock } from "../../base/mod.ts";
import {
  type HealthObservation,
  helloSchema,
  type ParentMessage,
} from "../../contracts/platform/mod.ts";
import { checkLaunchSpec } from "../security/mod.ts";
import { settledWithin, valueWithin } from "./deadline.ts";
import { ADAPTER_MS } from "./group.ts";
import {
  checkKillAdapter,
  type Spawned,
  spawnProcess,
  type SpawnRequest,
} from "./process.ts";
import type { FrameWriter } from "./frames.ts";
import { type RunDeps, runOnce } from "./run.ts";
import {
  type ChildCallbacks,
  makeSlot,
  READY_MS,
  RESTART_DELAYS_MS,
  RESTART_LIMIT,
  settle,
  type Slot,
  STOP_MS,
  TEARDOWN_MS,
} from "./slot.ts";

export type { ChildCallbacks } from "./slot.ts";

export type StartResult =
  | { ok: true }
  | { ok: false; code: "invalid_input" | "unavailable" };

export type SupervisorOptions = {
  clock: Clock;
  denoCommand: string;
  // 재기동 간격(1·2·4초)에만 쓴다. ready·stop·teardown 기한은 실제 경과 시간으로 잰다.
  sleep?: (ms: number) => Promise<void>;
  spawn?: (request: SpawnRequest) => Spawned;
  // kind별로 좁혀 넘길 환경. 전체 환경은 복사하지 않는다.
  env?: (kind: string) => Record<string, string>;
  // 테스트가 기한을 줄일 때만 쓴다. 기본값은 architecture 2.3의 고정 값이다.
  readyMs?: number;
  stopMs?: number;
  teardownMs?: number;
  // 테스트가 실제 /usr/bin/kill 없이 adapter 가용성을 바꿔 끼울 때만 쓴다.
  checkGroupKillAdapter?: () => Promise<boolean>;
};

export type Supervisor = {
  start(
    spec: unknown,
    hello: ParentMessage,
    callbacks: ChildCallbacks,
  ): Promise<StartResult>;
  // 그 kind만 정상 정지 뒤 새 spec으로 띄운다. 옛 child 종료가 확인되지 않으면 띄우지 않는다.
  updateSpec(
    spec: unknown,
    hello: ParentMessage,
    callbacks?: ChildCallbacks,
  ): Promise<StartResult>;
  // true면 그 kind의 child(group)가 끝난 것을 확인했다. false면 그 kind는 unavailable이다.
  stop(kind: string): Promise<boolean>;
  stopAll(): Promise<boolean>;
  observation(kind: string): HealthObservation;
  // ready인 child에 json frame을 쓴다. 없으면 unavailable이다.
  send(kind: string, payload: unknown): Promise<StartResult>;
  // ready인 child에 byte chunk frame을 쓴다. core는 내용을 해석하지 않는다(Q6).
  sendBytes(
    kind: string,
    channel: number,
    payload: Uint8Array,
  ): Promise<StartResult>;
};

type Deps = RunDeps & {
  stopMs: number;
  sleep: (ms: number) => Promise<void>;
};

type Decision = { result: StartResult } | { first: Promise<boolean> };

const ADAPTER_CHECK_MS = 2 * ADAPTER_MS;
const UNAVAILABLE: StartResult = { ok: false, code: "unavailable" };
const INVALID: StartResult = { ok: false, code: "invalid_input" };

export function createSupervisor(options: SupervisorOptions): Supervisor {
  const slots = new Map<string, Slot>();
  const locks = new Map<string, Promise<void>>();
  const deps: Deps = {
    denoCommand: options.denoCommand,
    readyMs: options.readyMs ?? READY_MS,
    stopMs: options.stopMs ?? STOP_MS,
    teardownMs: options.teardownMs ?? TEARDOWN_MS,
    sleep: options.sleep ??
      ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))),
    spawn: options.spawn ?? spawnProcess,
    env: options.env,
  };
  // 첫 child를 띄우기 전에 한 번 확인한다. 던지거나 거절하거나 답하지 않아도 unavailable이다.
  // 실제 adapter 확인은 자체 기한(ADAPTER_MS)을 갖고, 이 바깥 기한은 바꿔 끼운 확인까지 묶는다.
  let adapterUnavailable = false;
  const adapterReady = valueWithin(
    () => (options.checkGroupKillAdapter ?? checkKillAdapter)(),
    ADAPTER_CHECK_MS,
    false,
  )
    .then((ok) => ok === true)
    .then((ok) => {
      if (!ok) adapterUnavailable = true;
      return ok;
    });

  // 같은 kind의 start·updateSpec·stop은 한 줄로 선다. 다른 kind는 서로 기다리지 않는다.
  // 안의 일은 모두 bounded라 줄이 영원히 막히지 않는다.
  function serial<T>(kind: string, work: () => Promise<T>): Promise<T> {
    const before = locks.get(kind) ?? Promise.resolve();
    const result = before.then(work);
    const tail = result.then(() => {}, () => {});
    locks.set(kind, tail);
    void tail.then(() => {
      if (locks.get(kind) === tail) locks.delete(kind);
    });
    return result;
  }

  // slot을 만들고 첫 기동을 시작한다. 첫 결과는 줄 밖에서 기다린다(stop이 끼어들 수 있게).
  function install(
    spec: Slot["spec"],
    hello: ParentMessage,
    callbacks: ChildCallbacks,
  ): Promise<boolean> {
    const slot = makeSlot(spec, hello, callbacks);
    slots.set(spec.kind, slot);
    const first = new Promise<boolean>((resolve) => {
      slot.settle = resolve;
    });
    void supervise(slot, deps).catch(() => {
      // 우리 결함이나 바꿔 끼운 sleep의 throw도 조용히 넘기지 않는다. 그 kind를 막고 결과를 알린다.
      slot.phase = "unavailable";
      slot.reason = "supervision failed";
      settle(slot, false);
    });
    return first;
  }

  function launch(
    spec: unknown,
    hello: ParentMessage,
    callbacks: ChildCallbacks | undefined,
    replace: boolean,
  ): Promise<StartResult> {
    const checked = checkLaunchSpec(spec);
    if (!checked.ok) return Promise.resolve(INVALID);
    const parsed = helloSchema.safeParse(hello);
    // hello는 그 spec의 kind에만 묶인다. 다른 kind의 credential을 넘기지 않는다.
    if (!parsed.success || parsed.data.kind !== checked.value.kind) {
      return Promise.resolve(INVALID);
    }
    const kind = checked.value.kind;
    // 부른 순서대로 줄에 선다. adapter 확인은 줄 안에서 기다린다.
    // 첫 결과 promise를 그대로 돌려주면 async 함수가 그것을 기다려 줄을 붙든다. 감싸서 넘긴다.
    const decided = serial(kind, async (): Promise<Decision> => {
      if (!(await adapterReady)) return { result: UNAVAILABLE };
      const current = slots.get(kind);
      if (replace) {
        if (!current) return { result: UNAVAILABLE };
        const next = callbacks ?? current.callbacks;
        // 옛 child의 종료가 확인되지 않으면 slot과 handle을 그대로 두고 새로 띄우지 않는다.
        if (!(await stopSlot(current, deps))) return { result: UNAVAILABLE };
        return { first: install(checked.value, parsed.data, next) };
      }
      if (current?.phase === "unavailable") return { result: UNAVAILABLE };
      if (current && current.phase !== "stopped") return { result: INVALID };
      if (!callbacks) return { result: INVALID };
      return { first: install(checked.value, parsed.data, callbacks) };
    });
    return decided.then(async (decision) => {
      if ("result" in decision) return decision.result;
      return (await decision.first) ? { ok: true } : UNAVAILABLE;
    });
  }

  async function stop(kind: string): Promise<boolean> {
    return await serial(kind, () => {
      const slot = slots.get(kind);
      return slot ? stopSlot(slot, deps) : Promise.resolve(true);
    });
  }

  // ready child의 writer에만 쓴다. 재기동 중이면 진행 작업을 다시 보내지 않는다.
  function writeTo(
    kind: string,
    write: (writer: FrameWriter) => Promise<void>,
  ): Promise<StartResult> {
    const slot = slots.get(kind);
    const writer = slot?.phase === "ready" ? slot.attempt?.writer : undefined;
    if (!writer) return Promise.resolve(UNAVAILABLE);
    return write(writer).then(() => ({ ok: true as const }), () => UNAVAILABLE);
  }

  return {
    start: (spec, hello, callbacks) => launch(spec, hello, callbacks, false),
    updateSpec: (spec, hello, callbacks) =>
      launch(spec, hello, callbacks, true),
    stop,
    // 부르기 전에 줄에 선 start·updateSpec까지 포함해 그 뒤에 stop을 세운다. 돌아온 뒤에는 그때까지
    // 들어온 child가 남지 않는다. 그 뒤에 새로 부른 start는 막지 않는다(core 종료의 입장 차단은 따로다).
    async stopAll() {
      const kinds = new Set([...slots.keys(), ...locks.keys()]);
      const results = await Promise.all([...kinds].map(stop));
      return results.every((confirmed) => confirmed);
    },
    send(kind, payload) {
      return writeTo(kind, (writer) => writer.writeJson(payload));
    },
    sendBytes(kind, channel, payload) {
      return writeTo(kind, (writer) => writer.writeBytes(channel, payload));
    },
    observation(kind) {
      const slot = slots.get(kind);
      const available = slot?.phase === "ready";
      return {
        component: kind,
        available,
        reason: available ? undefined : slot?.reason ?? slot?.phase ??
          (adapterUnavailable ? "group kill adapter unavailable" : undefined) ??
          "not started",
        observed_at: options.clock.now(),
      };
    },
  };
}

async function supervise(slot: Slot, deps: Deps) {
  while (slot.phase === "starting" || slot.phase === "ready") {
    const generation = slot.generation;
    const outcome = await runOnce(slot, deps);
    if (slot.generation !== generation) return;
    if (slot.phase !== "starting" && slot.phase !== "ready") return;
    // 정상 정지가 아닌 끝만 재기동한다. 진행 중이던 요청은 다시 보내지 않는다.
    if (outcome === "stopped") return;
    const delay = nextAttempt(slot);
    if (delay === undefined) {
      settle(slot, false);
      return;
    }
    try {
      await deps.sleep(delay);
    } catch {
      if (slot.generation !== generation) return;
      slot.phase = "unavailable";
      slot.reason = "restart wait failed";
      settle(slot, false);
      return;
    }
    if (slot.generation !== generation || slot.phase !== "starting") return;
  }
}

// kind 하나의 재기동은 ready 전후를 합쳐 최대 3회다.
function nextAttempt(slot: Slot): number | undefined {
  if (slot.failures >= RESTART_LIMIT) {
    slot.phase = "unavailable";
    // 기한을 넘겨 ready가 안 온 경우만 ready 초과다. 바로 끝난 기동은 재기동 한도다.
    slot.reason = slot.reason === "ready timed out"
      ? "ready timed out"
      : "restart limit reached";
    return undefined;
  }
  const delay = RESTART_DELAYS_MS[slot.failures];
  slot.phase = "starting";
  slot.failures += 1;
  return delay;
}

// 정상 정지를 청하고 grace 뒤 group을 강제로 끝낸다. 기한은 모두 실제 경과 시간이다.
// 종료가 확인되면 true, 아니면 old attempt를 그대로 두고 그 kind를 unavailable로 막는다.
async function stopSlot(slot: Slot, deps: Deps): Promise<boolean> {
  if (slot.phase === "stopped") return true;
  const attempt = slot.attempt;
  if (slot.phase === "unavailable") {
    return attempt ? await attempt.teardown() : true;
  }
  slot.phase = "stopping";
  slot.reason = "stopped";
  slot.generation += 1;
  settle(slot, false);
  if (!attempt) {
    slot.phase = "stopped";
    return true;
  }
  // stop frame 쓰기가 막혀도 grace 기한을 넘기지 않는다. hello 뒤 같은 writer의 FIFO에 서고,
  // backlog가 차 있어도 마지막 제어 frame 자리로 들어간다.
  void attempt.writer.writeFinal({ type: "stop", grace_ms: deps.stopMs })
    .catch(() => {});
  await settledWithin(attempt.process.exited, deps.stopMs);
  const confirmed = await attempt.teardown();
  if (!confirmed) {
    slot.phase = "unavailable";
    slot.reason = "teardown unconfirmed";
    return false;
  }
  if (slot.attempt === attempt) slot.attempt = undefined;
  slot.phase = "stopped";
  return true;
}
