// detached 탭 창: 창을 띄우고 앱 view를 옮기고 project 창과 중계한다.
// 창을 닫을 때 탭을 잃지 않는 것이 이 file의 일이다: ×는 renderer에 dock을 시키고,
// 예기치 않게 사라지면 저장된 값으로 project 창에 돌려준다.
import type { BrowserWindow } from "electron";

import { DETACHED_EVENT_CHANNEL } from "../../../ipc/detached.ts";
import { createDetachedIpc } from "../detached/ipc.ts";
import { DetachedRegistry } from "../detached/registry.ts";
import { reveal } from "../headless.ts";
import { openDesktopWindow } from "./desktop-window.ts";
import type { AppViews } from "./app-views.ts";
import type { Registered, ShellContext } from "./context.ts";

export function register(ctx: ShellContext, views: AppViews): Registered {
  const { ipc, windowRef, windowOfRef } = ctx;
  const entries = new DetachedRegistry();

  const live = (ref: string): BrowserWindow | undefined => {
    const window = windowOfRef(ref);
    return window === undefined || window.isDestroyed() ? undefined : window;
  };
  const send: Parameters<typeof createDetachedIpc>[0]["send"] = (
    ref,
    event,
  ) => {
    const window = live(ref);
    if (window !== undefined && !window.webContents.isDestroyed()) {
      window.webContents.send(DETACHED_EVENT_CHANNEL, event);
    }
  };
  const closing = () => ctx.quit.requested || ctx.quit.active();

  const handlers = createDetachedIpc({
    registry: ctx.overlays.overlayRegistry(),
    entries,
    refOf: (sender) => {
      const window = ctx.shellWindowOf(sender);
      return window === undefined
        ? undefined
        : { ref: windowRef(window), detached: ctx.detached.has(window) };
    },
    openWindow: (start) => {
      const window = openDesktopWindow(ctx, start);
      if (window === undefined) return undefined;
      ctx.detached.add(window);
      window.on("closed", () => ctx.detached.delete(window));
      const ref = windowRef(window);
      // 편집기 guard가 먼저 달려 있으므로 이 listener는 그 뒤에 돈다.
      window.on("close", (event) => {
        const entry = entries.byRef(ref);
        if (entry === undefined || entry.silent || closing()) return;
        if (window.webContents.isCrashed()) return;
        event.preventDefault();
        send(ref, { kind: "dock-request" });
      });
      return { ref, bounds: window.getBounds() };
    },
    closeWindow: (ref) => live(ref)?.close(),
    focusWindow: (ref) => {
      const window = live(ref);
      if (window !== undefined) reveal(window, ctx.headless);
    },
    isAlive: (ref) => live(ref) !== undefined,
    send,
    owns: views.owns,
    moveViews: views.moveViews,
  });
  for (const [channel, handler] of handlers) ipc.handle(channel, handler);

  ctx.windowHooks.closed.push(({ ref }) => {
    // project 창이 닫히면 그 창의 detached 창도 함께 닫는다.
    for (const child of entries.childrenOf(ref)) {
      entries.silence(child.ref);
      live(child.ref)?.close();
    }
    const entry = entries.byRef(ref);
    if (entry === undefined) return;
    entries.remove(ref);
    // 창이 예기치 않게 사라졌다. 탭이 layout에서 사라지지 않게 저장된 값으로 돌려준다.
    // 앱을 끄는 중에는 보내지 않는다: 다음 실행에 detached 창이 돌아오지 않기 때문이다.
    if (!entry.silent && !closing()) {
      send(entry.parent, {
        kind: "docked",
        key: entry.key,
        tab: entry.tab,
        transfer: null,
      });
    }
  });

  return {
    stop() {
      for (const [channel] of handlers) ipc.removeHandler(channel);
    },
  };
}
