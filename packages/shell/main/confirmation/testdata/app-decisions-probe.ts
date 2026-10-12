// e2e/shell/app-decisions_test.ts가 build해 띄우는 Electron main. 실제 보호 창 조립(coordinator,
// 설치한 confirmation renderer와 preload, 창마다 메모리 partition)에 app-detail 결정 intent 다섯을
// 차례로 연다. core 읽기·명령만 가짜(kinds/app-decisions_fixture.ts)다. 창은 화면에 띄우지 않는다
// (show:false·offscreen). 창마다 종류와 표시 문구를 적고 PNG를 남긴다.
import { app, BrowserWindow, ipcMain, protocol, session } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { registerViewSchemes } from "../../desktop/security.ts";
import { createShellHandler } from "../../desktop/shell-protocol.ts";
import { createCoordinator } from "../coordinator.ts";
import { type ConfirmationIpcEvent, registerConfirmationIpc } from "../ipc.ts";
import { intents, world } from "../kinds/app-decisions_fixture.ts";
import type {
  AppContents,
  ConfirmationBrowserWindow,
  ConfirmationHost,
  ParentWindow,
} from "../window.ts";

interface ProbeConfig {
  userData: string;
  result: string;
  preload: string;
  rendererDist: string;
  shots: string;
}

const config = JSON.parse(
  process.env.LOPHN_APP_DECISIONS ?? "{}",
) as ProbeConfig;

registerViewSchemes(protocol);
app.setPath("userData", config.userData);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function run(): Promise<unknown> {
  await app.whenReady();
  mkdirSync(config.shots, { recursive: true });
  const parent = new BrowserWindow({
    show: false,
    width: 1000,
    height: 760,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const parentRef: ParentWindow = {
    id: "window-1",
    focus: () => {},
    getContentSize: () => {
      const [width = 0, height = 0] = parent.getContentSize();
      return { width, height };
    },
  };
  let latest: BrowserWindow | undefined;
  let paint: Electron.NativeImage | undefined;
  const host: ConfirmationHost = {
    create(options) {
      const made = new BrowserWindow(
        { ...options, parent } as unknown as ConstructorParameters<
          typeof BrowserWindow
        >[0],
      );
      latest = made;
      paint = undefined;
      made.webContents.on("paint", (_event, _dirty, image) => {
        paint = image;
      });
      made.webContents.setFrameRate(10);
      return made as unknown as ConfirmationBrowserWindow;
    },
    sessionFor(partition) {
      const ses = session.fromPartition(partition);
      const serve = createShellHandler({ distDir: config.rendererDist });
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
        setPermissionRequestHandler: () =>
          ses.setPermissionRequestHandler((_c, _p, callback) =>
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
    appContents: () => [] as readonly AppContents[],
  };
  const { kinds } = world();
  const coordinator = createCoordinator({
    host,
    canon: kinds.canon,
    handles: {
      register: (request) =>
        Promise.resolve({
          ok: true,
          confirmation: "D".repeat(43),
          expiresAt: request.expires_at,
        }),
      closeWindow: () => Promise.resolve(),
      clear: () => Promise.resolve(),
    },
    submit: kinds.submit,
    deferred: kinds.deferred,
    forget: (windowId) => kinds.closed(windowId),
    clock: { now: () => Date.now() },
    preload: config.preload,
    packaged: false,
    headless: { headless: true },
    epoch: () => "probe",
    connected: () => true,
  });
  registerConfirmationIpc({
    handle: (channel, listener) =>
      ipcMain.handle(
        channel,
        (event, input) => listener(event as ConfirmationIpcEvent, input),
      ),
    removeHandler: (channel) => ipcMain.removeHandler(channel),
  }, { coordinator, parentOf: () => parentRef });

  const windows: unknown[] = [];
  for (const [intent] of intents) {
    const opened = await coordinator.open({
      intent,
      parent: parentRef,
      requestedByPerson: true,
    });
    if (!opened.ok) {
      windows.push({
        decision: (intent as { decision: string }).decision,
        error: opened.error,
      });
      continue;
    }
    const contents = latest!.webContents;
    let text = "";
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      await wait(150);
      text = await contents.executeJavaScript("document.body.innerText")
        .catch(() => "");
      if (typeof text === "string" && text.length > 40) break;
    }
    await wait(500);
    const shown = coordinator.display(opened.value.windowId);
    const decision = (intent as { decision: string }).decision;
    const path = join(config.shots, `app-decision-${decision}.png`);
    if (paint !== undefined) writeFileSync(path, paint.toPNG());
    windows.push({
      decision,
      kind: shown?.view?.kind ?? null,
      state: shown?.state ?? null,
      text,
      png: paint !== undefined,
    });
    await coordinator.cancel(opened.value.windowId);
  }
  return windows;
}

run().then(
  (result) => {
    writeFileSync(config.result, JSON.stringify({ ok: true, result }));
    app.exit(0);
  },
  (error) => {
    writeFileSync(
      config.result,
      JSON.stringify({ ok: false, error: String(error?.stack ?? error) }),
    );
    app.exit(1);
  },
);
