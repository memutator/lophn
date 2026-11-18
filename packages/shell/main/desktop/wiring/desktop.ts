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
import { BROWSER_EVENT_CHANNEL } from "../../../ipc/browser.ts";
import {
  type CompiledBindings,
  compileBindings,
  parseKeyOverrides,
  resolveBindings,
} from "../../../../protocol/shell/keybindings.ts";
import { WINDOW_SHORTCUT_CHANNEL } from "../../../ipc/shortcuts.ts";
import { WINDOW_CONTROL_CHANNEL } from "../../../ipc/window-controls.ts";
import { guestViewSession } from "../../browser/webview-guest.ts";
import { isViewScheme } from "../security.ts";
import {
  keepRunningNotice,
  type LegacyAutostartOs,
  migrateLegacyLogin,
  nodeLegacyFiles,
} from "../autostart-migrate.ts";
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
import { word } from "../i18n.ts";
import { nodeExecutableProbe } from "../os-entry/exec-path.ts";
import { readOpenIntent } from "../open-intent.ts";
import { createOpenExternal } from "../open-external.ts";
import { createQuitFlow, quitDialogOptions } from "../quit.ts";
import { registerViewSchemes } from "../security.ts";
import { createShellHandler } from "../shell-protocol.ts";
import { listenShortcuts } from "../shortcuts.ts";
import { listenSecondInstance } from "../single-instance.ts";
import { installTray, TRAY_ICON_SIZE, type TrayFactory } from "../tray.ts";
import { createWindowControl } from "../window-controls.ts";
import type { AppViews } from "./app-views.ts";
import { recentWindow } from "./desktop-window.ts";
import type { Registered, ShellContext } from "./context.ts";
import type { Terminals } from "./terminal.ts";

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
        tray.setContextMenu(
          Menu.buildFromTemplate(
            items.map((item) =>
              item.type === "separator"
                ? { type: "separator" as const }
                : item.type === "notice"
                  ? { label: item.label, enabled: false }
                  : {
                      label: item.label,
                      click: () => onSelect(item.id),
                    },
            ),
          ),
        ),
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
  terminals: Terminals,
): Registered {
  const { headless, overlays, windows, ipc, log, desktop } = ctx;
  const { openIntent } = views;
  let globalPalette: GlobalPalette | undefined;

  // OS 폴더·파일 선택기. 그 창에 붙은 dialog로 열고 desktop 창 본문만 부른다.
  const pickDialog: PickDialog = {
    async open(event, request) {
      const sender = (event as unknown as { sender: WebContents }).sender;
      const parent = BrowserWindow.fromWebContents(sender);
      const options = {
        title: request.title,
        properties:
          request.kind === "folder"
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

  // 명시 종료. 도는 터미널·저장 중인 문서가 있으면 OS 확인 창으로 묻는다. 저장 수는 창마다 편집기가 알린 저장 중·실패·불명·충돌
  // 문서 수다. 일반 Quit은 shell 자원과 연결만 정리하고 터미널은 core에서 계속 돈다(사람이 고르면 먼저 닫는다). `Stop lophn`은 core
  // stop 응답까지 기다리고 core가 터미널을 모두 닫는다.
  const quitFlow = createQuitFlow({
    work: {
      runningTerminals: () => terminals.running(),
      pendingSaves: () => ctx.closeGuards.pendingSaves(),
      closeTerminals: (list) => terminals.close(list),
    },
    ask: async (prompt) => {
      const options = quitDialogOptions(prompt);
      const parent = BrowserWindow.getFocusedWindow();
      const reply = parent
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options);
      return reply.response;
    },
    quitApp: () => app.quit(),
  });
  ctx.quit.active = () => quitFlow.quitting;
  // 일반 Quit·Cmd+Q·`--quit`·OS 종료는 shell 자원과 core 연결만 정리한다. core는 남는다.
  const quitShell = () => ctx.stopAll();
  // `Stop lophn`은 core stop을 기다린 뒤 shell을 끝낸다. 응답을 잃지 않게 마지막에 끈다.
  const stopLophn = async () => {
    const stopped = await ctx.core.stopCore();
    if (!stopped) {
      log("core stop이 답하지 않았다. shell만 끝낸다");
      // 사람이 core가 남아 있을 수 있음을 모른 채 끝내지 않게 한다. 창이 없으면 로그만 남긴다.
      const parent = BrowserWindow.getFocusedWindow();
      const options = {
        type: "warning" as const,
        message: word("common.title.core-may-run"),
        detail: word("common.stop.no-answer"),
      };
      await (parent
        ? dialog.showMessageBox(parent, options)
        : dialog.showMessageBox(options));
    }
    ctx.stopAll();
  };
  // 앱 끄기가 창 닫기를 부르면 편집기 guard가 먼저 묻는다. 막으면 Electron이 끄기를 멈추므로
  // renderer가 허락한 뒤 다시 잇는다.
  app.on("before-quit", () => {
    ctx.quit.requested = true;
  });

  const legacyAutostart: LegacyAutostartOs = {
    platform: process.platform,
    packaged: app.isPackaged,
    execPath: process.execPath,
    ...(process.env.APPIMAGE ? { appImage: process.env.APPIMAGE } : {}),
    configHome: process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
    probe: nodeExecutableProbe,
    files: nodeLegacyFiles,
    loginItems: {
      get: (query) => app.getLoginItemSettings(query),
      set: (settings) => app.setLoginItemSettings(settings),
    },
    log,
  };

  // 옛 판에서 옮겨진 사람에게 동작이 바뀐 것을 한 번 알린다(창을 닫아도 core가 계속 돈다). 보이면 표지를 지워 다시 보이지 않는다.
  // 창이 아직 없으면 표지를 남겨 두고 다음 기회(옮기기가 끝난 뒤, 이 컴퓨터의 창이 load를 마친 뒤)에 한다.
  let noticeShown = false;
  const showKeepRunningNotice = (): void => {
    if (noticeShown || !keepRunningNotice.pending(ctx.dataRoot)) return;
    const parent = recentWindow(ctx);
    if (parent === undefined) return;
    noticeShown = true;
    keepRunningNotice.clear(ctx.dataRoot);
    void dialog
      .showMessageBox(parent, {
        type: "info",
        message: word("settings.notice.keep-running-moved"),
        buttons: [
          word("settings.button.open-keep-running-settings"),
          word("common.button.close"),
        ],
        defaultId: 0,
        cancelId: 1,
      })
      .then((reply) => {
        if (reply.response === 0) desktop.send("remote-settings");
      });
  };
  // 시작, tray, Dock, 두 번째 실행 어느 길로 연 창이든 같다.
  ctx.windowHooks.created.push((window) =>
    window.webContents.once("did-finish-load", showKeepRunningNotice),
  );

  // core에 붙은 뒤 옛 등록을 옮긴다. 안 되면 옛 등록을 남기고 다음 실행이 다시 한다.
  let migrating = false;
  ctx.relay.ready.push(() => {
    if (migrating) return;
    migrating = true;
    void migrateLegacyLogin({
      os: legacyAutostart,
      turnOn: async () => {
        const before = await ctx.coreInternal(
          "memory",
          "always_on",
          "status",
          {},
        );
        const set = await ctx.coreInternal("memory", "always_on", "set", {
          keep_running: true,
        });
        if (!set.ok) return false;
        // 표시만이 아니라 OS 등록이 섰을 때만 옛 등록을 지운다.
        if (
          (set.value as { start_at_login?: string }).start_at_login ===
          "registered"
        ) {
          return true;
        }
        // 등록이 서지 않았으면(systemd user session 없음 등) 옛 등록이 로그인 시작을 계속 한다. 표시만 켜 두면 알림 없이
        // idle-exit만 꺼지므로 이 시도가 켠 표시는 되돌린다. 사람이 이미 켠 표시는 그대로 둔다.
        const wasOn =
          before.ok &&
          (before.value as { keep_running?: boolean }).keep_running === true;
        if (!wasOn) {
          await ctx.coreInternal("memory", "always_on", "set", {
            keep_running: false,
          });
        }
        return false;
      },
      migrated: () => keepRunningNotice.mark(ctx.dataRoot),
    }).then(showKeepRunningNotice);
  });

  registerViewSchemes(protocol);

  // lock은 main.ts `startDesktop`이 core를 건드리기 전에 이미 잡았다.
  listenSecondInstance({
    app,
    onOpenWindow: () => desktop.open(),
    onOpenApp: (app) => openIntent({ kind: "app", app }),
    onAgentWindow: () => void desktop.openInactive(),
    // 창이 없어도 tray Quit과 같이 도는 터미널을 묻는다(확인 창은 부모 창 없이 뜬다). headless만 사람 화면에 띄우지 않고 끈다.
    onQuitIntent: () =>
      void (headless.headless
        ? quitFlow.stopNow(quitShell)
        : quitFlow.request("quit", quitShell)),
  });

  // 사람이 바꾼 키(설정 `shell.keybindings`). core 설정의 사본이 바뀌면 main이 먼저 받는 키도 따른다.
  // 이 OS의 것만 쓴다. 읽을 수 없는 줄은 표의 키다.
  let compiled: CompiledBindings | undefined;
  const platformKeys = process.platform === "darwin" ? "mac" : "other";
  const unwatchKeys = ctx.settings.watch(() => {
    const stored = ctx.settings.get("shell.keybindings") as
      | Record<string, unknown>
      | undefined;
    compiled = compileBindings(
      resolveBindings(platformKeys, parseKeyOverrides(stored?.[platformKeys])),
    );
  });

  // 창 안 shortcut. 창 본문·overlay·앱 view·browser 탭 어디에 focus가 있어도 그 창의 shell
  // renderer가 받는다. 보호 창이나 다른 창의 키는 shell 창이 아니라서 건드리지 않는다.
  // browser page(<webview> guest)만 아는 key context `browser`를 준다. app·artifact view의 주소는
  // view scheme이라 browser가 아니다.
  const keyContextOf = (contents: WebContents): string | undefined => {
    if (contents.getType() !== "webview") return undefined;
    return isViewScheme(contents.getURL()) ? undefined : "browser";
  };
  app.on("web-contents-created", (_event, contents) => {
    listenShortcuts(
      contents,
      process.platform,
      (shortcut, send) => {
        // browser 탭의 <webview> guest는 창의 자식 view가 아니라서 host를 통해 창을 찾는다.
        const host =
          contents.getType() === "webview" ? contents.hostWebContents : null;
        const window = [...windows].find(
          (window) =>
            !window.isDestroyed() &&
            (window.webContents === contents ||
              (host !== null && window.webContents === host) ||
              window.contentView.children.some(
                (view) =>
                  view instanceof WebContentsView &&
                  view.webContents === contents,
              )),
        );
        if (!window) return false;
        // browser page의 bookmark key는 그 탭(view_session)에만 알린다. shell:shortcut 글자 하나로는
        // 어느 browser 탭인지 알 수 없다.
        if (shortcut === "browser.bookmark") {
          if (send) {
            window.webContents.send(BROWSER_EVENT_CHANNEL, {
              kind: "bookmark-key",
              view_session: guestViewSession(contents.id),
            });
          }
          return true;
        }
        // shell renderer 자신의 키는 macOS(menu가 먼저 가져간다)에서만 main이 삼킨다. 다른 OS는
        // renderer의 keydown이 받아야 표의 같은 줄을 쓸 수 있고, 터미널에서 Ctrl+W도 PTY로 간다.
        // palette·Home은 예외다. 터미널 context가 Ctrl+글자를 PTY로 보내므로(Ctrl+K도 그 하나)
        // renderer에 맡기면 터미널 안에서 팔레트가 열리지 않는다. main이 모든 OS에서 삼키고 보낸다.
        if (
          window.webContents === contents &&
          process.platform !== "darwin" &&
          shortcut !== "palette.open" &&
          shortcut !== "home.open"
        )
          return false;
        if (send) window.webContents.send(WINDOW_SHORTCUT_CHANNEL, shortcut);
        return true;
      },
      () => compiled,
      () => keyContextOf(contents),
    );
  });

  // 창을 다 닫아도 main은 남는다. 종료는 tray의 명시 행동이다. 창이 없을 때 여는 길(시작, tray, 두 번째 실행, Dock)은
  // 시작 기계의 창을 연다(`desktop.open`·`desktop.show`).
  app.on("window-all-closed", () => {});
  // macOS는 창 없이 Dock을 누르면 창을 다시 연다.
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) desktop.show();
  });

  // 첫 창이 마지막 자리로 열리게 창보다 먼저 읽는다.
  Promise.all([app.whenReady(), ctx.windowState.load()]).then(() => {
    // Electron 기본 menu에서 Reload·Force Reload만 뺀다. Linux·Windows에서 page가 막지 않은 Ctrl+R이 창 renderer를 다시
    // 불러 popover·입력·스크롤을 잃는다. 편집·창 닫기·zoom·전체 화면 accelerator는 기본 menu와 같이 남긴다.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === "darwin"
          ? [{ role: "appMenu" as const }]
          : []),
        { role: "fileMenu" },
        { role: "editMenu" },
        {
          role: "viewMenu",
          submenu: [
            { role: "toggleDevTools" },
            { type: "separator" },
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { type: "separator" },
            { role: "togglefullscreen" },
          ],
        },
        { role: "windowMenu" },
      ]),
    );
    const serve = createShellHandler({ distDir: ctx.rendererDist() });
    protocol.handle("lophn-shell", (request) =>
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
        icon: ctx.appIcon,
        actions: {
          openWindow: () => desktop.show(),
          openHome: () => desktop.open(),
          stop: () => void quitFlow.request("stop", stopLophn),
          quit: () => void quitFlow.request("quit", quitShell),
        },
      });
    }
    // 전역 팔레트. 실패하면 tray에 사용 불가로 보이고 다른 key는 잡지 않는다.
    // headless는 OS에 등록하지 않는다.
    globalPalette = installGlobalPalette({
      port: guardShortcuts(electronShortcuts, headless, log),
      onPalette: () => desktop.send("global-palette"),
      unavailable: () => ctx.tray.current?.notice("global-search-unavailable"),
      log,
    });
    // core만 띄우는 시작(`--core`)과 첫 시작의 `--quit`은 여기 오기 전에 끝난다. 첫 시작의 `--open-app`은
    // 기본 창 대신 앱 전용 창을, `--agent-window`는 focus 없는 창을 연다.
    const start = readOpenIntent(process.argv);
    if (start.kind === "app") openIntent(start);
    else if (start.kind === "agent-window") void desktop.openInactive();
    else desktop.open();
  });

  return {
    stop() {
      ipc.removeHandler(FOLDER_PICK_CHANNEL);
      ipc.removeHandler(FILE_PICK_CHANNEL);
      ipc.removeHandler(WINDOW_CONTROL_CHANNEL);
      unwatchKeys();
      ipc.removeHandler(OPEN_EXTERNAL_CHANNEL);
      globalPalette?.dispose();
      ctx.tray.current?.destroy();
    },
  };
}
