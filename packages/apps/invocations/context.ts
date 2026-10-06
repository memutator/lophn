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

// 앱 handler가 "이 호출은 받지 않는다"고 알리는 오류의 표시다. handler가 효과를 내기 전에 던진 것만
// 이 표시를 달고, runtime은 일반 실패(500, 효과를 모름)와 달리 이 코드와 안내 문장을 호출자에게
// 돌려준다. SDK(packages/sdk/cap-schedule/rejection.ts)가 같은 심볼과 코드 목록으로 맞춘다.
export const COMMAND_REJECTION = Symbol.for("lophn.command-rejection");

export const REJECTION_CODES = [
  "invalid_input",
  "forbidden",
  "conflict",
  "unavailable",
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

export const REJECTION_MESSAGE_MAX_CHARS = 200;

export function readRejection(
  error: unknown,
): { code: RejectionCode; message: string } | undefined {
  if (!error || typeof error !== "object") return;
  const marked = (error as Record<symbol, unknown>)[COMMAND_REJECTION];
  const code = REJECTION_CODES.find((known) => known === marked);
  if (code === undefined) return;
  const message = (error as { message?: unknown }).message;
  return {
    code,
    message: typeof message === "string" && message.length > 0
      ? message.slice(0, REJECTION_MESSAGE_MAX_CHARS)
      : code,
  };
}
