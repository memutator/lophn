import { assert, assertEquals } from "@std/assert";
import { tokens } from "../../tokens.ts";
import { Switch } from "../switch/switch.tsx";
import { Checkbox } from "./checkbox.tsx";
import { click, one, render, style } from "../testing.ts";

Deno.test("shell/design-system#R43: Checkbox는 Radix로 라벨 클릭에도 바뀌고 선택은 잉크·check 표지다", () => {
  const changes: boolean[] = [];
  using view = render(
    <Checkbox
      label="Include archived"
      onCheckedChange={(on) => changes.push(on)}
    />,
  );
  const box = one(view.container, "[role=checkbox]");
  assertEquals(box.getAttribute("data-state"), "unchecked");
  click(one(view.container, "label"));
  assertEquals(changes, [true]);
  assertEquals(box.getAttribute("data-state"), "checked");
  assert(one(box, "svg").classList.contains("lucide-check"));
  assertEquals(style(box).backgroundColor, tokens.color.ink.background.light);
  click(box);
  assertEquals(changes, [true, false]);
});

Deno.test("shell/design-system#R43: Switch는 Radix로 바로 켜고 끄며 상태를 data-state로 남긴다", () => {
  const changes: boolean[] = [];
  using view = render(
    <Switch label="Open at login" onCheckedChange={(on) => changes.push(on)} />,
  );
  const track = one(view.container, "[role=switch]");
  click(track);
  assertEquals(changes, [true]);
  assertEquals(track.getAttribute("data-state"), "checked");
  assertEquals(style(track).backgroundColor, tokens.color.ink.background.light);
  assertEquals(one(view.container, "label").getAttribute("for"), track.id);
});
