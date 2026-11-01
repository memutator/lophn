// cap-tool과 같은 심볼. 먼저 설치한 쪽이 port를 소유하고 나중 load는 재사용한다.
import { AsyncLocalStorage } from "node:async_hooks";
import {
  APP_TOOL_PORT,
  type AppToolPort,
  type InvocationContext,
  type RegisteredHandler,
} from "../../invocations/context.ts";

const storage = new AsyncLocalStorage<InvocationContext>();
const registry: RegisteredHandler[] = [];

function createPort(): AppToolPort {
  return {
    handlers: () => registry.slice(),
    register(handler) {
      if (registry.some((known) => known.name === handler.name)) {
        throw new Error(`handler already registered: ${handler.name}`);
      }
      registry.push(handler);
    },
    run(context, fn) {
      return storage.run(context, () => Promise.resolve(fn()));
    },
    current: () => storage.getStore() ?? null,
  };
}

export function ensureAppToolPort(): AppToolPort {
  const store = globalThis as Record<symbol, unknown>;
  const existing = store[APP_TOOL_PORT];
  if (existing && typeof existing === "object") return existing as AppToolPort;
  const port = createPort();
  store[APP_TOOL_PORT] = port;
  return port;
}

ensureAppToolPort();
