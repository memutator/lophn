import { assert, assertEquals } from "@std/assert";
import { ReadingFrame, ResizeSourceProvider } from "../../components/mod.ts";
import {
  click,
  focus,
  manualResize,
  one,
  pressAsync,
  render,
} from "../../components/testing.ts";
import type { OutlineItem } from "../markdown/model.ts";
import { Toc } from "./toc.tsx";

const items: OutlineItem[] = [
  { id: "guide", title: "Guide", level: 1 },
  { id: "setup", title: "Setup", level: 2 },
  { id: "keys", title: "Keys", level: 3 },
  { id: "deep", title: "Deep", level: 4 },
];

function page(selected: string[], active?: string) {
  return (
    <ReadingFrame
      width="default"
      toc={
        <Toc
          items={items}
          activeId={active}
          onSelect={(id) => selected.push(id)}
        />
      }
    >
      <p>Body</p>
    </ReadingFrame>
  );
}

Deno.test("shell/design-system#R23: 넓은 칸의 목차는 본문 옆 목록이고 3단까지 보이며 고르면 알린다", () => {
  const resize = manualResize();
  const selected: string[] = [];
  using view = render(
    <ResizeSourceProvider value={resize}>
      {page(selected, "setup")}
    </ResizeSourceProvider>,
  );
  resize.resize({ width: 1012 });
  const nav = one(view.container, "aside nav");
  assertEquals(nav.getAttribute("aria-label"), "On this page");
  const buttons = [...nav.querySelectorAll("button")];
  assertEquals(buttons.map((button) => button.textContent), [
    "Guide",
    "Setup",
    "Keys",
  ]);
  assertEquals(buttons[1].getAttribute("aria-current"), "location");
  assertEquals(
    (buttons[2].parentElement as HTMLElement).dataset.level,
    "3",
  );
  click(buttons[2]);
  assertEquals(selected, ["keys"]);
});

Deno.test("shell/design-system#R23: 좁은 칸의 목차는 머리 dropdown이고 키보드로 골라 알린다", async () => {
  const resize = manualResize();
  const selected: string[] = [];
  using view = render(
    <ResizeSourceProvider value={resize}>
      {page(selected, "guide")}
    </ResizeSourceProvider>,
  );
  resize.resize({ width: 1011 });
  assertEquals(view.container.querySelector("aside"), null);
  const head = one(view.container, "[data-placement=head]");
  assertEquals(one(head, "label").textContent, "On this page");
  const trigger = one(head, "button");
  assertEquals(trigger.textContent, "Guide");
  focus(trigger);
  await pressAsync(trigger, "ArrowDown");
  assert(document.querySelector("[role=listbox]"), "dropdown did not open");
  await pressAsync(document.activeElement!, "ArrowDown");
  await pressAsync(document.activeElement!, "Enter");
  assertEquals(selected, ["setup"]);
  resize.resize({ width: 1012 });
  assert(one(view.container, "aside nav"));
});
