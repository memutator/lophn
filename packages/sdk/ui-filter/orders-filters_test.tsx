import { assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  one,
  render,
  settle,
  unmountSettled,
} from "../../design/components/testing.ts";
import { OrdersFilters, type OrdersQuery } from "./examples/orders-filters.tsx";

const now = new Date(2026, 9, 6, 15, 30);

function button(root: ParentNode, text: string): HTMLElement {
  const found = [...root.querySelectorAll("button")].find((element) =>
    element.textContent === text
  );
  if (!found) throw new Error(`no button ${text}`);
  return found;
}

function panel(): HTMLElement {
  return one(document, "[data-radix-popper-content-wrapper]");
}

function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!
      .call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

Deno.test("apps/sdk#R18, R19: 예제의 기간·다중 선택·검색은 바뀔 때마다 그 값으로 read command를 부른다", async () => {
  const calls: [string, OrdersQuery][] = [];
  const call = (command: string, input: OrdersQuery) => {
    calls.push([command, input]);
    return Promise.resolve([]);
  };
  const view = render(<OrdersFilters now={now} call={call} />);
  try {
    const range = one(view.container, "[data-filter=date-range]");
    assertEquals(range.textContent, "Last 30 days");
    click(range);
    await settle();
    click(button(panel(), "Last 7 days"));
    await settle();
    assertEquals(range.textContent, "Last 7 days");
    assertEquals(calls.at(-1), ["list-orders", {
      from: "2026-09-30",
      to: "2026-10-06",
      statuses: [],
      text: "",
    }]);

    click(range);
    await settle();
    const [from, to] = [
      ...panel().querySelectorAll("input[type=date]"),
    ] as HTMLInputElement[];
    assertEquals([from.value, to.value], ["2026-09-30", "2026-10-06"]);
    type(from, "2025-12-28");
    type(to, "2026-01-04");
    click(button(panel(), "Apply"));
    await settle();
    assertEquals(range.textContent, "Dec 28, 2025–Jan 4, 2026");
    assertEquals(calls.at(-1)?.[1].from, "2025-12-28");

    const statuses = one(view.container, "[data-filter=multi-select]");
    assertEquals(statuses.textContent, "All statuses");
    click(statuses);
    await settle();
    const boxes = [...panel().querySelectorAll("[role=checkbox]")];
    click(boxes[2]);
    await settle();
    assertEquals(statuses.textContent, "Late");
    click(boxes[0]);
    await settle();
    assertEquals(statuses.textContent, "Open and 1 more");
    assertEquals(calls.at(-1)?.[1].statuses, ["open", "late"]);
    click(button(panel(), "Clear"));
    await settle();
    assertEquals(statuses.textContent, "All statuses");
    assertEquals(calls.at(-1)?.[1].statuses, []);
    act(() => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await settle();

    const search = one(
      view.container,
      "[data-filter=search] input",
    ) as HTMLInputElement;
    assertEquals(
      one(view.container, "[data-filter=search] label").textContent,
      "Search orders",
    );
    type(search, " A-10 ");
    assertEquals(calls.at(-1)?.[1].text, "A-10");

    click(button(view.container, "Reset filters"));
    await settle();
    assertEquals(calls.at(-1)?.[1], {
      from: "2026-09-07",
      to: "2026-10-06",
      statuses: [],
      text: "",
    });
    assertEquals(
      [...view.container.querySelectorAll("button")].some((element) =>
        element.textContent === "Reset filters"
      ),
      false,
    );
  } finally {
    await unmountSettled(view);
  }
});
