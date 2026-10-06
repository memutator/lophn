import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  render,
} from "../../../../packages/design/components/testing.ts";

import type {
  AppFrameViewState,
  AppViewOpen,
  LophnShellViewsApi,
} from "../../ipc/app-frame.ts";
import type {
  AppWindowReply,
  LophnAppWindowsApi,
} from "../../ipc/app-window.ts";
import { AppSpace } from "./app-space.tsx";
import { opsPanelPlacement } from "./ops-panel-frame.tsx";
import {
  appRow,
  BUDGET,
  BUDGET_RELEASE,
  fakeApps,
  NOTES,
} from "../desktop/lophn-space/apps/testdata/fake-apps.ts";
import { find, flush } from "../desktop/lophn-space/testdata/dom.ts";
import {
  RequestDrafts,
  RequestsProvider,
} from "../desktop/lophn-space/things-to-confirm/context.tsx";
import {
  approval,
  fakeRequests,
  manualTicks,
  question,
} from "../desktop/lophn-space/things-to-confirm/testdata/fake-source.ts";

const BAR = 48;
const HEIGHT = 552;

// happy-dom은 배치를 하지 않는다. 앱 view 자리는 바 아래 본문 전체, 덮는 운영 패널은 오른쪽
// 720px라고 둔다.
function withLayout<T>(width: number, run: () => Promise<T>): Promise<T> {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    let rect = [0, 0, 0, 0];
    if (this.matches("[data-ops-panel='overlay']")) {
      rect = [width - 720, BAR, 720, HEIGHT];
    } else if (this.closest("[data-phase]")) {
      rect = [0, BAR, width, HEIGHT];
    }
    const [x, y, w, h] = rect as [number, number, number, number];
    return {
      x,
      y,
      left: x,
      top: y,
      width: w,
      height: h,
      right: x + w,
      bottom: y + h,
      toJSON() {},
    } as DOMRect;
  };
  return run().finally(() => {
    HTMLElement.prototype.getBoundingClientRect = original;
  });
}

async function frames(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

function fakeViews() {
  const calls: unknown[][] = [];
  const listeners = new Set<(state: AppFrameViewState) => void>();
  const api: LophnShellViewsApi = {
    openApp(input: AppViewOpen) {
      calls.push(["open", input]);
      return Promise.resolve({
        view_session: "view-1",
        app: input.app,
        release: input.release ?? null,
        mode: input.mode,
        screen: input.screen,
        size: input.size,
        connectionState: "running",
      });
    },
    setViewBounds(input) {
      calls.push(["bounds", input.bounds]);
      return Promise.resolve({ generation: 1 });
    },
    setViewsHidden(input) {
      calls.push(["hide", ...input.view_sessions]);
      return Promise.resolve({ generation: 2 });
    },
    closeView(input) {
      calls.push(["close", input.view_session]);
      return Promise.resolve();
    },
    subscribeViewState(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    api,
    calls,
    push(state: AppFrameViewState) {
      for (const listener of listeners) listener(state);
    },
  };
}

function fakeWindows(replies: Partial<Record<string, AppWindowReply>> = {}) {
  const calls: unknown[][] = [];
  const reply = (name: string) =>
    Promise.resolve(replies[name] ?? { ok: true } as AppWindowReply);
  const api: LophnAppWindowsApi = {
    openWindow(input) {
      calls.push(["window", input]);
      return reply("window");
    },
    addShortcut(input) {
      calls.push(["add", input]);
      return reply("add");
    },
    removeShortcut(input) {
      calls.push(["remove", input]);
      return reply("remove");
    },
  };
  return { api, calls };
}

const budget = appRow(BUDGET, "Grocery budget", { release: BUDGET_RELEASE });

function space(
  props: {
    views?: LophnShellViewsApi;
    windows?: LophnAppWindowsApi;
    source: ReturnType<typeof fakeApps>["source"];
    width?: number;
    onLauncher?: () => void;
    onDocuments?: () => void;
  },
) {
  return (
    <AppSpace
      app={BUDGET}
      source={props.source}
      views={props.views}
      windows={props.windows}
      windowWidth={props.width ?? 1280}
      onLauncher={props.onLauncher ?? (() => {})}
      onDocuments={props.onDocuments ?? (() => {})}
      onThingsToConfirm={() => {}}
    />
  );
}

Deno.test("shell/app-frame#R26: 앱 공간은 얇은 바와 앱 view 전체 본문이고 바에 런처 복귀·이름·연결 상태·[Report a problem] 자리·운영 패널·문서 작업대·새 창이 있다", async () => {
  await withLayout(1280, async () => {
    const views = fakeViews();
    const windows = fakeWindows();
    const apps = fakeApps({
      rows: [budget],
      runs: { [BUDGET]: "stopped" },
      screen: "home",
    });
    let launcher = 0;
    let documents = 0;
    using view = render(space({
      source: apps.source,
      views: views.api,
      windows: windows.api,
      onLauncher: () => launcher++,
      onDocuments: () => documents++,
    }));
    await frames();
    // 본문 전체에 그 앱의 지금 version을 full 크기로 연다.
    assertEquals(views.calls[0], ["open", {
      app: BUDGET,
      mode: "live",
      release: BUDGET_RELEASE,
      screen: "home",
      size: "full",
    }]);
    assertEquals(views.calls.find((call) => call[0] === "bounds"), [
      "bounds",
      { x: 0, y: BAR, width: 1280, height: HEIGHT },
    ]);
    const bar = find(view.container, "header");
    assertEquals(
      find(bar, "[data-app-name]").textContent,
      "Grocery budget",
    );
    // 연결 상태는 view가 알린 것을 쓴다.
    assertEquals(
      find(bar, "[data-app-status]").getAttribute("data-app-status"),
      "running",
    );
    assertEquals(find(bar, "[data-app-status]").textContent, "Running");
    assert(bar.querySelector("[data-report-slot]"));
    assert(bar.querySelector("[data-launcher-back]"));
    // 바에는 원시 enum·ID가 보이지 않는다(shell/wording#R4).
    for (const raw of ["app_", "rel_", "running", "stopped", "home"]) {
      assert(!(bar.textContent ?? "").includes(raw), raw);
    }
    click(find(bar, "[data-launcher-back]"));
    click(find(bar, "[data-app-bar='documents']"));
    assertEquals([launcher, documents], [1, 1]);
    // 연결 상태가 바뀌면 바도 바뀐다.
    act(() =>
      views.push({
        view_session: "view-1",
        app: BUDGET,
        release: BUDGET_RELEASE,
        mode: "live",
        screen: "home",
        size: "full",
        connectionState: "unavailable",
      })
    );
    assertEquals(find(bar, "[data-app-status]").textContent, "Not responding");
  });
});

Deno.test("shell/app-frame#R26: 운영 패널은 720px이고 1024px 이상이면 옆 열, 미만이면 덮되 앱 view는 덮이지 않는 영역으로 줄고 닫으면 원래 bounds로 돌아온다", async () => {
  assertEquals(opsPanelPlacement(false, 1280), "hidden");
  assertEquals(opsPanelPlacement(true, 1024), "docked");
  assertEquals(opsPanelPlacement(true, 1023), "overlay");

  await withLayout(1280, async () => {
    const views = fakeViews();
    const apps = fakeApps({ rows: [budget], screen: "home" });
    using view = render(space({ source: apps.source, views: views.api }));
    await frames();
    click(find(view.container, "[data-app-bar='app-details']"));
    await frames();
    const panel = find(view.container, "[data-ops-panel]");
    assertEquals(panel.getAttribute("data-ops-panel"), "docked");
    assertEquals(panel.getAttribute("style"), "width: 720px;");
  });

  await withLayout(960, async () => {
    const views = fakeViews();
    const apps = fakeApps({ rows: [budget], screen: "home" });
    using view = render(
      space({ source: apps.source, views: views.api, width: 960 }),
    );
    await frames();
    click(find(view.container, "[data-app-bar='app-details']"));
    await frames();
    assertEquals(
      find(view.container, "[data-ops-panel]").getAttribute("data-ops-panel"),
      "overlay",
    );
    click(find(view.container, "[data-ops-panel-close]"));
    await frames();
    assertEquals(view.container.querySelector("[data-ops-panel]"), null);
    // 앱 view는 숨기지 않고 패널 밖 240px로 줄었다가 닫으면 본문 전체로 돌아온다.
    assertEquals(
      views.calls.filter((call) => call[0] !== "open"),
      [
        ["bounds", { x: 0, y: BAR, width: 960, height: HEIGHT }],
        ["bounds", { x: 0, y: BAR, width: 240, height: HEIGHT }],
        ["bounds", { x: 0, y: BAR, width: 960, height: HEIGHT }],
      ],
    );
  });
});

Deno.test("shell/desktop#R27: 앱 공간의 lophn 크롬은 그 앱의 결정 대기와 lophn 장애 안내만 두고 전역 관리 진입점이 없다", async () => {
  const requests = fakeRequests({
    requests: [
      approval(1, { place: { kind: "app", id: BUDGET } }),
      question(2, { place: { kind: "app", id: NOTES } }),
      question(3, { place: { kind: "global" } }),
    ],
  });
  const apps = fakeApps({ rows: [budget], screen: "home" });
  using view = render(
    <RequestsProvider
      deps={{
        source: requests.source,
        drafts: new RequestDrafts(),
        ticks: manualTicks().ticks,
        now: () => 0,
      }}
    >
      {space({ source: apps.source, views: fakeViews().api })}
    </RequestsProvider>,
  );
  await flush();
  const bar = find(view.container, "header");
  assertEquals(
    find(bar, "[data-space-decisions]").textContent,
    "1 decision waiting",
  );
  assertEquals(bar.querySelector("[data-entry='lophn']"), null);
  act(() => requests.push({ state: "failed", confirmedAt: 1 }));
  await flush();
  assert(bar.querySelector("[data-core-down]"));
});

Deno.test("shell/desktop#R13, shell/desktop#R14: 바의 새 창과 운영 패널의 앱 메뉴 추가·삭제는 그 앱 ID만 보내고 결과를 사람 말로 알린다", async () => {
  const windows = fakeWindows({
    window: { ok: false, code: "unavailable" },
    remove: { ok: false, code: "not_installed" },
  });
  const apps = fakeApps({ rows: [budget], screen: "home" });
  using view = render(
    space({
      source: apps.source,
      views: fakeViews().api,
      windows: windows.api,
    }),
  );
  await flush();
  click(find(view.container, "[data-app-bar='new-window']"));
  await flush();
  assertEquals(
    find(view.container, "[data-window-failed]").textContent,
    "The app didn't open in a new window. Try again.",
  );
  click(find(view.container, "[data-app-bar='app-details']"));
  await flush();
  click(find(view.container, "[data-shortcut='add']"));
  await flush();
  assertEquals(
    find(view.container, "[data-shortcut-result]").textContent,
    "Added to your computer's app menu.",
  );
  click(find(view.container, "[data-shortcut='remove']"));
  await flush();
  assertEquals(
    find(view.container, "[data-shortcut-result]").textContent,
    "Only the installed lophn app can change your computer's app menu.",
  );
  assertEquals(windows.calls, [
    ["window", { app: BUDGET }],
    ["add", { app: BUDGET }],
    ["remove", { app: BUDGET }],
  ]);
});

Deno.test("shell/wording#R4: 앱 공간 본문은 열 화면이 없거나 보관됐거나 version이 없으면 view를 열지 않고 그 영향을 한 문장으로 보인다", async () => {
  const cases = [
    [fakeApps({ rows: [budget] }), "This app's screen can't open here yet."],
    [
      fakeApps({
        rows: [{ ...budget, archived: true }],
        screen: "home",
      }),
      "This app is archived. Restore it in Apps to open it again.",
    ],
    [
      fakeApps({ rows: [appRow(BUDGET, "Grocery budget")], screen: "home" }),
      "This app has nothing to show yet.",
    ],
    [fakeApps({ rows: [], screen: "home" }), "This app isn't here anymore."],
  ] as const;
  for (const [apps, text] of cases) {
    const views = fakeViews();
    using view = render(space({ source: apps.source, views: views.api }));
    await flush();
    assertEquals(views.calls, []);
    const body = find(view.container, "[data-space='app']");
    assert((body.textContent ?? "").includes(text), text);
    assert(!(body.textContent ?? "").includes("app_"));
  }
});
