// 작업대 layout 저장·복원.
import { BrowserWindow, type WebContents } from "electron";

import { createLayoutStore } from "../../workspace/layout-store.ts";
import { registerLayoutIpc, removeLayoutIpc } from "../core/layout-ipc.ts";
import type { Registered, ShellContext } from "./context.ts";
import type { Detached } from "./detached.ts";

export function register(ctx: ShellContext, detached: Detached): Registered {
  const { dataRoot, overlays, ipc } = ctx;

  const windowOf = (event: unknown) =>
    BrowserWindow.fromWebContents((event as { sender: WebContents }).sender);

  // desktop 창 본문만 부르고 파일 schema는 여기서 검사한다.
  registerLayoutIpc(ipc, {
    registry: overlays.overlayRegistry(),
    store: createLayoutStore(dataRoot),
    detachedBounds: (event) => {
      const parent = windowOf(event);
      return parent ? detached.boundsOf(ctx.windowRef(parent)) : new Map();
    },
  });

  return { stop: () => removeLayoutIpc(ipc) };
}
