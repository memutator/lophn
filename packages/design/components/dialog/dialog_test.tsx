import { assert, assertEquals } from "@std/assert";
import { useState } from "react";
import { tokens } from "../../tokens.ts";
import { Button } from "../button/button.tsx";
import { Dialog, type DialogWidth } from "./dialog.tsx";
import {
  click,
  focus,
  isFocused,
  one,
  pressAsync,
  render,
  settle,
  style,
} from "../testing.ts";

function Opener({ width }: { width?: DialogWidth }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Discard draft?"
        width={width}
        actions={<Button variant="primary">Discard</Button>}
      >
        The draft can't be restored.
      </Dialog>
    </div>
  );
}

function dialog(): HTMLElement | null {
  return document.querySelector("[role=dialog]");
}

Deno.test("shell/design-system#R33: dialog 폭은 480/640px이고 안 여백은 24px이다", async () => {
  for (const [width, pixels] of [["default", "480px"], ["wide", "640px"]]) {
    using view = render(<Opener width={width as DialogWidth} />);
    click(one(view.container, "button"));
    await settle();
    const opened = dialog()!;
    assertEquals(style(opened).width, pixels);
    assertEquals(
      [style(opened).paddingTop, style(opened).paddingLeft],
      ["24px", "24px"],
    );
    await pressAsync(document.activeElement!, "Escape");
  }
});

Deno.test("shell/design-system#R45: dialog 그림자·floating 표면·backdrop 색과 층은 token 값이다", async () => {
  using view = render(<Opener />);
  click(one(view.container, "button"));
  await settle();
  const opened = dialog()!;
  const backdrop = opened.previousElementSibling as HTMLElement;
  assertEquals(style(opened).boxShadow, tokens.shadow.dialog.light);
  assertEquals(style(opened).backgroundColor, tokens.floating.surface.light);
  assertEquals(
    style(backdrop).backgroundColor.replaceAll(" ", ""),
    tokens.floating.backdrop.light,
  );
  assertEquals(style(backdrop).zIndex, String(tokens.z.backdrop));
  assertEquals(style(opened).zIndex, String(tokens.z.dialog));
  await pressAsync(document.activeElement!, "Escape");
});

Deno.test("shell/design-system#R2: dialog를 Escape로 닫으면 연 버튼으로 focus가 돌아간다", async () => {
  using view = render(<Opener />);
  const opener = one(view.container, "button");
  focus(opener);
  click(opener);
  await settle();
  assert(dialog()?.contains(document.activeElement), "focus is not trapped");
  await pressAsync(document.activeElement!, "Escape");
  assertEquals(dialog(), null);
  assert(isFocused(opener), "focus did not return to the opener");
});
