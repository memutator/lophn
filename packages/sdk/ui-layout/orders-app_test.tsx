import { assert, assertEquals } from "@std/assert";
import { ResizeSourceProvider } from "@lophn/design/components";
import {
  click,
  manualResize,
  one,
  render,
  style,
} from "../../design/components/testing.ts";
import { OrdersApp } from "./examples/orders-app.tsx";

const now = new Date("2026-10-06T00:00:00Z");

function button(root: ParentNode, text: string): HTMLElement {
  const found = [...root.querySelectorAll("button")].find((element) =>
    element.textContent === text
  );
  if (!found) throw new Error(`no button ${text}`);
  return found;
}

function mount(width: number) {
  const resize = manualResize();
  const view = render(
    <ResizeSourceProvider value={resize}>
      <OrdersApp now={now} />
    </ResizeSourceProvider>,
  );
  resize.resize({ width, height: 480 });
  return { view, resize };
}

Deno.test("apps/sdk#R15: 예제는 앱 shell·sidebar·tab·grid·card와 5가지 페이지 틀을 연다", () => {
  const { view, resize } = mount(1024);
  using _ = view;
  const nav = one(view.container, "nav");
  assertEquals(view.container.querySelectorAll("[role=tab]").length, 2);
  assert(view.container.querySelector("main [class*=grid] [class*=card]"));
  const frames: Record<string, string> = {
    Overview: "dashboard",
    Orders: "list-detail",
    "All orders": "table",
    Settings: "form",
    Guide: "reading",
  };
  for (const [label, frame] of Object.entries(frames)) {
    click(button(nav, label));
    resize.resize({ width: 1024, height: 480 });
    assertEquals(
      one(view.container, "main [data-frame]").dataset.frame,
      frame,
      label,
    );
    assertEquals(
      one(nav, "[aria-current=page]").textContent,
      label,
    );
  }
});

Deno.test("apps/sdk#R37: 같은 화면을 전체·320px 패널·240px 카드에 넣으면 sidebar 조작이 남고 한 줄로 옮겨진다", () => {
  for (
    const [width, space] of [[1024, "full"], [320, "panel"], [
      240,
      "card",
    ]] as const
  ) {
    const { view } = mount(width);
    using _ = view;
    const shell = one(view.container, "[data-space]");
    assertEquals(shell.dataset.space, space);
    const sidebar = one(view.container, "nav ul");
    assertEquals(sidebar.querySelectorAll("button").length, 5);
    assertEquals(
      style(sidebar).flexDirection,
      space === "full" ? "column" : "row",
    );
    const body = style(shell.lastElementChild!);
    assert(
      space === "full"
        ? body.gridTemplateColumns.startsWith("200px")
        : !body.gridTemplateColumns.includes("200px"),
      body.gridTemplateColumns,
    );
  }
});

Deno.test("apps/sdk#R37: 240px 카드의 dashboard는 한 줄 한 칸, 320px 패널의 목록·상세는 한 쪽씩 보이고 돌아갈 수 있다", () => {
  const card = mount(240);
  using _card = card.view;
  const cell = one(card.view.container, "[data-span='4']");
  assertEquals(style(cell).gridColumn.replace(/\s/g, ""), "1/-1");

  const panel = mount(320);
  using _panel = panel.view;
  click(button(one(panel.view.container, "nav"), "Orders"));
  panel.resize.resize({ width: 320, height: 480 });
  const frame = one(panel.view.container, "[data-frame=list-detail]");
  assertEquals(frame.dataset.pad, "narrow");
  assertEquals(frame.children.length, 1);
  click(button(frame, "Harbor Cafe"));
  assertEquals(frame.children.length, 1);
  assert(frame.textContent?.includes("A-1002"));
  click(button(frame, "Back"));
  assert(frame.textContent?.includes("North Shop"));
  assert(!frame.textContent?.includes("A-1002"));
});
