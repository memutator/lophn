// 작업대 layout, 현재 보기(live view), view hint.
import { BrowserWindow, type WebContents } from "electron";

import { VIEW_HINT_CHANNEL } from "../../../ipc/workspace.ts";
import { createLiveView } from "../../workspace/live-view.ts";
import { createLayoutStore } from "../../workspace/layout-store.ts";
import { registerLayoutIpc, removeLayoutIpc } from "../core/layout-ipc.ts";
import type { AppViews } from "./app-views.ts";
import type { Registered, ShellContext } from "./context.ts";

export function register(ctx: ShellContext, views: AppViews): Registered {
  const { dataRoot, overlays, windows, core, ipc, windowRef } = ctx;

  // 현재 보기 publish는 appFrame 다음에 붙인다.
  const liveView = createLiveView({
    session: () => {
      const current = core.session();
      if (!current) return null;
      return {
        call: (kind, resource, method, body) =>
          current.internal(kind, resource, method, body),
      };
    },
    isLive: (ref) =>
      [...windows].some((window) =>
        !window.isDestroyed() && windowRef(window) === ref
      ),
    views: (ref) => views.appFrame.views(ref),
    now: () => new Date().toISOString(),
  });
  ctx.relay.beforeCall.push(async (event, call) => {
    if (
      call.kind !== "command" || call.resource !== "messages" ||
      call.method !== "receive"
    ) return;
    const window = [...windows].find((one) =>
      !one.isDestroyed() && one.webContents.id === event.sender.id
    );
    if (window === undefined) return;
    await liveView.bindReceive(call.body, windowRef(window));
  });
  ipc.handle(
    VIEW_HINT_CHANNEL,
    (event: { sender: { id: number } }, input: unknown) => {
      const window = [...windows].find((one) =>
        !one.isDestroyed() && one.webContents.id === event.sender.id
      );
      if (window === undefined) return Promise.resolve({ ok: false });
      return liveView.hint(windowRef(window), input);
    },
  );
  ctx.windowHooks.closed.push(({ ref }) => void liveView.unavailable(ref));

  // 작업대 layout. desktop 창 본문만 부르고 파일 schema는 여기서 검사한다.
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
