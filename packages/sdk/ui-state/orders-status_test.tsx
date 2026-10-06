import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  manualTimer,
  one,
  render,
} from "../../design/components/testing.ts";
import { RENDER_ERROR_EVENT } from "./mod.ts";
import {
  AppRoot,
  type OrdersResult,
  OrdersStatus,
} from "./examples/orders-status.tsx";

const now = new Date("2026-10-06T12:00:00Z");
const ready: OrdersResult = {
  loading: false,
  failed: false,
  orders: ["A-1001"],
  updatedAt: new Date("2026-10-06T11:50:00Z"),
};

Deno.test("apps/sdk#R18: 읽기 결과의 loading·error·empty·freshness를 한 component로 보인다", () => {
  const timer = manualTimer();
  const status = (result: OrdersResult) => (
    <OrdersStatus result={result} now={now} reload={() => {}} timer={timer} />
  );
  using view = render(status({ ...ready, loading: true }));
  assertEquals(view.container.innerHTML, "");
  act(() => timer.advance(300));
  assert(view.container.querySelector("[data-skeleton]"));

  view.rerender(status({ ...ready, failed: true }));
  assertEquals(
    one(view.container, "[data-state=error]").textContent,
    "Couldn't load orders.Reload",
  );

  view.rerender(status({ ...ready, orders: [] }));
  assertEquals(
    one(view.container, "[data-state=empty]").textContent,
    "No orders yet.Reload",
  );

  view.rerender(status(ready));
  assertEquals(view.container.querySelector("[data-state=stale]"), null);
  assertEquals(one(view.container, "li").textContent, "A-1001");

  view.rerender(
    status({ ...ready, updatedAt: new Date("2026-10-06T10:00:00Z") }),
  );
  assertEquals(
    one(view.container, "[data-state=stale]").textContent,
    "Last updated 2 hours ago",
  );
  assertEquals(one(view.container, "li").textContent, "A-1001");
});

let broken = true;

function Screen() {
  if (broken) throw new TypeError("orders is undefined");
  return <p>Orders</p>;
}

Deno.test("apps/sdk#R29: AppErrorBoundary는 root render 오류를 lophn:render-error event로 넘기고 원문 없이 다시 시도를 보인다", () => {
  const seen: unknown[] = [];
  const listen = (event: Event) => seen.push((event as CustomEvent).detail);
  window.addEventListener(RENDER_ERROR_EVENT, listen);
  // React가 잡은 오류를 console에 다시 쓴다. 이 테스트의 의도된 오류만 조용히 둔다.
  const original = console.error;
  console.error = () => {};
  try {
    broken = true;
    using view = render(<AppRoot><Screen /></AppRoot>);
    assertEquals(RENDER_ERROR_EVENT, "lophn:render-error");
    assertEquals(seen, [{ name: "TypeError", message: "orders is undefined" }]);
    const shown = one(view.container, "[data-state=error]");
    assertEquals(shown.textContent, "Couldn't show this screen.Try again");
    assert(!view.container.textContent?.includes("undefined"));
    broken = false;
    click(one(shown, "button"));
    assertEquals(view.container.textContent, "Orders");
    assertEquals(seen.length, 1);
  } finally {
    console.error = original;
    window.removeEventListener(RENDER_ERROR_EVENT, listen);
  }
});
