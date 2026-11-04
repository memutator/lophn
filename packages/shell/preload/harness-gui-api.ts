import type { AcpUpdate } from "../../protocol/acp/mod.ts";
import {
  HARNESS_GUI_CONNECT_CHANNEL,
  HARNESS_GUI_INPUT_CHANNEL,
  HARNESS_GUI_UPDATE_CHANNEL,
  type HarnessGuiApi,
  type HarnessGuiInfo,
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
