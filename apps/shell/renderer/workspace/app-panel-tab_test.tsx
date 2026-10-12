import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  one,
  render,
} from "../../../../packages/design/components/testing.ts";

import { AppViewsProvider } from "../app-frame/app-views.tsx";
import {
  APP_A,
  APP_B,
  fakeAppViews,
  frames,
  REL_1,
  withLayout,
} from "../app-frame/testdata/app-views.ts";
import { AppPanelPicker, AppPanelTab } from "./app-panel-tab.tsx";
import type { WorkspaceSource } from "./source.ts";
import { Workspace } from "./workspace.tsx";

const SCREENS = [
  {
    app: APP_A,
    name: "Orders",
    screens: [
      { key: "board", label: "Board", sizes: ["full", "panel"] as const },
      { key: "settings", label: "Settings", sizes: ["full"] as const },
      { key: "today", label: "Today", sizes: ["card"] as const },
    ],
  },
  {
    app: APP_B,
    name: "Calendar",
    screens: [{ key: "month", label: "Month", sizes: ["full"] as const }],
  },
];

function source(layout: unknown): WorkspaceSource {
  return {
    project: () =>
      Promise.resolve({
        ok: true,
        value: { id: "prj_1", title: "lophn", folders: [] },
      }),
    documents: () =>
      Promise.resolve({ ok: true, value: [{ id: "doc_1", title: "notes" }] }),
    files: () => Promise.resolve({ ok: true, value: [] }),
    readLayout: () => Promise.resolve({ ok: true, available: true, layout }),
    saveLayout: () => Promise.resolve({ ok: true }),
  };
}

Deno.test("shell/workspace#R5: 탭 선택에는 panel을 선언한 화면만 나오고 전체 화면만 선언한 앱은 앱 공간으로 열기를 안내한다", async () => {
  const fake = fakeAppViews({ screens: SCREENS });
  const chosen: unknown[] = [];
  const spaces: string[] = [];
  using view = render(
    <AppViewsProvider value={fake.deps}>
      <AppPanelPicker
        onChoose={(choice) => chosen.push(choice)}
        onOpenAppSpace={(app) => spaces.push(app)}
        onClose={() => {}}
      />
    </AppViewsProvider>,
  );
  await frames();
  const root = view.container;
  const items = [...root.querySelectorAll("li button")].map((node) =>
    node.textContent
  );
  // card·full 화면은 탭에 나오지 않는다. 패널이 없는 앱은 줄여 열지 않고 앱 공간 안내다.
  assertEquals(items, ["Orders · Board", "Open in app space"]);
  const only = one(root, `[data-app-space-only='${APP_B}']`);
  assertEquals(
    one(only, "span").textContent,
    "Calendar opens only in the app space.",
  );
  click(one(only, "button"));
  assertEquals(spaces, [APP_B]);
  click(root.querySelector("li button")!);
  assertEquals(chosen, [{ app: APP_A, screen: "board", title: "Orders" }]);
  // 고르기만으로는 view를 열지 않는다.
  assertEquals(fake.opened(), []);
});

Deno.test("shell/workspace#R5: 열 때 panel을 선언하지 않은 화면으로 거절되면 줄여 보이지 않고 앱 공간으로 열기를 안내한다", async () => {
  await withLayout(async () => {
    const fake = fakeAppViews();
    fake.refuseNext("invalid_input");
    const spaces: string[] = [];
    using view = render(
      <AppViewsProvider value={fake.deps}>
        <div data-rect="0 48 800 600">
          <AppPanelTab
            app={APP_A}
            screen="settings"
            shown
            onOpenAppSpace={(app) => spaces.push(app)}
          />
        </div>
      </AppViewsProvider>,
    );
    await frames();
    assertEquals(fake.opened(), [{
      app: APP_A,
      mode: "live",
      release: REL_1,
      screen: "settings",
      size: "panel",
    }]);
    const notice = one(view.container, "[data-app-panel-notice]");
    assertEquals(
      one(notice, "p").textContent,
      "This screen can't open in a tab. Open it in the app space.",
    );
    click(one(notice, "button"));
    assertEquals(spaces, [APP_A]);
    // 거절된 view에는 bounds를 보내지 않는다.
    assertEquals(fake.calls.filter((call) => call[0] === "bounds"), []);
  });
});

Deno.test("shell/app-frame#R33, shell/app-frame#R34: 같은 앱의 두 패널은 각자 live·지금 판·panel로 열고 크롬의 이름·모드·연결 상태와 문제 알리기가 자기 view에 묶인다", async () => {
  await withLayout(async () => {
    const fake = fakeAppViews();
    using view = render(
      <AppViewsProvider value={fake.deps}>
        <div data-rect="0 48 400 600" data-left="">
          <AppPanelTab app={APP_A} screen="board" shown />
        </div>
        <div data-rect="401 48 400 600" data-right="">
          <AppPanelTab app={APP_A} screen="board" shown />
        </div>
      </AppViewsProvider>,
    );
    await frames();
    for (const input of fake.opened()) {
      assertEquals(input, {
        app: APP_A,
        mode: "live",
        release: REL_1,
        screen: "board",
        size: "panel",
      });
    }
    const left = one(view.container, "[data-left] [data-view-chrome]");
    const right = one(view.container, "[data-right] [data-view-chrome]");
    const sessions = [left, right].map((chrome) =>
      chrome.getAttribute("data-view-session")
    );
    assertEquals(sessions.sort(), ["view-1", "view-2"]);
    assertEquals(one(left, "[data-view-app-name]").textContent, "Orders");
    assertEquals(one(left, "[data-view-mode]").textContent, "Live");
    assertEquals(
      one(left, "[data-view-connection]").textContent,
      "Connected",
    );
    // 한쪽이 멈춰도 다른 쪽 크롬은 그대로이고, 버튼은 각자의 view를 가리킨다.
    const leftSession = left.getAttribute("data-view-session")!;
    await act(() =>
      fake.push({
        view_session: leftSession,
        app: APP_A,
        release: REL_1,
        mode: "live",
        screen: "board",
        size: "panel",
        connectionState: "unavailable",
      })
    );
    await frames();
    assertEquals(
      one(left, "[data-view-connection]").textContent,
      "Not connected",
    );
    assertEquals(
      one(right, "[data-view-connection]").textContent,
      "Connected",
    );
    click(one(left, "[data-report-problem]"));
    click(one(right, "[data-report-problem]"));
    assertEquals(fake.reports, [
      leftSession,
      right.getAttribute("data-view-session")!,
    ]);
    // 크롬은 앱 view 자리 밖이다.
    const region = one(view.container, "[data-left] [data-phase]");
    assert(!region.contains(left));
  });
});

Deno.test("shell/app-frame#R21, shell/app-frame#R32: 멈추거나 crash한 패널은 크롬에 상태와 [Open again]을 보이고 누를 때만 그 view를 새로 열며 문제 알리기는 그대로 눌린다", async () => {
  await withLayout(async () => {
    const fake = fakeAppViews();
    using view = render(
      <AppViewsProvider value={fake.deps}>
        <div data-rect="0 48 400 600" data-left="">
          <AppPanelTab app={APP_A} screen="board" shown />
        </div>
        <div data-rect="401 48 400 600" data-right="">
          <AppPanelTab app={APP_A} screen="board" shown />
        </div>
      </AppViewsProvider>,
    );
    await frames();
    const left = one(view.container, "[data-left] [data-view-chrome]");
    const right = one(view.container, "[data-right] [data-view-chrome]");
    const leftSession = left.getAttribute("data-view-session")!;
    // 건강한 view에는 상태 표시도 새로 열기도 없다.
    assertEquals(left.querySelector("[data-view-health]"), null);
    assertEquals(left.querySelector("[data-reopen-view]"), null);
    const state = {
      view_session: leftSession,
      app: APP_A,
      release: REL_1,
      mode: "live" as const,
      screen: "board",
      size: "panel" as const,
      connectionState: "running" as const,
    };
    for (
      const [health, label] of [
        ["unresponsive", "Not responding"],
        ["crashed", "Screen stopped"],
      ] as const
    ) {
      await act(() => fake.push({ ...state, viewHealth: health }));
      await frames();
      assertEquals(one(left, "[data-view-health]").textContent, label);
      // 연결 상태는 따로 그대로 보인다.
      assertEquals(
        one(left, "[data-view-connection]").textContent,
        "Connected",
      );
      assertEquals(right.querySelector("[data-view-health]"), null);
    }
    // 스스로 다시 열지 않는다.
    assertEquals(fake.calls.filter((call) => call[0] === "reopen"), []);
    click(one(left, "[data-reopen-view]"));
    click(one(left, "[data-report-problem]"));
    assertEquals(fake.calls.filter((call) => call[0] === "reopen"), [
      ["reopen", leftSession],
    ]);
    assertEquals(fake.reports, [leftSession]);
    // main이 새 view 상태를 알리면 표시가 걷힌다.
    await act(() => fake.push({ ...state, viewHealth: "ok" }));
    await frames();
    assertEquals(left.querySelector("[data-view-health]"), null);
    assertEquals(left.querySelector("[data-reopen-view]"), null);
  });
});

Deno.test("shell/app-frame#R35, shell/workspace#R5: 작업대에서 연 앱 패널은 다른 탭을 고르면 view를 남긴 채 숨기고 다시 고르면 bounds를 보내며 닫으면 폐기한다", async () => {
  await withLayout(async () => {
    const fake = fakeAppViews({ screens: SCREENS });
    using view = render(
      <AppViewsProvider value={fake.deps}>
        <div data-rect="0 48 1200 700">
          <Workspace
            projectId="prj_1"
            source={source({
              panes: [{
                tabs: [
                  { key: "doc_1", kind: "document_editor", title: "notes" },
                  {
                    key: "panel_a",
                    kind: "app_panel",
                    title: "Orders",
                    app: APP_A,
                    screen: "board",
                  },
                ],
                selected_tab: "panel_a",
              }],
              split_ratio: 0.5,
              focused_pane: 0,
            })}
            windowWidth={1600}
            bodyWidth={1200}
            onLauncher={() => {}}
            onLophn={() => {}}
          />
        </div>
      </AppViewsProvider>,
    );
    await frames();
    const root = view.container;
    assertEquals(fake.opened().map((input) => input.size), ["panel"]);
    assert(fake.calls.some((call) => call[0] === "bounds"));

    // 다른 탭을 고르면 숨기기만 하고 폐기하지 않는다.
    click(one(root, "[data-tab='doc_1']"));
    await frames();
    assert(
      fake.calls.some((call) => call[0] === "hide" && call[1] === "view-1"),
    );
    assertEquals(fake.calls.filter((call) => call[0] === "close"), []);
    assertEquals(fake.opened().length, 1);
    const before = fake.calls.length;
    click(one(root, "[data-tab='panel_a']"));
    await frames();
    assert(
      fake.calls.slice(before).some((call) =>
        call[0] === "bounds" && call[1] === "view-1"
      ),
    );
    assertEquals(fake.opened().length, 1);

    // 앱 패널 열기는 앱을 고르는 탭으로 시작하고, 고르면 panel로 연다.
    click(one(root, "[data-open-app-panel]"));
    await frames();
    const picker = one(root, "[data-app-panel-picker]");
    click(picker.querySelector("li button")!);
    await frames();
    assertEquals(fake.opened().length, 2);
    assertEquals(fake.opened()[1]!.screen, "board");

    // 닫으면 그 view를 폐기한다.
    click(one(root, "[data-tab='panel_a'] [data-close]"));
    await frames();
    assertEquals(
      fake.calls.filter((call) => call[0] === "close"),
      [["close", "view-1"]],
    );
  });
});
