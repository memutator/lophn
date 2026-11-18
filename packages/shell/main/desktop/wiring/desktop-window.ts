// shell 창 열기. 창이 열리고 닫힐 때의 영역별 반응은 context의 windowHooks로 받는다.
import {
  app,
  BrowserWindow,
  type Event as ElectronEvent,
  screen,
  shell,
} from "electron";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { WINDOW_STATE_CHANNEL } from "../../../ipc/window-controls.ts";
import type { DesktopIntent } from "../../../ipc/shortcuts.ts";
import { DESKTOP_INTENT_CHANNEL } from "../../../ipc/shortcuts.ts";
import {
  capturePaints,
  reveal,
  revealInactive,
  surfaceOptions,
} from "../headless.ts";
import { decideShellNavigation } from "../navigation-guard.ts";
import { openExternalLink } from "../open-external.ts";
import { DESKTOP_URL } from "../shell-protocol.ts";
import {
  type CreatedWindow,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  openWindow,
  type WindowConfig,
} from "../window.ts";
import { startMachine } from "../viewer/start.ts";
import { clampToWorkAreas } from "../work-area.ts";
import { stateOf } from "../window-controls.ts";
import type { WindowBounds } from "../../workspace/schema.ts";
import type { ShellContext } from "./context.ts";

/** 영역이 창을 열고 보이게 할 때 쓰는 통로. */
export type DesktopWindows = {
  /** 창이 하나도 없으면 시작 기계의 창을, 있으면 이 컴퓨터의 새 창을 연다. */
  open(): void;
  /**
   * 이 컴퓨터의 일반 창이 있으면 그 창을, 없으면 focus 없이 새 창을 연다. project를 주면 늘 그 project를 보이는 새 창을 focus 없이
   * 연다. 앱과 저장한 창 자리가 준비된 뒤 돌려준다.
   */
  openInactive(project?: string): Promise<BrowserWindow | undefined>;
  /** 가장 최근 창(어느 기계든)을 앞으로 가져온다. 창이 없으면 시작 기계의 창을 연다. */
  show(): void;
  send(intent: DesktopIntent): void;
};

let shotSerial = 0;

type NavigationEvent = ElectronEvent & { url: string; isMainFrame: boolean };

type Workspace = { bounds: WindowBounds; maximized: boolean };

/** 이미 떠 있는 desktop 창이 있으면 새 창을 이만큼 비켜 연다. 같은 자리에 겹쳐 뜨면 새 창이 열린 줄 모른다. */
const CASCADE_STEP = 32;

/** 창을 옮기거나 크기를 바꾸는 동안 저장을 이만큼 미룬다. 끄는 동안은 매 픽셀 event가 온다. */
const SAVE_DEBOUNCE_MS = 500;

/**
 * 새 desktop 창의 자리. 마지막으로 저장한 자리를 지금 화면 안으로 당긴다. 다른 desktop 창이 떠 있으면 그만큼
 * 비켜 연다. 저장한 적 없으면 undefined이고 OS가 기본 크기 창을 놓는다.
 */
export function restoredWorkspace(ctx: ShellContext) {
  const saved = ctx.windowState.current;
  if (saved === null) return undefined;
  return onScreen(saved, recentWindow(ctx) === undefined ? 0 : CASCADE_STEP);
}

/** 저장한 자리를 `shift`만큼 비켜 지금 화면 안으로 당긴다. 다른 기계의 창은 기계마다 저장한 자리를 그대로(0) 쓴다. */
export function onScreen(saved: Workspace, shift = 0): Workspace {
  const bounds = clampToWorkAreas(
    {
      ...saved.bounds,
      x: saved.bounds.x + shift,
      y: saved.bounds.y + shift,
    },
    screen.getAllDisplays().map((display) => display.workArea),
    { width: MIN_WINDOW_WIDTH, height: MIN_WINDOW_HEIGHT },
  );
  return { bounds, maximized: saved.maximized };
}

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

// detached 창과 앱 전용 창은 건너뛴다: 전역 키와 tray가 탭 하나만 든 창으로 가지 않게 한다.
export function recentWindow(ctx: ShellContext): BrowserWindow | undefined {
  return [...ctx.windows]
    .filter(
      (window) =>
        !window.isDestroyed() &&
        !ctx.detached.has(window) &&
        !ctx.appWindows.has(window),
    )
    .at(-1);
}

// browser page(<webview>)는 보이는 창에서만 그려서 agent가 창 없이 browser를 쓰려면 창이 실제로 떠야 한다. 사람이 하던
// 일을 끊지 않게 focus는 가져오지 않고, 숨기거나 최소화하지 않는다. 앱이 준비되기 전에는 BrowserWindow를 만들 수 없다.
export async function openInactiveWindow(
  ctx: ShellContext,
  project?: string,
): Promise<BrowserWindow | undefined> {
  await Promise.all([app.whenReady(), ctx.windowState.load()]);
  if (project !== undefined) {
    return openDesktopWindow(ctx, undefined, { inactive: true, project });
  }
  return (
    recentWindow(ctx) ?? openDesktopWindow(ctx, undefined, { inactive: true })
  );
}

function recentTopWindow(ctx: ShellContext): BrowserWindow | undefined {
  return [...ctx.topWindows].filter((window) => !window.isDestroyed()).at(-1);
}

export function showDesktopWindow(ctx: ShellContext): void {
  const recent = recentTopWindow(ctx);
  if (recent === undefined) openStartWindow(ctx);
  else reveal(recent, ctx.headless);
}

export function openDesktop(ctx: ShellContext): void {
  if (recentTopWindow(ctx) === undefined) openStartWindow(ctx);
  else openDesktopWindow(ctx);
}

/**
 * 창이 없을 때 여는 창. 시작 기계는 core를 기다리지 않고 `viewer/start.json`에서 고른다. 못 읽거나, 다른 기계가 쓴 file이거나,
 * 이 컴퓨터면 이 컴퓨터의 창이다. 그 기계가 명단에 없으면 그 창은 removed gate를 보인다(machine-windows).
 */
function openStartWindow(ctx: ShellContext): void {
  void startMachine(ctx.dataRoot).then((start) => {
    if (start === null) openDesktopWindow(ctx);
    else ctx.machineWindows.open(start.machine, start.name);
  });
}

/** shell 창의 시작 값. detached 탭 창과 앱 전용 창이 쓴다. */
export interface DesktopWindowStart {
  hash: string;
  bounds?: WindowBounds;
  /** 시스템 제목. 없으면 제품 이름이다. */
  title?: string;
  /** detached 탭 창이면 작은 최소 크기를 쓴다. 앱 전용 창은 기본 최소 크기(960x600)다. */
  detached?: boolean;
}

/** `start`가 있으면 그 hash와 자리로 연다(detached·앱 전용 창). 개발용 시작 환경 변수는 보지 않는다. */
export function openDesktopWindow(
  ctx: ShellContext,
  start?: DesktopWindowStart,
  // 보이되 focus를 가져오지 않는다(`showInactive`). 저장한 자리가 있든 없든 숨긴 채 만들어 ready-to-show에서 보인다.
  // project가 있으면 그 project 작업대부터 연다(폰이 연 터미널 탭을 놓을 창).
  options: { inactive?: boolean; project?: string } = {},
): BrowserWindow | undefined {
  const { here, windows } = ctx;
  // detached 창은 layout이 탭마다 자리를 갖는다. 앱 전체의 마지막 자리는 desktop 창만 쓰고 고친다.
  const workspace = start === undefined ? restoredWorkspace(ctx) : undefined;
  const bounds = start?.bounds ?? workspace?.bounds;
  let created: BrowserWindow | undefined;
  // 개발 확인 전용(`npm run dev:mock`). renderer가 주소의 `mock`을 보고 core 대신 메모리 가짜
  // 통로로 모든 화면을 채운다. `LOPHN_SHELL_START`의 시작 자리와 함께 쓴다.
  const desktopUrl =
    process.env.LOPHN_DEV_MOCK === "1" ? `${DESKTOP_URL}?mock` : DESKTOP_URL;
  openWindow({
    platform: process.platform,
    packaged: app.isPackaged,
    // build가 preload를 같은 dist에 .cjs로 낸다.
    preload: join(here, "preload-shell.cjs"),
    // 개발 확인 전용. 제품 실행은 이 변수를 주지 않는다.
    // `LOPHN_SHELL_START=project:<id>`는 그 프로젝트 작업대부터, `settings`는 Settings부터,
    // `app:<id>`는 그 앱 공간부터 연다.
    ...(bounds ? { bounds } : {}),
    // 저장한 자리로 여는 창은 숨긴 채 만들고 크기를 맞춘 뒤 보인다(`rememberWorkspace`).
    ...(workspace || options.inactive ? { show: false } : {}),
    ...(start?.title === undefined ? {} : { title: start.title }),
    detached: start === undefined ? false : start.detached !== false,
    url:
      start !== undefined
        ? `${desktopUrl}${start.hash}`
        : options.project !== undefined
          ? `${desktopUrl}#project=${options.project}`
          : process.env.LOPHN_DEV_SEED === "1"
            ? `${DESKTOP_URL}?dev-seed=1`
            : /^project:prj_[0-9a-z]{26}$/.test(
                  process.env.LOPHN_SHELL_START ?? "",
                )
              ? `${desktopUrl}#project=${process.env.LOPHN_SHELL_START!.slice(8)}`
              : process.env.LOPHN_SHELL_START === "settings"
                ? `${desktopUrl}#settings`
                : /^app:app_[0-9a-z]{26}$/.test(
                      process.env.LOPHN_SHELL_START ?? "",
                    )
                  ? `${desktopUrl}#app=${process.env.LOPHN_SHELL_START!.slice(4)}`
                  : desktopUrl,
    windows: {
      create: (config: WindowConfig) => {
        const window = createShellWindow(
          ctx,
          config,
          join(here, "preload-shell.cjs"),
        );
        windows.add(window);
        created = window;
        for (const reaction of ctx.windowHooks.created) reaction(window);
        if (start === undefined) {
          rememberWorkspace(
            ctx,
            window,
            workspace,
            options.inactive === true,
            (state) => ctx.windowState.save(state),
          );
        }
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
        if (start === undefined) {
          ctx.topWindows.add(window);
          window.on("focus", () => {
            ctx.topWindows.delete(window);
            ctx.topWindows.add(window);
          });
          window.on("closed", () => ctx.topWindows.delete(window));
        }
        return wrap(window);
      },
    },
  });
  return created;
}

/**
 * shell 창 하나를 만든다: navigation guard, headless 그림, overlay, 창 단추 상태. 이 컴퓨터의 창과 다른 기계의 창이 같이
 * 쓴다. 어느 목록에 넣을지와 영역 반응(`windowHooks`)은 부르는 쪽이 정한다.
 */
export function createShellWindow(
  ctx: ShellContext,
  config: WindowConfig,
  preload: string,
): BrowserWindow {
  const { headless, overlays } = ctx;
  const window = new BrowserWindow(
    surfaceOptions({ ...config, icon: ctx.appIcon }, headless),
  );
  // shell 창의 main frame은 lophn-shell://desktop 밖으로 가지 않는다. http·https는
  // open-external로 넘긴다. Electron 44에서 main frame은 will-frame-navigate가 먼저 오고,
  // 거기서 막으면 will-navigate는 오지 않는다. 그래서 will-navigate는 듣지 않는다.
  const open = (url: string) =>
    headless.headless ? Promise.resolve() : shell.openExternal(url);
  const guard = (event: NavigationEvent) => {
    const decision = decideShellNavigation({
      url: event.url,
      isMainFrame: event.isMainFrame,
    });
    if (decision.allow) return;
    event.preventDefault();
    if (decision.external) {
      void openExternalLink({ open, log: ctx.log }, event.url);
    }
  };
  window.webContents.on("will-frame-navigate", guard);
  window.webContents.on("will-redirect", guard);
  // ctrl·가운데 click과 target=_blank link가 여기로 온다.
  window.webContents.setWindowOpenHandler((details) => {
    const decision = decideShellNavigation({
      url: details.url,
      isMainFrame: true,
    });
    if (!decision.allow && decision.external) {
      void openExternalLink({ open, log: ctx.log }, details.url);
    }
    return { action: "deny" };
  });
  const shotName = `window-${++shotSerial}`;
  if (headless.headless) {
    window.webContents.once("did-finish-load", () =>
      console.log(`[lophn] headless ${shotName} visible=${window.isVisible()}`),
    );
  }
  capturePaints(window.webContents, shotName, headless, {
    write: (path, data) => writeFileSync(path, data),
    timer: {
      set: (callback, ms) => setTimeout(callback, ms),
      clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
    },
  });
  overlays.attach(window, preload, app.isPackaged);
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
  return window;
}

/**
 * 저장한 크기·최대화를 되살리고, 옮기거나 크기를 바꾸거나 최대화·되돌리거나 닫을 때 그 자리를 `store`로 저장한다. 최대화한
 * 창은 되돌렸을 때의 자리(`getNormalBounds`)를 함께 둔다. 최소화와 전체 화면은 저장하지 않는다(다시 열 때 그
 * 모양이면 창이 안 보이거나 상단 바가 없다). 이 컴퓨터의 창은 앱 하나의 자리에, 다른 기계의 창은 기계마다의 자리에 둔다.
 */
export function rememberWorkspace(
  ctx: ShellContext,
  window: BrowserWindow,
  workspace: Workspace | undefined,
  inactive: boolean,
  store: (state: Workspace) => void,
): void {
  revealRestored(ctx, window, workspace, inactive);
  // focus 없이 연 창은 maximize하지 않았으므로 그 창의 상태가 사람이 고른 것이 아니다. 사람이 그 창을 최대화하거나 되돌리기
  // 전에는 앞서 저장한 값을 그대로 쓴다. 안 그러면 다음 창이 최대화 없이 열린다.
  let kept: boolean | undefined = inactive
    ? (workspace?.maximized ?? false)
    : undefined;
  let timer: NodeJS.Timeout | undefined;
  const save = () => {
    clearTimeout(timer);
    if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) {
      return;
    }
    const { x, y, width, height } = window.getNormalBounds();
    store({
      bounds: { x, y, width, height },
      maximized: kept ?? window.isMaximized(),
    });
  };
  const savePicked = () => {
    kept = undefined;
    save();
  };
  const later = () => {
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DEBOUNCE_MS);
  };
  // Linux에는 moved가 없어 move와 resize를 같이 듣는다.
  window.on("move", later);
  window.on("resize", later);
  window.on("maximize", savePicked);
  window.on("unmaximize", savePicked);
  window.on("close", save);
}

/** 숨긴 채 만든 창을 저장한 크기·최대화로 맞춘 뒤 보인다. */
function revealRestored(
  ctx: ShellContext,
  window: BrowserWindow,
  workspace: Workspace | undefined,
  inactive: boolean,
): void {
  if (workspace === undefined && !inactive) return;
  // Wayland(KWin)에서는 Electron이 창이 뜰 모니터를 몰라 만들 때 크기를 primary 모니터 안으로 자르고, 보인 뒤
  // 바꾼 크기도 받지 않는다. 숨긴 채 만든 창에 저장한 크기를 다시 건 뒤 보이면 그 크기로 뜬다(KWin에서 확인).
  // 자리(x·y)는 Wayland에서 compositor가 정한다. X11·macOS·Windows는 만들 때의 크기·자리가 이미 맞다.
  window.once("ready-to-show", () => {
    if (window.isDestroyed()) return;
    if (workspace !== undefined) {
      window.setSize(workspace.bounds.width, workspace.bounds.height);
      // maximize()는 Windows에서 focus를 가져가므로 focus 없는 창은 저장한 일반 크기로 둔다.
      if (workspace.maximized && !inactive) window.maximize();
    }
    if (inactive) revealInactive(window, ctx.headless);
    else reveal(window, ctx.headless);
  });
}

export function wrap(window: BrowserWindow): CreatedWindow {
  return {
    setTitle: (title) => window.setTitle(title),
    loadURL: (url) => window.loadURL(url),
    onPageTitleUpdated: (handler) => {
      window.on("page-title-updated", (event) =>
        handler(() => event.preventDefault()),
      );
    },
  };
}
