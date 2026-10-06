// 앱 화면 검사 host의 Electron 조립(shell#T46). `entry.ts`가 `--app-screen-test`일 때만 이
// bundle을 연다. desktop main의 데이터 root·사람 token·core 연결·single instance·collector를
// 하나도 쓰지 않는다. userData는 실행마다 새 임시 폴더, 앱 view는 `app-test-<run>` 메모리
// partition이고 모든 표면은 `show: false`·offscreen이라 OS에 창이 보이지 않는다. 앱 view는 운영과
// 같은 adapter·앱 preload·session 정책·protocol handler를 지나고, 화면 byte만 앱 socket 대신
// 고정 bundle 파일에서 온다. 통로는 상속 fd 3의 JSON lines 하나씩이고 stdout은 쓰지 않는다.
import {
  app,
  BrowserWindow,
  ipcMain,
  protocol,
  session as electronSession,
  type WebContents,
  webContents as allContents,
  WebContentsView,
} from "electron";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SCREEN_TEST_FD,
  screenTestInputSchema,
  screenTestLine,
  screenTestObservationSchema,
} from "../../../packages/contracts/shell/screen-test.ts";
import {
  SCREEN_TEST_BLOCKED_CHANNEL,
  SCREEN_TEST_PROBE_CHANNEL,
} from "../ipc/screen-test.ts";
import { nodeInvoke } from "./app-frame/app-invoke.ts";
import { registerAppIpc } from "./app-frame/app-ipc.ts";
import { parseAppUrl, type ProtocolView } from "./app-frame/app-protocol.ts";
import { electronAppViews } from "./app-frame/electron-app-frame.ts";
import { navigationAllowed } from "./app-frame/network-policy.ts";
import type { BoundView } from "./app-frame/registry.ts";
import {
  BLOCK_RESPONSE_MS,
  bundleUpstream,
  createScreenTestCall,
  createScreenTestRecorder,
  FEEDBACK_MS,
  fitsFrame,
  type LoadResult,
  readFrame,
  runScreenTest,
  SCREEN_TEST_APP,
  SCREEN_TEST_LABEL,
  type ScreenEntry,
  screenEntryUrl,
  type ScreenSurface,
  type ScreenTestInput,
  screenTestPartition,
  type ScreenTestPorts,
  type ScreenTestRecorder,
} from "./app-frame/screen-test-host.ts";
import {
  type AppSessionHandle,
  createAppSessions,
} from "./app-frame/session-policy.ts";
import { type HeadlessMode, surfaceOptions } from "./desktop/headless.ts";
import { registerViewSchemes, webPreferences } from "./desktop/security.ts";

const HEADLESS: HeadlessMode = { headless: true };
const FRAME_REF = "screen-test";
const VIEW_SIZE = { width: 1280, height: 800 };
// feedback dialog 자리. 앱 view 위의 다른 renderer에 고정 문서를 연다(shell overlay와 같은 배치).
const DIALOG_URL =
  "data:text/html;charset=utf-8,<!doctype html><title>feedback</title><textarea></textarea>";
// 기한 뒤 host가 스스로 끝나는 여유. 관측을 쓰지 못하고 끝나면 runner는 판정 불가로 둔다.
const EXIT_GRACE_MS = FEEDBACK_MS + 5_000;

registerViewSchemes(protocol);
const userData = mkdtempSync(join(tmpdir(), "lophn-app-screen-test-"));
app.setPath("userData", userData);
app.on("window-all-closed", () => {});
process.on("exit", () => rmSync(userData, { recursive: true, force: true }));

let channel: Socket | undefined;
try {
  // runner가 입력을 쓴 뒤 자기 쪽을 닫아도 관측을 쓸 수 있게 반만 닫힌 상태를 둔다.
  channel = new Socket({
    fd: SCREEN_TEST_FD,
    readable: true,
    writable: true,
    allowHalfOpen: true,
  });
} catch {
  channel = undefined;
}
const inputLine = channel === undefined
  ? Promise.resolve(undefined)
  : readFrame(channel);

function finish(code: number, line?: string): void {
  const exit = () => app.exit(code);
  if (channel === undefined || line === undefined) {
    channel?.destroy();
    exit();
    return;
  }
  channel.on("error", exit);
  channel.end(line, exit);
}

/** contracts/shell 입력 schema. 모르는 field·경로 이탈·잘못된 기한은 undefined다. */
function parseInput(line: string): ScreenTestInput | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  const parsed = screenTestInputSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** session webRequest가 막은 요청을 관측에 더한다. 판정은 session 정책 그대로다. */
function watchBlocked(
  handle: AppSessionHandle,
  blocked: (contentsId: number | undefined, url: string) => void,
): AppSessionHandle {
  return {
    ...handle,
    onBeforeRequest(listener) {
      handle.onBeforeRequest((details, callback) =>
        listener(details, (response) => {
          if (response.cancel) blocked(details.webContentsId, details.url);
          callback(response);
        })
      );
    },
  };
}

function urlLike(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

interface LiveView {
  key: string;
  token: string;
  view: BoundView;
}

function electronPorts(
  input: ScreenTestInput,
  recorder: ScreenTestRecorder,
): ScreenTestPorts {
  const partition = screenTestPartition(randomBytes(8).toString("hex"));
  const window = new BrowserWindow(surfaceOptions({
    show: false,
    ...VIEW_SIZE,
    webPreferences: {
      ...webPreferences(app.isPackaged),
      partition: `${partition}-frame`,
    },
  }, HEADLESS));
  const host = electronAppViews({
    windowOf: (ref) => ref === FRAME_REF ? window : undefined,
    preload: join(__dirname, "preload-app.cjs"),
    packaged: app.isPackaged,
    headless: HEADLESS,
    raise() {},
  });
  const live = new Map<number, LiveView>();
  const blocked = (contentsId: number | undefined, url: string) => {
    const view = contentsId === undefined ? undefined : live.get(contentsId);
    if (view !== undefined) recorder.blocked(view.key, url);
  };
  const sessions = createAppSessions({
    handle: (name) => watchBlocked(host.sessionHandle(name), blocked),
    viewOf(contentsId) {
      const view = contentsId === undefined ? undefined : live.get(contentsId);
      return view === undefined
        ? undefined
        : { token: view.token, appLabel: SCREEN_TEST_LABEL, hosts: [] };
    },
    protocol: {
      viewFor(token, appLabel): ProtocolView | undefined {
        const view = [...live.values()].find((item) => item.token === token);
        if (view === undefined || appLabel !== SCREEN_TEST_LABEL) {
          return undefined;
        }
        return {
          view_session: view.view.view_session,
          appLabel,
          screen: view.key,
          size: "full",
          endpoint: input.app_socket_path,
          authorization: "",
          hosts: [],
        };
      },
      upstream: bundleUpstream(input),
      stale() {},
    },
    platformPorts: () => [],
  });
  sessions.ensure(partition, SCREEN_TEST_LABEL);
  electronSession.fromPartition(partition).registerPreloadScript({
    type: "frame",
    filePath: join(__dirname, "preload-screen-test.cjs"),
  });
  ipcMain.on(SCREEN_TEST_BLOCKED_CHANNEL, (event, value) => {
    if (typeof value === "string" && urlLike(value)) {
      blocked(event.sender.id, value);
    }
  });

  // 운영과 같은 앱 IPC. view_error는 collector 대신 관측으로 간다.
  const call = createScreenTestCall({
    endpoint: input.app_socket_path,
    invoke: nodeInvoke,
    requestKey: () => randomUUID(),
  });
  registerAppIpc({
    handle: (name, listener) => ipcMain.handle(name, listener),
    on: (name, listener) => void ipcMain.on(name, listener),
    removeHandler: (name) => ipcMain.removeHandler(name),
    removeAllListeners: (name) => void ipcMain.removeAllListeners(name),
  }, {
    view: (contentsId) => live.get(contentsId)?.view,
    call: (_view, value) => call(value),
    openExternal: () =>
      Promise.resolve({
        ok: false,
        error: {
          code: "unavailable",
          message: "external links are not opened in app tests",
        },
      }),
    viewError(view, value) {
      recorder.error(view.target.screen, value);
      return Promise.resolve();
    },
  });

  function open(screen: ScreenEntry): ScreenSurface {
    const view = host.views.create({
      partition,
      allowNavigation: (url) =>
        navigationAllowed(url, SCREEN_TEST_LABEL, screen.key),
    });
    const contents = allContents.fromId(view.id) as WebContents;
    let gone = false;
    let frames = 0;
    // custom protocol의 404·5xx도 Chromium에는 load 성공이다. main frame 응답 code로 가른다.
    let status = 0;
    contents.on("did-navigate", (_event, _url, code) => {
      status = code;
    });
    contents.on("render-process-gone", () => {
      gone = true;
    });
    contents.on("paint", (_event, _dirty, image) => {
      if (!image.isEmpty()) frames += 1;
    });
    live.set(view.id, {
      key: screen.key,
      token: randomBytes(32).toString("base64url"),
      view: {
        view_session: `view-test-${randomUUID()}`,
        generation: 1,
        target: {
          app: SCREEN_TEST_APP,
          mode: "preview",
          release: null,
          screen: screen.key,
          size: "full",
        },
        binding: {
          endpoint: input.app_socket_path,
          authorization: "",
          release: null,
          bundleHash: "",
          processNonce: "",
          expiresAtMs: null,
        },
      },
    });
    host.views.attach(FRAME_REF, view, { x: 0, y: 0, ...VIEW_SIZE });
    return {
      loaded: view.load(screenEntryUrl(screen)).then(
        (): LoadResult =>
          status >= 400
            ? { ok: false, reason: `http ${status}` }
            : { ok: true },
        (error: { code?: unknown }) => ({
          ok: false as const,
          reason: typeof error?.code === "string" ? error.code : "load failed",
        }),
      ),
      bound() {
        if (gone || contents.isDestroyed()) return false;
        try {
          return parseAppUrl(contents.mainFrame.url, SCREEN_TEST_LABEL)
            ?.screen === screen.key;
        } catch {
          return false;
        }
      },
      probe() {
        if (!contents.isDestroyed()) {
          contents.send(SCREEN_TEST_PROBE_CHANNEL, { kind: "errors" });
        }
      },
      async block() {
        if (contents.isDestroyed()) return false;
        contents.send(SCREEN_TEST_PROBE_CHANNEL, { kind: "block" });
        // 멈춘 main thread는 JS 실행에 답하지 못한다. 답이 오면 멈추지 않은 것이다.
        await wait(BLOCK_RESPONSE_MS);
        const answered = await Promise.race([
          contents.executeJavaScript("1").then(() => true, () => false),
          wait(BLOCK_RESPONSE_MS).then(() => false),
        ]);
        return !answered;
      },
      async capture(ms) {
        const before = frames;
        const end = Date.now() + ms;
        if (!contents.isDestroyed()) contents.invalidate();
        while (Date.now() < end) {
          if (gone || contents.isDestroyed()) return false;
          if (frames > before) return true;
          await wait(50);
        }
        return false;
      },
      close() {
        live.delete(view.id);
        host.views.detach(FRAME_REF, view);
        view.destroy();
      },
    };
  }

  async function openDialog(ms: number): Promise<boolean> {
    const dialog = new WebContentsView(surfaceOptions({
      webPreferences: {
        ...webPreferences(app.isPackaged),
        partition: `${partition}-dialog`,
      },
    }, HEADLESS));
    dialog.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.contentView.addChildView(dialog);
    dialog.setBounds({ x: 320, y: 160, width: 640, height: 480 });
    try {
      return await Promise.race([
        dialog.webContents.loadURL(DIALOG_URL).then(() => true, () => false),
        wait(ms).then(() => false),
      ]);
    } finally {
      window.contentView.removeChildView(dialog);
      dialog.webContents.close();
    }
  }

  return { open, openDialog, wait, now: () => Date.now() };
}

void app.whenReady().then(async () => {
  const line = await inputLine;
  channel?.on("error", () => {});
  const input = line === undefined ? undefined : parseInput(line);
  if (input === undefined) {
    process.stderr.write("[lophn] app screen test input is invalid\n");
    finish(2);
    return;
  }
  const guard = setTimeout(() => finish(3), input.deadline_ms + EXIT_GRACE_MS);
  const recorder = createScreenTestRecorder();
  await runScreenTest(input, electronPorts(input, recorder), recorder);
  clearTimeout(guard);
  // 관측도 contract schema로 확인한다. 틀리거나 frame 상한을 넘으면 쓰지 않는다.
  const observation = screenTestObservationSchema.safeParse(
    recorder.observation(),
  );
  const out = observation.success
    ? screenTestLine(observation.data)
    : undefined;
  if (out === undefined || !fitsFrame(out)) {
    process.stderr.write("[lophn] app screen test observation is invalid\n");
    finish(4);
    return;
  }
  finish(0, out);
});
