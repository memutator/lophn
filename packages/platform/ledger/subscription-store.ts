import { err, ok, type Result } from "../../base/mod.ts";

export type SubscriptionStore = {
  get(principal: string, name: string): Promise<Result<string | null>>;
  ack(
    principal: string,
    name: string,
    through: string,
    sourceFrom?: string,
  ): Promise<Result<void>>;
  close(): void;
};
const unavailable = () =>
  err({ code: "unavailable" as const, message: "ack 저장소를 사용할 수 없다" });

// entry는 H/derived/api-subscriptions 절대 경로를 넘긴다. ledger handle은 받지 않는다.
export async function createSubscriptionStore(
  directory: string,
): Promise<Result<SubscriptionStore>> {
  if (!directory.startsWith("/")) return unavailable();
  let worker: Worker;
  try {
    worker = new Worker(
      new URL("./subscription-store-worker.ts", import.meta.url).href,
      { type: "module" },
    );
  } catch {
    return unavailable();
  }
  let closed = false;
  let nextId = 0;
  const pending = new Map<number, {
    resolve(value: Result<unknown>): void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  function close() {
    if (closed) return;
    closed = true;
    worker.terminate();
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.resolve(unavailable());
    }
    pending.clear();
  }
  const ready = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      close();
      resolve(false);
    }, 10000);
    worker.onerror = (event) => {
      event.preventDefault();
      clearTimeout(timer);
      close();
      resolve(false);
    };
    worker.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data.ready === true);
    };
    try {
      worker.postMessage({ directory });
    } catch {
      clearTimeout(timer);
      close();
      resolve(false);
    }
  });
  if (!ready) {
    close();
    return unavailable();
  }
  worker.onerror = (event) => {
    event.preventDefault();
    close();
  };
  worker.onmessage = (event) => {
    const item = pending.get(event.data.id);
    if (!item) return;
    pending.delete(event.data.id);
    clearTimeout(item.timer);
    item.resolve(event.data.result);
  };
  function request(
    action: "get" | "ack",
    principal: string,
    name: string,
    through?: string,
    sourceFrom?: string,
  ): Promise<Result<unknown>> {
    if (closed || pending.size >= 64) return Promise.resolve(unavailable());
    return new Promise((resolve) => {
      const id = ++nextId;
      const timer = setTimeout(close, 2000);
      pending.set(id, { resolve, timer });
      try {
        worker.postMessage({
          id,
          action,
          principal,
          name,
          through,
          sourceFrom,
        });
      } catch {
        close();
      }
    });
  }
  return ok({
    get: (principal, name) =>
      request("get", principal, name) as Promise<Result<string | null>>,
    ack: (principal, name, through, sourceFrom) =>
      request("ack", principal, name, through, sourceFrom) as Promise<
        Result<void>
      >,
    close,
  });
}
