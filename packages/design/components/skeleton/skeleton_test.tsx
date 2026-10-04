import { assert, assertEquals } from "@std/assert";
import { Loading, Skeleton } from "./skeleton.tsx";
import { manualTimer, render, type Rendered, style } from "../testing.ts";
import type { Timer } from "../shared.ts";

function loading(state: boolean, timer: Timer) {
  return (
    <Loading
      loading={state}
      timer={timer}
      placeholder={<Skeleton shape="line" lines={2} />}
    >
      <p>Loaded</p>
    </Loading>
  );
}

function shown(view: Rendered): "nothing" | "skeleton" | "content" {
  if (view.container.querySelector("[data-skeleton]")) return "skeleton";
  return view.container.textContent === "Loaded" ? "content" : "nothing";
}

Deno.test("shell/design-system#R1: 200ms에 끝난 첫 조회는 loading을 보이지 않는다", () => {
  const timer = manualTimer();
  using view = render(loading(true, timer));
  timer.advance(200);
  assertEquals(shown(view), "nothing");
  view.rerender(loading(false, timer));
  assertEquals(shown(view), "content");
  assertEquals(timer.pending(), 0);
});

Deno.test("shell/design-system#R1: 300ms가 지나면 skeleton이 보이고 500ms에도 자리를 지킨다", () => {
  const timer = manualTimer();
  using view = render(loading(true, timer));
  timer.advance(299);
  assertEquals(shown(view), "nothing");
  timer.advance(1);
  assertEquals(shown(view), "skeleton");
  timer.advance(200);
  assertEquals(shown(view), "skeleton");
  view.rerender(loading(false, timer));
  assertEquals(shown(view), "content");
});

Deno.test("shell/design-system#R1: loading 중 unmount하면 timer가 남지 않는다", () => {
  const timer = manualTimer();
  const view = render(loading(true, timer));
  assertEquals(timer.pending(), 1);
  view.unmount();
  assertEquals(timer.pending(), 0);
});

Deno.test("shell/design-system#R1: 끝났다 다시 loading이면 300ms를 처음부터 잰다", () => {
  const timer = manualTimer();
  using view = render(loading(true, timer));
  timer.advance(250);
  view.rerender(loading(false, timer));
  view.rerender(loading(true, timer));
  timer.advance(100);
  assertEquals(shown(view), "nothing");
  timer.advance(199);
  assertEquals(shown(view), "nothing");
  timer.advance(1);
  assertEquals(shown(view), "skeleton");
  assertEquals(timer.pending(), 0);
});

Deno.test("shell/design-system#R1: skeleton은 실제 줄·컨트롤·아이콘 자리 크기를 지킨다", () => {
  using view = render(
    <div>
      <Skeleton shape="line" lines={3} />
      <Skeleton shape="control" />
      <Skeleton shape="icon" />
    </div>,
  );
  const [lines, control, icon] = [
    ...view.container.querySelectorAll("[data-skeleton]"),
  ];
  assertEquals(lines.children.length, 3);
  for (const line of lines.children) {
    assertEquals(style(line).height, "22px");
  }
  assertEquals(style(control.children[0]).height, "32px");
  assertEquals(style(icon.children[0]).width, "20px");
  assert(style(control.children[0]).animationDuration !== "0s");
});
