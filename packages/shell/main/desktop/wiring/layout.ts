// 작업대 layout과 전역 float 저장·복원.
import { BrowserWindow, type WebContents } from "electron";

import { createGlobalFloatsStore } from "../../workspace/global-floats.ts";
import { createWorkspaceLayoutStore } from "../../workspace/workspace-layout-store.ts";
import {
  registerGlobalFloatsIpc,
  removeGlobalFloatsIpc,
} from "../core/global-floats-ipc.ts";
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
    workspaceStore: createWorkspaceLayoutStore(dataRoot),
    detachedBounds: (event) => {
      const parent = windowOf(event);
      return parent ? detached.boundsOf(ctx.windowRef(parent)) : new Map();
    },
  });

  // 전역 float는 workspace를 넘으므로 layout 파일과 따로 쓴다.
  registerGlobalFloatsIpc(ipc, {
    registry: overlays.overlayRegistry(),
    store: createGlobalFloatsStore(dataRoot),
  });

  return {
    stop: () => {
      removeLayoutIpc(ipc);
      removeGlobalFloatsIpc(ipc);
    },
  };
}
