// extension harness-gui가 연 ACP session 하나를 창 하나로 그린다. 창은 desktop 창이 `#harness-gui` hash로 여는 한 화면이고
// (detached 창과 같은 길), 이 file은 그 창과 handle을 잇는다: 창이 붙으면 쌓인 갱신을 처음부터 보내고, 창의 조작을
// handle에 주고, 창이 닫히면 handle을 닫는다. 반대로 extension이 handle을 닫으면 창도 닫는다.
import { basename } from "node:path";
import type { IpcMainInvokeEvent } from "electron";

import { acpInputSchema } from "../../../protocol/acp/mod.ts";
import { HARNESS_ADAPTERS } from "../../../protocol/coding-agent/harness-adapter.ts";
import {
  HARNESS_GUI_CONNECT_CHANNEL,
  HARNESS_GUI_INPUT_CHANNEL,
  HARNESS_GUI_UPDATE_CHANNEL,
  type HarnessGuiInfo,
} from "../../ipc/harness-gui.ts";
import type { AcpWindowHandle } from "./wiring/extensions.ts";
import { openDesktopWindow } from "./wiring/desktop-window.ts";
import type { Registered, ShellContext } from "./wiring/context.ts";

type Opened = {
  handle: AcpWindowHandle;
  /** 창이 붙어 있는 동안만 있다. */
  detach?: () => void;
};

export function register(
  ctx: ShellContext,
): Registered & { open(handle: AcpWindowHandle): void } {
  // 창의 webContents id로 handle을 찾는다. 창이 보낸 값이 아니라 main이 아는 sender로 정한다.
  const opened = new Map<number, Opened>();

  ctx.ipc.handle(
    HARNESS_GUI_CONNECT_CHANNEL,
    (event: IpcMainInvokeEvent): HarnessGuiInfo | null => {
      const entry = opened.get(event.sender.id);
      if (entry === undefined) return null;
      // renderer가 다시 로드되면 처음부터 다시 받는다.
      entry.detach?.();
      entry.detach = entry.handle.attach({
        update: (update) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(HARNESS_GUI_UPDATE_CHANNEL, update);
          }
        },
        closed: () => {},
      });
      return { harness: entry.handle.harness, cwd: entry.handle.cwd };
    },
  );
  ctx.ipc.handle(
    HARNESS_GUI_INPUT_CHANNEL,
    (event: IpcMainInvokeEvent, input: unknown): boolean => {
      const entry = opened.get(event.sender.id);
      const parsed = acpInputSchema.safeParse(input);
      if (entry === undefined || !parsed.success) return false;
      entry.handle.input(parsed.data);
      return true;
    },
  );

  return {
    open(handle) {
      const window = openDesktopWindow(ctx, {
        hash: `#harness-gui=${encodeURIComponent(handle.id)}`,
        title: `${HARNESS_ADAPTERS[handle.harness].label} — ${basename(handle.cwd)}`,
        detached: true,
      });
      if (window === undefined) {
        handle.close();
        return;
      }
      const id = window.webContents.id;
      const entry: Opened = { handle };
      opened.set(id, entry);
      // 사람이 창을 닫았다. handle이 닫히면 extension의 onClose가 CLI를 멈춘다.
      window.on("closed", () => {
        entry.detach?.();
        opened.delete(id);
        handle.close();
      });
      // extension이 먼저 닫은 경우(extension을 끔)도 창이 남지 않게 한다.
      handle.attach({
        update: () => {},
        closed: () => {
          if (!window.isDestroyed()) window.close();
        },
      });
    },
    stop() {
      ctx.ipc.removeHandler(HARNESS_GUI_CONNECT_CHANNEL);
      ctx.ipc.removeHandler(HARNESS_GUI_INPUT_CHANNEL);
      for (const { handle } of [...opened.values()]) handle.close();
    },
  };
}
