// 영역 file(`wiring/*.ts`)이 함께 쓰는 값. 영역끼리는 서로 import하지 않고 이 context와
// `register`가 돌려주는 값으로만 주고받는다.
import { app, type BrowserWindow, ipcMain } from "electron";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type {
  BusEvent,
  EventCondition,
} from "../../../../protocol/events/mod.ts";
import { electronOverlays } from "../../app-frame/electron-overlay.ts";
import { createAppConnector } from "../../app-frame/app-connection.ts";
import { CloseGuards } from "../../editor/close-guard.ts";
import type { ConnectionOptions, CoreConnection } from "../core/connection.ts";
import { type HeadlessMode, readHeadless } from "../headless.ts";
import { packagedInstall, resolveDataRoot } from "../paths.ts";
import type { InstalledTray } from "../tray.ts";
import { connectCore } from "./core.ts";
import {
  type DesktopWindows,
  openDesktopWindow,
  sendIntent,
  showDesktopWindow,
} from "./desktop-window.ts";

// shell tsc는 base를 보지 않으므로 Result 모양만 여기서 맞춘다.
export type CallResult = { ok: true; value: unknown } | {
  ok: false;
  error: { code: string; message: string };
};

/** 영역 하나를 등록한 결과. `main.ts`가 끝날 때 거꾸로 `stop()`을 부른다. */
export type Registered = { stop(): void };

/** main 안 IPC 등록 통로. 영역마다 자기 listener 모양으로 좁혀 쓴다. */
export type Ipc = {
  handle(
    channel: string,
    listener: (event: never, input: never) => unknown,
  ): void;
  on(channel: string, listener: (event: never, input: never) => void): void;
  removeHandler(channel: string): void;
  removeAllListeners(channel: string): void;
};

type BeforeCall = NonNullable<ConnectionOptions["beforeCall"]>;

/** core 연결이 main에 보여 주는 곳. 영역이 자기 반응을 덧붙인다. */
export type CoreRelay = {
  /** main 자신의 Gateway 조건. renderer들의 조건과 합쳐 건다. */
  conditions: EventCondition[];
  /** 조건에 맞아 도착한 event. renderer에도 같이 가지만 main이 먼저 쓴다. */
  events: Array<(event: BusEvent) => void>;
  beforeCall: Array<(...args: Parameters<BeforeCall>) => Promise<void>>;
  /** renderer로 가지 않는 main 전용 frame. 영역이 자기 type만 골라 쓴다. */
  frames: Array<(frame: { type: string }) => void>;
};

/** 창이 열리고 닫힐 때 영역이 덧붙이는 반응. */
export type WindowHooks = {
  created: Array<(window: BrowserWindow) => void>;
  closed: Array<(window: { ref: string; contentsId: number }) => void>;
};

export type ShellContext = {
  /** 빌드 결과(dist) 폴더. */
  here: string;
  dataRoot: string;
  headless: HeadlessMode;
  overlays: ReturnType<typeof electronOverlays>;
  /** 순서는 최근에 focus를 받은 창이 끝이다. 창 밖에서 온 일은 끝의 창에 시킨다. */
  windows: Set<BrowserWindow>;
  /** 앱 전용 창. shell 창이 아니라서 shortcut·intent·core 상태를 받지 않는다. */
  appWindowRefs: Map<string, BrowserWindow>;
  log: (message: string) => void;
  core: CoreConnection;
  /** main 안 core 통로. renderer allowlist를 거치지 않는다. */
  coreInternal(
    kind: string,
    resource: string,
    method: string,
    body: unknown,
  ): Promise<CallResult>;
  ipc: Ipc;
  relay: CoreRelay;
  windowHooks: WindowHooks;
  appConnector: ReturnType<typeof createAppConnector>;
  /** 창마다 편집기 guard가 저장 중 수를 기억한다. 편집기가 채우고 종료 흐름이 읽는다. */
  closeGuards: CloseGuards;
  /** 앱 끄기 상태. 종료 흐름이 채우고 편집기 창 guard가 읽는다. */
  quit: { requested: boolean; active: () => boolean };
  tray: { current: InstalledTray | undefined };
  desktop: DesktopWindows;
  windowRef(window: BrowserWindow): string;
  windowOfRef(ref: string): BrowserWindow | undefined;
  shellWindowOf(sender: unknown): BrowserWindow | undefined;
  rendererDist(): string;
  /** `main.ts`가 영역을 등록할 때마다 넣는다. */
  registered: Registered[];
  /** 한 번만 돈다. 등록의 반대 순서로 멈춘다. */
  stopAll(): void;
};

export function createShellContext(): ShellContext {
  const here = __dirname;
  const dataRoot = resolveDataRoot();
  // 개발 확인 전용. 창을 화면에 띄우지 않고 offscreen으로 그린다.
  const headless = readHeadless(process.env);
  if (headless.shotDir) mkdirSync(headless.shotDir, { recursive: true });
  const overlays = electronOverlays(headless);
  const windows = new Set<BrowserWindow>();
  const appWindowRefs = new Map<string, BrowserWindow>();
  const log = (message: string) => console.log(`[lophn] ${message}`);

  const windowRef = (window: BrowserWindow) => `window-${window.id}`;
  const windowOfRef = (ref: string) =>
    [...windows].find((window) =>
      !window.isDestroyed() && windowRef(window) === ref
    ) ?? appWindowRefs.get(ref);

  let stopped = false;
  const relay: CoreRelay = {
    conditions: [],
    events: [],
    beforeCall: [],
    frames: [],
  };
  const core = connectCore({ here, dataRoot, windows, log, relay });
  const coreInternal: ShellContext["coreInternal"] = (
    kind,
    resource,
    method,
    body,
  ) => {
    const session = core.session();
    return session
      ? session.internal(kind, resource, method, body)
      : Promise.resolve({
        ok: false,
        error: { code: "unavailable", message: "core is not ready" },
      });
  };

  const ctx: ShellContext = {
    here,
    dataRoot,
    headless,
    overlays,
    windows,
    appWindowRefs,
    log,
    core,
    coreInternal,
    ipc: {
      handle: (channel, listener) => ipcMain.handle(channel, listener as never),
      on: (channel, listener) => void ipcMain.on(channel, listener as never),
      removeHandler: (channel) => ipcMain.removeHandler(channel),
      removeAllListeners: (channel) => void ipcMain.removeAllListeners(channel),
    },
    relay,
    windowHooks: { created: [], closed: [] },
    appConnector: createAppConnector(coreInternal),
    closeGuards: new CloseGuards(),
    quit: { requested: false, active: () => false },
    tray: { current: undefined },
    desktop: {
      open: () => openDesktopWindow(ctx),
      show: () => showDesktopWindow(ctx),
      send: (intent) => sendIntent(ctx, intent),
    },
    windowRef,
    windowOfRef,
    shellWindowOf: (sender) =>
      [...windows].find((window) =>
        !window.isDestroyed() && window.webContents === sender
      ),
    rendererDist: () => {
      // packaged는 설치 묶음의 desktop/이다.
      if (app.isPackaged) {
        return packagedInstall(process.resourcesPath).desktop;
      }
      // build 결과에서 here는 packages/shell/main/dist이고 renderer dist는 형제 concern
      // 폴더 바로 아래다: packages/shell/renderer/dist.
      return join(here, "..", "..", "renderer", "dist");
    },
    registered: [],
    stopAll: () => {
      if (stopped) return;
      stopped = true;
      for (const area of [...ctx.registered].reverse()) area.stop();
      overlays.dispose();
    },
  };
  return ctx;
}
