// 작업대 layout 저장·복원.
import { BrowserWindow, type WebContents } from "electron";

import { createLayoutStore } from "../../workspace/layout-store.ts";
import { registerLayoutIpc, removeLayoutIpc } from "../core/layout-ipc.ts";
import type { Registered, ShellContext } from "./context.ts";

export function register(ctx: ShellContext): Registered {
  const { dataRoot, overlays, ipc } = ctx;

  // desktop 창 본문만 부르고 파일 schema는 여기서 검사한다.
  registerLayoutIpc(ipc, {
    registry: overlays.overlayRegistry(),
    store: createLayoutStore(dataRoot),
    bounds: (event) => {
      const sender = (event as unknown as { sender: WebContents }).sender;
      const parent = BrowserWindow.fromWebContents(sender);
      if (!parent) return null;
      const box = parent.getBounds();
      return { x: box.x, y: box.y, width: box.width, height: box.height };
    },
  });

  return { stop: () => removeLayoutIpc(ipc) };
}
