// 앱 view·frame·guest 붙이기와 view IPC, 외부 링크, view 오류, 앱 전용 창, 창 열기 intent.
import { app, session, shell } from "electron";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { appLogViewError } from "../../../../protocol/apps/mod.ts";
import { validateInput } from "../../../../protocol/apps/declaration/schema.ts";
import type { InputSchema } from "../../../../protocol/apps/declaration/types.ts";
import {
  VIEW_STATE_CHANNEL,
  type AppViewOpen,
} from "../../../ipc/app-frame.ts";
import { createCoreUpstream } from "../../app-frame/app-protocol.ts";
import { clearAppStorage } from "../../app-frame/app-storage.ts";
import { createEntryScreen } from "../../app-frame/declaration-source.ts";
import { createViewDiagnostics } from "../../app-frame/diagnostics.ts";
import { electronAppViews } from "../../app-frame/electron-app-frame.ts";
import { createExternalLinks } from "../../app-frame/external-link.ts";
import type { Outcome } from "../../app-frame/app-connection.ts";
import { createAppFrame } from "../../app-frame/registry.ts";
import { createViewErrors } from "../../app-frame/view-error.ts";
import {
  createViewIpc,
  registerViewIpc,
  removeViewIpc,
} from "../../app-frame/view-ipc.ts";
import {
  createAppWindowIpc,
  registerAppWindowIpc,
  removeAppWindowIpc,
} from "../app-window-ipc.ts";
import { createAppWindows } from "../app-window.ts";
import { nodeExecutableProbe } from "../autostart.ts";
import { reveal } from "../headless.ts";
import {
  type EntryFiles,
  installOsEntry,
  type OsEntryEnv,
  removeOsEntry,
} from "../os-entry/entry.ts";
import type { OpenIntent } from "../open-intent.ts";
import type { ArtifactWiring } from "./artifact.ts";
import type { BrowserWiring } from "./browser.ts";
import type { Registered, ShellContext } from "./context.ts";
import { openDesktopWindow } from "./desktop-window.ts";

/** 뒤 영역이 쓰는 앱 view 값. */
export type AppViews = Registered & {
  appFrame: ReturnType<typeof createAppFrame>;
  externalLinks: ReturnType<typeof createExternalLinks>;
  viewErrors: ReturnType<typeof createViewErrors>;
  /** 창 열기 intent. 열 수 없는 앱은 가장 최근 창(없으면 새 기본 창)을 앞으로 가져온다. */
  openIntent(intent: OpenIntent): void;
  /** 모두 window의 native view(크기 준 popup, DevTools)인가. */
  owns(window: string, view_sessions: readonly string[]): boolean;
  /** native view를 닫지 않고 from 창에서 to 창으로 옮긴다. 하나라도 from 창의 것이 아니면 아무것도 옮기지 않는다. */
  moveViews(
    from: string,
    to: string,
    view_sessions: readonly string[],
  ): Outcome<null>;
};

export function register(
  ctx: ShellContext,
  browser: Pick<BrowserWiring, "nativeBounds" | "webviewGuests">,
  artifact: Pick<ArtifactWiring, "views">,
): AppViews {
  const {
    here,
    headless,
    overlays,
    windows,
    log,
    core,
    coreInternal,
    ipc,
    windowRef,
    windowOfRef,
  } = ctx;

  // 앱 view registry. 연결은 core 앱 통로로 main이 얻고, 화면은 renderer의 `<webview>`다.
  const appViews = electronAppViews({
    windowOf: (ref) => windowOfRef(ref),
    packaged: app.isPackaged,
    headless,
  });
  const appFrame = createAppFrame({
    connector: ctx.appConnector,
    views: appViews.views,
    validateParams: (schema, params) =>
      validateInput(schema as InputSchema | null, params),
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

  // build가 앱 preload를 같은 dist에 .cjs로 낸다. 붙이기에서만 강제한다.
  const preload = join(here, "preload-app.cjs");
  browser.webviewGuests.add((window, src) => {
    const accepted = appFrame.acceptGuest(window, src);
    if (accepted === undefined) return undefined;
    return {
      target: {
        kind: "app",
        partition: accepted.partition,
        src: accepted.src,
        preload,
      },
      bind: (guest) => appFrame.bindGuest(accepted, guest),
      drop: () => appFrame.dropGuest(accepted),
    };
  });
  registerViewIpc(
    ipc,
    createViewIpc({
      registry: overlays.overlayRegistry(),
      windowOf: (sender) => {
        const window = [...windows].find(
          (window) => !window.isDestroyed() && window.webContents === sender,
        );
        return window === undefined ? undefined : windowRef(window);
      },
      views: {
        openApp(window, input: AppViewOpen) {
          return appFrame.open(window, input, input.card);
        },
        close(window, view_session) {
          if (appFrame.owner(view_session) === window) {
            appFrame.close(view_session);
            return { ok: true, value: null };
          }
          if (artifact.views.owner(view_session) === window) {
            artifact.views.close(view_session);
            return { ok: true, value: null };
          }
          return {
            ok: false,
            error: { code: "invalid_input", message: "view is not open" },
          };
        },
        reopen: (window, view_session) => appFrame.reopen(window, view_session),
      },
      // app view·artifact view는 `<webview>`라 위치·숨김을 renderer CSS가 정한다.
      bounds: {
        setBounds: (window, view_session, bounds, layer) =>
          browser.nativeBounds.setBounds(window, view_session, bounds, layer),
        hide: (window, view_sessions) =>
          browser.nativeBounds.hide(window, view_sessions),
      },
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
          "memory",
          appLogViewError.resource,
          appLogViewError.method,
          forward,
        );
        return result.ok;
      } catch {
        return false;
      }
    },
    clock: { nowMs: () => Date.now() },
    log,
  });

  // 앱 전용 창. shell 문서 하나를 열고 그 renderer가 app view를 `<webview>`로 연다. 전용 창의
  // screen은 core의 `apps/tools` read로 읽은 선언이 정한다(`full` 크기를 선언한 첫 screen).
  // 읽지 못하거나 그런 screen이 없으면 unavailable이고, 그때 `--open-app`은 기본 창을 앞으로
  // 가져온다.
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
      coreInternal("read", "apps", "tools", { app, release }),
    ),
    open: ({ hash, title }) => {
      const window = openDesktopWindow(ctx, { hash, title, detached: false });
      if (window === undefined) return undefined;
      // 전역 palette·tray가 탭 하나만 든 창으로 가지 않게 detached 창과 같이 표시한다.
      ctx.appWindows.add(window);
      window.on("closed", () => ctx.appWindows.delete(window));
      return {
        ref: windowRef(window),
        reveal: () => reveal(window, headless),
        alive: () => !window.isDestroyed(),
      };
    },
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
  // 앱이 영구히 지워지면 그 앱의 browser 저장소(cookie, localStorage, IndexedDB, cache)도 비운다. 보관한 앱이라 열린 view는 이미 없다.
  ctx.relay.conditions.push({ types: ["AppRemoved"] });
  ctx.relay.events.push((event) => {
    if (event.type !== "AppRemoved" || event.subject === null) return;
    void clearAppStorage(
      {
        userData: app.getPath("userData"),
        partition: (name) => session.fromPartition(name),
        log,
      },
      event.subject,
    );
  });
  ctx.windowHooks.closed.push(({ ref }) => appFrame.closeWindow(ref));

  return {
    appFrame,
    externalLinks,
    viewErrors,
    owns: browser.nativeBounds.owns,
    moveViews: browser.nativeBounds.move,
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
      appFrame.dispose();
    },
  };
}
