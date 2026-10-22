// cap-tool host port의 구조. SDK는 packages/core/apps를 import하지 않고,
// apps leaf는 packages/sdk를 import하지 않는다. 두 쪽이 같은 모양으로 맞춘다.
// 필드가 바뀌면 packages/sdk/cap-tool/context.ts도 같이 바꾼다.

// core가 알려 준 부른 쪽이다(protocol/apps/calls/caller.ts와 같다).
type InvocationCaller =
  | { kind: "person"; view_session: string }
  | { kind: "agent"; session: string; turn: string; tool_call: string }
  | {
    kind: "app";
    app: string;
    release: string;
    parent_invocation: string | null;
  }
  | { kind: "program"; job: string; job_run: string };

export type InvocationContext = {
  app: string;
  release: string | null;
  mode: "live" | "preview";
  invocation: string | null;
  // 이 호출의 tool key와 검증·default 적용한 실제 입력의 정규 hash다(cap-host의 호출 문맥).
  tool?: string | null;
  inputHash?: string | null;
  caller?: InvocationCaller | null;
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

export function readAppToolPort(): AppToolPort | undefined {
  const port = (globalThis as Record<symbol, unknown>)[APP_TOOL_PORT];
  if (!port || typeof port !== "object") return;
  const candidate = port as Partial<AppToolPort>;
  if (
    typeof candidate.handlers !== "function" ||
    typeof candidate.register !== "function" ||
    typeof candidate.run !== "function" ||
    typeof candidate.current !== "function"
  ) return;
  return candidate as AppToolPort;
}

// 앱 handler가 "이 호출은 받지 않는다"고 알리는 오류의 표시다. handler가 효과를 내기 전에 던진 것만
// 이 표시를 달고, runtime은 일반 실패(500, 효과를 모름)와 달리 이 코드와 안내 문장을 호출자에게
// 돌려준다. SDK(packages/sdk/cap-tool/rejection.ts)가 같은 심볼과 코드 목록으로 맞춘다.
const APP_TOOL_REJECTION = Symbol.for("lophn.app-tool-rejection");

const REJECTION_CODES = [
  "invalid_input",
  "forbidden",
  "conflict",
  "unavailable",
] as const;
type RejectionCode = (typeof REJECTION_CODES)[number];

const REJECTION_MESSAGE_MAX_CHARS = 200;

export function readRejection(
  error: unknown,
): { code: RejectionCode; message: string } | undefined {
  if (!error || typeof error !== "object") return;
  const marked = (error as Record<symbol, unknown>)[APP_TOOL_REJECTION];
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
