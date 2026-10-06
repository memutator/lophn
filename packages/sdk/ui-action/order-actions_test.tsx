import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  manualTimer,
  one,
  render,
  settle,
} from "../../design/components/testing.ts";
import type { AppBridge, CommandInput } from "./mod.ts";
import { COMMANDS, OrderActions } from "./examples/order-actions.tsx";

// 사람 확인과 결과를 테스트가 정하는 `lophnApp` 대역. 부른 것만 기록하고 다른 통로는 없다.
function bridge() {
  const calls: [string, CommandInput][] = [];
  const waiting: {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }[] = [];
  const app: AppBridge = {
    call(command, input) {
      calls.push([command, input]);
      return new Promise((resolve, reject) =>
        waiting.push({ resolve, reject })
      );
    },
  };
  return { app, calls, waiting };
}

Deno.test("apps/sdk#R19: 확인 표시는 effect가 아니라 blueprint confirm 선언을 따르고 호출은 lophnApp.call로만 간다", async () => {
  const { app, calls, waiting } = bridge();
  const timer = manualTimer();
  using view = render(
    <OrderActions app={app} selected={() => ["A-1001"]} timer={timer} />,
  );
  const sync = one(view.container, "[data-command=sync-orders] button");
  const archive = one(view.container, "[data-command=archive-shipped] button");
  assertEquals(COMMANDS.sync.effect, "external");
  assertEquals(sync.dataset.confirm, undefined);
  assertEquals(sync.querySelector("svg"), null);
  assertEquals(COMMANDS.archive.effect, "write");
  assertEquals(archive.dataset.confirm, "true");
  assert(one(archive, "svg").classList.contains("lucide-shield-check"));
  assertEquals(archive.textContent, "Archive shipped orders");

  act(() => {
    archive.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  });
  act(() => timer.advance(400));
  await settle();
  assert(
    document.body.textContent?.includes("lophn asks you before this runs."),
  );

  click(archive);
  await settle();
  assertEquals(calls, [["archive-shipped", { orders: ["A-1001"] }]]);
  assertEquals(archive.getAttribute("aria-busy"), "true");
  assertEquals((archive as HTMLButtonElement).disabled, true);
  assert(one(archive, "svg").classList.contains("lucide-clock"));
  assertEquals(
    one(view.container, "[data-command=archive-shipped] [role=status]")
      .textContent,
    "Waiting for your confirmation.",
  );
  click(archive);
  assertEquals(calls.length, 1);
  await act(async () => {
    waiting[0].resolve({ archived: 1 });
    await Promise.resolve();
  });
  assertEquals((archive as HTMLButtonElement).disabled, false);
  assertEquals(
    view.container.querySelector(
      "[data-command=archive-shipped] [role=status]",
    ),
    null,
  );

  click(sync);
  await settle();
  assertEquals(calls.at(-1), ["sync-orders", null]);
  assertEquals(sync.getAttribute("aria-busy"), "true");
  assertEquals(
    view.container.querySelector("[data-command=sync-orders] [role=status]"),
    null,
  );
});

Deno.test("apps/sdk#R19: 실패하거나 bridge가 없으면 원문 없이 버튼 옆에 실패를 남기고 다시 누를 수 있다", async () => {
  const { app, calls, waiting } = bridge();
  using view = render(<OrderActions app={app} selected={() => []} />);
  const archive = one(view.container, "[data-command=archive-shipped] button");
  click(archive);
  await settle();
  await act(async () => {
    waiting[0].reject(new Error("forbidden: confirmation was declined"));
    await Promise.resolve();
  });
  const failed = one(view.container, "[data-failed]");
  assertEquals(
    failed.textContent,
    "Archive shipped orders didn't finish. Try again.",
  );
  assertEquals((archive as HTMLButtonElement).disabled, false);
  click(archive);
  await settle();
  assertEquals(calls.length, 2);
  assertEquals(view.container.querySelector("[data-failed]"), null);

  using missing = render(<OrderActions selected={() => []} />);
  click(one(missing.container, "[data-command=sync-orders] button"));
  await settle();
  assertEquals(
    one(missing.container, "[data-failed]").textContent,
    "Sync orders didn't finish. Try again.",
  );
});
