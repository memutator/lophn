// e2e/shell/broken-app_test.ts가 build해 띄우는 Electron main. 실제 shell과 같은 app-frame 조립
// (scheme, electron 앱 view adapter, registry)에 앱 view 셋을 연다: 깨질 앱 view, 같은 앱의 숨긴
// 다른 탭, 옆 칸의 다른 앱. core 앱 통로만 가짜이고 앱 화면은 테스트가 Unix socket에 띄운 가짜
// 앱이 내준다. 창은 화면에 띄우지 않는다(show:false·offscreen). 창 본문 자체는 shell 크롬 자리로
// 버튼 하나를 그린 작은 page다.
// 각 부하(무한 loop, 큰 렌더링, crash, 화면 첫 렌더 오류) 동안 shell 크롬 누르기, 다른 탭으로
// 바꾸기, 다른 앱 누르기의 첫 반응 ms를 재고, 깨진 view의 상태 알림과 새 view 열기를 적는다.
import { app, BrowserWindow, protocol, WebContentsView } from "electron";
import { writeFileSync } from "node:fs";

import { registerViewSchemes } from "../../desktop/security.ts";
import { TOP_BAR_HEIGHT } from "../../desktop/window.ts";
import { nodeUpstream } from "../app-protocol.ts";
import { createViewDiagnostics } from "../diagnostics.ts";
import { electronAppViews } from "../electron-app-frame.ts";
import { type AppFrameViewState, createAppFrame } from "../registry.ts";

interface ProbeConfig {
  userData: string;
  result: string;
  preload: string;
  apps: { broken: string; other: string };
  release: string;
  socket: string;
  /** 부하 하나에서 조작 하나를 몇 번 재는가. */
  samples: number;
}

const config = JSON.parse(
  process.env.LOPHN_BROKEN_APP ?? "{}",
) as ProbeConfig;

registerViewSchemes(protocol);
app.setPath("userData", config.userData);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(
  what: string,
  check: () => boolean | Promise<boolean>,
  ms = 15_000,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
    await wait(20);
  }
}

// 이만큼 안에 답이 없으면 그 조작은 멈춘 것으로 적는다(표본 ms는 이 값이다).
const STUCK_MS = 2_000;

async function timed(operate: () => Promise<unknown>): Promise<number> {
  const started = performance.now();
  const answered = await Promise.race([
    operate().then(() => true, () => true),
    wait(STUCK_MS).then(() => false),
  ]);
  return answered ? performance.now() - started : STUCK_MS;
}

const SHELL_PAGE = "data:text/html;charset=utf-8," + encodeURIComponent(
  "<!doctype html><html><body style='margin:0;background:#20242a;color:#fff'>" +
    "<button id='chrome' onclick='this.dataset.n=(+this.dataset.n||0)+1'>" +
    "Report a problem</button></body></html>",
);

const HALF = { width: 600, height: 760 - TOP_BAR_HEIGHT };
const LEFT = { x: 0, y: TOP_BAR_HEIGHT, ...HALF };
const RIGHT = { x: 600, y: TOP_BAR_HEIGHT, ...HALF };

type Load = "loop" | "large" | "crash" | "render-error";

async function run(): Promise<unknown> {
  await app.whenReady();
  const window = new BrowserWindow({
    show: false,
    width: 1200,
    height: 760,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  await window.loadURL(SHELL_PAGE);

  const adapter = electronAppViews({
    windowOf: (ref) => ref === "window-1" ? window : undefined,
    preload: config.preload,
    packaged: false,
    headless: { headless: true },
    raise: () => {},
  });
  const states: AppFrameViewState[] = [];
  let connects = 0;
  let serial = 0;
  const frame = createAppFrame({
    connector: {
      connect(target) {
        connects += 1;
        return Promise.resolve({
          ok: true,
          value: {
            endpoint: config.socket,
            authorization: `probe ${target.app}`,
            release: target.release,
            bundleHash: "0".repeat(64),
            processNonce: "probe",
            expiresAtMs: null,
          },
        });
      },
      hosts: () => Promise.resolve({ ok: true, value: [] }),
    },
    views: adapter.views,
    sessionHandle: adapter.sessionHandle,
    upstream: nodeUpstream,
    platformPorts: () => [],
    diagnostics: createViewDiagnostics({
      send: () => true,
      log: () => {},
      clock: { nowIso: () => new Date().toISOString() },
    }),
    ids: {
      viewSession: () => `view-${++serial}`,
      token: () => `token-${Math.random().toString(36).slice(2)}`,
    },
    clock: { nowMs: () => Date.now() },
    onState: (_window, state) => states.push(state),
  });

  const appViews = (): WebContentsView[] =>
    window.contentView.children.filter((child) =>
      child instanceof WebContentsView
    ) as WebContentsView[];

  async function open(appId: string, screen: string, bounds = LEFT) {
    const opened = await frame.open({
      app: appId,
      mode: "live",
      release: config.release,
      screen,
      size: "full",
      parentWindow: "window-1",
      bounds,
    });
    if (!opened.ok) throw new Error(`open failed: ${opened.error.message}`);
    return opened.value.view_session;
  }

  // 지금 창에 붙은 view 중 이 view_session의 것. 붙을 때까지 기다린다.
  async function attached(before: Set<WebContentsView>) {
    let view: WebContentsView | undefined;
    await until("view attaches", () => {
      view = appViews().find((item) => !before.has(item));
      return view !== undefined;
    });
    await until("view loads", () => !view!.webContents.isLoading());
    return view!;
  }

  // 다른 앱은 옆 칸에 늘 붙어 있다.
  const otherAppSession = await open(config.apps.other, "main", RIGHT);
  const otherApp = await attached(new Set());

  const health = (view_session: string) =>
    frame.state(view_session)?.viewHealth;
  // 닫힌 view는 webContents가 없어질 수 있다.
  const gone = (view: WebContentsView) =>
    !view.webContents || view.webContents.isDestroyed();
  const pid = (view: WebContentsView) =>
    gone(view) ? -1 : view.webContents.getOSProcessId();

  async function scenario(load: Load) {
    // 같은 앱의 다른 탭을 먼저 열고 숨긴다. 그 다음 깨질 view를 같은 칸에 연다.
    const tabSession = await open(config.apps.broken, "main");
    const tab = await attached(new Set([otherApp]));
    frame.hide(tabSession);
    await until("tab hides", () => !appViews().includes(tab));
    const screen = load === "crash" ? "main" : load;
    const brokenSession = await open(config.apps.broken, screen);
    const broken = await attached(new Set([otherApp]));
    const brokenPid = pid(broken);
    const statesBefore = states.length;
    const connectsBefore = connects;

    // 부하를 건다.
    if (load === "crash") {
      broken.webContents.forcefullyCrashRenderer();
      await until("view crashes", () => health(brokenSession) === "crashed");
    } else if (load === "loop") {
      // 멈춤 감지는 입력이 기다릴 때 생긴다. 사람이 누르듯 입력을 보낸다.
      await wait(600);
      const poke = setInterval(() => {
        if (gone(broken)) return;
        broken.webContents.sendInputEvent({
          type: "mouseDown",
          x: 20,
          y: 20,
          button: "left",
          clickCount: 1,
        });
        broken.webContents.sendInputEvent({
          type: "mouseUp",
          x: 20,
          y: 20,
          button: "left",
          clickCount: 1,
        });
      }, 250);
      try {
        await until(
          "view becomes unresponsive",
          () => health(brokenSession) === "unresponsive",
          60_000,
        );
      } finally {
        clearInterval(poke);
      }
    } else {
      await wait(300);
    }

    // 부하가 걸린 동안 shell 크롬·다른 탭·다른 앱을 조작한다.
    const shellChrome: number[] = [];
    const otherTab: number[] = [];
    const otherAppMs: number[] = [];
    for (let i = 0; i < config.samples; i += 1) {
      shellChrome.push(
        await timed(() =>
          window.webContents.executeJavaScript(
            "document.getElementById('chrome').click(); " +
              "document.getElementById('chrome').dataset.n",
          )
        ),
      );
      otherAppMs.push(
        await timed(() =>
          otherApp.webContents.executeJavaScript(
            "document.body.dataset.n = String((+document.body.dataset.n || 0) + 1)",
          )
        ),
      );
      // 탭 바꾸기: 깨진 view를 숨기고 다른 탭을 같은 칸에 붙인다. 붙었을 때가 첫 반응이다.
      otherTab.push(
        await timed(async () => {
          frame.hide(brokenSession);
          frame.setBounds(tabSession, LEFT);
          await until("tab shows", () => appViews().includes(tab), STUCK_MS);
        }),
      );
      frame.hide(tabSession);
      frame.setBounds(brokenSession, LEFT);
      await until("broken shows", () => appViews().includes(broken), STUCK_MS)
        .catch(() => {});
      await wait(20);
    }

    // 자동으로 다시 load하거나 연결을 다시 얻지 않는다.
    await wait(1_500);
    const pushed = states.slice(statesBefore)
      .filter((state) => state.view_session === brokenSession)
      .map((state) => state.viewHealth);
    const before = {
      health: health(brokenSession),
      connection: frame.state(brokenSession)?.connectionState,
      connects: connects - connectsBefore,
      sameContents: appViews().includes(broken) &&
        !gone(broken),
    };

    // 사람이 [Open again]을 누른 것처럼 새 view를 지금 연결로 연다.
    const reopened = frame.reopen(brokenSession);
    let after: Record<string, unknown> = { ok: reopened.ok };
    if (reopened.ok) {
      const fresh = await attached(new Set([otherApp, tab]));
      after = {
        ok: true,
        health: health(brokenSession),
        connects: connects - connectsBefore,
        newContents: fresh !== broken,
        oldDestroyed: gone(broken),
        answers: await timed(() => fresh.webContents.executeJavaScript("1")),
      };
    }
    const result = {
      load,
      shellChrome,
      otherTab,
      otherApp: otherAppMs,
      pushed,
      before,
      after,
      // 같은 앱의 다른 탭이 깨진 view와 같은 renderer process인가. WebContents가 따로여도
      // 같은 process일 수 있어 자원 격리를 이것만으로 약속하지 않는다.
      tabSharesProcess: pid(tab) === brokenPid,
      otherAppSharesProcess: pid(otherApp) === brokenPid,
      healthyAfter: health(otherAppSession),
    };
    frame.close(brokenSession);
    frame.close(tabSession);
    await until(
      `${load} views close`,
      () => appViews().length === 1,
      STUCK_MS * 2,
    ).catch(() => {});
    return result;
  }

  const results = [];
  // 멈춘 renderer는 닫혀도 남을 수 있어 무한 loop를 마지막에 둔다.
  for (const load of ["render-error", "large", "crash", "loop"] as const) {
    results.push(await scenario(load));
  }
  return { results, otherAppHealth: health(otherAppSession) };
}

run().then(
  (result) => {
    writeFileSync(config.result, JSON.stringify({ ok: true, result }));
    app.exit(0);
  },
  (error: unknown) => {
    writeFileSync(
      config.result,
      JSON.stringify({
        ok: false,
        error: error instanceof Error
          ? (error.stack ?? String(error))
          : String(error),
      }),
    );
    app.exit(1);
  },
);
