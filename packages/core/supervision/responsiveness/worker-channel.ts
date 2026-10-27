import { err, ok, type Result } from "../../../base/mod.ts";
import type { ChildMessage } from "../../../protocol/supervision/mod.ts";

// worker 요청 통로. 보낸 request_id의 worker_response를 기다린다.
// worker가 없거나 답하지 않으면 unavailable이고 성공으로 바꾸지 않는다.
export type WorkerChannel = {
  request(
    op: string,
    payload: unknown,
    timeoutMs?: number,
  ): Promise<Result<unknown>>;
  // 감독이 child 메시지를 넘기는 callback.
  onMessage(message: ChildMessage): void;
  // 감독 pipe의 쓰기. 연결이 없으면 null이다(worker가 아직 뜨지 않음·정지).
  bind(send: ((payload: unknown) => Promise<boolean>) | null): void;
  readonly bound: boolean;
  // worker를 새 spec으로 바꿀 때 work를 이것으로 감싼다. 이미 보낸 요청은 옛 child가
  // 답하기를 잠깐(REPLACE_DRAIN_MS) 기다리고, 남은 요청은 옛 child와 함께 사라지므로 기한까지
  // 기다리지 않고 바로 unavailable로 끝낸다. 그동안 온 새 요청은 보내지 않고 교체가 끝나기를
  // (그 요청의 기한 안에서) 기다렸다가 새 child로 보낸다.
  replacing<T>(work: () => Promise<T>): Promise<T>;
  // worker가 끝났다(crash·정지). 보낸 요청은 답이 오지 않으므로 기한까지 기다리지 않고 바로
  // unavailable로 끝낸다.
  failPending(message: string): void;
};

const REQUEST_TIMEOUT_MS = 5_000;
// worker를 바꾸기 전에 이미 보낸 요청이 답하기를 기다리는 한도. 넘은 요청은 unavailable로 끝낸다.
const REPLACE_DRAIN_MS = 3_000;

export function createWorkerChannel(
  options: { drainMs?: number } = {},
): WorkerChannel {
  const drainMs = options.drainMs ?? REPLACE_DRAIN_MS;
  let send: ((payload: unknown) => Promise<boolean>) | null = null;
  let counter = 0;
  const pending = new Map<string, (answer: Result<unknown>) => void>();
  // worker를 바꾸는 중이면 그 끝을 알리는 promise. 아니면 null이다.
  let replacing: Promise<void> | null = null;
  // 보낸 요청이 모두 끝나기를 기다리는 쪽.
  const idle: (() => void)[] = [];

  function leave(id: string): ((answer: Result<unknown>) => void) | undefined {
    const settle = pending.get(id);
    pending.delete(id);
    if (pending.size === 0) {
      for (const wake of idle.splice(0)) wake();
    }
    return settle;
  }

  const unavailable = (message: string): Result<unknown> =>
    err({ code: "unavailable", message });

  function failPending(message: string) {
    for (const id of [...pending.keys()]) leave(id)?.(unavailable(message));
  }

  function deliver(
    sender: (payload: unknown) => Promise<boolean>,
    op: string,
    payload: unknown,
    timeoutMs: number,
  ): Promise<Result<unknown>> {
    counter += 1;
    const id = `worker-request-${counter}`;
    return new Promise<Result<unknown>>((resolve) => {
      const timer = setTimeout(() => {
        leave(id);
        resolve(unavailable("worker가 시간 안에 답하지 않았다"));
      }, timeoutMs);
      pending.set(id, (answer) => {
        clearTimeout(timer);
        resolve(answer);
      });
      sender({ type: "worker_request", request_id: id, op, payload }).then(
        (sent) => {
          if (sent) return;
          leave(id)?.(unavailable("worker에 요청을 보내지 못했다"));
        },
        () => {
          leave(id)?.(unavailable("worker에 요청을 보내지 못했다"));
        },
      );
    });
  }

  async function pendingWithin(ms: number): Promise<void> {
    if (pending.size === 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const emptied = new Promise<void>((resolve) => idle.push(resolve));
    const expired = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ms);
    });
    try {
      await Promise.race([emptied, expired]);
    } finally {
      clearTimeout(timer);
    }
  }

  // 교체가 끝나기를 기다린다. 이 요청의 기한이 먼저 오면 보내지 않고 unavailable이다.
  async function untilReplaced(
    gate: Promise<void>,
    timeoutMs: number,
  ): Promise<number | undefined> {
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<"expired">((resolve) => {
      timer = setTimeout(() => resolve("expired"), timeoutMs);
    });
    try {
      const outcome = await Promise.race([gate, expired]);
      if (outcome === "expired") return undefined;
    } finally {
      clearTimeout(timer);
    }
    return Math.max(1, timeoutMs - (performance.now() - started));
  }

  return {
    async request(op, payload, timeoutMs = REQUEST_TIMEOUT_MS) {
      let budget = timeoutMs;
      if (replacing !== null) {
        const left = await untilReplaced(replacing, timeoutMs);
        if (left === undefined) {
          return unavailable("worker를 바꾸는 중이라 시간 안에 닿지 못했다");
        }
        budget = left;
      }
      const sender = send;
      if (sender === null) {
        return unavailable("worker가 준비되지 않았다");
      }
      return await deliver(sender, op, payload, budget);
    },
    async replacing(work) {
      // 다른 교체(감독 포기 뒤 다시 띄움과 root 변경이 겹칠 수 있다)가 끝나기를 기다린 뒤 한다.
      while (replacing !== null) await replacing;
      let open: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      replacing = gate;
      try {
        // 이미 보낸 요청은 옛 child가 답하게 두되 오래 기다리지 않는다. 옛 child가 멈추면 남은
        // 요청에는 답이 오지 않으므로 바로 끝낸다.
        await pendingWithin(drainMs);
        failPending("worker를 바꾸는 중이라 요청이 끝나지 못했다");
        return await work();
      } finally {
        if (replacing === gate) replacing = null;
        open();
      }
    },
    failPending,
    onMessage(message) {
      if (message.type !== "worker_response") return;
      const settle = leave(message.request_id);
      if (!settle) return;
      settle(
        message.ok
          ? ok(message.payload)
          : err({
              code: message.error.code,
              message: "worker가 요청을 거절했다",
            }),
      );
    },
    bind(next) {
      send = next;
    },
    get bound() {
      return send !== null;
    },
  };
}
