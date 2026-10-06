// 조립만 한다. 창·single instance·scheme 규칙은 각 모듈에 있다.
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  protocol,
  session,
  shell,
  Tray,
  type WebContents,
  WebContentsView,
} from "electron";
import { randomBytes, randomFillSync, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { CORE_STATE_CHANNEL } from "../../ipc/core.ts";
import { EDITOR_CLOSE_REQUEST_CHANNEL } from "../../ipc/editor.ts";
import { FOLDER_PICK_CHANNEL } from "../../ipc/folder-picker.ts";
import {
  DESKTOP_INTENT_CHANNEL,
  type DesktopIntent,
  WINDOW_SHORTCUT_CHANNEL,
} from "../../ipc/shortcuts.ts";

import { electronOverlays } from "../app-frame/electron-overlay.ts";
import { electronAppViews } from "../app-frame/electron-app-frame.ts";
import { createAppConnector } from "../app-frame/app-connection.ts";
import { nodeUpstream } from "../app-frame/app-protocol.ts";
import { createViewDiagnostics } from "../app-frame/diagnostics.ts";
import { createAppFrame } from "../app-frame/registry.ts";
import { createAppCall } from "../app-frame/app-call.ts";
import { nodeInvoke } from "../app-frame/app-invoke.ts";
import {
  canonicalInputHash,
  validateInput,
} from "../../../../packages/contracts/apps/blueprint.ts";
import { registerAppIpc, removeAppIpc } from "../app-frame/app-ipc.ts";
import { createExternalLinks } from "../app-frame/external-link.ts";
import { createViewErrors, reportIdOf } from "../app-frame/view-error.ts";
import { startCoreConnection } from "./core/connection.ts";
import { createCoordinator } from "../confirmation/coordinator.ts";
import { createKinds } from "../confirmation/kinds/mod.ts";
import {
  type ConfirmationIpc,
  registerConfirmationIpc,
  removeConfirmationIpc,
} from "../confirmation/ipc.ts";
import type {
  AppContents,
  ConfirmationBrowserWindow,
  ConfirmationHost,
  ParentWindow,
} from "../confirmation/window.ts";
import { nodeFetch, nodeSockets, nodeStreamFetch } from "./core/node-io.ts";
import {
  CloseGuard,
  CloseGuards,
  guardWindowClose,
} from "../editor/close-guard.ts";
import { coreFilesPort, coreRestorePort } from "../editor/core-port.ts";
import { createFileAdapter } from "../editor/file-adapter.ts";
import { createRestorer } from "../editor/restore.ts";
import { registerEditorIpc, removeEditorIpc } from "../editor/ipc.ts";
import { resolveLaunchMode } from "./launch-mode.ts";
import { type AppWindowConfig, createAppWindows } from "./app-window.ts";
import {
  type OpenIntent,
  openUrlIntent,
  readOpenIntent,
  registerUrlScheme,
} from "./open-intent.ts";
import { browserDataPath, resolveDataRoot } from "./paths.ts";
import {
  type AutostartOs,
  nodeAutostartFiles,
  nodeExecutableProbe,
  readAutostart,
  writeAutostart,
} from "./autostart.ts";
import {
  createQuitFlow,
  quitChosen,
  quitDialogOptions,
  requestQuit,
} from "./quit.ts";
import {
  type InstalledTray,
  installTray,
  TRAY_ICON_SIZE,
  type TrayFactory,
  trayIconPath,
} from "./tray.ts";
import {
  capturePaints,
  guardNotifier,
  guardShortcuts,
  readHeadless,
  reveal,
  surfaceOptions,
} from "./headless.ts";
import { createFolderPicker } from "./folder-picker.ts";
import {
  type GlobalPalette,
  type GlobalShortcutPort,
  installGlobalPalette,
} from "./global-shortcut.ts";
import {
  createOsNotifications,
  displayFromReply,
  type OsNotifier,
} from "./os-notification.ts";
import { registerViewSchemes } from "./security.ts";
import { listenShortcuts } from "./shortcuts.ts";
import { startSingleInstance } from "./single-instance.ts";
import { createShellHandler, DESKTOP_URL } from "./shell-protocol.ts";
import { type CreatedWindow, openWindow, type WindowConfig } from "./window.ts";
import {
  attachTerminalSurface,
  type MainIpc,
  registerTerminalIpc,
  removeTerminalIpc,
  TerminalFocusTable,
} from "../terminal/controller.ts";
import { createTerminalIpc } from "../terminal/ipc.ts";
import { createSupervisor, spawnNodeHost } from "../terminal/supervisor.ts";

// shell tsc는 base를 보지 않으므로 Result 모양만 여기서 맞춘다.
type CallResult = { ok: true; value: unknown } | {
  ok: false;
  error: { code: string; message: string };
};

/** 등록 폴더 read. renderer가 믿는 경로를 여기서 다시 읽는다(documents#T7). */
async function projectFolders(
  session: CallSession | null,
  project: string,
): Promise<readonly { folder_ref: string; path: string }[]> {
  if (!session) return [];
  const reply = await session.call("read", "projects", "list", {
    status: "active",
  });
  if (!reply.ok) return [];
  const projects = (reply.value as { projects?: unknown[] }).projects ?? [];
  const found = projects.find(
    (item) => (item as { id?: string }).id === project,
  ) as { folders?: { path: string }[] } | undefined;
  return (found?.folders ?? []).map((folder, index) => ({
    folder_ref: `${project}_${index}`,
    path: folder.path,
  }));
}

type CallSession = {
  call(
    kind: string,
    resource: string,
    method: string,
    body: unknown,
  ): Promise<CallResult>;
};

const here = dirname(__filename);
const dataRoot = resolveDataRoot();
// 개발 확인 전용. 창을 화면에 띄우지 않고 offscreen으로 그린다(docs/dev/stack.md).
const headless = readHeadless(process.env);
if (headless.shotDir) mkdirSync(headless.shotDir, { recursive: true });
let shotSerial = 0;
const overlays = electronOverlays(headless);
// 순서는 최근에 focus를 받은 창이 끝이다. 창 밖에서 온 일은 끝의 창에 시킨다.
const windows = new Set<BrowserWindow>();
// 앱 전용 창(shell#T47). shell 창이 아니라서 shortcut·intent·core 상태를 받지 않는다.
const appWindowRefs = new Map<string, BrowserWindow>();
const log = (message: string) => console.log(`[lophn] ${message}`);
let tray: InstalledTray | undefined;

// OS notification(shell#T56, platform#T46). 지금 도착한 NotificationCreated마다 core가 주는 OS
// 표시 요청(사람이 켰을 때만 값이 있다)으로 계기 종류의 고정 문구만 올린다. 클릭은
// things-to-confirm을 열 뿐 읽음이 아니다. 표시 실패는 고정 이유로 core에 알린다. headless는
// OS에 올리지 않는다.
const osNotifications = createOsNotifications({
  notifier: guardNotifier(electronNotifier(), headless, log),
  display: async (notification) => {
    const session = core.session();
    if (!session) return null;
    const reply = await session.internal("read", "notifications", "display", {
      notification,
    });
    return reply.ok ? displayFromReply(reply.value) : null;
  },
  report: async (notification, reason) => {
    const session = core.session();
    if (!session) return;
    await session.internal("memory", "notifications", "delivery", {
      notification,
      reason,
    });
  },
  open: () => sendIntent("things-to-confirm"),
  unavailable: () => tray?.notice("notifications-unavailable"),
  log,
});
// 창을 다 닫아도 core는 남긴다. 명시 종료(tray·OS 종료)만 core를 멈춘다.
const core = startCoreConnection({
  launch: {
    repoRoot: join(here, "..", "..", "..", ".."),
    dataRoot,
    denoBinary: "deno",
    packaged: app.isPackaged,
  },
  ipc: { handle: (channel, listener) => ipcMain.handle(channel, listener) },
  fetch: nodeFetch,
  stream: nodeStreamFetch,
  sockets: nodeSockets(),
  clock: { now: () => Date.now() },
  targets: () =>
    [...windows].map((window) => ({
      send: (channel, payload) => window.webContents.send(channel, payload),
      isDestroyed: () => window.isDestroyed(),
    })),
  arrived: (events) => {
    void osNotifications.arrived(events);
    refreshAppViews(events);
  },
});

// 앱 view registry(shell#T37). 연결은 core 앱 통로로 main이 얻고, view는 앱 preload만 갖는다.
// 붙이기·숨기기 IPC와 renderer 연결은 shell#T39가 이 registry에 잇는다.
const appViews = electronAppViews({
  windowOf: (ref) =>
    [...windows].find((window) =>
      !window.isDestroyed() && windowRef(window) === ref
    ) ?? appWindowRefs.get(ref),
  // build가 앱 preload를 같은 dist에 .cjs로 낸다.
  preload: join(here, "preload-app.cjs"),
  packaged: app.isPackaged,
  headless,
  raise: (window) => overlays.raise(window),
});
const appConnector = createAppConnector((kind, resource, method, body) => {
  const session = core.session();
  return session
    ? session.internal(kind, resource, method, body)
    : Promise.resolve({
      ok: false,
      error: { code: "unavailable", message: "core is not ready" },
    });
});
const appFrame = createAppFrame({
  connector: appConnector,
  views: appViews.views,
  sessionHandle: appViews.sessionHandle,
  upstream: nodeUpstream,
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
});

// 앱 preload 통로(shell#T38). 신원은 IPC sender view에서만 정한다. 고정 blueprint read
// (`/v1/apps/blueprint`, apps#T19)와 confirm command의 approval·proof(shell#T45), view 오류의
// collector 전달 binding(problems#T16)은 아직 core 통로가 없어 unavailable·unsent다.
const appCall = createAppCall({
  connector: appConnector,
  blueprint: () =>
    Promise.resolve({
      ok: false,
      error: { code: "unavailable", message: "blueprint read is not ready" },
    }),
  rules: { validate: validateInput, hash: canonicalInputHash },
  confirm: () =>
    Promise.resolve({
      ok: false,
      error: { code: "unavailable", message: "confirmation is not ready" },
    }),
  invoke: nodeInvoke,
  ids: { requestKey: () => randomUUID() },
  clock: { nowMs: () => Date.now() },
});
// headless 확인에서는 사람 화면에 browser를 띄우지 않는다.
const externalLinks = createExternalLinks({
  open: (url) =>
    headless.headless ? Promise.resolve() : shell.openExternal(url),
  log,
});
const viewErrors = createViewErrors({
  send: () => Promise.resolve(false),
  ids: { reportId: () => reportIdOf(Date.now(), randomBytes(10)) },
  clock: {
    nowMs: () => Date.now(),
    nowIso: () => new Date().toISOString(),
  },
  log,
});
const appIpc = {
  handle: (
    channel: string,
    listener: (event: unknown, input: unknown) => Promise<unknown>,
  ) => ipcMain.handle(channel, listener),
  on: (channel: string, listener: (event: unknown, input: unknown) => void) =>
    void ipcMain.on(channel, listener),
  removeHandler: (channel: string) => ipcMain.removeHandler(channel),
  removeAllListeners: (channel: string) =>
    void ipcMain.removeAllListeners(channel),
};
registerAppIpc(appIpc, {
  view: (contentsId) => appFrame.senderView(contentsId),
  call: (view, input) => appCall.call(view, input),
  openExternal: (view, input) => externalLinks.open(view, input),
  viewError: (view, input) => viewErrors.observe(view, input),
});

// 보호 창(shell#T22·T29). 사람이 desktop 창에서 [Review]를 누를 때만 그 창의 child modal로
// 연다. 종류별 정본 read·제출은 main 안 통로로 core를 부르고, handle은 비공개 pipe로 등록한다.
// 창마다 메모리 partition이고 설치된 confirmation 페이지만 그 partition에서 연다.
let confirmationShots = 0;
const confirmationHost: ConfirmationHost = {
  create(config) {
    const parent = [...windows].find((window) =>
      !window.isDestroyed() && windowRef(window) === config.parent.id
    );
    const window = new BrowserWindow(
      {
        ...config,
        ...(parent === undefined ? {} : { parent }),
      } as unknown as ConstructorParameters<typeof BrowserWindow>[0],
    );
    capturePaints(
      window.webContents,
      `confirmation-${++confirmationShots}`,
      headless,
      {
        write: (path, data) => writeFileSync(path, data),
        timer: {
          set: (callback, ms) => setTimeout(callback, ms),
          clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
        },
      },
    );
    return window as unknown as ConfirmationBrowserWindow;
  },
  sessionFor(partition) {
    const ses = session.fromPartition(partition);
    const serve = createShellHandler({ distDir: rendererDist() });
    // 이 partition은 confirmation 페이지만 연다. 다른 shell 화면은 없다.
    ses.protocol.handle("lophn-shell", async (request) => {
      if (new URL(request.url).host !== "confirmation") {
        return new Response(null, { status: 404 });
      }
      const res = await serve(request);
      return new Response(res.body ? Buffer.from(res.body) : null, {
        status: res.status,
        headers: res.headers,
      });
    });
    return {
      partition,
      // 권한 요청은 모두 거절한다.
      setPermissionRequestHandler: () =>
        ses.setPermissionRequestHandler((_contents, _permission, callback) =>
          callback(false)
        ),
      on: (_event, listener) =>
        ses.on("will-download", (event) => listener(event)),
      webRequest: {
        onBeforeRequest: (filter, listener) =>
          ses.webRequest.onBeforeRequest(
            filter,
            (details, callback) => listener(details, callback),
          ),
      },
    };
  },
  appContents(parentId) {
    const parent = [...windows].find((window) =>
      !window.isDestroyed() && windowRef(window) === parentId
    );
    if (parent === undefined) return [];
    // shell 크롬 overlay 말고 부모 창에 붙은 앱·문서 view 전부의 입력을 막는다.
    return parent.contentView.children.flatMap((view) =>
      view instanceof WebContentsView &&
        !view.webContents.getURL().startsWith("lophn-shell:")
        ? [view.webContents as unknown as AppContents]
        : []
    );
  },
};
const confirmationKinds = createKinds({
  core: () => core.session(),
  clock: { now: () => Date.now() },
  random: (bytes) => randomFillSync(bytes),
});
const confirmations = createCoordinator({
  host: confirmationHost,
  canon: confirmationKinds.canon,
  handles: {
    register: (request) => core.registerConfirmation(request),
    // core pipe에는 창 하나의 handle만 버리는 메시지가 없다. 120초 기한과 일회 소비가 막는다.
    closeWindow: () => Promise.resolve(),
    clear: () => Promise.resolve(),
  },
  submit: confirmationKinds.submit,
  deferred: confirmationKinds.deferred,
  forget: (windowId) => confirmationKinds.closed(windowId),
  clock: { now: () => Date.now() },
  // build가 보호 preload를 같은 dist에 .cjs로 낸다.
  preload: join(here, "preload-confirmation.cjs"),
  packaged: app.isPackaged,
  headless,
  epoch: () => core.session()?.coreEpoch ?? "",
  connected: () => core.state.state === "ready",
});
const confirmationIpc: ConfirmationIpc = {
  handle: (channel, listener) =>
    ipcMain.handle(
      channel,
      (event, input) => listener(event as { sender: { id: number } }, input),
    ),
  removeHandler: (channel) => ipcMain.removeHandler(channel),
};
registerConfirmationIpc(confirmationIpc, {
  coordinator: confirmations,
  // 부모는 IPC를 보낸 desktop 창 본문이다. renderer가 보낸 parentWindow 값은 쓰지 않는다.
  parentOf(event): ParentWindow | undefined {
    const window = [...windows].find((one) =>
      !one.isDestroyed() && one.webContents.id === event.sender.id
    );
    if (window === undefined) return undefined;
    return {
      id: windowRef(window),
      focus: () => window.focus(),
      getContentSize: () => {
        const [width = 0, height = 0] = window.getContentSize();
        return { width, height };
      },
    };
  },
});

function windowRef(window: BrowserWindow): string {
  return `window-${window.id}`;
}

// 앱 전용 창(shell#T47, desktop#R13, R14). 본문 view와 같은 appFrame·Electron adapter로 연다.
// 전용 창의 screen은 blueprint read(`/v1/apps/blueprint`, apps#T19)가 정한다. 아직 core 통로가
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
  entryScreen: () =>
    Promise.resolve({
      ok: false,
      error: { code: "unavailable", message: "blueprint read is not ready" },
    }),
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

/** 창 열기 intent. 열 수 없는 앱은 가장 최근 창(없으면 새 기본 창)을 앞으로 가져온다. */
function openIntent(intent: OpenIntent): void {
  if (intent.kind === "app") {
    void appWindows.open(intent.app).then((opened) => {
      if (opened.ok) return;
      log(`앱 전용 창을 열지 못했다: ${opened.error.message}`);
      showDesktopWindow();
    });
  } else if (intent.kind === "things-to-confirm") {
    sendIntent({ kind: "things-to-confirm", request: intent.request });
  } else openDesktopWindow();
}

// 권한·release가 바뀌면 옛 view와 연결을 버리고 다시 연다. release event는 앱을 싣지 않아
// 모든 view의 연결을 다시 본다.
function refreshAppViews(
  events: readonly { type: string; payload: unknown }[],
): void {
  for (const event of events) {
    if (event.type === "GrantCreated" || event.type === "GrantRevoked") {
      const app = (event.payload as { app?: unknown }).app;
      if (typeof app === "string") void appFrame.refresh(app);
    } else if (event.type === "ReleaseActivated") {
      void appFrame.refresh();
    }
  }
}
const terminals = createSupervisor({
  // build가 host를 main과 같은 dist에 묶는다. 생성만 하고 첫 요청 때 띄운다.
  entry: join(here, "terminal-host.cjs"),
  spawnHost: spawnNodeHost,
});

// terminal IPC. sender·frame 검사는 registry로, focus·generation은 ipc.ts가 본다.
// folder_ref는 documents#T7 등록 폴더 read를 다시 해석하고, 출력은 잡아 당기는
// snapshot으로만 renderer에 다시 보인다(shell/terminal#R7, R8).
const terminalFocus = new TerminalFocusTable();
const terminalIpc = createTerminalIpc({
  registry: overlays.overlayRegistry(),
  focus: terminalFocus,
  folders: {
    folders: (project) => projectFolders(core.session(), project),
  },
  host: terminals,
});
registerTerminalIpc(
  {
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    removeHandler: (channel) => ipcMain.removeHandler(channel),
  } satisfies MainIpc,
  terminalIpc,
);

// 프로젝트 등록의 OS 폴더 선택기. 그 창에 붙은 dialog로 열고 desktop 창 본문만 부른다.
ipcMain.handle(
  FOLDER_PICK_CHANNEL,
  createFolderPicker({
    registry: overlays.overlayRegistry(),
    headless,
    headlessPick: process.env.LOPHN_SHELL_PICK_FOLDER,
    dialog: {
      async open(event) {
        const sender = (event as unknown as { sender: WebContents }).sender;
        const parent = BrowserWindow.fromWebContents(sender);
        const options = {
          properties: ["openDirectory" as const, "createDirectory" as const],
        };
        const result = parent
          ? await dialog.showOpenDialog(parent, options)
          : await dialog.showOpenDialog(options);
        return { canceled: result.canceled, paths: result.filePaths };
      },
    },
  }),
);

// 편집기 파일 adapter와 창 닫기 guard(shell#T17). renderer는 문서 id와 session handle만 보내고
// 실제 FileTarget·경로·core port는 여기서 정한다. 창마다 guard가 저장 중 수를 기억한다.
const fileAdapter = createFileAdapter({
  port: () => {
    const session = core.session();
    return session ? coreFilesPort(session) : null;
  },
  log,
});
const closeGuards = new CloseGuards();
const editorIpc = {
  handle: (
    channel: string,
    listener: (event: unknown, input: unknown) => Promise<unknown>,
  ) => ipcMain.handle(channel, listener),
  on: (channel: string, listener: (event: unknown, input: unknown) => void) =>
    void ipcMain.on(channel, listener),
  removeHandler: (channel: string) => ipcMain.removeHandler(channel),
  removeAllListeners: (channel: string) =>
    void ipcMain.removeAllListeners(channel),
};
// 버전 복원(shell#T18). 준비·파일 쓰기·판 바이트는 renderer allowlist 밖이라 main이 부른다.
const restorer = createRestorer({
  port: () => {
    const session = core.session();
    return session ? coreRestorePort(session) : null;
  },
  log,
});
registerEditorIpc(editorIpc, {
  registry: overlays.overlayRegistry(),
  adapter: fileAdapter,
  restorer,
  guardOf: (id) => closeGuards.get(id),
});

let globalPalette: GlobalPalette | undefined;

// 터미널 host와 core를 멈추는 한 번의 순서. tray Quit·`--quit`·OS 종료가 같이 쓴다.
let stopped = false;
function stopAll(): void {
  if (stopped) return;
  stopped = true;
  removeTerminalIpc(
    {
      handle: () => {},
      removeHandler: (channel) => ipcMain.removeHandler(channel),
    } satisfies MainIpc,
  );
  ipcMain.removeHandler(FOLDER_PICK_CHANNEL);
  removeEditorIpc(editorIpc);
  removeAppIpc(appIpc);
  removeConfirmationIpc(confirmationIpc);
  appFrame.dispose();
  terminals.stop();
  core.shutdown();
  overlays.dispose();
  globalPalette?.dispose();
  tray?.destroy();
}

// 명시 종료. 진행 중 터미널·저장이 있으면 OS 확인 창으로 묻는다(desktop#R21).
// 저장 수는 창마다 편집기가 알린 저장 중·실패·불명·충돌 문서 수다(shell#T17).
const quitFlow = createQuitFlow({
  work: {
    runningTerminals: () =>
      terminals.runtimes().filter((runtime) =>
        runtime.state === "running" || runtime.state === "starting"
      ).length,
    pendingSaves: () => closeGuards.pendingSaves(),
  },
  confirm: async (prompt) => {
    const options = quitDialogOptions(prompt);
    const parent = BrowserWindow.getFocusedWindow();
    const reply = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    return quitChosen(reply.response);
  },
  stop: stopAll,
  quitApp: () => app.quit(),
});

// OS 종료(logout, macOS Cmd+Q)도 터미널과 core를 멈춘다. 이미 멈췄으면 아무것도 안 한다.
app.once("will-quit", () => stopAll());
// 앱 끄기가 창 닫기를 부르면 편집기 guard가 먼저 묻는다. 막으면 Electron이 끄기를 멈추므로
// renderer가 허락한 뒤 다시 잇는다(shell/editor#R1).
let appQuitRequested = false;
app.on("before-quit", () => {
  appQuitRequested = true;
});

const autostartOs: AutostartOs = {
  platform: process.platform,
  packaged: app.isPackaged,
  execPath: process.execPath,
  ...(process.env.APPIMAGE ? { appImage: process.env.APPIMAGE } : {}),
  configHome: process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
  probe: nodeExecutableProbe,
  files: nodeAutostartFiles,
  loginItems: {
    get: (query) => app.getLoginItemSettings(query),
    set: (settings) => app.setLoginItemSettings(settings),
  },
  log: (message) => console.log(`[lophn] ${message}`),
};

// session이 생기기 전에 userData를 잡아야 Chromium 저장이 데이터 root 안에 있다.
app.setPath("userData", browserDataPath(dataRoot));
registerViewSchemes(protocol);

const instance = startSingleInstance({
  app,
  dataRoot,
  onOpenWindow: () => openDesktopWindow(),
  onOpenApp: (app) => openIntent({ kind: "app", app }),
  onThingsToConfirm: (request) =>
    openIntent({ kind: "things-to-confirm", request }),
  onQuitIntent: () =>
    requestQuit({
      windows: { hasWindows: () => BrowserWindow.getAllWindows().length > 0 },
      shutdownCore: () => quitFlow.stopNow(),
      quitApp: () => {},
      confirmWithWindows: () => void quitFlow.request(),
    }),
});

// macOS는 링크를 argv가 아니라 open-url로 준다. 준비 전에 와도 준비된 뒤 연다.
app.on("open-url", (event, url) => {
  event.preventDefault();
  const intent = openUrlIntent(url);
  if (intent.kind === "things-to-confirm" && instance.acquired) {
    void app.whenReady().then(() => openIntent(intent));
  }
});

// 창 안 shortcut. 창 본문·overlay·앱 view 어디에 focus가 있어도 그 창의 shell renderer가
// 받는다. 보호 창이나 다른 창의 키는 shell 창이 아니라서 건드리지 않는다(desktop#R18).
app.on("web-contents-created", (_event, contents) => {
  listenShortcuts(contents, process.platform, (shortcut) => {
    const window = desktopWindowOf(contents);
    if (!window) return false;
    window.webContents.send(WINDOW_SHORTCUT_CHANNEL, shortcut);
    return true;
  });
});

function desktopWindowOf(contents: WebContents): BrowserWindow | undefined {
  return [...windows].find((window) =>
    !window.isDestroyed() &&
    (window.webContents === contents ||
      window.contentView.children.some((view) =>
        view instanceof WebContentsView && view.webContents === contents
      ))
  );
}

// 창을 다 닫아도 main은 남는다. 종료는 tray의 명시 행동이다(desktop#R21).
app.on("window-all-closed", () => {});

const mode = resolveLaunchMode({
  argv: process.argv,
  // macOS login item은 argv를 넘기지 못해 OS가 알려 준 로그인 시작으로 안다.
  openedAtLogin: process.platform === "darwin" &&
    app.getLoginItemSettings().wasOpenedAtLogin === true,
});

if (instance.acquired) {
  app.whenReady().then(() => {
    const serve = createShellHandler({ distDir: rendererDist() });
    protocol.handle(
      "lophn-shell",
      (request) =>
        serve(request).then(
          (res) =>
            new Response(res.body ? Buffer.from(res.body) : null, {
              status: res.status,
              headers: res.headers,
            }),
        ),
    );
    // headless는 사람 화면의 tray 영역에도 아무것도 올리지 않는다.
    if (!headless.headless) {
      tray = installTray({
        factory: electronTray,
        icon: trayIconPath({
          packaged: app.isPackaged,
          resourcesPath: process.resourcesPath,
          // build 결과에서 here는 apps/shell/main/dist다.
          desktopDir: join(here, "..", "desktop"),
        }),
        actions: {
          openWindow: () => showDesktopWindow(),
          openLauncher: () => openDesktopWindow(),
          readAutostart: () => readAutostart(autostartOs),
          writeAutostart: (enabled) => writeAutostart(autostartOs, enabled),
          quit: () => void quitFlow.request(),
        },
      });
    }
    // 전역 팔레트(desktop#R18). 실패하면 tray에 사용 불가로 보이고 다른 key는 잡지 않는다.
    // headless는 OS에 등록하지 않는다.
    globalPalette = installGlobalPalette({
      port: guardShortcuts(electronShortcuts, headless, log),
      onPalette: () => sendIntent("global-palette"),
      unavailable: () => tray?.notice("global-search-unavailable"),
      log,
    });
    registerUrlScheme({
      packaged: app.isPackaged,
      headless: headless.headless,
      port: app,
      log,
    });
    // 창 없는 시작은 main과 core만 띄운다(desktop#R21). 첫 시작의 `--open-app`은 기본 창
    // 대신 앱 전용 창을, 링크는 그 대상을 고른 기본 창을 연다.
    const start = readOpenIntent(process.argv);
    if (start.kind === "app" || start.kind === "things-to-confirm") {
      openIntent(start);
    } else if (!mode.tray) openDesktopWindow();
  });
}

function rendererDist(): string {
  // build 결과에서 here는 apps/shell/main/dist이고 renderer dist는 형제 concern
  // 폴더 바로 아래다: apps/shell/renderer/dist.
  return join(here, "..", "..", "renderer", "dist");
}

const electronTray: TrayFactory = {
  create(icon) {
    const image = nativeImage.createFromPath(icon);
    if (image.isEmpty()) throw new Error("tray icon not found");
    const tray = new Tray(
      image.resize({
        width: TRAY_ICON_SIZE,
        height: TRAY_ICON_SIZE,
        quality: "best",
      }),
    );
    return {
      setToolTip: (text) => tray.setToolTip(text),
      setMenu: (items, onSelect) =>
        tray.setContextMenu(Menu.buildFromTemplate(
          items.map((item) =>
            item.type === "separator"
              ? { type: "separator" as const }
              : item.type === "notice"
              ? { label: item.label, enabled: false }
              : {
                type: item.type,
                label: item.label,
                ...(item.type === "checkbox"
                  ? { checked: item.checked, enabled: item.enabled }
                  : {}),
                click: () => onSelect(item.id),
              }
          ),
        )),
      onClick: (handler) => tray.on("click", () => handler()),
      destroy: () => tray.destroy(),
    };
  },
};

const electronShortcuts: GlobalShortcutPort = {
  register: (accelerator, callback) =>
    globalShortcut.register(accelerator, callback),
  unregister: (accelerator) => globalShortcut.unregister(accelerator),
};

function electronNotifier(): OsNotifier {
  // 올린 notification을 닫히거나 눌릴 때까지 잡아 둔다. 놓치면 클릭 handler가 사라진다.
  const live = new Set<Notification>();
  return {
    isSupported: () => Notification.isSupported(),
    show(note, onClick) {
      const shown = new Notification({ title: note.title, body: note.body });
      live.add(shown);
      shown.on("click", () => {
        live.delete(shown);
        onClick();
      });
      shown.on("close", () => live.delete(shown));
      shown.show();
    },
  };
}

/**
 * 창 밖에서 온 일(전역 팔레트 키, OS notification 클릭)을 가장 최근 창에 시킨다. 사람이
 * 직접 누른 것이라 창을 앞으로 가져온다. 창이 없으면 새 기본 창을 연다. 막 연 창은
 * preload가 받아 두었다가 renderer가 구독하면 넘긴다.
 */
function sendIntent(intent: DesktopIntent): void {
  const target =
    [...windows].filter((window) => !window.isDestroyed()).at(-1) ??
      openDesktopWindow();
  if (target === undefined) return;
  reveal(target, headless);
  const send = () => {
    if (!target.isDestroyed()) {
      target.webContents.send(DESKTOP_INTENT_CHANNEL, intent);
    }
  };
  if (target.webContents.isLoading()) {
    target.webContents.once("did-finish-load", send);
  } else send();
}

/** 가장 최근 창을 앞으로 가져온다. 창이 없으면 새 기본 창을 연다. */
function showDesktopWindow(): void {
  const recent = [...windows].filter((window) => !window.isDestroyed()).at(
    -1,
  );
  if (recent === undefined) {
    openDesktopWindow();
    return;
  }
  reveal(recent, headless);
}

function openDesktopWindow(): BrowserWindow | undefined {
  let created: BrowserWindow | undefined;
  openWindow({
    platform: process.platform,
    packaged: app.isPackaged,
    // build가 preload를 같은 dist에 .cjs로 낸다.
    preload: join(here, "preload-shell.cjs"),
    // 개발 확인 전용. 제품 실행은 이 변수를 주지 않는다.
    // `LOPHN_SHELL_START=lophn`은 headless 확인에서 런처 대신 lophn 공간부터 연다.
    // `conversation`은 같은 자리에서 대화 도크까지 열어 둔다. `things-to-confirm`은
    // lophn 공간의 things-to-confirm 형제부터 연다. `project:<id>`는 그 프로젝트 작업대부터 연다.
    url: process.env.LOPHN_DEV_SEED === "1"
      ? `${DESKTOP_URL}?dev-seed=1`
      : process.env.LOPHN_SHELL_START === "lophn"
      ? `${DESKTOP_URL}#lophn`
      : process.env.LOPHN_SHELL_START === "conversation"
      ? `${DESKTOP_URL}#conversation`
      : process.env.LOPHN_SHELL_START === "things-to-confirm"
      ? `${DESKTOP_URL}#things-to-confirm`
      : /^project:prj_[0-9a-z]{26}$/.test(process.env.LOPHN_SHELL_START ?? "")
      ? `${DESKTOP_URL}#project=${process.env.LOPHN_SHELL_START!.slice(8)}`
      : DESKTOP_URL,
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
        attachTerminalSurface(overlays.overlayRegistry(), window);
        windows.add(window);
        created = window;
        // 창 닫기는 편집기의 마지막 고침과 편집 종료를 먼저 본다(editor#R1).
        const contentsId = window.webContents.id;
        const guard = new CloseGuard({
          send: (request) => {
            if (!window.isDestroyed()) {
              window.webContents.send(EDITOR_CLOSE_REQUEST_CHANNEL, request);
            }
          },
          log,
        });
        closeGuards.add(contentsId, guard);
        guardWindowClose(
          {
            onClose: (listener) => window.on("close", listener),
            close: () => window.close(),
            isDestroyed: () => window.isDestroyed(),
          },
          guard,
          {
            quitting: () => quitFlow.quitting,
            quitRequested: () => appQuitRequested,
            resumeQuit: () => app.quit(),
            quitCancelled: () => {
              appQuitRequested = false;
            },
          },
        );
        const ref = windowRef(window);
        window.on("closed", () => {
          closeGuards.remove(contentsId);
          fileAdapter.dropOwner(contentsId);
          appFrame.closeWindow(ref);
        });
        window.on("focus", () => {
          windows.delete(window);
          windows.add(window);
        });
        window.on("closed", () => windows.delete(window));
        // 연결 전에 뜬 창은 지금 상태를 바로 받는다. 이후 변화는 targets가 민다.
        window.webContents.on("did-finish-load", () => {
          if (!window.isDestroyed()) {
            window.webContents.send(CORE_STATE_CHANNEL, { ...core.state });
          }
        });
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
