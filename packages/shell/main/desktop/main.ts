// 조립만 한다. 창·single instance·scheme 규칙은 각 모듈에 있고, 영역마다 `wiring/`의
// 한 file이 자기 값을 등록한다. 순서는 core 연결 → browser 탭 → artifact 탭 → 앱 view → 나머지, 창 열기는 맨 끝이다.
// core만 띄우는 로그인 intent(`--core`)는 이 조립 전에 ensure만 하고 끝난다.
import { app } from "electron";

import * as appearance from "./wiring/appearance.ts";
import * as annotate from "./wiring/annotate.ts";
import * as appCalls from "./wiring/app-calls.ts";
import * as appViews from "./wiring/app-views.ts";
import * as artifact from "./wiring/artifact.ts";
import * as bookmarks from "./wiring/bookmarks.ts";
import * as threadBookmarks from "./wiring/thread-bookmarks.ts";
import * as browser from "./wiring/browser.ts";
import * as codingRelay from "./wiring/coding-relay.ts";
import * as coding from "./wiring/coding.ts";
import * as secretInput from "./wiring/secret-input.ts";
import { createShellContext } from "./wiring/context.ts";
import * as core from "./wiring/core.ts";
import * as crash from "./wiring/crash.ts";
import * as desktop from "./wiring/desktop.ts";
import * as detached from "./wiring/detached.ts";
import * as editor from "./wiring/editor.ts";
import * as extensions from "./wiring/extensions.ts";
import * as layout from "./wiring/layout.ts";
import * as surface from "./wiring/surface.ts";
import * as terminalView from "./wiring/terminal-view.ts";
import { loginPathOf } from "./core/login-path.ts";
import { openShellCoreControl, productVersionOf } from "./core/supervise.ts";
import { resolveLaunchMode } from "./launch-mode.ts";
import { browserDataPath, resolveDataRoot } from "./paths.ts";
import { acquireSingleInstance } from "./single-instance.ts";

// core·terminal-host·extension이 이 env를 물려받으므로 어느 것보다 먼저 둔다.
const loginPath = loginPathOf(process.platform, process.env);
if (loginPath) process.env.PATH = loginPath;

// 로그인 자동 시작 intent는 창·tray·terminal-host·extension을 조립하지 않는다.
const mode = resolveLaunchMode({
  argv: process.argv,
  // macOS login item은 argv를 넘기지 못해 OS가 알려 준 로그인 시작으로 안다.
  openedAtLogin: openedAtLogin(),
});
if (mode.core) void ensureCoreOnly();
else startDesktop();

/** macOS가 login item으로 띄웠는지. argv를 못 받는 그 경우만 본다. */
function openedAtLogin(): boolean {
  if (process.platform !== "darwin") return false;
  try {
    return app.getLoginItemSettings().wasOpenedAtLogin === true;
  } catch {
    return false;
  }
}

// core만 ensure하고 끝난다. shell 자원은 하나도 만들지 않는다.
async function ensureCoreOnly(): Promise<void> {
  const repoRoot = core.coreRoot();
  const productVersion = productVersionOf(repoRoot);
  if (productVersion === undefined) {
    console.error("[lophn] package.json 판을 읽지 못해 core를 띄우지 않는다");
    app.exit(1);
    return;
  }
  const control = openShellCoreControl({
    launch: { repoRoot, dataRoot: resolveDataRoot() },
    productVersion,
  });
  if (!control.ok) {
    console.error(
      `[lophn] core control 자리를 잡지 못했다: ${control.error.message}`,
    );
    app.exit(1);
    return;
  }
  const ensured = await control.value
    .ensure()
    .catch((error: Error): { ok: false; error: { message: string } } => ({
      ok: false,
      error: { message: error.message },
    }));
  if (!ensured.ok) {
    console.error(`[lophn] core를 띄우지 못했다: ${ensured.error.message}`);
  }
  app.exit(ensured.ok ? 0 : 1);
}

function startDesktop(): void {
  // core를 건드리기 전에 lock부터 잡는다. 곧 끝날 두 번째 process가 core를 띄우거나 갈아 띄우지 않게 한다.
  // lock은 userData 폴더에 걸리고, session이 생기기 전에 userData를 데이터 root 안으로 잡아야 한다.
  const dataRoot = resolveDataRoot();
  app.setPath("userData", browserDataPath(dataRoot));
  if (!acquireSingleInstance(app, dataRoot)) return;

  const ctx = createShellContext();
  const add = <T extends { stop(): void }>(area: T): T => {
    ctx.registered.push(area);
    return area;
  };

  add(crash.register(ctx));
  add(core.register(ctx));
  const browserViews = add(browser.register(ctx));
  const artifacts = add(artifact.register(ctx, browserViews));
  const views = add(appViews.register(ctx, browserViews, artifacts));
  const calls = add(appCalls.register(ctx, views));
  add(annotate.register(ctx, views, artifacts));
  add(appearance.register(ctx));
  const terminals = add(coding.register(ctx, calls.appSessions));
  add(codingRelay.register(ctx, terminals));
  add(terminalView.register(ctx, terminals));
  add(bookmarks.register(ctx));
  add(threadBookmarks.register(ctx));
  const extensionHost = add(
    extensions.register(
      ctx,
      {
        showExtensionSettings: () => ctx.desktop.send("extension-settings"),
      },
      terminals,
    ),
  );
  add(editor.register(ctx));
  const detachedWindows = add(detached.register(ctx, views));
  add(layout.register(ctx, detachedWindows));
  const surfaceHost = add(
    surface.register(
      ctx,
      terminals,
      extensionHost,
      views.appFrame,
      artifacts.views,
      terminals.interrupt,
    ),
  );
  // 보호 입력 창이 agent의 한 번 넣기를 browser driver로 친다. driver는 surface가 만든다.
  add(secretInput.register(ctx, surfaceHost.typeOnce));
  add(desktop.register(ctx, views, terminals));

  // shell 자원과 core 연결을 정리하는 한 번의 순서. Quit·`--quit`·OS 종료가 같이 쓴다.
  // core는 멈추지 않는다(`Stop lophn`만 control stop을 보낸다). 이미 멈췄으면 아무것도 안 한다.
  app.once("will-quit", () => ctx.stopAll());
}
