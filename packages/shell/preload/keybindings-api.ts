import {
  KEYBINDINGS_CHANNEL,
  type KeybindingsApi,
} from "../ipc/keybindings.ts";

interface KeybindingsTransport {
  invoke(channel: string, input: unknown): Promise<unknown>;
}

// 사람이 바꾼 키만 보낸다. main이 다시 검사한다. 실패하면 main이 먼저 받는 키만 표의 키로 남는다.
export function createKeybindingsApi(
  transport: KeybindingsTransport,
): KeybindingsApi {
  return Object.freeze({
    set(overrides) {
      void transport.invoke(KEYBINDINGS_CHANNEL, overrides).catch(() => {});
    },
  } satisfies KeybindingsApi);
}
