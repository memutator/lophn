// 폴더·파일 고르기, 외부 열기, 단축키, 단일 instance, launch mode, 창 열기 시작, 종료 흐름.
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  Menu,
  nativeImage,
  protocol,
  shell,
  Tray,
  type WebContents,
  WebContentsView,
} from "electron";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  FILE_PICK_CHANNEL,
  FOLDER_PICK_CHANNEL,
} from "../../../ipc/folder-picker.ts";
import { OPEN_EXTERNAL_CHANNEL } from "../../../ipc/open-external.ts";
import { isMainCommand } from "../../../ipc/keybindings.ts";
import { WINDOW_SHORTCUT_CHANNEL } from "../../../ipc/shortcuts.ts";
import { WINDOW_CONTROL_CHANNEL } from "../../../ipc/window-controls.ts";
import {
  type AutostartOs,
  nodeAutostartFiles,
  nodeExecutableProbe,
  readAutostart,
  writeAutostart,
} from "../autostart.ts";
import {
  createFilePicker,
  createFolderPicker,
  type PickDialog,
} from "../folder-picker.ts";
import {
  type GlobalPalette,
  type GlobalShortcutPort,
  installGlobalPalette,
} from "../global-shortcut.ts";
import { guardShortcuts } from "../headless.ts";
import { resolveLaunchMode } from "../launch-mode.ts";
import { readOpenIntent } from "../open-intent.ts";
import { createOpenExternal } from "../open-external.ts";
import { browserDataPath } from "../paths.ts";
import {
  createQuitFlow,
  quitChosen,
  quitDialogOptions,
  requestQuit,
} from "../quit.ts";
import { registerViewSchemes } from "../security.ts";
import { createShellHandler } from "../shell-protocol.ts";
import { listenShortcuts } from "../shortcuts.ts";
import { startSingleInstance } from "../single-instance.ts";
import {
  installTray,
  TRAY_ICON_SIZE,
  type TrayFactory,
  trayIconPath,
} from "../tray.ts";
import { createWindowControl } from "../window-controls.ts";
import type { AppViews } from "./app-views.ts";
import type { Coding } from "./coding.ts";
import type { Registered, ShellContext } from "./context.ts";

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

export function register(
  ctx: ShellContext,
  views: AppViews,
  coding: Coding,
): Registered {
  const { dataRoot, headless, overlays, windows, ipc, log, desktop } = ctx;
  const { openIntent } = views;
  let globalPalette: GlobalPalette | undefined;

  // OS 폴더·파일 선택기. 그 창에 붙은 dialog로 열고 desktop 창 본문만 부른다.
  const pickDialog: PickDialog = {
    async open(event, request) {
      const sender = (event as unknown as { sender: WebContents }).sender;
      const parent = BrowserWindow.fromWebContents(sender);
      const options = {
        title: request.title,
        properties: request.kind === "folder"
          ? ["openDirectory" as const, "createDirectory" as const]
          : ["openFile" as const],
      };
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options);
      return { canceled: result.canceled, paths: result.filePaths };
    },
  };
  ipc.handle(
    FOLDER_PICK_CHANNEL,
    createFolderPicker({
      registry: overlays.overlayRegistry(),
      headless,
      headlessPick: process.env.LOPHN_SHELL_PICK_FOLDER,
      dialog: pickDialog,
    }),
  );
  ipc.handle(
    FILE_PICK_CHANNEL,
    createFilePicker({
      registry: overlays.overlayRegistry(),
      headless,
      headlessPick: process.env.LOPHN_SHELL_PICK_FILE,
      dialog: pickDialog,
    }),
  );

  // 상단 바의 최소화·최대화·닫기. desktop 창 본문만 부르고 그 창에만 간다.
  ipc.handle(
    WINDOW_CONTROL_CHANNEL,
    createWindowControl({
      registry: overlays.overlayRegistry(),
      windowOf: (event) => ctx.shellWindowOf(event.sender),
    }),
  );

  // shell 크롬의 외부 링크와 provider 공식 로그인 버튼. 확인 창 없이 OS browser로 연다.
  // headless 확인에서는 사람 화면에 browser를 띄우지 않는다.
  ipc.handle(
    OPEN_EXTERNAL_CHANNEL,
    createOpenExternal({
      registry: overlays.overlayRegistry(),
      open: (url) =>
        headless.headless ? Promise.resolve() : shell.openExternal(url),
      log,
    }),
  );

  // 명시 종료. 진행 중 터미널·저장이 있으면 OS 확인 창으로 묻는다.
  // 저장 수는 창마다 편집기가 알린 저장 중·실패·불명·충돌 문서 수다.
  const quitFlow = createQuitFlow({
    work: {
      runningTerminals: () =>
        coding.terminals.runtimes().filter((runtime) =>
          runtime.state === "running" || runtime.state === "starting"
        ).length,
      pendingSaves: () => ctx.closeGuards.pendingSaves(),
    },
    confirm: async (prompt) => {
      const options = quitDialogOptions(prompt);
      const parent = BrowserWindow.getFocusedWindow();
      const reply = parent
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options);
      return quitChosen(reply.response);
    },
    stop: () => ctx.stopAll(),
    quitApp: () => app.quit(),
  });
  ctx.quit.active = () => quitFlow.quitting;
  // 앱 끄기가 창 닫기를 부르면 편집기 guard가 먼저 묻는다. 막으면 Electron이 끄기를 멈추므로
  // renderer가 허락한 뒤 다시 잇는다.
  app.on("before-quit", () => {
    ctx.quit.requested = true;
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
    onOpenWindow: () => desktop.open(),
    onOpenApp: (app) => openIntent({ kind: "app", app }),
    onQuitIntent: () =>
      requestQuit({
        windows: { hasWindows: () => BrowserWindow.getAllWindows().length > 0 },
        shutdownCore: () => quitFlow.stopNow(),
        quitApp: () => {},
        confirmWithWindows: () => void quitFlow.request(),
      }),
  });

  // 창 안 shortcut. 창 본문·overlay·앱 view·browser 탭 어디에 focus가 있어도 그 창의 shell
  // renderer가 받는다. 보호 창이나 다른 창의 키는 shell 창이 아니라서 건드리지 않는다.
  app.on("web-contents-created", (_event, contents) => {
    listenShortcuts(contents, process.platform, (shortcut, send) => {
      // browser 탭의 <webview> guest는 창의 자식 view가 아니라서 host를 통해 창을 찾는다.
      const host = contents.getType() === "webview"
        ? contents.hostWebContents
        : null;
      const window = [...windows].find((window) =>
        !window.isDestroyed() &&
        (window.webContents === contents ||
          (host !== null && window.webContents === host) ||
          window.contentView.children.some((view) =>
            view instanceof WebContentsView && view.webContents === contents
          ))
      );
      if (!window) return false;
      // shell renderer 자신의 키는 macOS(menu가 먼저 가져간다)에서만 main이 삼킨다. 다른 OS는
      // renderer의 keydown이 받아야 터미널에서 Ctrl+W 같은 키를 shell로 보낼 수 있다.
      if (
        window.webContents === contents && process.platform !== "darwin" &&
        isMainCommand(shortcut)
      ) return false;
      if (send) window.webContents.send(WINDOW_SHORTCUT_CHANNEL, shortcut);
      return true;
    });
  });

  // 창을 다 닫아도 main은 남는다. 종료는 tray의 명시 행동이다.
  app.on("window-all-closed", () => {});

  const mode = resolveLaunchMode({
    argv: process.argv,
    // macOS login item은 argv를 넘기지 못해 OS가 알려 준 로그인 시작으로 안다.
    openedAtLogin: process.platform === "darwin" &&
      app.getLoginItemSettings().wasOpenedAtLogin === true,
  });

  if (instance.acquired) {
    app.whenReady().then(() => {
      const serve = createShellHandler({ distDir: ctx.rendererDist() });
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
        ctx.tray.current = installTray({
          factory: electronTray,
          icon: trayIconPath({
            packaged: app.isPackaged,
            resourcesPath: process.resourcesPath,
            // build 결과에서 here는 packages/shell/main/dist다.
            desktopDir: join(ctx.here, "..", "desktop"),
          }),
          actions: {
            openWindow: () => desktop.show(),
            openLauncher: () => desktop.open(),
            readAutostart: () => readAutostart(autostartOs),
            writeAutostart: (enabled) => writeAutostart(autostartOs, enabled),
            quit: () => void quitFlow.request(),
          },
        });
      }
      // 전역 팔레트. 실패하면 tray에 사용 불가로 보이고 다른 key는 잡지 않는다.
      // headless는 OS에 등록하지 않는다.
      globalPalette = installGlobalPalette({
        port: guardShortcuts(electronShortcuts, headless, log),
        onPalette: () => desktop.send("global-palette"),
        unavailable: () =>
          ctx.tray.current?.notice("global-search-unavailable"),
        log,
      });
      // 창 없는 시작은 main과 core만 띄운다. 첫 시작의 `--open-app`은 기본 창
      // 대신 앱 전용 창을 연다.
      const start = readOpenIntent(process.argv);
      if (start.kind === "app") openIntent(start);
      else if (!mode.tray) desktop.open();
    });
  }

  return {
    stop() {
      ipc.removeHandler(FOLDER_PICK_CHANNEL);
      ipc.removeHandler(FILE_PICK_CHANNEL);
      ipc.removeHandler(WINDOW_CONTROL_CHANNEL);
      ipc.removeHandler(OPEN_EXTERNAL_CHANNEL);
      globalPalette?.dispose();
      ctx.tray.current?.destroy();
    },
  };
}
