// e2e/shell/app-card_test.ts가 build해 띄우는 Electron main. 창 본문에 세션 카드 목록 page를
// 싣고, page가 renderer의 실제 bounds relay(`renderer/app-frame/bounds.ts`)로 카드 자리의 보이는
// 사각형을 console로 알리면 shell main과 같은 조립(registry, visibility, electron adapter)으로 card
// 크기 앱 view를 붙인다. 목록을 scroll하며 붙인 view의 실제 bounds를 적는다. core 앱 통로만 가짜
// connector이고 앱 화면은 테스트가 Unix socket에 띄운 가짜 앱이 내준다. 창은 화면에 띄우지
// 않는다(show:false·offscreen). 결과는 JSON 파일 하나로 쓰고 끝난다.
import { app, BrowserWindow, protocol, WebContentsView } from "electron";
import { writeFileSync } from "node:fs";

import { registerViewSchemes } from "../../desktop/security.ts";
import { TOP_BAR_HEIGHT } from "../../desktop/window.ts";
import { nodeUpstream } from "../app-protocol.ts";
import { createViewDiagnostics } from "../diagnostics.ts";
import { electronAppViews } from "../electron-app-frame.ts";
import { createAppFrame, type ViewBounds } from "../registry.ts";
import { createViewVisibility } from "../visibility.ts";

interface ProbeConfig {
  userData: string;
  result: string;
  preload: string;
  page: string;
  app: string;
  release: string;
  socket: string;
  message: string;
  block: string;
}

const config = JSON.parse(process.env.LOPHN_APP_CARD ?? "{}") as ProbeConfig;

registerViewSchemes(protocol);
app.setPath("userData", config.userData);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function run(): Promise<unknown> {
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    width: 1000,
    height: 760,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const appViews = () =>
    window.contentView.children.filter((child) =>
      child instanceof WebContentsView
    );

  // 붙이기마다 적는다. 목록 경계 밖에 보인 frame이 있었는지 본다.
  const attaches: ViewBounds[] = [];
  const adapter = electronAppViews({
    windowOf: (ref) => ref === "window-1" ? window : undefined,
    preload: config.preload,
    packaged: false,
    headless: { headless: true },
    raise: () => {},
  });
  const frame = createAppFrame({
    connector: {
      connect: (target) =>
        Promise.resolve({
          ok: true,
          value: {
            endpoint: config.socket,
            authorization: `probe ${target.app}`,
            release: target.release,
            bundleHash: "0".repeat(64),
            processNonce: "probe",
            expiresAtMs: null,
          },
        }),
      hosts: () => Promise.resolve({ ok: true, value: [] }),
    },
    views: {
      ...adapter.views,
      attach(ref, view, bounds) {
        attaches.push({ ...bounds });
        return adapter.views.attach(ref, view, bounds);
      },
    },
    sessionHandle: adapter.sessionHandle,
    upstream: nodeUpstream,
    platformPorts: () => [],
    diagnostics: createViewDiagnostics({
      send: () => true,
      log: () => {},
      clock: { nowIso: () => new Date().toISOString() },
    }),
    ids: { viewSession: () => "card-1", token: () => "token-1" },
    clock: { nowMs: () => Date.now() },
  });
  const visibility = createViewVisibility({
    frame,
    geometry: {
      body() {
        const [width = 0, height = 0] = window.getContentSize();
        return {
          x: 0,
          y: TOP_BAR_HEIGHT,
          width,
          height: height - TOP_BAR_HEIGHT,
        };
      },
      zoom: () => window.webContents.getZoomFactor(),
    },
    timer: {
      set: (callback, ms) => setTimeout(callback, ms),
      clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
    },
  });

  await window.loadFile(config.page);
  const opened = await visibility.openApp("window-1", {
    app: config.app,
    mode: "live",
    release: config.release,
    screen: "main",
    size: "card",
    card: { message: config.message, block: config.block },
  });
  if (!opened.ok) throw new Error(`open failed: ${opened.error.message}`);
  const view = opened.value.view_session;

  // page의 relay가 보낸 사각형만 main에 넘긴다. 다른 것은 보내지 않는다.
  const sent: string[] = [];
  window.webContents.on("console-message", (...args: unknown[]) => {
    const first = args[0] as { message?: string };
    const line = typeof first?.message === "string"
      ? first.message
      : String(args[2] ?? "");
    if (line.startsWith("bounds ")) {
      sent.push(line);
      void visibility.setBounds("window-1", view, JSON.parse(line.slice(7)));
    } else if (line === "hide") {
      sent.push(line);
      visibility.hide("window-1", [view]);
    }
  });
  const page = (script: string) => window.webContents.executeJavaScript(script);
  const list = await page("listRect()") as ViewBounds;
  await page("startCard()");

  const shown = () => appViews()[0]?.getBounds();
  async function settle(
    what: string,
    expected: ViewBounds | undefined,
  ): Promise<ViewBounds | undefined> {
    const deadline = Date.now() + 10_000;
    for (;;) {
      const current = shown();
      if (JSON.stringify(current) === JSON.stringify(expected)) return current;
      if (Date.now() > deadline) {
        throw new Error(
          `timed out: ${what} ${JSON.stringify({ current, expected, sent })}`,
        );
      }
      await wait(10);
    }
  }
  const card = (top: number, height: number) => ({
    x: 20,
    y: top,
    width: 400,
    height,
  });
  const listTop = list.y;
  const listBottom = list.y + list.height;
  // 카드 자리는 목록 안 300px 아래, 높이 240px이다.
  const at = (scroll: number) => listTop + 300 - scroll;
  const visible = (scroll: number) => {
    const top = Math.max(at(scroll), listTop);
    const bottom = Math.min(at(scroll) + 240, listBottom);
    return card(top, bottom - top);
  };

  const steps: Record<string, ViewBounds | undefined> = {};
  steps.partial = await settle("partial", visible(0));
  await page("scrollList(200)");
  steps.whole = await settle("whole", visible(200));
  // 연속 scroll. 매 frame 사각형이 바뀌어도 붙인 view는 목록 경계 안이다.
  for (let scroll = 200; scroll <= 520; scroll += 8) {
    await page(`scrollList(${scroll})`);
    await wait(4);
  }
  await page("scrollList(700)");
  steps.outside = await settle("outside", undefined);
  const detached = appViews().length === 0;
  await page("scrollList(100)");
  steps.back = await settle("back", visible(100));

  const outsideList = attaches.filter((bounds) =>
    bounds.y < listTop || bounds.y + bounds.height > listBottom ||
    bounds.x < list.x || bounds.x + bounds.width > list.x + list.width
  );
  visibility.dispose();
  frame.dispose();
  return {
    list,
    steps,
    detached,
    attaches: attaches.length,
    outsideList,
    sent: sent.length,
  };
}

run().then(
  (result) => {
    writeFileSync(config.result, JSON.stringify({ ok: true, result }));
    app.exit(0);
  },
  (error: unknown) => {
    writeFileSync(
      config.result,
      JSON.stringify({ ok: false, error: String(error) }),
    );
    app.exit(1);
  },
);
