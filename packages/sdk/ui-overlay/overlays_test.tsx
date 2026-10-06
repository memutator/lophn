import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  focus,
  manualTimer,
  one,
  pressAsync,
  render,
  settle,
  unmountSettled,
} from "../../design/components/testing.ts";
import { OverlayExample } from "./examples/overlays.tsx";

function button(root: ParentNode, text: string): HTMLElement {
  const found = [...root.querySelectorAll("button")].find((element) =>
    element.textContent === text
  );
  if (!found) throw new Error(`no button ${text}`);
  return found;
}

Deno.test("apps/sdk#R15: 예제에서 tooltip·popover·메뉴·dialog·palette·toast를 각각 열고 닫는다", async () => {
  const timer = manualTimer();
  const view = render(<OverlayExample timer={timer} clock={timer} />);
  try {
    const info = one(view.container, "button[aria-label='About this list']");
    act(() => {
      info.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    });
    act(() => timer.advance(400));
    await settle();
    assert(
      document.body.textContent?.includes("Orders from the last 30 days."),
    );

    click(button(view.container, "Filter"));
    await settle();
    const rows = document.querySelectorAll("[data-radix-popper-content-wrapper] button");
    assertEquals([...rows].map((row) => row.textContent), [
      "Open orders",
      "Closed orders",
    ]);
    await pressAsync(rows[0], "Escape");

    const more = button(view.container, "More");
    focus(more);
    await pressAsync(more, "Enter");
    assertEquals(
      [...document.querySelectorAll("[role=menuitem]")].map((row) =>
        row.textContent
      ),
      ["Export", "Archive"],
    );
    await pressAsync(document.querySelector("[role=menuitem]")!, "Escape");

    click(button(view.container, "Rename"));
    await settle();
    assertEquals(
      document.querySelector("[role=dialog] h2")?.textContent,
      "Rename",
    );
    click(button(document.querySelector("[role=dialog]")!, "Cancel"));
    await settle();
    assertEquals(document.querySelector("[role=dialog]"), null);

    click(button(view.container, "Commands"));
    await settle();
    assert(
      document.querySelector("[role=dialog]")?.textContent?.includes(
        "Refresh orders",
      ),
    );
    await pressAsync(document.querySelector("[role=dialog] input")!, "Escape");
    assertEquals(document.querySelector("[role=dialog]"), null);

    click(button(view.container, "Save"));
    // toast는 provider 아래, 곧 앱 view 안에 쌓인다.
    assert(view.container.textContent?.includes("List saved"));
    act(() => timer.advance(2000));
    assert(!view.container.textContent?.includes("List saved"));
  } finally {
    await unmountSettled(view);
  }
});
