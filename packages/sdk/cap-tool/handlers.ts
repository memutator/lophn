import { AsyncLocalStorage } from "node:async_hooks";
import {
  type HandlerPort,
  currentPort,
  installPort,
  type InvocationContext,
  type RegisteredHandler,
} from "./context.ts";

const storage = new AsyncLocalStorage<InvocationContext>();
const registry: RegisteredHandler[] = [];

function port(): HandlerPort {
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

// 이미 설치된 port가 있으면 그 registry를 쓴다. 두 load가 문맥을 나누지 않는다.
const installed = installPort(port());

function live(): HandlerPort {
  return currentPort() ?? installed;
}

// operation과 command의 handler는 이름 하나로 등록한다. 어느 쪽인지는 선언이 정한다.
export function handle(name: string, run: RegisteredHandler["handle"]): void {
  live().register({ name, handle: run });
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

export function registeredHandlers(): readonly string[] {
  return live()
    .handlers()
    .map((handler) => handler.name);
}
