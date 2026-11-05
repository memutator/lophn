import type { AcpUpdate } from "../../protocol/acp/mod.ts";
import {
  HARNESS_GUI_TAB_ACK_CHANNEL,
  HARNESS_GUI_TAB_CONNECT_CHANNEL,
  HARNESS_GUI_TAB_DISCONNECT_CHANNEL,
  HARNESS_GUI_TAB_IMAGE_CHANNEL,
  HARNESS_GUI_TAB_INPUT_CHANNEL,
  HARNESS_GUI_TAB_OPENED_CHANNEL,
  HARNESS_GUI_TAB_RUNNING_CHANNEL,
  HARNESS_GUI_TAB_TOGGLE_CHANNEL,
  HARNESS_GUI_TAB_UPDATE_CHANNEL,
  HARNESS_GUI_TAB_VIEW_CHANNEL,
  type HarnessGuiInfo,
  type HarnessGuiTabApi,
  type HarnessGuiTabOpened,
  type HarnessGuiTabToggleReply,
  type HarnessGuiTabView,
} from "../ipc/harness-gui.ts";

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
    async running(terminalRef) {
      try {
        return (await transport.invoke(HARNESS_GUI_TAB_RUNNING_CHANNEL, {
          terminal_ref: terminalRef,
        })) as { turn: boolean; tasks: number } | null;
      } catch {
        return null;
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
