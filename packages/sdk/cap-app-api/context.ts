// host port 모양. packages/core/apps/invocations/context.ts와 같은 필드다.
// SDK는 packages/core/apps를 import하지 않는다.

// core가 알려 준 부른 쪽이다(process-wire의 caller와 같다).
export type AppApiCaller =
  | { kind: "person"; view_session: string }
  | { kind: "agent"; session: string; turn: string; tool_call: string }
  | {
    kind: "app";
    app: string;
    release: string;
    parent_invocation: string | null;
  };

export type InvocationContext = {
  app: string;
  release: string | null;
  mode: "live" | "preview" | "test";
  invocation: string | null;
  // project 범위 app-api가 아니면 null이다.
  project: string | null;
  // 이 호출의 app-api key와 검증·default 적용한 실제 입력의 정규 hash다(cap-host의 호출 문맥).
  api?: string | null;
  inputHash?: string | null;
  caller?: AppApiCaller | null;
};

export type RegisteredHandler = {
  api: string;
  handle: (input: unknown) => Promise<unknown> | unknown;
};

export type SchedulePort = {
  handlers(): readonly RegisteredHandler[];
  register(handler: RegisteredHandler): void;
  run<T>(context: InvocationContext, fn: () => Promise<T> | T): Promise<T>;
  current(): InvocationContext | null;
};

export const SCHEDULE_PORT = Symbol.for("lophn.cap-app-api");

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
