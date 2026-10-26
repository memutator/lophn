import {
  CODING_CHANNEL,
  CODING_HOOK_ASK_CHANNEL,
  CODING_HOOK_RESULT_CHANNEL,
  type CodingApi,
  type CodingReply,
  type HookAsk,
  type HookResult,
} from "../ipc/coding.ts";

interface CodingTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
  on(
    channel: string,
    callback: (event: unknown, payload: unknown) => void,
  ): void;
  removeListener(
    channel: string,
    callback: (event: unknown, payload: unknown) => void,
  ): void;
}

const unavailable = (): CodingReply<never> => ({
  ok: false,
  error: { code: "unavailable", message: "Coding transport is unavailable" },
});

// main 응답은 그대로 넘긴다. 통로가 끊기면 unavailable이다. 이름·모양 검사는 main이 한다.
export function createCodingApi(transport: CodingTransport): CodingApi {
  async function call<T>(input: unknown): Promise<CodingReply<T>> {
    try {
      return await transport.invoke(CODING_CHANNEL, input) as CodingReply<T>;
    } catch {
      return unavailable();
    }
  }
  // main이 보낸 값의 모양만 본다. 값 검사는 main이 보낼 때 한다.
  function subscribe<T>(
    channel: string,
    shaped: (payload: unknown) => payload is T,
    listener: (payload: T) => void,
  ): () => void {
    const callback = (_event: unknown, payload: unknown) => {
      if (shaped(payload)) listener(payload);
    };
    transport.on(channel, callback);
    return () => transport.removeListener(channel, callback);
  }
  const isAsk = (payload: unknown): payload is HookAsk =>
    typeof payload === "object" && payload !== null &&
    typeof (payload as HookAsk).request === "string" &&
    Array.isArray((payload as HookAsk).files);
  const isResult = (payload: unknown): payload is HookResult =>
    typeof payload === "object" && payload !== null &&
    typeof (payload as HookResult).ok === "boolean" &&
    Array.isArray((payload as HookResult).files);
  return Object.freeze(
    {
      harnesses: () => call({ op: "harnesses" }),
      refresh: () => call({ op: "refresh" }),
      hookStatus: () => call({ op: "hook_status" }),
      installHooks: (harness) => call({ op: "install_hooks", harness }),
      answerHookAsk: ({ request, accepted }) =>
        call({ op: "hook_answer", request, accepted }),
      onHookAsk: (listener) =>
        subscribe(CODING_HOOK_ASK_CHANNEL, isAsk, listener),
      onHookResult: (listener) =>
        subscribe(CODING_HOOK_RESULT_CHANNEL, isResult, listener),
    } satisfies CodingApi,
  );
}
