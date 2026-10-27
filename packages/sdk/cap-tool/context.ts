// host port 모양. packages/core/apps/invocations/context.ts와 같은 필드다.
// SDK는 packages/core/apps를 import하지 않는다.

// core가 알려 준 부른 쪽이다(process-wire의 caller와 같다).
export type AppToolCaller =
  | { kind: "person"; view_session: string }
  | { kind: "agent"; session: string; turn: string; tool_call: string }
  | {
      kind: "app";
      app: string;
      release: string;
      parent_invocation: string | null;
    }
  | { kind: "program"; job: string; job_run: string }
  | { kind: "flow"; instance: string };

export type InvocationContext = {
  app: string;
  release: string | null;
  mode: "live" | "preview" | "test";
  invocation: string | null;
  // 이 호출의 tool 이름과 검증·default 적용한 실제 입력의 정규 hash다(cap-host의 호출 문맥).
  tool?: string | null;
  inputHash?: string | null;
  caller?: AppToolCaller | null;
};

export type RegisteredHandler = {
  tool: string;
  handle: (input: unknown) => Promise<unknown> | unknown;
};

export type AppToolPort = {
  handlers(): readonly RegisteredHandler[];
  register(handler: RegisteredHandler): void;
  run<T>(context: InvocationContext, fn: () => Promise<T> | T): Promise<T>;
  current(): InvocationContext | null;
};

export const APP_TOOL_PORT = Symbol.for("lophn.cap-tool");

type Store = Record<symbol, unknown>;

export function installPort(port: AppToolPort): AppToolPort {
  const store = globalThis as Store;
  const existing = store[APP_TOOL_PORT];
  if (existing && typeof existing === "object") return existing as AppToolPort;
  store[APP_TOOL_PORT] = port;
  return port;
}

export function currentPort(): AppToolPort | undefined {
  const port = (globalThis as Store)[APP_TOOL_PORT];
  return port && typeof port === "object" ? (port as AppToolPort) : undefined;
}
