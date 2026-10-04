import { err, ok, type Result } from "../../base/mod.ts";
import type {
  ReadRoute,
  RequestContext,
} from "../../contracts/platform/mod.ts";
import { READ_TIMEOUT_MS, readKey } from "./reads.ts";

export type ReaderHealth = "healthy" | "unhealthy" | "closed";
export type ReaderPool = {
  read(
    route: Pick<ReadRoute, "resource" | "method">,
    ctx: RequestContext,
    input: unknown,
  ): Promise<Result<unknown>>;
  health(): readonly ReaderHealth[];
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
  pending?: Pending;
  timer?: ReturnType<typeof setTimeout>;
  startedAt?: number;
};

const READER_READY_MS = 10000;

const unavailable = () =>
  err({
    code: "unavailable" as const,
    message: "reader가 현재 요청을 처리할 수 없다",
  });

export async function createReaderPool(
  path: string,
  registrationModules: readonly URL[],
): Promise<Result<ReaderPool>> {
  const keys = new Set<string>();
  const modules = registrationModules.map((url) => url.href);
  const slots: Slot[] = [];
  const queues = new Map<string, Pending[]>();
  const principals: string[] = [];
  let nextId = 0;
  let closed = false;
  let waiting = 0;

  function fail(slot: Slot) {
    if (slot.health !== "healthy") return;
    slot.health = "unhealthy";
    clearTimeout(slot.timer);
    slot.pending?.resolve(unavailable());
    slot.pending = undefined;
    // 동기 SQLite를 취소했다고 주장하지 않는다. unhealthy Worker를 pool에서 격리한다.
    slot.worker.terminate();
    pump();
  }

  function take(): Pending | undefined {
    const principal = principals.shift();
    if (principal === undefined) return;
    const queue = queues.get(principal)!;
    const pending = queue.shift()!;
    waiting--;
    if (queue.length) principals.push(principal);
    else queues.delete(principal);
    return pending;
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
    if (slots.every((slot) => slot.health !== "healthy")) {
      let pending: Pending | undefined;
      while ((pending = take())) pending.resolve(unavailable());
    }
  }

  let started: boolean[];
  try {
    started = await Promise.all(Array.from({ length: 2 }, () => {
      const worker = new Worker(
        new URL("./reader-worker.ts", import.meta.url).href,
        {
          type: "module",
        },
      );
      const slot: Slot = { worker, health: "healthy" };
      slots.push(slot);
      return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          fail(slot);
          resolve(false);
        }, READER_READY_MS);
        slot.timer = timer;
        worker.onerror = (event) => {
          event.preventDefault();
          clearTimeout(timer);
          fail(slot);
          resolve(false);
        };
        worker.onmessage = (event) => {
          clearTimeout(timer);
          const result = event.data.ready as Result<string[]>;
          if (!result?.ok) {
            fail(slot);
            resolve(false);
            return;
          }
          for (const key of result.value) keys.add(key);
          worker.onmessage = (reply) => {
            if (slot.health !== "healthy") return;
            const pending = slot.pending;
            if (!pending || reply.data.id !== pending.id) return;
            // reply가 timer보다 먼저 배달돼도 지난 실행 기한은 성공으로 바꾸지 않는다.
            if (performance.now() - slot.startedAt! > READ_TIMEOUT_MS) {
              fail(slot);
              return;
            }
            clearTimeout(slot.timer);
            slot.pending = undefined;
            pending.resolve(reply.data.result as Result<unknown>);
            pump();
          };
          resolve(true);
        };
        try {
          worker.postMessage({ path, modules });
        } catch {
          clearTimeout(timer);
          fail(slot);
          resolve(false);
        }
      });
    }));
  } catch {
    slots.forEach((slot) => {
      clearTimeout(slot.timer);
      slot.health = "closed";
      slot.worker.terminate();
    });
    return unavailable();
  }
  if (!started.every(Boolean)) {
    slots.forEach((slot) => {
      clearTimeout(slot.timer);
      slot.health = "closed";
      slot.worker.terminate();
    });
    return unavailable();
  }
  return ok({
    read(route, ctx, input) {
      const key = readKey(route);
      if (!keys.has(key)) {
        return Promise.resolve(
          err({ code: "not_found", message: "등록되지 않은 read다" }),
        );
      }
      if (
        closed || !slots.some((slot) => slot.health === "healthy") ||
        waiting >= 64 || (queues.get(ctx.principal)?.length ?? 0) >= 8
      ) return Promise.resolve(unavailable());
      return new Promise((resolve) => {
        const pending = { id: ++nextId, key, ctx, input, resolve };
        const queue = queues.get(ctx.principal);
        if (queue) queue.push(pending);
        else {
          queues.set(ctx.principal, [pending]);
          principals.push(ctx.principal);
        }
        waiting++;
        pump();
      });
    },
    health: () => slots.map((slot) => slot.health),
    close() {
      closed = true;
      for (const slot of slots) {
        clearTimeout(slot.timer);
        slot.health = "closed";
        slot.pending?.resolve(unavailable());
        slot.pending = undefined;
        slot.worker.terminate();
      }
      let pending: Pending | undefined;
      while ((pending = take())) pending.resolve(unavailable());
    },
  });
}
