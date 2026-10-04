import { assert, assertEquals } from "@std/assert";
import { act, useState } from "react";
import { tokens } from "../../tokens.ts";
import { Sheet } from "./sheet.tsx";
import {
  click,
  one,
  pressAsync,
  render,
  settle,
  style,
  unmountSettled,
} from "../testing.ts";

function Opener() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <p>Page</p>
      <Sheet open={open} onOpenChange={setOpen} title="Details" width="wide">
        Owner text
      </Sheet>
    </div>
  );
}

function sheet(): HTMLElement | null {
  return document.querySelector("[role=dialog]");
}

Deno.test("shell/design-system#R33: sheet는 backdrop 없이 sheet 층에 dialog 폭 token으로 열린다", async () => {
  using view = render(<Opener />);
  click(one(view.container, "button"));
  await settle();
  const opened = sheet()!;
  assertEquals(style(opened).width, tokens.dialog.width.wide);
  assertEquals(style(opened).zIndex, String(tokens.z.sheet));
  assertEquals(style(opened).boxShadow, tokens.shadow.dialog.light);
  const layers = [...document.body.querySelectorAll("[data-state]")];
  assert(layers.length === 1 && layers[0] === opened, "sheet drew a backdrop");
  await unmountSettled(view);
});

Deno.test("shell/design-system#R33: sheet는 Escape로 닫힌다", async () => {
  using view = render(<Opener />);
  click(one(view.container, "button"));
  await settle();
  await pressAsync(document.activeElement!, "Escape");
  assertEquals(sheet(), null);
});

Deno.test("shell/design-system#R33: sheet는 바깥 click으로 닫힌다", async () => {
  using view = render(<Opener />);
  click(one(view.container, "button"));
  await settle();
  assert(sheet());
  const page = one(view.container, "p");
  // Radix는 주 버튼 pointerdown 뒤 click까지 보고 바깥 click으로 닫는다.
  act(() => {
    page.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
    page.click();
  });
  await settle();
  assert(sheet() === null, "sheet stayed open after an outside click");
});
