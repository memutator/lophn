import { assertEquals } from "@std/assert";
import { act } from "react";
import { render, style } from "../../../../design/components/testing.ts";

import { Panes } from "./panes.tsx";
import type { TabItem, WorkspaceView } from "../model.ts";

function tab(key: string, kind: TabItem["kind"] = "document_editor"): TabItem {
  return { key, kind, title: key };
}

function twoPanes(ratio = 0.5, focused = 0): WorkspaceView {
  return {
    panes: [
      { tabs: [tab("doc"), tab("view", "app_panel")], selected: "doc" },
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
  // 저장된 0.6 비율로 다시 나눈다.
  const left = wide.container.querySelector("[data-pane='0']") as HTMLElement;
  assertEquals(left.style.width, `${Math.round(1999 * 0.6)}px`);
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
  const strip = view.container.querySelector("[data-tab-list]") as HTMLElement;
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

function dragEvent(type: string): Event {
  return new Event(type, { bubbles: true, cancelable: true });
}

Deno.test("shell/workspace#R3: drag로 탭을 다른 칸으로 옮긴다", () => {
  const moves: string[] = [];
  using view = renderPanes(twoPanes(), 1600, 1600, {
    onMove: (key, toPane) => moves.push(`${key}->${toPane}`),
  });
  const panes = [
    ...view.container.querySelectorAll("[data-pane]"),
  ] as HTMLElement[];
  const source = panes[0]!.querySelector("[data-tab='view']") as HTMLElement;
  act(() => {
    source.dispatchEvent(dragEvent("dragstart"));
  });
  act(() => {
    panes[1]!.dispatchEvent(dragEvent("dragover"));
  });
  assertEquals(panes[1]!.querySelector("[data-drop]") !== null, true);
  act(() => {
    panes[1]!.dispatchEvent(dragEvent("drop"));
  });
  assertEquals(moves, ["view->1"]);
  assertEquals(view.container.querySelector("[data-drop]"), null);
});

Deno.test("shell/workspace#R3: 한 칸에서 탭을 오른쪽 자리로 끌면 칸을 나눈다", () => {
  const moves: string[] = [];
  const one: WorkspaceView = {
    panes: [{ tabs: [tab("doc"), tab("view")], selected: "doc" }],
    splitRatio: 0.5,
    focusedPane: 0,
  };
  using view = renderPanes(one, 1600, 1600, {
    onMove: (key, toPane) => moves.push(`${key}->${toPane}`),
  });
  assertEquals(view.container.querySelector("[data-side-drop]"), null);
  const source = view.container.querySelector(
    "[data-tab='view']",
  ) as HTMLElement;
  act(() => source.dispatchEvent(dragEvent("dragstart")));
  const side = view.container.querySelector("[data-side-drop]") as HTMLElement;
  act(() => side.dispatchEvent(dragEvent("dragover")));
  act(() => side.dispatchEvent(dragEvent("drop")));
  assertEquals(moves, ["view->1"]);
});

Deno.test("shell/workspace#R3: 칸 나누기는 글자 없는 Lucide 아이콘 버튼이다", () => {
  const moves: string[] = [];
  const one: WorkspaceView = {
    panes: [{ tabs: [tab("doc"), tab("view")], selected: "view" }],
    splitRatio: 0.5,
    focusedPane: 0,
  };
  using view = renderPanes(one, 1600, 1600, {
    onMove: (key, toPane) => moves.push(`${key}->${toPane}`),
  });
  const split = view.container.querySelector(
    "[data-split-pane]",
  ) as HTMLElement;
  assertEquals(split.textContent, "");
  assertEquals(split.getAttribute("aria-label"), "Open in side pane");
  assertEquals(split.querySelector("svg")?.getAttribute("stroke-width"), "1.5");
  act(() => split.click());
  assertEquals(moves, ["view->1"]);
});

function pointer(type: string, clientX: number): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    button: 0,
  });
}

Deno.test("shell/editor#R5: 경계 drag는 drag-end에서만 비율을 저장하고 drag-cancel은 되돌린다", () => {
  const ratios: number[] = [];
  using view = renderPanes(twoPanes(), 1601, 1601, {
    onRatio: (ratio) => ratios.push(ratio),
  });
  const divider = () =>
    view.container.querySelector("[data-divider]") as HTMLElement;
  const leftWidth = () =>
    (view.container.querySelector("[data-pane='0']") as HTMLElement).style
      .width;
  act(() => {
    divider().dispatchEvent(pointer("pointerdown", 800));
    view.container.ownerDocument.dispatchEvent(pointer("pointermove", 900));
  });
  // drag 중에는 미리보기만 바뀌고 저장하지 않는다.
  assertEquals(leftWidth(), "900px");
  assertEquals(ratios, []);
  act(() => {
    view.container.ownerDocument.dispatchEvent(pointer("pointercancel", 900));
  });
  assertEquals(leftWidth(), "800px");
  assertEquals(ratios, []);
  act(() => {
    divider().dispatchEvent(pointer("pointerdown", 800));
    view.container.ownerDocument.dispatchEvent(pointer("pointermove", 2000));
    view.container.ownerDocument.dispatchEvent(pointer("pointerup", 2000));
  });
  // 각 칸 480px를 지킨다.
  assertEquals(ratios, [1120 / 1600]);
});
