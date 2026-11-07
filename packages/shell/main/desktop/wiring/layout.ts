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

  const workspaceStore = createWorkspaceLayoutStore(dataRoot);
  const globalFloats = createGlobalFloatsStore(dataRoot);

  // 앱이 영구히 지워지면 그 앱 workspace의 layout 파일과 전역 float을 지운다. 다른 workspace의 탭과 고정은
  // 그릴 때 없는 앱이라 건너뛰거나 "앱이 없다" 안내로 그려진다.
  ctx.relay.conditions.push({ types: ["AppRemoved"] });
  ctx.relay.events.push((event) => {
    if (event.type !== "AppRemoved" || event.subject === null) return;
    const app = event.subject;
    void workspaceStore.remove(app);
    void globalFloats.removeApp(app);
  });

  // desktop 창 본문만 부르고 파일 schema는 여기서 검사한다.
  registerLayoutIpc(ipc, {
    registry: overlays.overlayRegistry(),
    workspaceStore,
    detachedBounds: (event) => {
      const parent = windowOf(event);
      return parent ? detached.boundsOf(ctx.windowRef(parent)) : new Map();
    },
  });

  // 전역 float는 workspace를 넘으므로 layout 파일과 따로 쓴다.
  registerGlobalFloatsIpc(ipc, {
    registry: overlays.overlayRegistry(),
    store: globalFloats,
  });

  return {
    stop: () => {
      removeLayoutIpc(ipc);
      removeGlobalFloatsIpc(ipc);
    },
  };
}
