// 앱 탭 현재 보기 참조(shell/workspace#R11). 실제 app-frame registry의 view 목록에서 요청 창의
// 앱 패널 참조만 꺼내고, 상세 상태·DOM·screenshot은 담을 자리조차 없다.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { ViewListing } from "../app-frame/view-model.ts";
import { appViewContext } from "./app-view-context.ts";
import { assembleCurrentView, type LayoutHint } from "./current-view.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const APP_B = "app_01h455vb4pex5v6nkc6gd5fdw2";
const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const PRJ = "prj_01h455vb4pex5v6nkc6gd5fdw1";
const AT = "2026-10-06T00:00:00.000Z";

function view(partial: Partial<ViewListing>): ViewListing {
  return {
    view_session: "view-1",
    generation: 1,
    app: APP,
    release: REL,
    mode: "live",
    screen: "board",
    size: "panel",
    card: null,
    ...partial,
  };
}

const VIEWS: Record<string, ViewListing[]> = {
  "win-1": [
    view({ view_session: "view-1", generation: 2 }),
    view({ view_session: "view-2", generation: 5 }),
    // 같은 앱의 전체 view와 세션 카드는 탭이 아니다.
    view({ view_session: "view-3", generation: 9, size: "full" }),
    view({
      view_session: "view-4",
      generation: 9,
      size: "card",
      card: { message: "msg_01h455vb4pex5v6nkc6gd5fdw1", block: "usage" },
    }),
    // 준비 전 bundle의 preview는 참조할 판이 없다.
    view({
      view_session: "view-5",
      app: APP_B,
      mode: "preview",
      release: null,
    }),
  ],
  "win-2": [view({ view_session: "view-6", generation: 30 })],
};

const source = { views: (window: string) => VIEWS[window] ?? [] };

function hint(tab: string): LayoutHint {
  return {
    window_ref: "win-1",
    project: PRJ,
    panes: [{
      tabs: [
        { kind: "app_panel", key: "a1", app: APP, surface: "board" },
        { kind: "app_panel", key: "b1", app: APP_B, surface: "board" },
      ],
      selected: tab,
    }],
    focused_pane: 0,
    app_tab: tab,
  };
}

test("shell/workspace#R11: 앱 탭의 현재 보기는 요청 창 패널 view의 앱·release·mode·screen·generation 참조만이고 DOM·screenshot 자리가 없다", () => {
  const context = appViewContext(source, "win-1");
  // 같은 창의 가장 늦게 바뀐 패널이다. 다른 창(win-2)의 더 새 view를 대신 쓰지 않는다.
  assert.deepEqual(context.appView(APP, "board"), {
    release: REL,
    mode: "live",
    view_generation: 5,
  });
  assert.equal(context.appView(APP, "other"), null);
  assert.equal(context.appView(APP_B, "board"), null);

  const assembled = assembleCurrentView({
    hint: hint("a1"),
    registry: { isLive: (ref) => ref === "win-1", ...context },
    scope: { project: () => true, document: () => true, app: () => true },
    observed_at: AT,
  });
  assert.equal(assembled.ok, true);
  const state = (assembled as Extract<typeof assembled, { ok: true }>).state;
  assert.deepEqual(state.app_view, {
    app: APP,
    release: REL,
    mode: "live",
    surface: "board",
    view_generation: 5,
  });
  const text = JSON.stringify(state);
  for (const field of ["dom", "html", "screenshot", "capture", "text"]) {
    assert.equal(text.includes(`"${field}"`), false, field);
  }

  // 판이 없는 preview 패널은 참조 대신 생략으로 남는다.
  const preview = assembleCurrentView({
    hint: hint("b1"),
    registry: { isLive: () => true, ...context },
    scope: { project: () => true, document: () => true, app: () => true },
    observed_at: AT,
  });
  assert.equal(preview.ok, true);
  const previewState = (preview as Extract<typeof preview, { ok: true }>).state;
  assert.equal(previewState.app_view, null);
  assert.deepEqual(previewState.omissions, [{
    reason: "app_not_live",
    truncated: false,
  }]);
});

test("apps/agent-context#R2 shell/workspace#R11: 앱 패널 탭은 이 창의 그 앱·screen 패널 view의 session만 싣고 다른 창·다른 화면·꾸며낸 session은 싣지 않는다", () => {
  const context = appViewContext(source, "win-1");
  const tabs = (claimed: string, app = APP, surface = "board") => {
    const assembled = assembleCurrentView({
      hint: {
        window_ref: "win-1",
        project: PRJ,
        panes: [{
          tabs: [{
            kind: "app_panel",
            key: "a1",
            app,
            surface,
            view_session: claimed,
          }],
          selected: "a1",
        }],
        focused_pane: 0,
      },
      registry: { isLive: () => true, ...context },
      scope: { project: () => true, document: () => true, app: () => true },
      observed_at: AT,
    });
    assert.equal(assembled.ok, true);
    return (assembled as Extract<typeof assembled, { ok: true }>).state.tabs;
  };
  // 이 창의 패널 view(view-1)다.
  assert.deepEqual(tabs("view-1"), [{
    kind: "app_panel",
    key: "a1",
    app: APP,
    surface: "board",
    view_session: "view-1",
    selected: true,
  }]);
  // 다른 창의 view, 패널이 아닌 전체·카드 view, 꾸며낸 값은 session 없이 탭만 남는다.
  for (const claimed of ["view-6", "view-3", "view-4", "view-forged"]) {
    const [tab] = tabs(claimed);
    assert.equal(tab && "view_session" in tab, false, claimed);
  }
  // 다른 앱·다른 화면의 탭에 이 view의 session을 붙이지 못한다.
  assert.equal("view_session" in tabs("view-1", APP_B)[0]!, false);
  assert.equal("view_session" in tabs("view-1", APP, "other")[0]!, false);
});
