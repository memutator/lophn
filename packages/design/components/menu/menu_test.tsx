import { assert, assertEquals } from "@std/assert";
import { useState } from "react";
import { tokens } from "../../tokens.ts";
import { Dialog } from "../dialog/dialog.tsx";
import { Menu } from "./menu.tsx";
import {
  focus,
  isFocused,
  one,
  pressAsync,
  render,
  settle,
  style,
  unmountSettled,
} from "../testing.ts";

const items = [
  { id: "rename", label: "Rename" },
  { id: "remove", label: "Remove", disabled: true },
];

function menu(): HTMLElement | null {
  return document.querySelector("[role=menu]");
}

Deno.test("shell/design-system#R33: menu 행은 32px이고 popover 그림자와 popover 층을 쓴다", async () => {
  using view = render(
    <Menu
      trigger={<button type="button">More</button>}
      items={items}
      onSelect={() => {}}
    />,
  );
  const trigger = one(view.container, "button");
  focus(trigger);
  await pressAsync(trigger, "Enter");
  const rows = [...menu()!.querySelectorAll("[role=menuitem]")];
  assertEquals(rows.map((row) => style(row).height), ["32px", "32px"]);
  assertEquals(style(menu()!).boxShadow, tokens.shadow.popover.light);
  assertEquals(style(menu()!).zIndex, String(tokens.z.popover));
  await pressAsync(document.activeElement!, "Escape");
});

Deno.test("shell/design-system#R43: menu는 키보드로 고른 id만 돌려주고 trigger로 focus를 돌린다", async () => {
  const chosen: string[] = [];
  using view = render(
    <Menu
      trigger={<button type="button">More</button>}
      items={[...items, { id: "copy", label: "Copy" }]}
      onSelect={(id) => chosen.push(id)}
    />,
  );
  const trigger = one(view.container, "button");
  focus(trigger);
  await pressAsync(trigger, "Enter");
  await pressAsync(document.activeElement!, "ArrowDown");
  await pressAsync(document.activeElement!, "Enter");
  assertEquals(chosen, ["copy"]);
  assertEquals(menu(), null);
  assert(isFocused(trigger), "focus did not return to the trigger");
});

function MenuInDialog() {
  const [open, setOpen] = useState(true);
  return (
    <Dialog open={open} onOpenChange={setOpen} title="Rename">
      <Menu
        trigger={<button type="button">More</button>}
        items={items}
        onSelect={() => {}}
      />
    </Dialog>
  );
}

Deno.test("shell/design-system#R20: dialog 안 menu는 sibling으로 dialog 위에 뜨고 Escape는 menu만 닫아 자기 trigger로 돌아간다", async () => {
  using view = render(<MenuInDialog />);
  await settle();
  const dialog = one(document, "[role=dialog]");
  const trigger = one(dialog, "button");
  focus(trigger);
  await pressAsync(trigger, "Enter");
  const opened = menu()!;
  assert(!dialog.contains(opened), "menu must not render inside the dialog");
  assert(
    Number(style(opened).zIndex) > Number(style(dialog).zIndex),
    "menu is not above the dialog",
  );
  await pressAsync(document.activeElement!, "Escape");
  assertEquals(menu(), null);
  assert(
    document.querySelector("[role=dialog]"),
    "dialog closed with the menu",
  );
  assert(isFocused(trigger), "focus did not return to the menu trigger");
  await unmountSettled(view);
});

Deno.test("shell/design-system#R33: menu 줄은 leading·label 요소·data 표식을 그대로 그리고 글 label 줄은 그대로다", async () => {
  const chosen: string[] = [];
  using view = render(
    <Menu
      trigger={<button type="button">More</button>}
      items={[
        {
          id: "a",
          leading: <span data-lead="">L</span>,
          label: <span data-name="">Alpha</span>,
          textValue: "Alpha",
          data: { "data-row": "a" },
        },
        { id: "b", label: "Beta" },
      ]}
      onSelect={(id) => chosen.push(id)}
    />,
  );
  const trigger = one(view.container, "button");
  focus(trigger);
  await pressAsync(trigger, "Enter");
  const rows = [...menu()!.querySelectorAll<HTMLElement>("[role=menuitem]")];
  assertEquals(rows.length, 2);
  assertEquals(rows[0].getAttribute("data-row"), "a");
  const lead = one(rows[0], "[data-lead]");
  const name = one(rows[0], "[data-name]");
  assert(lead.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING);
  assertEquals(rows[1].textContent, "Beta");
  assertEquals(rows[1].hasAttribute("data-row"), false);
  assertEquals(style(rows[0]).height, "32px");
  await pressAsync(document.activeElement!, "Enter");
  assertEquals(chosen, ["a"]);
});
