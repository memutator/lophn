// 앱 view·frame·visibility와 view IPC, 외부 링크, view 오류, 앱 전용 창, 창 열기 intent.
import { app, BrowserWindow, shell } from "electron";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { VIEW_STATE_CHANNEL } from "../../../ipc/app-frame.ts";
import { createCoreUpstream } from "../../app-frame/app-protocol.ts";
import { createEntryScreen } from "../../app-frame/blueprint-source.ts";
import { createViewDiagnostics } from "../../app-frame/diagnostics.ts";
import { electronAppViews } from "../../app-frame/electron-app-frame.ts";
import { createExternalLinks } from "../../app-frame/external-link.ts";
import type { Outcome } from "../../app-frame/app-connection.ts";
import { createAppFrame } from "../../app-frame/registry.ts";
import { createViewErrors, reportIdOf } from "../../app-frame/view-error.ts";
import {
  createViewIpc,
  registerViewIpc,
  removeViewIpc,
} from "../../app-frame/view-ipc.ts";
import { createViewVisibility } from "../../app-frame/visibility.ts";
import { routeFrame } from "../../browser/frame-router.ts";
import {
  createAppWindowIpc,
  registerAppWindowIpc,
  removeAppWindowIpc,
} from "../app-window-ipc.ts";
import { type AppWindowConfig, createAppWindows } from "../app-window.ts";
import { nodeExecutableProbe } from "../autostart.ts";
import { reveal, surfaceOptions } from "../headless.ts";
import {
  type EntryFiles,
  installOsEntry,
  type OsEntryEnv,
  removeOsEntry,
} from "../os-entry/entry.ts";
import type { OpenIntent } from "../open-intent.ts";
import { TOP_BAR_HEIGHT } from "../window.ts";
import type { ArtifactWiring } from "./artifact.ts";
import type { BrowserWiring } from "./browser.ts";
import type { Registered, ShellContext } from "./context.ts";

/** 뒤 영역이 쓰는 앱 view 값. */
export type AppViews = Registered & {
  appFrame: ReturnType<typeof createAppFrame>;
  externalLinks: ReturnType<typeof createExternalLinks>;
  viewErrors: ReturnType<typeof createViewErrors>;
  /** 창 열기 intent. 열 수 없는 앱은 가장 최근 창(없으면 새 기본 창)을 앞으로 가져온다. */
  openIntent(intent: OpenIntent): void;
  /** 모두 window의 native view(앱 view, popup, DevTools)인가. */
  owns(window: string, view_sessions: readonly string[]): boolean;
  /** view를 닫지 않고 from 창에서 to 창으로 옮긴다. 하나라도 from 창의 것이 아니면 아무것도 옮기지 않는다. */
  moveViews(
    from: string,
    to: string,
    view_sessions: readonly string[],
  ): Outcome<null>;
};

export function register(
  ctx: ShellContext,
  browser: Pick<BrowserWiring, "frame" | "orderOf">,
  artifact: Pick<ArtifactWiring, "frame">,
): AppViews {
  const {
    here,
    headless,
    overlays,
    windows,
    appWindowRefs,
    log,
    core,
    coreInternal,
    ipc,
    windowRef,
    windowOfRef,
  } = ctx;

  // 앱 view registry. 연결은 core 앱 통로로 main이 얻고, view는 앱 preload만 갖는다.
  // 붙이기·숨기기 IPC와 renderer 연결은 이 registry에 잇는다.
  const appViews = electronAppViews({
    windowOf: (ref) => windowOfRef(ref),
    // build가 앱 preload를 같은 dist에 .cjs로 낸다.
    preload: join(here, "preload-app.cjs"),
    packaged: app.isPackaged,
    headless,
    orderOf: browser.orderOf,
  });
  const appFrame = createAppFrame({
    connector: ctx.appConnector,
    views: appViews.views,
    sessionHandle: appViews.sessionHandle,
    // 화면 byte는 core의 file route `app.screen_file`이 내준다.
    upstream: createCoreUpstream((input, signal) => {
      const session = core.session();
      return session
        ? session.fileStream("apps", "screen_file", input, signal)
        : Promise.resolve({
          status: 503,
          headers: new Headers(),
          body: null,
        });
    }),
    // 앱 view가 loopback으로 core API에 닿지 못하게 한다. 부여된 host여도 막는다.
    platformPorts: () => {
      const session = core.session();
      return session ? [session.apiPort] : [];
    },
    diagnostics: createViewDiagnostics({
      send: (message) => core.diagnostic(message),
      log,
      clock: { nowIso: () => new Date().toISOString() },
    }),
    ids: {
      viewSession: () => `view-${randomUUID()}`,
      token: () => randomBytes(32).toString("base64url"),
    },
    clock: { nowMs: () => Date.now() },
    // 연결 상태·release가 바뀌면 그 창의 shell renderer에 표시 갱신을 민다(ledger event가 아님).
    onState(ref, state) {
      const window = windowOfRef(ref);
      if (window !== undefined && !window.webContents.isDestroyed()) {
        window.webContents.send(VIEW_STATE_CHANNEL, state);
      }
    },
  });

  // native view 배치. renderer는 사각형만 보내고 붙이기·숨기기·폐기는 registry가 한다.
  const viewVisibility = createViewVisibility({
    // browser·artifact 탭의 view는 앱 registry에 없다. view_session으로 갈라 보낸다.
    frame: routeFrame(appFrame, browser.frame, artifact.frame),
    geometry: {
      // overlay와 같은 창 본문이다. 상단 바는 shell 크롬이라 앱 view가 덮지 않는다.
      body(ref) {
        const window = windowOfRef(ref);
        if (window === undefined) return undefined;
        const [width = 0, height = 0] = window.getContentSize();
        return {
          x: 0,
          y: TOP_BAR_HEIGHT,
          width: Math.max(0, width),
          height: Math.max(0, height - TOP_BAR_HEIGHT),
        };
      },
      zoom: (ref) => windowOfRef(ref)?.webContents.getZoomFactor() ?? 1,
    },
    timer: {
      set: (callback, ms) => setTimeout(callback, ms),
      clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
    },
  });
  registerViewIpc(
    ipc,
    createViewIpc({
      registry: overlays.overlayRegistry(),
      windowOf: (sender) => {
        const window = [...windows].find((window) =>
          !window.isDestroyed() && window.webContents === sender
        );
        return window === undefined ? undefined : windowRef(window);
      },
      visibility: viewVisibility,
    }),
  );

  // headless 확인에서는 사람 화면에 browser를 띄우지 않는다.
  const externalLinks = createExternalLinks({
    open: (url) =>
      headless.headless ? Promise.resolve() : shell.openExternal(url),
    log,
  });
  const viewErrors = createViewErrors({
    send: async (forward) => {
      const session = core.session();
      if (!session) return false;
      try {
        const result = await session.internal(
          "worker",
          "problems",
          "observe-view-error",
          forward,
        );
        return result.ok;
      } catch {
        return false;
      }
    },
    ids: { reportId: () => reportIdOf(Date.now(), randomBytes(10)) },
    clock: {
      nowMs: () => Date.now(),
      nowIso: () => new Date().toISOString(),
    },
    log,
  });

  // 앱 전용 창. 본문 view와 같은 appFrame·Electron adapter로 연다.
  // 전용 창의 screen은 blueprint read(`/apps/blueprint`)가 정한다. 아직 core 통로가
  // 없어 unavailable이고, 그동안 `--open-app`은 기본 창을 앞으로 가져온다.
  const appWindows = createAppWindows({
    readApp: (app) => {
      const session = core.session();
      return session
        ? session.internal("read", "apps", "get", { app })
        : Promise.resolve({
          ok: false,
          error: { code: "unavailable", message: "core is not ready" },
        });
    },
    entryScreen: createEntryScreen((app, release) =>
      coreInternal("read", "apps", "app_api", { app, release })
    ),
    create: (config: AppWindowConfig) => {
      const window = new BrowserWindow(surfaceOptions(config, headless));
      // 창 자신은 page가 없다. 새 창 요청도 받지 않는다.
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      const ref = windowRef(window);
      appWindowRefs.set(ref, window);
      window.on("closed", () => appWindowRefs.delete(ref));
      return {
        ref,
        body: () => {
          const [width = 0, height = 0] = window.getContentSize();
          return { x: 0, y: 0, width, height };
        },
        onResize: (listener) => void window.on("resize", listener),
        onClosed: (listener) => void window.on("closed", listener),
        reveal: () => reveal(window, headless),
        close: () => window.destroy(),
      };
    },
    frame: appFrame,
    packaged: app.isPackaged,
    log,
  });

  // 앱 바로가기의 실제 OS 쓰기. 같은 디렉터리의 임시 파일을 rename해 쓰고,
  // macOS bundle은 폴더째 지운다. installOsEntry가 headless·개발 실행에서는 부르지 않는다.
  const nodeEntryFiles: EntryFiles = {
    write(path, data, mode) {
      mkdirSync(dirname(path), { recursive: true });
      const temp = `${path}.${process.pid}.tmp`;
      writeFileSync(temp, data, { mode });
      renameSync(temp, path);
    },
    remove(path) {
      rmSync(path, { recursive: true, force: true });
    },
  };
  const osEntryEnv: OsEntryEnv = {
    platform: process.platform,
    packaged: app.isPackaged,
    headless: headless.headless,
    execPath: process.execPath,
    ...(process.env.APPIMAGE ? { appImage: process.env.APPIMAGE } : {}),
    home: homedir(),
    dataHome: process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
    appData: process.env.APPDATA || join(homedir(), "AppData", "Roaming"),
    probe: nodeExecutableProbe,
    files: nodeEntryFiles,
    shortcuts: {
      write(path, options) {
        mkdirSync(dirname(path), { recursive: true });
        return shell.writeShortcutLink(path, "create", options);
      },
    },
    log,
  };

  // 앱 공간의 [Open in new window]와 바로가기 추가·삭제. desktop 창 본문만 부른다.
  registerAppWindowIpc(
    ipc,
    createAppWindowIpc({
      registry: overlays.overlayRegistry(),
      openWindow: (app) => appWindows.open(app),
      readApp: (app) => {
        const session = core.session();
        return session
          ? session.internal("read", "apps", "get", { app })
          : Promise.resolve({
            ok: false,
            error: { code: "unavailable", message: "core is not ready" },
          });
      },
      entries: {
        install: (app) => installOsEntry(osEntryEnv, app),
        remove: (app) => removeOsEntry(osEntryEnv, app),
      },
    }),
  );

  // activation·grant·rewind가 끝나 앱 view가 바뀌었다는 event가 오면 그 앱의 옛 view와 연결을 버리고
  // 다시 연다. 이 event는 남지 않는다.
  ctx.relay.conditions.push({ types: ["AppViewChanged"] });
  ctx.relay.events.push((event) => {
    if (event.type === "AppViewChanged") void appFrame.refresh(event.subject);
  });
  ctx.windowHooks.closed.push(({ ref }) => {
    viewVisibility.closeWindow(ref);
    appFrame.closeWindow(ref);
  });

  return {
    appFrame,
    externalLinks,
    viewErrors,
    owns: viewVisibility.owns,
    moveViews: viewVisibility.move,
    openIntent(intent) {
      if (intent.kind === "app") {
        void appWindows.open(intent.app).then((opened) => {
          if (opened.ok) return;
          log(`앱 전용 창을 열지 못했다: ${opened.error.message}`);
          ctx.desktop.show();
        });
      } else ctx.desktop.open();
    },
    stop() {
      removeViewIpc(ipc);
      removeAppWindowIpc(ipc);
      viewVisibility.dispose();
      appFrame.dispose();
    },
  };
}
