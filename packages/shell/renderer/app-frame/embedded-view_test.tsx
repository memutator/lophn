import { assert, assertEquals } from "@std/assert";
import { act, useRef } from "react";
import { click, one, render } from "../../../design/components/testing.ts";

import type {
  AppFrameViewState,
  AppViewOpen,
  LophnShellViewsApi,
} from "../../ipc/app-frame.ts";
import {
  createViewCovers,
  EmbeddedView,
  useViewCover,
  ViewCoversProvider,
} from "./embedded-view.tsx";

const APP_A = "app_01j9zzzzzzzzzzzzzzzzzzzzzz";
const APP_B = "app_01j9yyyyyyyyyyyyyyyyyyyyyy";
const REL = "rel_01j9zzzzzzzzzzzzzzzzzzzzz1";

// happy-dom은 배치를 하지 않는다. 가장 가까운 data-rect 조상의 사각형을 돌려준다.
function withLayout<T>(run: () => Promise<T>): Promise<T> {
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function () {
    const host = this.closest("[data-rect]");
    const [x, y, width, height] = (host?.getAttribute("data-rect") ?? "0 0 0 0")
      .split(" ").map(Number) as [number, number, number, number];
    return {
      x,
      y,
      left: x,
      top: y,
      width,
      height,
      right: x + width,
      bottom: y + height,
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

function fakeViews(options: { failFirst?: boolean } = {}) {
  const calls: unknown[][] = [];
  let serial = 0;
  let fail = options.failFirst === true;
  const listeners = new Set<(state: AppFrameViewState) => void>();
  const api: LophnShellViewsApi = {
    openApp(input: AppViewOpen) {
      calls.push(["open", input.app]);
      if (fail) {
        fail = false;
        return Promise.reject(new Error("unavailable"));
      }
      return Promise.resolve({
        view_session: `view-${++serial}`,
        app: input.app,
        release: input.release ?? null,
        mode: input.mode,
        screen: input.screen,
        size: input.size,
        connectionState: "running",
      });
    },
    setViewBounds(input) {
      calls.push(["bounds", input.view_session, input.bounds]);
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
    reopenView: () => Promise.reject(new Error("conflict")),
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

function Slot(
  { views, app, shown = true, rect }: {
    views: LophnShellViewsApi;
    app: string;
    shown?: boolean;
    rect: string;
  },
) {
  return (
    <div data-rect={rect}>
      <EmbeddedView
        views={views}
        app={app}
        mode="live"
        release={REL}
        screen="main"
        size="panel"
        label="Reading log"
        shown={shown}
      />
    </div>
  );
}

Deno.test("shell/app-frame#R25, shell/app-frame#R28: 두 칸의 자리가 각자 view를 열고 자기 경계를 보내며 자리 안에 shell 크롬을 그리지 않는다", async () => {
  await withLayout(async () => {
    const views = fakeViews();
    using view = render(
      <>
        <Slot views={views.api} app={APP_A} rect="0 40 640 760" />
        <Slot views={views.api} app={APP_B} rect="640 40 640 760" />
      </>,
    );
    await frames();
    assertEquals(views.calls.filter((call) => call[0] === "open"), [
      ["open", APP_A],
      ["open", APP_B],
    ]);
    assertEquals(views.calls.filter((call) => call[0] === "bounds"), [
      ["bounds", "view-1", { x: 0, y: 40, width: 640, height: 760 }],
      ["bounds", "view-2", { x: 640, y: 40, width: 640, height: 760 }],
    ]);
    for (const region of view.container.querySelectorAll("[data-phase]")) {
      assertEquals(region.getAttribute("data-phase"), "ready");
      assertEquals(region.querySelectorAll("button").length, 0);
    }
  });
});

Deno.test("shell/app-frame#R27, shell/app-frame#R29: 탭 전환은 옛 view 숨김을 새 view 열기보다 먼저 보내고 자리를 없애면 닫는다", async () => {
  await withLayout(async () => {
    const views = fakeViews();
    using view = render(
      <Slot views={views.api} app={APP_A} rect="0 40 640 760" />,
    );
    await frames();
    views.calls.length = 0;
    view.rerender(
      <>
        <Slot views={views.api} app={APP_A} shown={false} rect="0 40 640 760" />
        <Slot views={views.api} app={APP_B} rect="0 40 640 760" />
      </>,
    );
    await frames();
    assertEquals(views.calls.slice(0, 2), [["hide", "view-1"], [
      "open",
      APP_B,
    ]]);
    assertEquals(views.calls.at(-1), ["bounds", "view-2", {
      x: 0,
      y: 40,
      width: 640,
      height: 760,
    }]);
    views.calls.length = 0;
    view.rerender(<Slot views={views.api} app={APP_B} rect="0 40 640 760" />);
    await frames();
    // 남은 자리가 같은 key가 아니면 다시 연다. 사라진 자리의 view는 닫힌다.
    assert(views.calls.some((call) => call[0] === "close"));
  });
});

Deno.test("shell/app-frame#R36: 좁은 창에서 덮는 패널이 열리면 view를 숨기지 않고 남은 폭을 보내고 닫으면 원래 bounds를 보낸다", async () => {
  await withLayout(async () => {
    const views = fakeViews();
    const covers = createViewCovers();
    function Dock({ open }: { open: boolean }) {
      const ref = useRef<HTMLDivElement | null>(null);
      useViewCover(ref, open);
      return <div ref={ref} data-rect="540 40 360 660" />;
    }
    const tree = (open: boolean) => (
      <ViewCoversProvider value={covers}>
        <Slot views={views.api} app={APP_A} rect="0 40 900 660" />
        <Dock open={open} />
      </ViewCoversProvider>
    );
    using view = render(tree(false));
    await frames();
    view.rerender(tree(true));
    await frames();
    view.rerender(tree(false));
    await frames();
    assertEquals(
      views.calls.filter((call) => call[0] !== "open"),
      [
        ["bounds", "view-1", { x: 0, y: 40, width: 900, height: 660 }],
        ["bounds", "view-1", { x: 0, y: 40, width: 540, height: 660 }],
        ["bounds", "view-1", { x: 0, y: 40, width: 900, height: 660 }],
      ],
    );
  });
});

Deno.test("shell/app-frame#R25: 열기에 실패하면 자리에 오류와 다시 열기를 두고, 연결 상태 갱신은 자기 view 것만 받는다", async () => {
  await withLayout(async () => {
    const views = fakeViews({ failFirst: true });
    const seen: string[] = [];
    using view = render(
      <div data-rect="0 40 640 760">
        <EmbeddedView
          views={views.api}
          app={APP_A}
          mode="live"
          release={REL}
          screen="main"
          size="full"
          label="Reading log"
          onState={(state) => seen.push(state.connectionState)}
        />
      </div>,
    );
    await frames();
    const region = one(view.container, "[data-phase]");
    assertEquals(region.getAttribute("data-phase"), "failed");
    assert(region.textContent?.includes("Reading log"));
    click(one(region, "button"));
    await frames();
    assertEquals(region.getAttribute("data-phase"), "ready");
    const base: AppFrameViewState = {
      view_session: "view-1",
      app: APP_A,
      release: REL,
      mode: "live",
      screen: "main",
      size: "full",
      connectionState: "unavailable",
    };
    act(() => {
      views.push(base);
      views.push({
        ...base,
        view_session: "view-9",
        connectionState: "stopped",
      });
    });
    assertEquals(seen, ["running", "unavailable"]);
  });
});
