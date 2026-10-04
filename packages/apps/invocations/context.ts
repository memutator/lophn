// cap-schedule host port의 구조. SDK는 packages/apps를 import하지 않고,
// apps leaf는 packages/sdk를 import하지 않는다. 두 쪽이 같은 모양으로 맞춘다.
// 필드가 바뀌면 packages/sdk/cap-schedule/context.ts도 같이 바꾼다.

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

export function readSchedulePort(): SchedulePort | undefined {
  const port = (globalThis as Record<symbol, unknown>)[SCHEDULE_PORT];
  if (!port || typeof port !== "object") return;
  const candidate = port as Partial<SchedulePort>;
  if (
    typeof candidate.handlers !== "function" ||
    typeof candidate.register !== "function" ||
    typeof candidate.run !== "function" ||
    typeof candidate.current !== "function"
  ) return;
  return candidate as SchedulePort;
}
