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

// 명령이 지나간 단계의 표시(apps/invocations#R11). 로컬 저장과 외부 전송처럼 따로 끝나는 일을
// invocation 요약에 따로 남긴다. 단계 이름은 trace 이름 규칙(64자)을 따르고 호출 문맥의
// invocation에 붙는다. 문맥이 없으면 아무것도 하지 않는다.
export type InvocationStageState = "completed" | "failed" | "unknown";

export type StagePort = {
  stage(name: string, state: InvocationStageState): void;
};

export const STAGE_PORT = Symbol.for("lophn.invocation-stages");

export function readStagePort(): StagePort | undefined {
  const port = (globalThis as Record<symbol, unknown>)[STAGE_PORT];
  if (!port || typeof port !== "object") return;
  const candidate = port as Partial<StagePort>;
  if (typeof candidate.stage !== "function") return;
  return candidate as StagePort;
}

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
