// 조립만 한다. 창·single instance·scheme 규칙은 각 모듈에 있고, 영역마다 `wiring/`의
// 한 file이 자기 값을 등록한다. 순서는 core 연결 → browser 탭 → artifact 탭 → 앱 view → 나머지, 창 열기는 맨 끝이다.
import { app } from "electron";

import * as appearance from "./wiring/appearance.ts";
import * as annotate from "./wiring/annotate.ts";
import * as appCalls from "./wiring/app-calls.ts";
import * as appViews from "./wiring/app-views.ts";
import * as artifact from "./wiring/artifact.ts";
import * as bookmarks from "./wiring/bookmarks.ts";
import * as browser from "./wiring/browser.ts";
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
add(appCalls.register(ctx, views));
add(annotate.register(ctx, views, artifacts));
add(secretInput.register(ctx));
add(appearance.register(ctx));
const terminals = add(coding.register(ctx));
add(bookmarks.register(ctx));
add(
  extensions.register(ctx, { open: () => {}, showExtensionSettings: () => {} }),
);
add(editor.register(ctx));
const detachedWindows = add(detached.register(ctx, views));
add(layout.register(ctx, detachedWindows));
add(desktop.register(ctx, views, terminals));

// 터미널 host와 core를 멈추는 한 번의 순서. tray Quit·`--quit`·OS 종료가 같이 쓴다.
// OS 종료(logout, macOS Cmd+Q)도 같다. 이미 멈췄으면 아무것도 안 한다.
app.once("will-quit", () => ctx.stopAll());
