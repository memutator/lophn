import { AsyncLocalStorage } from "node:async_hooks";
import {
  type AppApiPort,
  currentPort,
  installPort,
  type InvocationContext,
  type RegisteredHandler,
} from "./context.ts";

const storage = new AsyncLocalStorage<InvocationContext>();
const registry: RegisteredHandler[] = [];

function port(): AppApiPort {
  return {
    handlers: () => registry.slice(),
    register(handler) {
      if (registry.some((known) => known.api === handler.api)) {
        throw new Error(`tool already registered: ${handler.api}`);
      }
      registry.push(handler);
    },
    run(context, fn) {
      return storage.run(context, () => Promise.resolve(fn()));
    },
    current: () => storage.getStore() ?? null,
  };
}

// 이미 설치된 port가 있으면 그 registry를 쓴다. 두 load가 문맥을 나누지 않는다.
const installed = installPort(port());

function live(): AppApiPort {
  return currentPort() ?? installed;
}

export function tool(
  name: string,
  handle: RegisteredHandler["handle"],
): void {
  live().register({ api: name, handle });
}

export function currentContext(): InvocationContext | null {
  return live().current();
}

export function runWith<T>(
  context: InvocationContext,
  fn: () => Promise<T> | T,
): Promise<T> {
  return live().run(context, fn);
}

export function registeredTools(): readonly string[] {
  return live().handlers().map((handler) => handler.api);
}
