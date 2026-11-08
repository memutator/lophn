import {
  EXTENSIONS_CHANNEL,
  type ExtensionsApi,
  type ExtensionsReply,
} from "../ipc/extensions.ts";

interface ExtensionsTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
}

// main 응답은 그대로 넘긴다. 통로가 끊기면 unavailable이다. 이름·모양 검사는 main이 한다.
export function createExtensionsApi(
  transport: ExtensionsTransport,
): ExtensionsApi {
  async function call<T>(input: unknown): Promise<ExtensionsReply<T>> {
    try {
      return (await transport.invoke(
        EXTENSIONS_CHANNEL,
        input,
      )) as ExtensionsReply<T>;
    } catch {
      return {
        ok: false,
        error: {
          code: "unavailable",
          message: "Extensions transport is unavailable",
        },
      };
    }
  }
  return Object.freeze({
    list: () => call({ op: "list" }),
    install: (id) => call({ op: "install", id }),
    remove: (id) => call({ op: "remove", id }),
    run: (command) => call({ op: "run", command }),
  } satisfies ExtensionsApi);
}
