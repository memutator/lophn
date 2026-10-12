// host port 모양. packages/core/apps/invocations/context.ts와 같은 필드다.
// SDK는 packages/core/apps를 import하지 않는다.

export type InvocationContext = {
  app: string;
  release: string | null;
  mode: "live" | "preview" | "test";
  invocation: string | null;
  // 이 호출의 command key와 검증·default 적용한 실제 입력의 정규 hash다(cap-host의 호출 문맥).
  command?: string | null;
  inputHash?: string | null;
  // 이 호출을 다른 앱에게서 받았다면 그 앱의 인증된 출처 식별이다(받은 연결의 caller).
  // 다른 앱을 부를 때 준비 서비스가 path를 이어 가는 근거로 쓴다.
  caller?: {
    app: string;
    release: string;
    parent_invocation: string | null;
  } | null;
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
