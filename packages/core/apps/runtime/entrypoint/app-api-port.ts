// cap-app-api와 같은 심볼. 먼저 설치한 쪽이 port를 소유하고 나중 load는 재사용한다.
import { AsyncLocalStorage } from "node:async_hooks";
import {
  APP_API_PORT,
  type AppApiPort,
  type InvocationContext,
  type RegisteredHandler,
} from "../../invocations/context.ts";

const storage = new AsyncLocalStorage<InvocationContext>();
const registry: RegisteredHandler[] = [];

function createPort(): AppApiPort {
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

export function ensureAppApiPort(): AppApiPort {
  const store = globalThis as Record<symbol, unknown>;
  const existing = store[APP_API_PORT];
  if (existing && typeof existing === "object") return existing as AppApiPort;
  const port = createPort();
  store[APP_API_PORT] = port;
  return port;
}

ensureAppApiPort();
