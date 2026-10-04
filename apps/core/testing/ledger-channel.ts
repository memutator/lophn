import { err, type Result } from "../../../packages/base/mod.ts";
import type {
  TestBoot,
  TestRequestBody,
  TestResponse,
} from "./ledger-types.ts";

export const harnessUnavailable = () =>
  err({
    code: "unavailable" as const,
    message: "ledger test harness를 사용할 수 없다",
  });
const READY_MS = 10000;
const REQUEST_MS = 10000;
// 64 data 요청과 별개로 credential 제어/close가 들어갈 여유를 남긴다.
const MAX_PENDING = 66;

type Pending = {
  resolve(result: Result<unknown>): void;
  timer: ReturnType<typeof setTimeout>;
  deadline: number;
};

export function startChannel(boot: TestBoot, failed: () => void) {
  const worker = new Worker(
    new URL("./ledger-worker.ts", import.meta.url).href,
    {
      type: "module",
      name: JSON.stringify(boot),
    },
  );
  let dead = false;
  let sequence = 0;
  const pending = new Map<number, Pending>();
  let resolveReady: (result: Result<unknown>) => void;
  const ready = new Promise<Result<unknown>>((resolve) => {
    resolveReady = resolve;
  });
  const timer = setTimeout(fail, READY_MS);
  function stop() {
    if (dead) return;
    dead = true;
    clearTimeout(timer);
    resolveReady(harnessUnavailable());
    worker.terminate();
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve(harnessUnavailable());
    }
    pending.clear();
  }
  function fail() {
    stop();
    failed();
  }
  worker.onerror = (event) => {
    event.preventDefault();
    fail();
  };
  worker.onmessageerror = fail;
  worker.onmessage = (event: MessageEvent<TestResponse>) => {
    const reply = event.data;
    if (reply.id === 0) {
      clearTimeout(timer);
      resolveReady(reply.result);
      if (!reply.result.ok) fail();
      return;
    }
    const entry = pending.get(reply.id);
    if (!entry) return;
    // parent timer보다 reply가 먼저 와도 지난 기한을 성공으로 바꾸지 않는다.
    if (performance.now() > entry.deadline) {
      fail();
      return;
    }
    pending.delete(reply.id);
    clearTimeout(entry.timer);
    entry.resolve(reply.result);
  };
  return {
    ready,
    stop,
    request<T>(body: TestRequestBody): Promise<Result<T>> {
      if (dead || pending.size >= MAX_PENDING) {
        return Promise.resolve(harnessUnavailable());
      }
      return new Promise((resolve) => {
        const id = ++sequence;
        const timeout = body.op === "read" ? 2000 : REQUEST_MS;
        pending.set(id, {
          deadline: performance.now() + timeout,
          resolve: (result) => resolve(result as Result<T>),
          timer: setTimeout(fail, timeout),
        });
        try {
          worker.postMessage({ ...body, id });
        } catch {
          const entry = pending.get(id)!;
          pending.delete(id);
          clearTimeout(entry.timer);
          resolve(
            err({
              code: "invalid_input",
              message: "테스트 요청을 전달할 수 없다",
            }),
          );
        }
      });
    },
  };
}
