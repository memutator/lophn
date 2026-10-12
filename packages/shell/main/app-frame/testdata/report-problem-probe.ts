// e2e/shell/report-problem_test.ts가 build해 띄우는 Electron main. 실제 shell과 같은 app-frame
// 조립(scheme, electron 앱 view adapter, registry)과 실제 overlay view(설치한 renderer와 shell
// preload)에 [Report a problem] main 쪽(feedback.ts)을 붙인다. core 앱 통로와 problems 접수만
// 가짜이고 앱 화면은 테스트가 Unix socket에 띄운 가짜 앱이 내준다. 창은 화면에 띄우지 않는다
// (show:false·offscreen). 건강한 view, 무한 loop로 멈춘 view, crash한 view에서 버튼을 눌러
// dialog가 열리는지, 캡처하는 동안 앱 view가 창에 붙어 있는지를 적고 dialog를 PNG로 남긴다.
import {
  app,
  BrowserWindow,
  ipcMain,
  type NativeImage,
  protocol,
  type View,
  WebContentsView,
} from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { FeedbackPreview } from "../../../ipc/feedback.ts";
import {
  type CallerContents,
  ContentsRegistry,
  type IpcEvent,
} from "../../desktop/ipc-guard.ts";
import { registerViewSchemes } from "../../desktop/security.ts";
import { createShellHandler } from "../../desktop/shell-protocol.ts";
import { TOP_BAR_HEIGHT } from "../../desktop/window.ts";
import { nodeUpstream } from "../app-protocol.ts";
import { createViewDiagnostics } from "../diagnostics.ts";
import { electronAppViews } from "../electron-app-frame.ts";
import { electronOverlays } from "../electron-overlay.ts";
import {
  createFeedback,
  registerFeedbackIpc,
  type SubmitFeedbackRequest,
} from "../feedback.ts";
import { createAppFrame } from "../registry.ts";

interface ProbeConfig {
  userData: string;
  result: string;
  preload: string;
  shellPreload: string;
  rendererDist: string;
  shots: string;
  app: string;
  release: string;
  socket: string;
}

const config = JSON.parse(
  process.env.LOPHN_REPORT_PROBLEM ?? "{}",
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

// 버튼을 누른 desktop renderer 자리. IPC 검사(sender·frame·URL)는 feedback_test가 따로 보고
// 여기서는 그 검사를 통과한 요청과 같은 모양을 쓴다.
const deskFrame = { url: "lophn-shell://desktop/index.html", parent: null };
const desk: CallerContents = {
  id: -1,
  isDestroyed: () => false,
  mainFrame: deskFrame,
};
const deskEvent: IpcEvent = { sender: desk, senderFrame: deskFrame };

async function run(): Promise<unknown> {
  await app.whenReady();
  const serve = createShellHandler({ distDir: config.rendererDist });
  protocol.handle(
    "lophn-shell",
    (request) =>
      serve(request).then((res) =>
        new Response(res.body ? Buffer.from(res.body) : null, {
          status: res.status,
          headers: res.headers,
        })
      ),
  );
  const window = new BrowserWindow({
    show: false,
    width: 1000,
    height: 760,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const overlays = electronOverlays({ headless: true });
  const overlay = overlays.attach(window, config.shellPreload, false);
  const overlayView = (): WebContentsView | undefined =>
    window.contentView.children.find((child) =>
      child instanceof WebContentsView &&
      child.webContents.getURL().startsWith("lophn-shell://overlay")
    ) as WebContentsView | undefined;
  await until("overlay loads", () => {
    const view = overlayView();
    return view !== undefined && !view.webContents.isLoading();
  });
  const overlayContents = overlayView()!.webContents;
  let overlayPaint: NativeImage | undefined;
  overlayContents.on("paint", (_event, _dirty, image) => {
    overlayPaint = image;
  });
  overlayContents.setFrameRate(30);

  const adapter = electronAppViews({
    windowOf: (ref) => ref === "window-1" ? window : undefined,
    preload: config.preload,
    packaged: false,
    headless: { headless: true },
    raise: (target) => overlays.raise(target),
  });
  let serial = 0;
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
  });

  const previews: FeedbackPreview[] = [];
  const submitted: { input: SubmitFeedbackRequest; png: boolean }[] = [];
  // 버튼 통로(desk)와 overlay 페이지를 함께 아는 표. overlay 페이지는 실제 등록을 쓴다.
  class ProbeRegistry extends ContentsRegistry {
    override find(id: number) {
      return super.find(id) ?? overlays.overlayRegistry().find(id);
    }
  }
  const registry = new ProbeRegistry();
  registry.register({
    contents: desk,
    origin: { scheme: "lophn-shell", host: "desktop", path: "/index.html" },
  });
  const feedback = createFeedback({
    registry,
    windowOfShell: (sender) => sender === desk ? "window-1" : undefined,
    windowOfOverlay: (sender) =>
      overlay.isOverlay(sender) ? "window-1" : undefined,
    view: (view_session) => frame.feedbackView(view_session),
    dialog: () => ({
      open: (draftRef) => overlay.openFeedback(draftRef),
      close: (draftRef) => overlay.closeFeedback(draftRef),
      preview(preview) {
        previews.push(preview);
        overlay.sendFeedback(preview);
      },
      dialogOpen: () => overlay.dialogOpen(),
    }),
    protectedWindow: () => false,
    submit(input, png) {
      submitted.push({ input, png: png !== null });
      return Promise.resolve({
        ok: true,
        value: {
          report: input.report_id,
          problem: "prb_01j9zzzzzzzzzzzzzzzzzzzzzz",
        },
      });
    },
    openIssue: () => {},
    lookup: () => Promise.resolve({ ok: true, value: null }),
    ids: {
      draft: () => `draft-${++serial}`,
      report: () => "rpt_01j9zzzzzzzzzzzzzzzzzzzzzz",
    },
    clock: { nowIso: () => new Date().toISOString() },
    timer: {
      set: (callback, ms) => setTimeout(callback, ms),
      clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
    },
  });
  overlays.onFeedbackEnded((draftRef) => feedback.ended(draftRef));
  registerFeedbackIpc({
    handle: (channel, listener) =>
      ipcMain.handle(
        channel,
        (event, input: unknown) =>
          listener(event as unknown as IpcEvent, input),
      ),
    removeHandler: (channel) => ipcMain.removeHandler(channel),
  }, feedback);

  mkdirSync(config.shots, { recursive: true });
  const appViews = (): View[] =>
    window.contentView.children.filter((child) =>
      child !== overlayView() && child instanceof WebContentsView
    );
  const inOverlay = (script: string) =>
    overlayContents.executeJavaScript(script, true);

  async function shot(name: string): Promise<void> {
    overlayPaint = undefined;
    overlayContents.invalidate();
    await until(`${name} paint`, () => overlayPaint !== undefined, 5_000);
    await wait(300);
    writeFileSync(join(config.shots, `${name}.png`), overlayPaint!.toPNG());
  }

  async function scenario(
    name: string,
    screen: string,
    breakView: (contents: Electron.WebContents) => Promise<void>,
  ) {
    previews.length = 0;
    const opened = await frame.open({
      app: config.app,
      mode: "live",
      release: config.release,
      screen,
      size: "full",
      parentWindow: "window-1",
      bounds: { x: 0, y: TOP_BAR_HEIGHT, width: 1000, height: 712 },
    });
    if (!opened.ok) throw new Error(`open failed: ${opened.error.message}`);
    const session = opened.value.view_session;
    await until(`${name} attaches`, () => appViews().length === 1);
    const view = appViews()[0] as WebContentsView;
    await until(`${name} loads`, () => !view.webContents.isLoading());
    await wait(600);
    await breakView(view.webContents);

    const started = Date.now();
    const begun = feedback.begin(deskEvent, { view_session: session });
    if (!begun.ok) throw new Error(`begin failed: ${begun.error.message}`);
    const dialogAtOpen = overlay.dialogOpen();
    const attachedAtOpen = window.contentView.children.includes(view);
    let attachedDuringCapture = true;
    await until(`${name} capture settles`, () => {
      if (!window.contentView.children.includes(view)) {
        attachedDuringCapture = false;
      }
      return previews.some((preview) => preview.screenshot_block !== "pending");
    }, 5_000);
    const captureMs = Date.now() - started;
    const last = previews.at(-1)!;
    await until(
      `${name} dialog draws`,
      async () =>
        await inOverlay(
          "document.querySelector('[data-feedback=screenshot-reason], [data-feedback=screenshot-preview]') !== null && document.querySelector('[data-feedback=screenshot-reason]')?.dataset.reason !== 'pending'",
        ) === true,
    );
    const drawn = await inOverlay(`(() => {
      const image = document.querySelector('[data-feedback=screenshot-preview]');
      const reason = document.querySelector('[data-feedback=screenshot-reason]');
      return {
        text: document.querySelector('textarea') !== null,
        image: image ? image.getAttribute('src').slice(0, 22) : null,
        reason: reason ? reason.dataset.reason : null,
      };
    })()`) as { text: boolean; image: string | null; reason: string | null };
    await shot(name);
    return {
      session,
      view,
      result: {
        dialogAtOpen,
        attachedAtOpen,
        attachedDuringCapture,
        attachedAfter: window.contentView.children.includes(view),
        captureMs,
        block: last.screenshot_block ?? null,
        hasImage: last.screenshot_png !== null,
        drawn,
      },
    };
  }

  async function click(selector: string): Promise<void> {
    await inOverlay(
      `document.querySelector(${JSON.stringify(selector)}).click()`,
    );
  }

  // 1) 건강한 view: 캡처한 그대로를 미리보기에 보이고, 글을 써서 screenshot과 함께 보낸다.
  const healthy = await scenario("healthy", "main", () => Promise.resolve());
  await inOverlay(`(() => {
    const area = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(area, 'The total on this page is wrong.');
    area.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await click("[data-feedback=screenshot] [role=checkbox]");
  await wait(200);
  await shot("healthy-filled");
  await click("[data-feedback=send]");
  await until(
    "received",
    async () =>
      await inOverlay(
        "document.querySelector('[data-feedback=received]') !== null",
      ) === true,
  );
  await shot("healthy-received");
  await click("[data-feedback=close]");
  await until("healthy closes", () => !overlay.dialogOpen());
  frame.close(healthy.session);
  await until("healthy view closes", () => appViews().length === 0);

  // 2) crash한 view. renderer 프로세스를 OS에서 바로 죽인다.
  const crashed = await scenario("crashed", "main", async (contents) => {
    let gone = false;
    contents.once("render-process-gone", () => {
      gone = true;
    });
    process.kill(contents.getOSProcessId(), "SIGKILL");
    await until("view crashes", () => gone);
  });
  await click("[data-feedback=cancel]");
  await until("crashed cancels", () => !overlay.dialogOpen());
  frame.close(crashed.session);
  await until("crashed view closes", () => appViews().length === 0);

  // 3) 무한 loop로 멈춘 view. 마지막에 둔다(멈춘 renderer는 닫혀도 남을 수 있다).
  const hung = await scenario("hung", "hang", async (contents) => {
    await until(
      "page loops",
      async () =>
        await Promise.race([
          contents.executeJavaScript("1").then(() => false),
          wait(400).then(() => true),
        ]),
    );
  });
  await click("[data-feedback=cancel]");
  await until("hung cancels", () => !overlay.dialogOpen());

  return {
    healthy: healthy.result,
    hung: hung.result,
    crashed: crashed.result,
    submitted,
    drafts: feedback.size,
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
