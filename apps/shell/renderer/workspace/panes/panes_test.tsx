import { assertEquals } from "@std/assert";
import { act } from "react";
import {
  render,
  style,
} from "../../../../../packages/design/components/testing.ts";

import { Panes } from "./panes.tsx";
import type { TabItem, WorkspaceView } from "../model.ts";

function tab(key: string, kind: TabItem["kind"] = "document_editor"): TabItem {
  return { key, kind, title: key };
}

function twoPanes(ratio = 0.5, focused = 0): WorkspaceView {
  return {
    panes: [
      { tabs: [tab("doc"), tab("view", "document_viewer")], selected: "doc" },
      { tabs: [tab("term", "terminal")], selected: "term" },
    ],
    splitRatio: ratio,
    focusedPane: focused,
  };
}

const noop = () => {};

function renderPanes(
  view: WorkspaceView,
  bodyWidth: number,
  windowWidth = 1600,
  handlers: Partial<Parameters<typeof Panes>[0]> = {},
) {
  return render(
    <Panes
      view={view}
      bodyWidth={bodyWidth}
      windowWidth={windowWidth}
      onSelect={noop}
      onClose={noop}
      onFocus={noop}
      onMove={noop}
      onRatio={noop}
      {...handlers}
    />,
  );
}

Deno.test("shell/workspace#R3: 두 칸은 각자 탭 순서와 선택을 보이고 focus는 한 곳이다", () => {
  using view = renderPanes(twoPanes(0.5, 1), 1600);
  assertEquals(
    view.container.querySelector("[data-panes]")?.getAttribute("data-panes"),
    "2",
  );
  const panes = [...view.container.querySelectorAll("[data-pane]")];
  assertEquals(panes.length, 2);
  assertEquals(
    panes.map((pane) => pane.getAttribute("data-focused")),
    ["false", "true"],
  );
  const left = panes[0]!.querySelectorAll("[data-tab]");
  assertEquals(
    [...left].map((node) => node.getAttribute("data-tab")),
    ["doc", "view"],
  );
  assertEquals(
    panes[1]!.querySelector("[aria-selected='true']")?.getAttribute("data-tab"),
    "term",
  );
});

Deno.test("shell/workspace#R4: 칸이 480px 아래면 한 칸 보기가 되고 넓어지면 원래 배치로 돌아온다", () => {
  const stored = twoPanes(0.6, 1);
  using narrow = renderPanes(stored, 900);
  assertEquals(
    narrow.container.querySelector("[data-panes]")?.getAttribute("data-panes"),
    "1",
  );
  const shown = narrow.container.querySelector("[data-pane]") as HTMLElement;
  assertEquals(shown.getAttribute("data-pane"), "1");
  // 저장된 비율과 탭 소속은 그대로다.
  assertEquals(stored.splitRatio, 0.6);
  assertEquals(stored.panes[0]!.tabs.map((item) => item.key), ["doc", "view"]);

  using wide = renderPanes(stored, 2000);
  assertEquals(
    wide.container.querySelector("[data-panes]")?.getAttribute("data-panes"),
    "2",
  );
  const widths = [...wide.container.querySelectorAll("[data-pane]")].map((
    pane,
  ) => Number.parseFloat(style(pane as HTMLElement).width));
  assertEquals(widths[0]! > widths[1]!, true);
});

Deno.test("shell/editor#R5: 경계는 1px, 잡는 영역은 8px, 두 번 누르면 50:50이다", () => {
  const ratios: number[] = [];
  using view = renderPanes(twoPanes(), 1600, 1600, {
    onRatio: (ratio) => ratios.push(ratio),
  });
  const divider = view.container.querySelector("[data-divider]") as HTMLElement;
  assertEquals(style(divider).width, "1px");
  const grab = view.container.querySelector("[data-grab]") as HTMLElement;
  assertEquals(style(grab).width, "8px");
  act(() =>
    divider.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
  );
  assertEquals(ratios, [0.5]);
});

Deno.test("shell/desktop#R22: 본문 여백은 1024px 미만에서 16px, 이상에서 32px다", () => {
  using wide = renderPanes(twoPanes(), 1600, 1280);
  const wideBody = wide.container.querySelector(
    "[data-pane-body]",
  ) as HTMLElement;
  assertEquals(style(wideBody).paddingLeft, "32px");
  assertEquals(style(wideBody).paddingTop, "24px");

  using narrow = renderPanes(twoPanes(), 900, 1000);
  const narrowBody = narrow.container.querySelector(
    "[data-pane-body]",
  ) as HTMLElement;
  assertEquals(style(narrowBody).paddingLeft, "16px");
});

Deno.test("shell/workspace#R3: 키보드로 탭을 다른 칸으로 옮긴다", () => {
  const moves: string[] = [];
  using view = renderPanes(twoPanes(), 1600, 1600, {
    onMove: (key, toPane) => moves.push(`${key}->${toPane}`),
  });
  const strip = view.container.querySelector("[data-tab-strip]") as HTMLElement;
  act(() => {
    strip.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  assertEquals(moves, ["doc->1"]);
});
