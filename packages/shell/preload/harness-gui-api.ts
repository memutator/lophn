import type { AcpUpdate } from "../../protocol/acp/mod.ts";
import {
  HARNESS_GUI_CONNECT_CHANNEL,
  HARNESS_GUI_INPUT_CHANNEL,
  HARNESS_GUI_TAB_ACK_CHANNEL,
  HARNESS_GUI_TAB_CONNECT_CHANNEL,
  HARNESS_GUI_TAB_DISCONNECT_CHANNEL,
  HARNESS_GUI_TAB_IMAGE_CHANNEL,
  HARNESS_GUI_TAB_INPUT_CHANNEL,
  HARNESS_GUI_TAB_OPENED_CHANNEL,
  HARNESS_GUI_TAB_TOGGLE_CHANNEL,
  HARNESS_GUI_TAB_UPDATE_CHANNEL,
  HARNESS_GUI_TAB_VIEW_CHANNEL,
  HARNESS_GUI_UPDATE_CHANNEL,
  type HarnessGuiApi,
  type HarnessGuiInfo,
  type HarnessGuiTabApi,
  type HarnessGuiTabOpened,
  type HarnessGuiTabToggleReply,
  type HarnessGuiTabView,
} from "../ipc/harness-gui.ts";

interface HarnessGuiTransport {
  invoke(channel: string, input?: unknown): Promise<unknown>;
  on(
    channel: string,
    callback: (event: unknown, payload: AcpUpdate) => void,
  ): void;
  removeListener(
    channel: string,
    callback: (event: unknown, payload: AcpUpdate) => void,
  ): void;
}

// 갱신은 main이 handle에서 받은 값이라 모양은 거기서 정해졌다. 여기서는 넘기기만 한다.
export function createHarnessGuiApi(
  transport: HarnessGuiTransport,
): HarnessGuiApi {
  let listener: ((event: unknown, update: AcpUpdate) => void) | undefined;
  return Object.freeze({
    async connect(onUpdate) {
      // 다시 붙으면 main이 처음부터 다시 보내므로 앞 listener는 뗀다.
      if (listener !== undefined) {
        transport.removeListener(HARNESS_GUI_UPDATE_CHANNEL, listener);
      }
      listener = (_event, update) => onUpdate(update);
      transport.on(HARNESS_GUI_UPDATE_CHANNEL, listener);
      return (await transport.invoke(
        HARNESS_GUI_CONNECT_CHANNEL,
      )) as HarnessGuiInfo;
    },
    async input(input) {
      try {
        return (
          (await transport.invoke(HARNESS_GUI_INPUT_CHANNEL, input)) === true
        );
      } catch {
        return false;
      }
    },
  } satisfies HarnessGuiApi);
}

interface HarnessGuiTabTransport {
  invoke(channel: string, input?: unknown): Promise<unknown>;
  on(
    channel: string,
    callback: (event: unknown, payload: unknown) => void,
  ): void;
  removeListener(
    channel: string,
    callback: (event: unknown, payload: unknown) => void,
  ): void;
}

// 한 창에 탭이 여럿이라 갱신은 handle id로 가른다. payload 모양은 main이 정한 것이라 여기서는 넘기기만 한다.
export function createHarnessGuiTabApi(
  transport: HarnessGuiTabTransport,
): HarnessGuiTabApi {
  const updates = new Map<string, (update: AcpUpdate) => void>();
  transport.on(HARNESS_GUI_TAB_UPDATE_CHANNEL, (_event, payload) => {
    const one = payload as { handle: string; update: AcpUpdate };
    updates.get(one.handle)?.(one.update);
  });
  const push = <T>(channel: string, listener: (value: T) => void) => {
    const callback = (_event: unknown, payload: unknown) =>
      listener(payload as T);
    transport.on(channel, callback);
    return () => transport.removeListener(channel, callback);
  };
  return Object.freeze({
    onOpened: (listener) =>
      push<HarnessGuiTabOpened>(HARNESS_GUI_TAB_OPENED_CHANNEL, listener),
    async ackOpened(request) {
      await transport.invoke(HARNESS_GUI_TAB_ACK_CHANNEL, { request });
    },
    onView: (listener) =>
      push<HarnessGuiTabView>(HARNESS_GUI_TAB_VIEW_CHANNEL, listener),
    async connect(handle, onUpdate) {
      updates.set(handle, onUpdate);
      return (await transport.invoke(HARNESS_GUI_TAB_CONNECT_CHANNEL, {
        handle,
      })) as HarnessGuiInfo | null;
    },
    async disconnect(handle) {
      updates.delete(handle);
      await transport.invoke(HARNESS_GUI_TAB_DISCONNECT_CHANNEL, { handle });
    },
    async input(handle, input) {
      try {
        return (
          (await transport.invoke(HARNESS_GUI_TAB_INPUT_CHANNEL, {
            handle,
            input,
          })) === true
        );
      } catch {
        return false;
      }
    },
    async toggle(input) {
      try {
        // main이 거절하면(창 신원, 입력) null이다.
        const reply = (await transport.invoke(
          HARNESS_GUI_TAB_TOGGLE_CHANNEL,
          input,
        )) as HarnessGuiTabToggleReply | null;
        return reply ?? { ok: false, reason: "failed", message: "refused" };
      } catch (cause) {
        return { ok: false, reason: "failed", message: String(cause) };
      }
    },
    async uploadImage(handle, image) {
      try {
        const path = await transport.invoke(HARNESS_GUI_TAB_IMAGE_CHANNEL, {
          handle,
          ...image,
        });
        return typeof path === "string" ? path : null;
      } catch {
        return null;
      }
    },
  } satisfies HarnessGuiTabApi);
}
