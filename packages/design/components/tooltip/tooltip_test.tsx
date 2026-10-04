import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import { tokens } from "../../tokens.ts";
import type { Timer } from "../shared.ts";
import { Tooltip } from "./tooltip.tsx";
import {
  focus,
  manualTimer,
  one,
  render,
  settle,
  style,
  unmountSettled,
} from "../testing.ts";

function shown(): HTMLElement | null {
  return document.querySelector("[data-radix-popper-content-wrapper] > div");
}

Deno.test("shell/design-system#R33: tooltip은 hover·focus 뒤 400ms 지나서야 보이고 떠나면 timer를 지운다", async () => {
  const timer = manualTimer();
  using view = render(
    <Tooltip content="Full path" timer={timer}>
      <button type="button">Open</button>
    </Tooltip>,
  );
  const trigger = one(view.container, "button");
  act(() => {
    trigger.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  });
  timer.advance(399);
  assertEquals(shown(), null);
  timer.advance(1);
  assertEquals(shown()?.textContent, "Full path");
  act(() => {
    trigger.dispatchEvent(
      new PointerEvent("pointerout", {
        bubbles: true,
        relatedTarget: document.body,
      }),
    );
  });
  await settle();
  assertEquals(shown(), null);
  focus(trigger);
  assertEquals(shown(), null, "focus must wait for the same delay");
  timer.advance(400);
  assert(shown(), "focus did not show the tooltip");
  act(() => trigger.blur());
  await settle();
  assertEquals(shown(), null);
  assertEquals(timer.pending(), 0);
});

Deno.test("shell/design-system#R33: tooltip 지연 중 떠나거나 unmount하면 timer가 남지 않고 보이지 않는다", async () => {
  const timer = manualTimer();
  const view = render(
    <Tooltip content="Full path" timer={timer}>
      <button type="button">Open</button>
    </Tooltip>,
  );
  const trigger = one(view.container, "button");
  act(() => {
    trigger.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  });
  timer.advance(200);
  act(() => {
    trigger.dispatchEvent(
      new PointerEvent("pointerout", {
        bubbles: true,
        relatedTarget: document.body,
      }),
    );
  });
  assertEquals(timer.pending(), 0);
  timer.advance(1000);
  assertEquals(shown(), null);
  focus(trigger);
  assertEquals(timer.pending(), 1);
  view.unmount();
  assertEquals(timer.pending(), 0);
  await settle();
});

Deno.test("shell/design-system#R33: tooltip timer를 바꾸면 기다리던 지연을 지우고 새 timer로 다시 400ms를 잰다", async () => {
  const old = manualTimer();
  const next = manualTimer();
  using view = render(
    <Tooltip content="Tip" timer={old}>
      <button type="button">Open</button>
    </Tooltip>,
  );
  const trigger = one(view.container, "button");
  act(() => {
    trigger.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  });
  old.advance(100);
  view.rerender(
    <Tooltip content="Tip" timer={next}>
      <button type="button">Open</button>
    </Tooltip>,
  );
  assertEquals(old.pending(), 0);
  focus(trigger);
  next.advance(399);
  assertEquals(shown(), null);
  next.advance(1);
  assert(shown(), "new timer did not show the tooltip");
  await unmountSettled(view);
});

Deno.test("shell/design-system#R33: tooltip은 Radix 기본 지연 timer를 걸지 않고 지운 timer의 늦은 callback을 무시한다", async () => {
  const callbacks: (() => void)[] = [];
  const leaky: Timer = {
    set: (callback) => callbacks.push(callback),
    clear: () => {},
  };
  using view = render(
    <Tooltip content="Tip" timer={leaky}>
      <button type="button">Open</button>
    </Tooltip>,
  );
  const trigger = one(view.container, "button");
  const delays: unknown[] = [];
  // Radix는 happy-dom window의 setTimeout으로 지연을 건다.
  const dom = (globalThis as unknown as {
    window: { setTimeout: (callback: () => void, ms?: number) => unknown };
  }).window;
  const original = dom.setTimeout;
  dom.setTimeout = (callback, ms) => {
    delays.push(ms);
    return original.call(dom, callback, ms);
  };
  try {
    act(() => {
      trigger.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
      trigger.dispatchEvent(new PointerEvent("pointermove", { bubbles: true }));
    });
  } finally {
    dom.setTimeout = original;
  }
  assertEquals(delays, []);
  act(() => {
    trigger.dispatchEvent(
      new PointerEvent("pointerout", {
        bubbles: true,
        relatedTarget: document.body,
      }),
    );
  });
  act(() => callbacks[0]());
  assertEquals(shown(), null);
  await unmountSettled(view);
});

Deno.test("shell/design-system#R45: tooltip은 popover 그림자·floating 표면·tooltip 층을 쓴다", async () => {
  using _view = render(
    <Tooltip content="Saved" open>
      <button type="button">Open</button>
    </Tooltip>,
  );
  await settle();
  const tip = shown()!;
  assertEquals(style(tip).boxShadow, tokens.shadow.popover.light);
  assertEquals(style(tip).backgroundColor, tokens.floating.surface.light);
  assertEquals(style(tip).zIndex, String(tokens.z.tooltip));
});
