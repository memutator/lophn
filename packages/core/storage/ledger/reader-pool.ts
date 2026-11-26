import { Worker } from "node:worker_threads";
import { err, type Logger, ok, type Result } from "../../../base/mod.ts";
import type { ReadRoute } from "../../../protocol/base/mod.ts";
import type { RequestContext } from "../../../protocol/server/mod.ts";
import type { KnownSecretChannel } from "./known-secrets.ts";
import { READ_TIMEOUT_MS, readKey } from "./reads.ts";

type ReaderHealth = "healthy" | "unhealthy" | "closed";
export type ReaderPool = {
  read(
    route: Pick<ReadRoute, "resource" | "method">,
    ctx: RequestContext,
    input: unknown,
  ): Promise<Result<unknown>>;
  health(): readonly ReaderHealth[];
  // 알려진 secret 값의 등록·회수 통로. 요청 message 밖이다(known-secrets.ts).
  readonly known: KnownSecretChannel;
  close(): void;
};

type Pending = {
  id: number;
  key: string;
  ctx: RequestContext;
  input: unknown;
  resolve(result: Result<unknown>): void;
};

type Slot = {
  worker: Worker;
  health: ReaderHealth;
  // 배경에서 기동이 끝나 secret sync가 도는 동안 broadcast만 받고 read는 아직 넣지 않는다.
  syncing?: boolean;
  pending?: Pending;
  timer?: ReturnType<typeof setTimeout>;
  startedAt?: number;
};

// reader 기동은 모든 등록 module을 TS 그대로 읽어 들이므로 느린 machine에서 몇 초씩 걸리고, 두 reader와
// writer가 같이 뜨면 더 걸린다(VPS에서 10초를 넘겨 core가 뜨지 못했다). 이 기한은 멈춘 worker만 잡는다.
const READER_READY_MS = 60000;
// 줄에 서는 read의 상한: caller(principal)마다, 전체. 다른 caller는 공정 순서로 돈다.
const PER_CALLER = 8;
const WAITING_MAX = 64;
// reader가 등록·회수를 반영했다는 확인을 기다리는 상한. 진행 중인 read(최대 READ_TIMEOUT_MS)
// 뒤에 처리되므로 그보다 길다. 확인하지 못한 reader는 오래된 값을 쥔 채 서빙하지 않게 격리한다.
const KNOWN_ACK_MS = 5000;

// 격리된 reader slot을 다시 띄우는 한도와 간격(core 시작마다). 한도를 넘으면 더 띄우지 않고
// 그 slot은 격리된 채 남는다(둘 다 그러면 read는 unavailable이다).
const READER_RESPAWN_LIMIT = 6;
const RESPAWN_BACKOFF_MS: readonly number[] = [
  250, 500, 1000, 2000, 4000, 8000,
];

type ReaderPoolOptions = {
  logger: Logger;
  respawnLimit?: number;
  backoffMs?: readonly number[];
  // 다시 띄운 reader가 healthy가 된 뒤 부른다. 새 reader는 알려진 secret 값을 모르는 채(ready 아님)
  // 시작하므로 소유자가 현재 값을 다시 넣는다(secret store sync). 그동안 그 reader는 fail-closed다.
  onRespawn?: () => Promise<unknown> | void;
  // 한도를 넘겨 더 다시 띄우지 않게 됐을 때 한 번 부른다. 기본은 logger.error 한 줄이다.
  onExhausted?: (limit: number) => void;
};

const unavailable = () =>
  err({
    code: "unavailable" as const,
    message: "reader가 현재 요청을 처리할 수 없다",
  });

export async function createReaderPool(
  path: string,
  registrationModules: readonly URL[],
  options: ReaderPoolOptions,
): Promise<Result<ReaderPool>> {
  const respawnLimit = options.respawnLimit ?? READER_RESPAWN_LIMIT;
  const backoff = options.backoffMs ?? RESPAWN_BACKOFF_MS;
  // 시작이 끝난 뒤에만 격리된 slot을 다시 띄운다(시작 실패는 pool 실패다).
  let serving = false;
  let respawnsUsed = 0;
  let respawning = false;
  let exhaustedLogged = false;
  let respawnTimer: ReturnType<typeof setTimeout> | undefined;
  const keys = new Set<string>();
  const modules = registrationModules.map((url) => url.href);
  const slots: Slot[] = [];
  const queues = new Map<string, Pending[]>();
  const principals: string[] = [];
  // caller 줄(PER_CALLER)이 찬 뒤 온 read. 줄에 자리가 나면 들어가고 READ_TIMEOUT_MS 안에 못 들어가면 unavailable이다.
  // 창 하나가 workspace를 열 때 한꺼번에 부르는 read를 거절하지 않고 늦게 받는다.
  const held = new Map<
    string,
    { pending: Pending; timer: ReturnType<typeof setTimeout> }[]
  >();
  let nextId = 0;
  let closed = false;
  let waiting = 0;
  // 등록·회수 확인을 기다리는 중인 방송. 확인을 보낸 slot이 남아 있는 동안만 산다.
  let nextKnown = 0;
  const knownWaits = new Map<
    number,
    {
      slots: Set<Slot>;
      settle(result: Result<void>): void;
    }
  >();

  // slot이 확인했거나(격리돼 더 서빙하지 않게 됐거나) 하면 그 방송의 대기에서 뺀다.
  function settleKnown(id: number, slot: Slot) {
    const wait = knownWaits.get(id);
    if (!wait) return;
    wait.slots.delete(slot);
    if (wait.slots.size === 0) wait.settle(ok(undefined));
  }

  function fail(slot: Slot) {
    if (slot.health !== "healthy" && !slot.syncing) return;
    slot.syncing = false;
    slot.health = "unhealthy";
    clearTimeout(slot.timer);
    slot.pending?.resolve(unavailable());
    slot.pending = undefined;
    for (const id of [...knownWaits.keys()]) settleKnown(id, slot);
    // 동기 SQLite를 취소했다고 주장하지 않는다. unhealthy Worker를 pool에서 격리한다.
    slot.worker.terminate();
    pump();
    scheduleRespawn();
  }

  // 격리된 slot을 한 번에 하나씩 backoff 뒤에 다시 띄운다. 한도(core 시작마다)를 넘으면 멈추고
  // 한 번만 알린다.
  function scheduleRespawn() {
    if (!serving || closed || respawning) return;
    const slot = slots.find((candidate) => candidate.health === "unhealthy");
    if (slot === undefined) return;
    if (respawnsUsed >= respawnLimit) {
      if (!exhaustedLogged) {
        exhaustedLogged = true;
        try {
          if (options.onExhausted) options.onExhausted(respawnLimit);
          else {
            options.logger.error({
              component: "reader-pool",
              event: "respawn_exhausted",
              message: "isolated readers stay isolated",
              fields: { limit: respawnLimit },
            });
          }
        } catch {
          /* 알림 실패가 pool을 막지 않는다 */
        }
      }
      return;
    }
    respawning = true;
    const delay = backoff[Math.min(respawnsUsed, backoff.length - 1)] ?? 0;
    respawnsUsed++;
    respawnTimer = setTimeout(() => {
      respawnTimer = undefined;
      void respawn(slot).then((revived) => {
        respawning = false;
        if (closed) return;
        if (revived) {
          pump();
          void Promise.resolve(options.onRespawn?.()).catch(() => undefined);
        }
        scheduleRespawn();
      });
    }, delay);
  }

  async function respawn(slot: Slot): Promise<boolean> {
    if (closed) return false;
    let worker: Worker;
    try {
      worker = newWorker();
    } catch {
      return false;
    }
    const booted = await boot(slot, worker);
    if (!booted || closed) {
      worker.terminate();
      return false;
    }
    slot.worker = worker;
    slot.pending = undefined;
    slot.health = "healthy";
    return true;
  }

  // 줄 끝에 세운다. 그 caller가 줄에 없었으면 공정 순서의 끝에 넣는다.
  function enqueue(pending: Pending) {
    const queue = queues.get(pending.ctx.principal);
    if (queue) queue.push(pending);
    else {
      queues.set(pending.ctx.principal, [pending]);
      principals.push(pending.ctx.principal);
    }
    waiting++;
  }

  function take(): Pending | undefined {
    const principal = principals.shift();
    if (principal === undefined) return;
    const queue = queues.get(principal)!;
    const pending = queue.shift()!;
    waiting--;
    if (queue.length) principals.push(principal);
    else queues.delete(principal);
    // 자리가 났다. 기다리던 그 caller의 read를 줄에 세운다.
    const next = held.get(principal)?.shift();
    if (next) {
      clearTimeout(next.timer);
      if (held.get(principal)!.length === 0) held.delete(principal);
      enqueue(next.pending);
    }
    return pending;
  }

  function hold(pending: Pending) {
    const list = held.get(pending.ctx.principal) ?? [];
    held.set(pending.ctx.principal, list);
    const entry = {
      pending,
      timer: setTimeout(() => {
        const index = list.indexOf(entry);
        if (index < 0) return;
        list.splice(index, 1);
        if (list.length === 0) held.delete(pending.ctx.principal);
        pending.resolve(unavailable());
      }, READ_TIMEOUT_MS),
    };
    list.push(entry);
  }

  // 줄과 기다리는 read를 모두 unavailable로 끝낸다.
  function drain() {
    let pending: Pending | undefined;
    while ((pending = take())) pending.resolve(unavailable());
  }

  function pump() {
    for (const slot of slots) {
      if (slot.health !== "healthy" || slot.pending) continue;
      const pending = take();
      if (!pending) break;
      slot.pending = pending;
      slot.startedAt = performance.now();
      // native SQL은 child event loop timer를 막으므로 parent wall-clock에서 감지한다.
      slot.timer = setTimeout(() => fail(slot), READ_TIMEOUT_MS);
      try {
        slot.worker.postMessage({
          id: pending.id,
          key: pending.key,
          ctx: pending.ctx,
          input: pending.input,
        });
      } catch {
        clearTimeout(slot.timer);
        slot.pending = undefined;
        pending.resolve(
          err({ code: "invalid_input", message: "read 입력을 전달할 수 없다" }),
        );
        pump();
      }
    }
    if (slots.every((slot) => slot.health !== "healthy")) drain();
  }

  function newWorker(): Worker {
    return new Worker(new URL("./reader-worker.ts", import.meta.url), {
      workerData: { path, modules },
    });
  }

  // worker를 기동해 ready를 기다린다. 성공하면 서빙 handler를 달고 true다. 실패(기한·오류·거절)는
  // false이고 worker를 끝내는 것은 부른 쪽의 몫이다. slot의 health는 바꾸지 않는다.
  function boot(slot: Slot, worker: Worker): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const onBootError = () => {
        clearTimeout(timer);
        worker.off("message", onReady);
        resolve(false);
      };
      const onReady = (message: { ready?: Result<string[]> }) => {
        clearTimeout(timer);
        const result = message.ready;
        if (!result?.ok) {
          resolve(false);
          return;
        }
        for (const key of result.value) keys.add(key);
        worker.off("message", onReady);
        worker.off("error", onBootError);
        worker.on("message", (reply) => {
          // 다시 띄워 바뀐 slot의 옛 worker가 늦게 보낸 message는 버린다.
          if (
            slot.worker !== worker ||
            (slot.health !== "healthy" && !slot.syncing)
          ) {
            return;
          }
          const ack = reply.known_ack;
          if (typeof ack === "number") {
            settleKnown(ack, slot);
            return;
          }
          const pending = slot.pending;
          if (!pending || reply.id !== pending.id) return;
          // reply가 timer보다 먼저 배달돼도 지난 실행 기한은 성공으로 바꾸지 않는다.
          if (performance.now() - slot.startedAt! > READ_TIMEOUT_MS) {
            fail(slot);
            return;
          }
          clearTimeout(slot.timer);
          slot.pending = undefined;
          pending.resolve(reply.result as Result<unknown>);
          pump();
        });
        // 서빙 중 오류는 slot을 격리한다.
        worker.on("error", () => {
          if (slot.worker === worker) fail(slot);
        });
        resolve(true);
      };
      const timer = setTimeout(() => {
        worker.off("message", onReady);
        worker.off("error", onBootError);
        resolve(false);
      }, READER_READY_MS);
      worker.on("error", onBootError);
      worker.on("message", onReady);
    });
  }

  // 기동 때 두 reader가 writer와 동시에 TS를 파싱하면 부팅이 크게 느려진다.
  // 첫 reader가 서면 바로 서빙을 열고, 두 번째 reader는 배경에서 띄워 secret sync 뒤 합류한다.
  let firstStarted: boolean;
  try {
    const worker = newWorker();
    const slot: Slot = { worker, health: "healthy" };
    slots.push(slot);
    firstStarted = await boot(slot, worker);
  } catch {
    slots.forEach((slot) => {
      clearTimeout(slot.timer);
      slot.health = "closed";
      slot.worker.terminate();
    });
    return unavailable();
  }
  if (!firstStarted) {
    slots.forEach((slot) => {
      clearTimeout(slot.timer);
      slot.health = "closed";
      slot.worker.terminate();
    });
    return unavailable();
  }
  serving = true;
  // 두 번째 reader slot은 배경에서 띄운다. boot가 끝나면 알려진 secret을 맞춘 뒤 healthy로 올린다.
  try {
    const secondWorker = newWorker();
    const secondSlot: Slot = { worker: secondWorker, health: "unhealthy" };
    slots.push(secondSlot);
    void boot(secondSlot, secondWorker).then(async (booted) => {
      if (closed) {
        secondWorker.terminate();
        return;
      }
      if (!booted) {
        secondWorker.terminate();
        scheduleRespawn();
        return;
      }
      secondSlot.syncing = true;
      await Promise.resolve(options.onRespawn?.()).catch(() => undefined);
      if (closed || secondSlot.worker !== secondWorker) return;
      secondSlot.syncing = false;
      secondSlot.health = "healthy";
      pump();
    });
  } catch {
    // 두 번째 slot을 못 띄워도 첫 reader로 서빙한다.
  }
  // 모든 healthy reader에 같은 등록·회수를 보내고 반영 확인을 기다린다. 값은 postMessage의
  // 구조적 복사로만 가고 어디에도 기록하지 않는다.
  function broadcast(
    op: "register" | "revoke" | "ready" | "unready",
    values: readonly string[],
  ): Promise<Result<void>> {
    if (values.length === 0 && op !== "ready" && op !== "unready") {
      return Promise.resolve(ok(undefined));
    }
    const targets = slots.filter(
      (slot) => slot.health === "healthy" || slot.syncing,
    );
    if (closed || targets.length === 0) return Promise.resolve(unavailable());
    const id = ++nextKnown;
    return new Promise((resolve) => {
      const waiting = new Set(targets);
      const timer = setTimeout(() => {
        // 반영을 확인하지 못한 reader는 격리한다(오래된 값으로 서빙하지 않는다).
        const late = [...waiting];
        settle(unavailable());
        for (const slot of late) fail(slot);
      }, KNOWN_ACK_MS);
      const settle = (result: Result<void>) => {
        clearTimeout(timer);
        knownWaits.delete(id);
        resolve(result);
      };
      knownWaits.set(id, { slots: waiting, settle });
      for (const slot of targets) {
        try {
          slot.worker.postMessage({ known: { id, op, values: [...values] } });
        } catch {
          fail(slot);
        }
      }
    });
  }

  return ok({
    known: {
      register: (values) => broadcast("register", values),
      revoke: (values) => broadcast("revoke", values),
      setReady: (ready) => broadcast(ready ? "ready" : "unready", []),
    },
    read(route, ctx, input) {
      const key = readKey(route);
      if (!keys.has(key)) {
        return Promise.resolve(
          err({ code: "not_found", message: "등록되지 않은 read다" }),
        );
      }
      if (
        closed ||
        !slots.some((slot) => slot.health === "healthy") ||
        waiting >= WAITING_MAX
      )
        return Promise.resolve(unavailable());
      return new Promise((resolve) => {
        const pending = { id: ++nextId, key, ctx, input, resolve };
        if ((queues.get(ctx.principal)?.length ?? 0) >= PER_CALLER) {
          hold(pending);
          return;
        }
        enqueue(pending);
        pump();
      });
    },
    health: () => slots.map((slot) => slot.health),
    close() {
      closed = true;
      clearTimeout(respawnTimer);
      respawnTimer = undefined;
      for (const slot of slots) {
        clearTimeout(slot.timer);
        slot.health = "closed";
        slot.pending?.resolve(unavailable());
        slot.pending = undefined;
        slot.worker.terminate();
      }
      drain();
      for (const wait of [...knownWaits.values()]) wait.settle(unavailable());
    },
  });
}
