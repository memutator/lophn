import {
  CODING_CHANNEL,
  type CodingApi,
  type CodingReply,
} from "../ipc/coding.ts";

export interface CodingTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
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
  return Object.freeze(
    {
      detect: () => call({ op: "detect" }),
      refresh: () => call({ op: "refresh" }),
      connect: (request) => call({ op: "connect", request }),
      folders: () => call({ op: "folders" }),
      start: (click) => call({ op: "start", click }),
      sessions: () => call({ op: "sessions" }),
    } satisfies CodingApi,
  );
}
