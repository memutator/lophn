// shell renderer가 받는 창 안 shortcut 이름. Electron event는 closure 밖으로 내지 않고
// 팔레트·home이거나 표에 있는 binding id 글자만 넘긴다.
import {
  DESKTOP_INTENT_CHANNEL,
  type DesktopIntent,
  DRIVER_INPUT_CHANNEL,
  type IntentApi,
  isDesktopIntent,
  isWindowShortcut,
  type ShortcutApi,
  WINDOW_SHORTCUT_CHANNEL,
} from "../ipc/shortcuts.ts";

interface ShortcutTransport {
  on(
    channel: string,
    callback: (event: unknown, payload: unknown) => void,
  ): void;
  removeListener(
    channel: string,
    callback: (event: unknown, payload: unknown) => void,
  ): void;
}

export function createShortcutApi(transport: ShortcutTransport): ShortcutApi {
  return Object.freeze({
    subscribe(listener) {
      const callback = (_event: unknown, payload: unknown) => {
        if (isWindowShortcut(payload)) listener(payload);
      };
      transport.on(WINDOW_SHORTCUT_CHANNEL, callback);
      return () => transport.removeListener(WINDOW_SHORTCUT_CHANNEL, callback);
    },
    subscribeDriverInput(listener) {
      const callback = (_event: unknown, payload: unknown) => {
        if (typeof payload === "boolean") listener(payload);
      };
      transport.on(DRIVER_INPUT_CHANNEL, callback);
      return () => transport.removeListener(DRIVER_INPUT_CHANNEL, callback);
    },
  } satisfies ShortcutApi);
}

/**
 * main이 창에 시키는 것(전역 팔레트). 표에 있는 이름만 넘긴다.
 * 막 연 창에서는 renderer가 구독하기 전에 올 수 있어 preload가 곧바로 듣고 마지막 하나를 들고 있다가
 * 첫 구독에 넘긴다.
 */
export function createIntentApi(transport: ShortcutTransport): IntentApi {
  const listeners = new Set<(intent: DesktopIntent) => void>();
  let held: DesktopIntent | null = null;
  transport.on(DESKTOP_INTENT_CHANNEL, (_event, payload) => {
    if (!isDesktopIntent(payload)) return;
    const intent: DesktopIntent = payload;
    if (listeners.size === 0) {
      held = intent;
      return;
    }
    for (const listener of listeners) listener(intent);
  });
  return Object.freeze({
    subscribe(listener) {
      listeners.add(listener);
      if (held !== null) {
        const intent = held;
        held = null;
        listener(intent);
      }
      return () => void listeners.delete(listener);
    },
  } satisfies IntentApi);
}
