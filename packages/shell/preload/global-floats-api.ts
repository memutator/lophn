import {
  GLOBAL_FLOATS_READ_CHANNEL,
  GLOBAL_FLOATS_SAVE_CHANNEL,
  type GlobalFloatRecord,
  type GlobalFloatsReadResult,
  type GlobalFloatsSaveResult,
} from "../ipc/global-floats.ts";

interface GlobalFloatsTransport {
  invoke(channel: string, input?: unknown): Promise<unknown>;
}

/** 전역 float 통로. 목록만 보내고 main이 다시 검사한다. */
interface LophnGlobalFloatsApi {
  read(): Promise<GlobalFloatsReadResult>;
  save(input: { floats: GlobalFloatRecord[] }): Promise<GlobalFloatsSaveResult>;
}

export function createGlobalFloatsApi(
  transport: GlobalFloatsTransport,
): LophnGlobalFloatsApi {
  return Object.freeze({
    read: async () => {
      try {
        return (await transport.invoke(
          GLOBAL_FLOATS_READ_CHANNEL,
        )) as GlobalFloatsReadResult;
      } catch {
        return { ok: false, code: "unavailable", message: "" };
      }
    },
    save: async (input) => {
      try {
        return (await transport.invoke(
          GLOBAL_FLOATS_SAVE_CHANNEL,
          input,
        )) as GlobalFloatsSaveResult;
      } catch {
        return { ok: false, code: "unavailable", message: "" };
      }
    },
  } satisfies LophnGlobalFloatsApi);
}
