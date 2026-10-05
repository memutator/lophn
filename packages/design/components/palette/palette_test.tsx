import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import { FileText } from "lucide-react";
import { tokens } from "../../tokens.ts";
import { Palette } from "./palette.tsx";
import {
  one,
  pressAsync,
  render,
  settle,
  style,
  unmountSettled,
} from "../testing.ts";

const items = [
  { id: "open", label: "Open project" },
  { id: "close", label: "Close tab" },
  { id: "settings", label: "Settings" },
];

function palette(): HTMLElement {
  return one(document, "[role=dialog]");
}

Deno.test("shell/design-system#R33: palette는 폭640px·위20%에 dialog 그림자와 palette 층으로 뜬다", async () => {
  using view = render(
    <Palette
      open
      onOpenChange={() => {}}
      title="Search"
      items={items}
      onSelect={() => {}}
    />,
  );
  await settle();
  assertEquals(style(palette()).width, tokens.palette.width);
  assertEquals(style(palette()).top, tokens.palette.top);
  assertEquals(style(palette()).boxShadow, tokens.shadow.dialog.light);
  assertEquals(style(palette()).zIndex, String(tokens.z.palette));
  const backdrop = palette().previousElementSibling as HTMLElement;
  assertEquals(
    style(backdrop).backgroundColor.replaceAll(" ", ""),
    tokens.floating.backdrop.light,
  );
  await unmountSettled(view);
});

Deno.test("shell/design-system#R39: palette 항목은 36px이고 목록 scrollbar는 항상 보인다", async () => {
  using view = render(
    <Palette
      open
      onOpenChange={() => {}}
      title="Search"
      items={items}
      onSelect={() => {}}
    />,
  );
  await settle();
  const options = [...palette().querySelectorAll("[role=option]")];
  assertEquals(options.map((option) => style(option).height), [
    "36px",
    "36px",
    "36px",
  ]);
  const list = one(palette(), "[role=listbox]");
  assertEquals(style(list).overflowY, "scroll");
  await unmountSettled(view);
});

Deno.test("shell/design-system#R43: palette는 검색으로 줄이고 화살표·Enter로 고른 id만 돌려준다", async () => {
  const chosen: string[] = [];
  using view = render(
    <Palette
      open
      onOpenChange={() => {}}
      title="Search"
      items={items}
      onSelect={(id) => chosen.push(id)}
    />,
  );
  await settle();
  const input = one(palette(), "input") as HTMLInputElement;
  assert(document.activeElement === input, "search does not have focus");
  assertEquals(one(palette(), "label").textContent, "Search");
  await pressAsync(input, "ArrowDown");
  await pressAsync(input, "Enter");
  assertEquals(chosen, ["close"]);
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, "zzz");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assertEquals(palette().querySelectorAll("[role=option]").length, 0);
  assertEquals(
    one(palette(), "p").textContent,
    "Nothing matches your search.",
  );
  await unmountSettled(view);
});

Deno.test("shell/design-system#R39: palette 키보드로 목록 아래 항목을 고르면 그 행을 보이게 옮기고 focus는 검색 칸에 둔다", async () => {
  const many = Array.from({ length: 12 }, (_, index) => ({
    id: `item-${index}`,
    label: `Item ${index}`,
  }));
  const scrolled: string[] = [];
  const original = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = function () {
    scrolled.push(this.textContent ?? "");
  };
  try {
    using view = render(
      <Palette
        open
        onOpenChange={() => {}}
        title="Search"
        items={many}
        onSelect={() => {}}
      />,
    );
    await settle();
    const input = one(palette(), "input");
    for (let step = 0; step < 9; step++) await pressAsync(input, "ArrowDown");
    assertEquals(scrolled.at(-1), "Item 9");
    assert(document.activeElement === input, "focus left the search input");
    await unmountSettled(view);
  } finally {
    HTMLElement.prototype.scrollIntoView = original;
  }
});

Deno.test("shell/design-system#R43: palette는 묶음 이름 아래 행을 모아 16px 아이콘·보조 글·키 이름을 두고 검색어를 넘기면 거르지 않는다", async () => {
  const queries: string[] = [];
  using view = render(
    <Palette
      open
      onOpenChange={() => {}}
      title="Search"
      items={[
        { id: "a", label: "notes", group: "Open tabs", icon: FileText },
        { id: "b", label: "plan", group: "Open tabs", detail: "Terminal" },
        {
          id: "c",
          label: "Back to launcher",
          group: "Actions",
          hint: "Ctrl+Shift+L",
        },
      ]}
      onSelect={() => {}}
      onQueryChange={(query) => queries.push(query)}
    />,
  );
  await settle();
  const headings = [...palette().querySelectorAll("[role=listbox] > div")]
    .map((row) => row.firstElementChild)
    .filter((node) => node?.getAttribute("role") === "presentation")
    .map((node) => node!.textContent);
  assertEquals(headings, ["Open tabs", "Actions"]);
  const options = [...palette().querySelectorAll("[role=option]")];
  assertEquals(options.map((option) => style(option).height), [
    "36px",
    "36px",
    "36px",
  ]);
  const icon = options[0]!.querySelector("svg")!;
  assertEquals(icon.getAttribute("width"), "16");
  assertEquals(icon.getAttribute("stroke-width"), "1.5");
  assertEquals(options[1]!.textContent, "planTerminal");
  assertEquals(options[2]!.textContent, "Back to launcherCtrl+Shift+L");
  const input = one(palette(), "input") as HTMLInputElement;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    setter.call(input, "zzz");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assertEquals(queries, ["zzz"]);
  // 호출자가 맞는 행을 다시 준다. palette는 이름으로 거르지 않는다.
  assertEquals(palette().querySelectorAll("[role=option]").length, 3);
  await unmountSettled(view);
});
