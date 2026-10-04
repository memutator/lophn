// host port 모양. packages/apps/invocations/context.ts와 같은 필드다.
// SDK는 packages/apps를 import하지 않는다.

export type InvocationContext = {
  app: string;
  release: string | null;
  mode: "live" | "preview" | "test";
  invocation: string | null;
};

export type RegisteredHandler = {
  command: string;
  handle: (input: unknown) => Promise<unknown> | unknown;
};

export type SchedulePort = {
  handlers(): readonly RegisteredHandler[];
  register(handler: RegisteredHandler): void;
  run<T>(context: InvocationContext, fn: () => Promise<T> | T): Promise<T>;
  current(): InvocationContext | null;
};

export const SCHEDULE_PORT = Symbol.for("lophn.cap-schedule");

type Store = Record<symbol, unknown>;

export function installPort(port: SchedulePort): SchedulePort {
  const store = globalThis as Store;
  const existing = store[SCHEDULE_PORT];
  if (existing && typeof existing === "object") return existing as SchedulePort;
  store[SCHEDULE_PORT] = port;
  return port;
}

export function currentPort(): SchedulePort | undefined {
  const port = (globalThis as Store)[SCHEDULE_PORT];
  return port && typeof port === "object" ? port as SchedulePort : undefined;
}
