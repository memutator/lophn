import { AsyncLocalStorage } from "node:async_hooks";
import {
  currentPort,
  installPort,
  type InvocationContext,
  type RegisteredHandler,
  type SchedulePort,
} from "./context.ts";

const storage = new AsyncLocalStorage<InvocationContext>();
const registry: RegisteredHandler[] = [];

function port(): SchedulePort {
  return {
    handlers: () => registry.slice(),
    register(handler) {
      if (registry.some((known) => known.command === handler.command)) {
        throw new Error(`command already registered: ${handler.command}`);
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

function live(): SchedulePort {
  return currentPort() ?? installed;
}

export function command(
  name: string,
  handle: RegisteredHandler["handle"],
): void {
  live().register({ command: name, handle });
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

export function registeredCommands(): readonly string[] {
  return live().handlers().map((handler) => handler.command);
}
