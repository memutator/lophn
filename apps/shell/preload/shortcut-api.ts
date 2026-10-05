// shell renderer가 받는 창 안 shortcut 이름. Electron event는 closure 밖으로 내지 않고
// 표에 있는 이름만 넘긴다.
import {
  isWindowShortcut,
  type ShortcutApi,
  WINDOW_SHORTCUT_CHANNEL,
} from "../ipc/shortcuts.ts";

export interface ShortcutTransport {
  on(channel: string, callback: (event: unknown, payload: unknown) => void): void;
  removeListener(
    channel: string,
    callback: (event: unknown, payload: unknown) => void,
  ): void;
}

export function createShortcutApi(transport: ShortcutTransport): ShortcutApi {
  return Object.freeze(
    {
      subscribe(listener) {
        const callback = (_event: unknown, payload: unknown) => {
          if (isWindowShortcut(payload)) listener(payload);
        };
        transport.on(WINDOW_SHORTCUT_CHANNEL, callback);
        return () =>
          transport.removeListener(WINDOW_SHORTCUT_CHANNEL, callback);
      },
    } satisfies ShortcutApi,
  );
}
