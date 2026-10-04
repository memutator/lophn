import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import { tokens } from "../../tokens.ts";
import { Popover, PopoverRow } from "./popover.tsx";
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

function content(): HTMLElement | null {
  return document.querySelector("[data-radix-popper-content-wrapper] > div");
}

function Example({ onSelect = () => {} }: { onSelect?: () => void }) {
  return (
    <div>
      <Popover trigger={<button type="button">Filter</button>}>
        <PopoverRow onSelect={onSelect}>Newest first</PopoverRow>
      </Popover>
      <button type="button">Elsewhere</button>
    </div>
  );
}

Deno.test("shell/design-system#R33: popover 행은 menu와 같은 32px이고 popover 그림자·층을 쓴다", async () => {
  const picked: string[] = [];
  using view = render(<Example onSelect={() => picked.push("row")} />);
  click(one(view.container, "button"));
  await settle();
  const popover = content()!;
  assertEquals(style(one(popover, "button")).height, "32px");
  assertEquals(style(popover).boxShadow, tokens.shadow.popover.light);
  assertEquals(style(popover).backgroundColor, tokens.floating.surface.light);
  assertEquals(style(popover).zIndex, String(tokens.z.popover));
  click(one(popover, "button"));
  assertEquals(picked, ["row"]);
});

Deno.test("shell/design-system#R20: modal 밖 popover는 focus가 바깥으로 옮겨지면 닫힌다", async () => {
  using view = render(<Example />);
  const [trigger, elsewhere] = view.container.querySelectorAll("button");
  click(trigger);
  await settle();
  assert(content(), "popover did not open");
  act(() => (elsewhere as HTMLElement).focus());
  await settle();
  assertEquals(content(), null);
});

Deno.test("shell/design-system#R2: popover를 Escape로 닫으면 연 trigger로 focus가 돌아간다", async () => {
  using view = render(<Example />);
  const trigger = one(view.container, "button");
  focus(trigger);
  click(trigger);
  await settle();
  assert(!isFocused(trigger));
  await pressAsync(document.activeElement!, "Escape");
  assertEquals(content(), null);
  assert(isFocused(trigger), "focus did not return to the trigger");
});
