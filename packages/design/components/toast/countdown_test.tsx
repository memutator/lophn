import { assertEquals } from "@std/assert";
import { act } from "react";
import type { Timer } from "../shared.ts";
import { Toast, type ToastProps } from "./toast.tsx";
import { manualTimer, one, render } from "../testing.ts";

function hover(target: Element, entering: boolean) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(entering ? "pointerover" : "pointerout", {
        bubbles: true,
        relatedTarget: document.body,
      }),
    );
  });
}

function toast(props: Omit<ToastProps, "title">) {
  return <Toast title="Saved" {...props} />;
}

Deno.test("shell/design-system#R33: toast가 error로 바뀌면 timer를 지우고 다시 neutral이면 남은 시간만 이어 간다", () => {
  const timer = manualTimer();
  const closed: string[] = [];
  const onClose = () => closed.push("closed");
  using view = render(toast({ timer, clock: timer, onClose }));
  timer.advance(1000);
  view.rerender(toast({ tone: "error", timer, clock: timer, onClose }));
  assertEquals(timer.pending(), 0);
  timer.advance(60000);
  assertEquals(closed, []);
  view.rerender(toast({ timer, clock: timer, onClose }));
  timer.advance(3999);
  assertEquals(closed, []);
  timer.advance(1);
  assertEquals(closed, ["closed"]);
});

Deno.test("shell/design-system#R33: toast 시간 종류가 바뀌면 지난 시간을 빼고 새 시간에 맞춘다", () => {
  const timer = manualTimer();
  const closed: string[] = [];
  const onClose = () => closed.push("closed");
  using view = render(toast({ timer, clock: timer, onClose }));
  timer.advance(1500);
  view.rerender(toast({ duration: "brief", timer, clock: timer, onClose }));
  timer.advance(499);
  assertEquals(closed, []);
  timer.advance(1);
  assertEquals(closed, ["closed"]);
});

Deno.test("shell/design-system#R33: toast timer·clock을 바꾸면 만든 adapter로 옛 handle을 지우고 남은 시간과 최신 onClose를 쓴다", () => {
  const old = manualTimer();
  const next = manualTimer();
  const closed: string[] = [];
  using view = render(
    toast({ timer: old, clock: old, onClose: () => closed.push("old") }),
  );
  old.advance(1000);
  view.rerender(
    toast({ timer: next, clock: next, onClose: () => closed.push("new") }),
  );
  assertEquals(old.pending(), 0);
  const node = one(view.container, "[data-tone]");
  hover(node, true);
  old.advance(10000);
  next.advance(10000);
  assertEquals(closed, []);
  hover(node, false);
  next.advance(3999);
  assertEquals(closed, []);
  next.advance(1);
  assertEquals(closed, ["new"]);
});

Deno.test("shell/design-system#R33: toast unmount는 timer를 남기지 않는다", () => {
  const timer = manualTimer();
  const closed: string[] = [];
  const view = render(
    toast({ timer, clock: timer, onClose: () => closed.push("closed") }),
  );
  view.unmount();
  assertEquals(timer.pending(), 0);
  timer.advance(10000);
  assertEquals(closed, []);
});

Deno.test("shell/design-system#R33: 멈춘 뒤 지운 timer의 늦은 callback은 toast를 닫지 않는다", () => {
  const clock = manualTimer();
  const callbacks: (() => void)[] = [];
  // clear해도 callback을 지우지 못하는 timer. 늦게 불려도 무시해야 한다.
  const leaky: Timer = {
    set: (callback) => callbacks.push(callback),
    clear: () => {},
  };
  const closed: string[] = [];
  using view = render(
    toast({ timer: leaky, clock, onClose: () => closed.push("closed") }),
  );
  hover(one(view.container, "[data-tone]"), true);
  act(() => callbacks[0]());
  assertEquals(closed, []);
  hover(one(view.container, "[data-tone]"), false);
  act(() => callbacks[1]());
  assertEquals(closed, ["closed"]);
});
