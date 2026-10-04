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

Deno.test("shell/workspace#R1: 탭 줄은 네 종류를 글자로 구별하고 닫기를 둔다", () => {
  const tabs = kinds.map((kind) => tab(kind, kind));
  using view = render(
    <TabStrip
      tabs={tabs}
      selected="document_editor"
      width={1000}
      scroll={0}
      focused
      onSelect={() => {}}
      onClose={() => {}}
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
  assertEquals(new Set(labels).size, 4);
  assertEquals(view.container.querySelectorAll("[data-close]").length, 4);
});

Deno.test("shell/editor#R3: 탭 줄은 36px, 탭은 120~220px, 고정 탭은 36px, 닫기는 20px다", () => {
  const tabs = [tab("a"), tab("b"), { ...tab("c"), pinned: true }];
  using view = render(
    <TabStrip
      tabs={tabs}
      selected="a"
      width={1000}
      scroll={0}
      focused
      onSelect={() => {}}
      onClose={() => {}}
    />,
  );
  const strip = view.container.querySelector("[data-tab-strip]") as HTMLElement;
  assertEquals(style(strip).height, "36px");
  const rendered = [
    ...view.container.querySelectorAll("[data-tab]"),
  ] as HTMLElement[];
  assertEquals(style(rendered[0]!).width, "220px");
  assertEquals(style(rendered[2]!).width, "36px");
  const close = rendered[0]!.querySelector("[data-close]") as HTMLElement;
  assertEquals(style(close).width, "20px");
  assertEquals(style(close).height, "20px");
});

Deno.test("shell/workspace#R2: 넘치는 탭은 줄 안에서 scroll하고 선택 탭을 드러내며 페이지 가로 scroll은 없다", () => {
  const tabs = Array.from({ length: 20 }, (_, index) => tab(`t${index}`));
  using view = render(
    <TabStrip
      tabs={tabs}
      selected="t19"
      width={400}
      scroll={0}
      focused
      onSelect={() => {}}
      onClose={() => {}}
    />,
  );
  const strip = view.container.querySelector("[data-tab-strip]") as HTMLElement;
  assertEquals(style(strip).overflow, "hidden");
  const scroller = view.container.querySelector("[data-scroll]") as HTMLElement;
  assertEquals(scroller.getAttribute("data-scroll"), "2000");
  assertEquals(style(scroller).overflow, "hidden");
  assertEquals(view.container.querySelectorAll("[data-tab]").length, 20);
});

Deno.test("shell/workspace#R1: 키보드로 탭을 다른 칸으로 옮긴다", () => {
  const moved: string[] = [];
  using view = render(
    <TabStrip
      tabs={[tab("a"), tab("b")]}
      selected="a"
      width={600}
      scroll={0}
      focused
      onSelect={() => {}}
      onClose={() => {}}
      onMoveToPane={(key, direction) => moved.push(`${key}:${direction}`)}
    />,
  );
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
  assertEquals(moved, ["a:right"]);
});

Deno.test("shell/workspace#R1: 탭 선택과 닫기가 그 탭만 가리킨다", () => {
  const selected: string[] = [];
  const closed: string[] = [];
  using view = render(
    <TabStrip
      tabs={[tab("a"), tab("b")]}
      selected="a"
      width={600}
      scroll={0}
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
