// detached 탭 창: 창을 띄우고 앱 view를 옮기고 project 창과 중계한다.
// 창을 닫을 때 탭을 잃지 않는 것이 이 file의 일이다: ×는 renderer에 dock을 시키고,
// 예기치 않게 사라지면 저장된 값으로 project 창에 돌려준다.
import { type BrowserWindow, screen } from "electron";

import { DETACHED_EVENT_CHANNEL } from "../../../ipc/detached.ts";
import type { WindowBounds } from "../../workspace/layout.ts";
import { clampToWorkAreas } from "../detached/bounds.ts";
import { createDetachedIpc } from "../detached/ipc.ts";
import { DetachedRegistry } from "../detached/registry.ts";
import { reveal } from "../headless.ts";
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from "../window.ts";
import { openDesktopWindow } from "./desktop-window.ts";
import type { AppViews } from "./app-views.ts";
import type { Registered, ShellContext } from "./context.ts";

/** 창을 옮기거나 크기를 바꾸는 동안은 모아서 한 번만 project 창에 알린다. */
const MOVED_DEBOUNCE_MS = 500;

export type Detached = Registered & {
  /** project 창 ref의 살아 있는 detached 창 bounds(key별). layout을 저장할 때 채운다. */
  boundsOf(parent: string): ReadonlyMap<string, WindowBounds>;
};

export function register(ctx: ShellContext, views: AppViews): Detached {
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
      // 되살릴 때 저장된 자리가 지금 화면 밖일 수 있어 화면 안으로 당긴다.
      const bounds = start.bounds === undefined ? undefined : clampToWorkAreas(
        start.bounds,
        screen.getAllDisplays().map((display) => display.workArea),
        { width: MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT },
      );
      const window = openDesktopWindow(ctx, {
        ...start,
        ...(bounds === undefined ? {} : { bounds }),
      });
      if (window === undefined) return undefined;
      ctx.detached.add(window);
      const ref = windowRef(window);
      // Linux에는 moved가 없어 move와 resize를 같이 듣는다.
      let movedTimer: ReturnType<typeof setTimeout> | undefined;
      const noteMoved = () => {
        clearTimeout(movedTimer);
        movedTimer = setTimeout(() => {
          const entry = entries.byRef(ref);
          if (entry !== undefined) send(entry.parent, { kind: "moved" });
        }, MOVED_DEBOUNCE_MS);
      };
      window.on("move", noteMoved);
      window.on("resize", noteMoved);
      window.on("closed", () => {
        clearTimeout(movedTimer);
        ctx.detached.delete(window);
      });
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
    boundsOf(parent) {
      const result = new Map<string, WindowBounds>();
      for (const entry of entries.childrenOf(parent)) {
        const window = live(entry.ref);
        if (window === undefined) continue;
        const { x, y, width, height } = window.getBounds();
        result.set(entry.key, { x, y, width, height });
      }
      return result;
    },
  };
}
