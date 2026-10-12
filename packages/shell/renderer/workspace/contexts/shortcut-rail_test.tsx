import { assert, assertEquals } from "@std/assert";
import {
  click,
  focus,
  manualTimer,
  one,
  render,
} from "../../../../design/components/testing.ts";

import {
  RAIL_ACTIONS,
  type RailAction,
  ShortcutRail,
} from "./shortcut-rail.tsx";
import { all, norm } from "./testing.tsx";

function rail(
  onOpen: (action: RailAction) => void = () => {},
  timer = manualTimer(),
) {
  return {
    view: render(<ShortcutRail onOpen={onOpen} timer={timer} />),
    timer,
  };
}

const shownTooltip = () =>
  document.querySelector("[data-radix-popper-content-wrapper] > div");

Deno.test("shell/workspace#R32 [ctx-I51]: rail은 Terminal · Contexts · Saved views · Search · Agent 다섯 단추만 이 순서로 둔다", () => {
  assertEquals([...RAIL_ACTIONS], [
    "terminal",
    "contexts",
    "saved",
    "search",
    "agent",
  ]);
  const { view } = rail();
  using _ = view;
  const bar = one(view.container, "[role=toolbar]");
  assertEquals(bar.getAttribute("aria-label"), "Shortcuts");
  const buttons = all(bar, "button");
  assertEquals(buttons.map((button) => button.dataset.railAction), [
    "terminal",
    "contexts",
    "saved",
    "search",
    "agent",
  ]);
  assertEquals(buttons.map((button) => button.getAttribute("aria-label")), [
    "Terminal",
    "Contexts",
    "Saved views",
    "Search",
    "Agent",
  ]);
});

Deno.test("shell/workspace#R32 [ctx-I51]: 단추는 이름 글자 없이 아이콘만 보이고 아이콘이 있다", () => {
  const { view } = rail();
  using _ = view;
  const buttons = all(view.container, "button");
  assertEquals(buttons.length, 5);
  for (const button of buttons) {
    assertEquals(norm(button), "");
    assert(button.querySelector("svg") !== null, "the button has no icon");
  }
});

Deno.test("shell/workspace#R32 [ctx-I51]: 단추를 누르면 그 종류를 부른 쪽에 알린다: Saved views와 Search는 구별된다", () => {
  const opened: RailAction[] = [];
  const { view } = rail((action) => opened.push(action));
  using _ = view;
  for (const button of all(view.container, "button")) click(button);
  assertEquals(opened, ["terminal", "contexts", "saved", "search", "agent"]);
});

Deno.test("shell/workspace#R32 [ctx-I51]: 단추에 focus가 가고 400ms가 지나면 이름 tooltip이 보인다", () => {
  const { view, timer } = rail();
  using _ = view;
  const contexts = one(view.container, '[data-rail-action="contexts"]');
  focus(contexts);
  assertEquals(shownTooltip(), null);
  timer.advance(400);
  assertEquals(norm(shownTooltip()), "Contexts");
});
