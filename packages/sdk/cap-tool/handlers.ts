import {
  currentPort,
  type HandlerPort,
  type InvocationContext,
  type RegisteredHandler,
} from "./context.ts";

// 호출 문맥을 쥐는 port는 entry가 깐다(port.node.ts, port.phone.ts). host가 먼저 깔았으면 그것을 쓴다.
function live(): HandlerPort {
  const port = currentPort();
  if (!port) throw new Error("no handler port is installed");
  return port;
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

export function registryPort(
  run: HandlerPort["run"],
  current: HandlerPort["current"],
): HandlerPort {
  const registry: RegisteredHandler[] = [];
  return {
    handlers: () => registry.slice(),
    register(handler) {
      if (registry.some((known) => known.name === handler.name)) {
        throw new Error(`handler already registered: ${handler.name}`);
      }
      registry.push(handler);
    },
    run,
    current,
  };
}
