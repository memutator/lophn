// 조립만 한다. 창·single instance·scheme 규칙은 각 모듈에 있다.
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  Tray,
  type WebContents,
  WebContentsView,
} from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { CORE_STATE_CHANNEL } from "../../ipc/core.ts";
import { WINDOW_SHORTCUT_CHANNEL } from "../../ipc/shortcuts.ts";

import { electronOverlays } from "../app-frame/electron-overlay.ts";
import { startCoreConnection } from "./core/connection.ts";
import { nodeFetch, nodeSockets } from "./core/node-io.ts";
import { resolveLaunchMode } from "./launch-mode.ts";
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
  readHeadless,
  reveal,
  surfaceOptions,
} from "./headless.ts";
import { registerShellScheme } from "./security.ts";
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
const windows = new Set<BrowserWindow>();
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
  sockets: nodeSockets(),
  clock: { now: () => Date.now() },
  targets: () =>
    [...windows].map((window) => ({
      send: (channel, payload) => window.webContents.send(channel, payload),
      isDestroyed: () => window.isDestroyed(),
    })),
});
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

let tray: InstalledTray | undefined;

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
  terminals.stop();
  core.shutdown();
  overlays.dispose();
  tray?.destroy();
}

// 명시 종료. 진행 중 터미널·저장이 있으면 OS 확인 창으로 묻는다(desktop#R21).
// 저장 수는 편집기 닫기 guard(shell#T17)가 생기면 그 값을 잇는다.
const quitFlow = createQuitFlow({
  work: {
    runningTerminals: () =>
      terminals.runtimes().filter((runtime) =>
        runtime.state === "running" || runtime.state === "starting"
      ).length,
    pendingSaves: () => 0,
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
registerShellScheme(protocol);

const instance = startSingleInstance({
  app,
  dataRoot,
  onOpenWindow: () => openDesktopWindow(),
  onQuitIntent: () =>
    requestQuit({
      windows: { hasWindows: () => BrowserWindow.getAllWindows().length > 0 },
      shutdownCore: () => quitFlow.stopNow(),
      quitApp: () => {},
      confirmWithWindows: () => void quitFlow.request(),
    }),
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
    // 창 없는 시작은 main과 core만 띄운다(desktop#R21).
    if (!mode.tray) openDesktopWindow();
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
            item.type === "separator" ? { type: "separator" as const } : {
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

function openDesktopWindow(): void {
  openWindow({
    platform: process.platform,
    packaged: app.isPackaged,
    // build가 preload를 같은 dist에 .cjs로 낸다.
    preload: join(here, "preload-shell.cjs"),
    // 개발 확인 전용. 제품 실행은 이 변수를 주지 않는다.
    // `LOPHN_SHELL_START=lophn`은 headless 확인에서 런처 대신 lophn 공간부터 연다.
    // `conversation`은 같은 자리에서 대화 도크까지 열어 둔다.
    url: process.env.LOPHN_DEV_SEED === "1"
      ? `${DESKTOP_URL}?dev-seed=1`
      : process.env.LOPHN_SHELL_START === "lophn"
      ? `${DESKTOP_URL}#lophn`
      : process.env.LOPHN_SHELL_START === "conversation"
      ? `${DESKTOP_URL}#conversation`
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
