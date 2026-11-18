// 창 없는 page host. display가 없는 Linux에서 core가 같은 Electron binary를 `--page-host`로 띄운 것이다(shell-launcher.ts).
// desktop 앱처럼 core의 `/host-link`에 host로 붙어 browser 탭 열기·닫기, `browser_call`, `page_*`에 답한다. 창, tray, renderer,
// terminal host, extension, 전역 단축키는 없다. 탭마다 offscreen page 하나를 들고 desktop 앱과 같은 driver, stream, browser profile을 쓴다.
import { app } from "electron";

import type { HostToolOutput } from "../../../protocol/lophn-agent/host-queue.ts";
import { createTabControl } from "../browser/agent/control.ts";
import { createBrowserDriver } from "../browser/agent/driver.ts";
import { createPageStream } from "../browser/agent/stream.ts";
import { electronBrowserSession } from "../browser/electron-session.ts";
import { installBrowserSession } from "../browser/session.ts";
import { createHostLink } from "../desktop/core/host-link.ts";
import { nodeSockets } from "../desktop/core/node-io.ts";
import { PAGE_HOST_INTENT } from "../desktop/launch-mode.ts";
import { readOpenIntent } from "../desktop/open-intent.ts";
import { browserDataPath, resolveDataRoot } from "../desktop/paths.ts";
import { acquireSingleInstance } from "../desktop/single-instance.ts";
import { connectCore } from "../desktop/wiring/core.ts";
import { createPageHostPages } from "./pages.ts";

// host link가 이만큼 닫혀 있으면 core가 없는 것으로 보고 끝난다.
const LINK_GONE_MS = 60_000;
const LINK_CHECK_MS = 5_000;
// browser 탭 열기의 답이다. desktop 앱이 page가 붙었을 때(bind) 주는 것과 같다.
const OPENED: HostToolOutput = { content: [{ type: "text", text: "opened" }] };
const NOT_HERE: HostToolOutput = {
  error: {
    code: "unavailable",
    message:
      "This computer has no display, so lophn can only open browser pages here. Retrying does not help; tell the person.",
  },
};

export function startPageHost(): void {
  // 같은 userData의 lock이라 desktop 앱과 page host는 한 기계에서 같이 돌지 않는다(나중에 뜬 쪽이 끝난다).
  const dataRoot = resolveDataRoot();
  app.setPath("userData", browserDataPath(dataRoot));
  if (!acquireSingleInstance(app, dataRoot)) return;
  // core가 다시 띄우려는 page host와 core만 띄우는 시작은 그대로 둔다. `--quit`이면 끝난다. 그 밖(사람이 앱을 누름)은
  // 물러나며 그 시작을 그 env로 다시 띄워 한 번 누름으로 desktop 앱이 선다. page host의 env에는 display가 없어 desktop 앱이
  // 뜨지 못하므로 두 번째 시작이 보낸 env(desktop/main.ts)를 덮는다. 그 env에도 display가 없으면 desktop 앱이 설 수 없어 남는다.
  let leaving = false;
  app.on("second-instance", (_event, argv, workingDirectory, additional) => {
    if (leaving || argv.includes(PAGE_HOST_INTENT)) return;
    const intent = readOpenIntent(argv).kind;
    if (intent === "core") return;
    if (intent !== "quit") {
      const env = (additional as { env?: NodeJS.ProcessEnv } | null)?.env;
      if (!env?.DISPLAY && !env?.WAYLAND_DISPLAY) return;
      Object.assign(process.env, env);
      // 개발의 entry 인자는 그 시작의 자리에서 본 상대 경로일 수 있다. relaunch는 지금 자리를 쓴다.
      process.chdir(workingDirectory);
      app.relaunch({ execPath: argv[0], args: argv.slice(1) });
    }
    leaving = true;
    app.quit();
  });
  // 마지막 page를 닫아도 끝나지 않는다(Electron 기본은 끝난다).
  app.on("window-all-closed", () => {});
  void app.whenReady().then(() => run(dataRoot));
}

function run(dataRoot: string): void {
  const log = (message: string) => console.log(`[lophn page-host] ${message}`);
  const relay = {
    conditions: [],
    ready: [() => link.refresh()],
    events: [],
    calls: [],
  };
  const core = connectCore({
    here: __dirname,
    dataRoot,
    windows: new Set(),
    relay,
    handle: () => {},
  });
  const link = createHostLink({
    target: () => core.hostLinkTarget(),
    sockets: nodeSockets(),
    log,
  });

  // 저장 dialog를 띄울 화면이 없어 download는 모두 거절한다(사용자 입력이 없는 것과 같다).
  installBrowserSession(electronBrowserSession(), {
    activation: { fresh: () => false },
  });

  const pages = createPageHostPages((tab, state) => {
    if (state === "closed") control.forget(tab);
    link.send({ type: "report", tab, state });
  });
  const control = createTabControl((tab, state) =>
    stream.controlChanged(tab, state),
  );
  const stream = createPageStream({
    page: (tab) => pages.page(tab),
    control,
    send: (frame) => link.send(frame),
    nowMs: () => Date.now(),
    schedule: (fire, ms) => {
      const timer = setTimeout(fire, ms);
      return () => clearTimeout(timer);
    },
  });
  control.onForget((tab) => stream.forget(tab));
  // view session은 탭 id 자체다. page host의 page는 모두 browser 탭이다.
  const driver = createBrowserDriver({
    viewSession: (tab) => (pages.page(tab) === undefined ? undefined : tab),
    lookup: {
      guest: (tab) => pages.page(tab),
      app: () => undefined,
      artifact: () => undefined,
    },
    releaseLogin: (request) => core.releaseLogin(request),
    control,
    nowMs: () => Date.now(),
  });

  const done = (id: string) => {
    link.send({ type: "response", id, result: "done" });
    return Promise.resolve(null);
  };
  link.onRequest("tab_open", async (payload) => {
    if (!("browser" in payload.target)) return NOT_HERE;
    await pages.open(payload.tab, payload.target.browser.url);
    return OPENED;
  });
  link.onRequest("tab_close", (payload, request) => {
    pages.close(payload.tab);
    return done(request.id);
  });
  link.onRequest("tab_show", (_payload, request) => done(request.id));
  link.onRequest("browser_call", (payload) => {
    pages.touch(payload.tab);
    return driver.run(payload);
  });
  link.onRequest("page_stream", (payload) => stream.stream(payload));
  link.onRequest("page_read", (payload) => stream.read(payload));
  link.onRequest("page_input", (payload) => stream.input(payload));
  link.onRequest("page_control", (payload) => stream.control(payload));
  link.onOpen(() => stream.reset());

  let seen = Date.now();
  const watch = setInterval(() => {
    if (link.connected()) seen = Date.now();
    else if (Date.now() - seen > LINK_GONE_MS) {
      log("core is gone; quitting");
      app.quit();
    }
  }, LINK_CHECK_MS);

  app.once("will-quit", () => {
    clearInterval(watch);
    stream.reset();
    link.stop();
    core.detach();
  });
}
