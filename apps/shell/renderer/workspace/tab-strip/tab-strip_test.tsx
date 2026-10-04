import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  render,
  style,
} from "../../../../../packages/design/components/testing.ts";

import { TabStrip } from "./tab-strip.tsx";
import type { TabItem } from "../model.ts";

function tab(key: string, kind: TabItem["kind"] = "document_editor"): TabItem {
  return { key, kind, title: key };
}

const kinds: TabItem["kind"][] = [
  "document_editor",
  "document_viewer",
  "terminal",
  "app_panel",
];

const noop = () => {};

Deno.test("shell/workspace#R1: 탭 줄은 네 종류를 글자로 구별하고 대상 이름과 닫기를 둔다", () => {
  const tabs = kinds.map((kind) => tab(kind, kind));
  using view = render(
    <TabStrip
      tabs={tabs}
      selected="document_editor"
      focused
      onSelect={noop}
      onClose={noop}
    />,
  );
  const labels = [
    ...view.container.querySelectorAll("[data-kind-label]"),
  ].map((node) => node.textContent);
  assertEquals(labels, [
    "Document editor",
    "Document viewer",
    "Terminal",
    "App panel",
  ]);
  const closes = [...view.container.querySelectorAll("[data-close]")];
  assertEquals(closes.length, 4);
  // 닫기는 글자 없이 아이콘만 보이고 이름은 aria-label에 둔다.
  for (const close of closes) {
    assertEquals(close.textContent, "");
    assertEquals(close.getAttribute("aria-label"), "Close tab");
    assert(close.querySelector("svg"), "close draws a Lucide icon");
  }
  // 종류마다 14px 아이콘을 선 1.5로 그린다.
  const icon = view.container.querySelector("[data-tab] svg") as SVGElement;
  assertEquals(icon.getAttribute("width"), "14");
  assertEquals(icon.getAttribute("stroke-width"), "1.5");
});

Deno.test("shell/editor#R3: 탭 줄은 36px, 탭은 120~220px, 고정 탭은 36px, 닫기는 20px, 좌우 여백 12px·간격 6px다", () => {
  const tabs = [tab("a"), tab("b"), { ...tab("c"), pinned: true }];
  using view = render(
    <TabStrip
      tabs={tabs}
      selected="a"
      focused
      onSelect={noop}
      onClose={noop}
    />,
  );
  const strip = view.container.querySelector("[data-tab-strip]") as HTMLElement;
  assertEquals(style(strip).height, "36px");
  const rendered = [
    ...view.container.querySelectorAll("[data-tab]"),
  ] as HTMLElement[];
  assertEquals(style(rendered[0]!).minWidth, "120px");
  assertEquals(style(rendered[0]!).maxWidth, "220px");
  assertEquals(style(rendered[0]!).paddingLeft, "12px");
  assertEquals(style(rendered[0]!).gap, "6px");
  assertEquals(style(rendered[2]!).width, "36px");
  const close = rendered[0]!.querySelector("[data-close]") as HTMLElement;
  assertEquals(style(close).width, "20px");
  assertEquals(style(close).height, "20px");
});

Deno.test("shell/editor#R3: focus 칸의 활성 탭 위에만 2px 표시를 둔다", () => {
  using focused = render(
    <TabStrip
      tabs={[tab("a"), tab("b")]}
      selected="a"
      focused
      onSelect={noop}
      onClose={noop}
    />,
  );
  using other = render(
    <TabStrip
      tabs={[tab("a"), tab("b")]}
      selected="a"
      focused={false}
      onSelect={noop}
      onClose={noop}
    />,
  );
  const marked = (root: HTMLElement) =>
    [...root.querySelectorAll("[data-tab]")].map((node) =>
      node.className.includes("focusBar")
    );
  assertEquals(marked(focused.container), [true, false]);
  assertEquals(marked(other.container), [false, false]);
});

Deno.test("shell/workspace#R2: 넘치는 탭은 줄 안에서 scroll하고 페이지 가로 scroll은 없다", () => {
  const tabs = Array.from({ length: 20 }, (_, index) => tab(`t${index}`));
  using view = render(
    <TabStrip
      tabs={tabs}
      selected="t19"
      focused
      onSelect={noop}
      onClose={noop}
    />,
  );
  const strip = view.container.querySelector("[data-tab-strip]") as HTMLElement;
  const list = view.container.querySelector("[data-tab-list]") as HTMLElement;
  assertEquals(style(list).overflowX, "auto");
  assertEquals(style(list).minWidth, "0px");
  assertEquals(style(strip).minWidth, "0px");
  // 탭은 줄어들지 않고 줄 안에서 넘친다.
  const first = view.container.querySelector("[data-tab]") as HTMLElement;
  assertEquals(style(first).flexShrink, "0");
  assertEquals(view.container.querySelectorAll("[data-tab]").length, 20);
});

Deno.test("shell/workspace#R3: 키보드로 탭을 다른 칸으로 옮긴다", () => {
  const moved: string[] = [];
  using view = render(
    <TabStrip
      tabs={[tab("a"), tab("b")]}
      selected="a"
      focused
      onSelect={noop}
      onClose={noop}
      onMoveToPane={(key, direction) => moved.push(`${key}:${direction}`)}
    />,
  );
  const list = view.container.querySelector("[data-tab-list]") as HTMLElement;
  act(() => {
    list.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  assertEquals(moved, ["a:right"]);
});

Deno.test("shell/workspace#R1: 탭 선택과 닫기가 그 탭만 가리킨다", () => {
  const selected: string[] = [];
  const closed: string[] = [];
  using view = render(
    <TabStrip
      tabs={[tab("a"), tab("b")]}
      selected="a"
      focused
      onSelect={(key) => selected.push(key)}
      onClose={(key) => closed.push(key)}
    />,
  );
  const tabs = [
    ...view.container.querySelectorAll("[data-tab]"),
  ] as HTMLElement[];
  act(() => tabs[1]!.click());
  click(tabs[0]!.querySelector("[data-close]")!);
  assertEquals(selected, ["b"]);
  assertEquals(closed, ["a"]);
  assert(
    tabs[0]!.getAttribute("aria-selected") === "true",
    "selected tab is marked",
  );
});
