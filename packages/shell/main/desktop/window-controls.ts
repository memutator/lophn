// desktop 창의 최소화·최대화·닫기. 등록된 desktop 창 본문만 부를 수 있고,
// 동작은 부른 그 창에만 간다. 어느 창인지는 renderer가 아니라 sender로 찾는다.
import { z } from "zod";

import {
  WINDOW_ACTIONS,
  type WindowControlReply,
  type WindowState,
} from "../../ipc/window-controls.ts";
import {
  checkCaller,
  checkInput,
  type ContentsRegistry,
  type IpcEvent,
} from "./ipc-guard.ts";

const inputSchema = z.strictObject({ action: z.enum(WINDOW_ACTIONS) });

/** 동작을 받는 창. Electron BrowserWindow의 일부다. */
export interface ControlledWindow {
  minimize(): void;
  maximize(): void;
  unmaximize(): void;
  isMaximized(): boolean;
  close(): void;
}

export interface WindowControlDeps {
  registry: ContentsRegistry;
  /** sender가 본문인 창. 없으면 undefined다. */
  windowOf(event: IpcEvent): ControlledWindow | undefined;
}

export function stateOf(window: ControlledWindow): WindowState {
  return { maximized: window.isMaximized() };
}

export function createWindowControl(deps: WindowControlDeps) {
  return (event: IpcEvent, input: unknown): WindowControlReply => {
    const caller = checkCaller(deps.registry, event);
    if (!caller.ok || caller.value.origin.host !== "desktop") {
      return { ok: false, code: "forbidden" };
    }
    const parsed = checkInput(inputSchema, input);
    if (!parsed.ok) return { ok: false, code: "invalid_input" };
    const window = deps.windowOf(event);
    if (window === undefined) return { ok: false, code: "unavailable" };
    const { action } = parsed.value;
    if (action === "minimize") window.minimize();
    else if (action === "close") window.close();
    else if (action === "toggle-maximize") {
      if (window.isMaximized()) window.unmaximize();
      else window.maximize();
    }
    return { ok: true, state: stateOf(window) };
  };
}
