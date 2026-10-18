// shell 창 열기. 창이 열리고 닫힐 때의 영역별 반응은 context의 windowHooks로 받는다.
import { app, BrowserWindow } from "electron";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { WINDOW_STATE_CHANNEL } from "../../../ipc/window-controls.ts";
import type { DesktopIntent } from "../../../ipc/shortcuts.ts";
import { DESKTOP_INTENT_CHANNEL } from "../../../ipc/shortcuts.ts";
import { capturePaints, reveal, surfaceOptions } from "../headless.ts";
import { DESKTOP_URL } from "../shell-protocol.ts";
import {
  type CreatedWindow,
  openWindow,
  type WindowConfig,
} from "../window.ts";
import { stateOf } from "../window-controls.ts";
import type { WindowBounds } from "../../workspace/layout.ts";
import type { ShellContext } from "./context.ts";

/** 영역이 창을 열고 보이게 할 때 쓰는 통로. */
export type DesktopWindows = {
  open(): BrowserWindow | undefined;
  show(): void;
  send(intent: DesktopIntent): void;
};

let shotSerial = 0;

/**
 * 창 밖에서 온 일(전역 팔레트 키)을 가장 최근 창에 시킨다. 사람이
 * 직접 누른 것이라 창을 앞으로 가져온다. 창이 없으면 새 기본 창을 연다. 막 연 창은
 * preload가 받아 두었다가 renderer가 구독하면 넘긴다.
 */
export function sendIntent(ctx: ShellContext, intent: DesktopIntent): void {
  const target = recentWindow(ctx) ?? openDesktopWindow(ctx);
  if (target === undefined) return;
  reveal(target, ctx.headless);
  const send = () => {
    if (!target.isDestroyed()) {
      target.webContents.send(DESKTOP_INTENT_CHANNEL, intent);
    }
  };
  if (target.webContents.isLoading()) {
    target.webContents.once("did-finish-load", send);
  } else send();
}

// detached 창은 건너뛴다: 전역 키와 tray가 탭 하나만 든 창으로 가지 않게 한다.
function recentWindow(ctx: ShellContext): BrowserWindow | undefined {
  return [...ctx.windows].filter((window) =>
    !window.isDestroyed() && !ctx.detached.has(window)
  ).at(-1);
}

/** 가장 최근 창을 앞으로 가져온다. 창이 없으면 새 기본 창을 연다. */
export function showDesktopWindow(ctx: ShellContext): void {
  const recent = recentWindow(ctx);
  if (recent === undefined) {
    openDesktopWindow(ctx);
    return;
  }
  reveal(recent, ctx.headless);
}

/** `start`가 있으면 그 hash와 자리로 연다(detached 창). 개발용 시작 환경 변수는 보지 않는다. */
export function openDesktopWindow(
  ctx: ShellContext,
  start?: { hash: string; bounds?: WindowBounds },
): BrowserWindow | undefined {
  const { here, headless, windows, overlays } = ctx;
  let created: BrowserWindow | undefined;
  // 개발 확인 전용(`deno task dev:mock`). renderer가 주소의 `mock`을 보고 core 대신 메모리 가짜
  // 통로로 모든 화면을 채운다. `LOPHN_SHELL_START`의 시작 자리와 함께 쓴다.
  const desktopUrl = process.env.LOPHN_DEV_MOCK === "1"
    ? `${DESKTOP_URL}?mock`
    : DESKTOP_URL;
  openWindow({
    platform: process.platform,
    packaged: app.isPackaged,
    // build가 preload를 같은 dist에 .cjs로 낸다.
    preload: join(here, "preload-shell.cjs"),
    // 개발 확인 전용. 제품 실행은 이 변수를 주지 않는다.
    // `LOPHN_SHELL_START=project:<id>`는 그 프로젝트 작업대부터, `settings`는 Settings부터,
    // `app:<id>`는 그 앱 공간부터 연다.
    // `instructions:global`·`instructions:project:<id>`는 그 [Instructions] 편집기부터 연다.
    ...(start?.bounds ? { bounds: start.bounds } : {}),
    url: start !== undefined
      ? `${desktopUrl}${start.hash}`
      : process.env.LOPHN_DEV_SEED === "1"
      ? `${DESKTOP_URL}?dev-seed=1`
      : /^project:prj_[0-9a-z]{26}$/.test(process.env.LOPHN_SHELL_START ?? "")
      ? `${desktopUrl}#project=${process.env.LOPHN_SHELL_START!.slice(8)}`
      : /^instructions:(global|project:prj_[0-9a-z]{26})$/.test(
          process.env.LOPHN_SHELL_START ?? "",
        )
      ? `${desktopUrl}#instructions=${process.env.LOPHN_SHELL_START!.slice(13)}`
      : process.env.LOPHN_SHELL_START === "settings"
      ? `${desktopUrl}#settings`
      : /^app:app_[0-9a-z]{26}$/.test(process.env.LOPHN_SHELL_START ?? "")
      ? `${desktopUrl}#app=${process.env.LOPHN_SHELL_START!.slice(4)}`
      : desktopUrl,
    windows: {
      create: (config: WindowConfig) => {
        const window = new BrowserWindow(surfaceOptions(config, headless));
        const shotName = `window-${++shotSerial}`;
        if (headless.headless) {
          window.webContents.once("did-finish-load", () =>
            console.log(
              `[lophn] headless ${shotName} visible=${window.isVisible()}`,
            ));
        }
        capturePaints(window.webContents, shotName, headless, {
          write: (path, data) => writeFileSync(path, data),
          timer: {
            set: (callback, ms) => setTimeout(callback, ms),
            clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
          },
        });
        overlays.attach(
          window,
          join(here, "preload-shell.cjs"),
          app.isPackaged,
        );
        windows.add(window);
        created = window;
        for (const reaction of ctx.windowHooks.created) reaction(window);
        const contentsId = window.webContents.id;
        const ref = ctx.windowRef(window);
        window.on("closed", () => {
          for (const reaction of ctx.windowHooks.closed) {
            reaction({ ref, contentsId });
          }
        });
        window.on("focus", () => {
          windows.delete(window);
          windows.add(window);
        });
        window.on("closed", () => windows.delete(window));
        // 최대화·되돌림은 상단 바가 단추 모양을 바꾸도록 그 창에 알린다.
        const sendWindowState = () => {
          if (!window.isDestroyed()) {
            window.webContents.send(WINDOW_STATE_CHANNEL, stateOf(window));
          }
        };
        window.on("maximize", sendWindowState);
        window.on("unmaximize", sendWindowState);
        window.on("enter-full-screen", sendWindowState);
        window.on("leave-full-screen", sendWindowState);
        return wrap(window);
      },
    },
  });
  return created;
}

function wrap(window: BrowserWindow): CreatedWindow {
  return {
    setTitle: (title) => window.setTitle(title),
    loadURL: (url) => window.loadURL(url),
    onPageTitleUpdated: (handler) => {
      window.on(
        "page-title-updated",
        (event) => handler(() => event.preventDefault()),
      );
    },
  };
}
