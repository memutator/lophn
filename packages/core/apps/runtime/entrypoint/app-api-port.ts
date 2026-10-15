// cap-app-api와 같은 심볼. 먼저 설치한 쪽이 port를 소유하고 나중 load는 재사용한다.
import { AsyncLocalStorage } from "node:async_hooks";
import {
  type InvocationContext,
  type RegisteredHandler,
  SCHEDULE_PORT,
  type SchedulePort,
} from "../../invocations/mod.ts";

const storage = new AsyncLocalStorage<InvocationContext>();
const registry: RegisteredHandler[] = [];

function createPort(): SchedulePort {
  return {
    handlers: () => registry.slice(),
    register(handler) {
      if (registry.some((known) => known.api === handler.api)) {
        throw new Error(`app-api already registered: ${handler.api}`);
      }
      registry.push(handler);
    },
    run(context, fn) {
      return storage.run(context, () => Promise.resolve(fn()));
    },
    current: () => storage.getStore() ?? null,
  };
}

export function ensureAppApiPort(): SchedulePort {
  const store = globalThis as Record<symbol, unknown>;
  const existing = store[SCHEDULE_PORT];
  if (existing && typeof existing === "object") return existing as SchedulePort;
  const port = createPort();
  store[SCHEDULE_PORT] = port;
  return port;
}

ensureAppApiPort();
