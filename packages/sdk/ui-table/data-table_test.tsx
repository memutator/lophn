import { assert, assertEquals } from "@std/assert";
import {
  click,
  focus,
  isFocused,
  manualTimer,
  one,
  pressAsync,
  render,
  settle,
} from "../../design/components/testing.ts";
import type { TableColumn } from "@lophn/design/components";
import { DataTable, type DataTableProps } from "./data-table.tsx";
import type { SortState } from "./model.ts";

interface Item {
  id: string;
  name: string;
  size: number | undefined;
}

const now = new Date("2026-10-04T12:00:00Z");
const columns: TableColumn<Item>[] = [
  { id: "id", header: "ID", kind: "id", value: (row) => row.id },
  { id: "name", header: "Name", kind: "text", value: (row) => row.name },
  { id: "size", header: "Size", kind: "number", value: (row) => row.size },
];

const items = (sizes: readonly (number | undefined)[]): Item[] =>
  sizes.map((size, index) => ({
    id: `item_${index}`,
    name: `Item ${index}`,
    size,
  }));

function view(
  props: Partial<DataTableProps<Item>> & { rows: readonly Item[] },
) {
  return (
    <DataTable
      columns={columns}
      rowKey={(row) => row.id}
      now={now}
      onRetry={() => {}}
      empty={{
        message: "Nothing here.",
        action: { label: "Add", onSelect: () => {} },
      }}
      {...props}
    />
  );
}

const keys = (root: HTMLElement) =>
  [...root.querySelectorAll("tbody tr[data-key]")].map((row) =>
    row.getAttribute("data-key")
  );

const button = (root: HTMLElement, label: string) =>
  one(root, `button[aria-label="${label}"]`);

Deno.test("apps/sdk#R16: 숫자 열 정렬은 방향 버튼으로 뒤집히고 빈 값은 끝에 남는다", () => {
  const changes: (SortState | null)[] = [];
  using rendered = render(view({
    rows: items([10, undefined, 9, 100]),
    defaultSort: { columnId: "size", direction: "ascending" },
    onSortChange: (sort) => changes.push(sort),
  }));
  assertEquals(keys(rendered.container), [
    "item_2",
    "item_0",
    "item_3",
    "item_1",
  ]);
  click(button(rendered.container, "Sort ascending"));
  assertEquals(keys(rendered.container), [
    "item_3",
    "item_0",
    "item_2",
    "item_1",
  ]);
  assertEquals(changes, [{ columnId: "size", direction: "descending" }]);
  assert(button(rendered.container, "Sort descending"));
});

Deno.test("apps/sdk#R16: Sort by에서 열을 고르면 그 열로 정렬하고 첫 페이지로 돌아간다", async () => {
  const pages: number[] = [];
  using rendered = render(view({
    rows: items([3, 1, 2, 5, 4]),
    pageSize: 2,
    onPageChange: (page) => pages.push(page),
  }));
  click(button(rendered.container, "Next page"));
  assertEquals(keys(rendered.container), ["item_2", "item_3"]);
  const trigger = one(rendered.container, "button[role=combobox]");
  focus(trigger);
  await pressAsync(trigger, "ArrowDown");
  // Original order → Name → Size
  await pressAsync(document.activeElement!, "ArrowDown");
  await pressAsync(document.activeElement!, "ArrowDown");
  await pressAsync(document.activeElement!, "Enter");
  assertEquals(trigger.textContent, "Size");
  assertEquals(keys(rendered.container), ["item_1", "item_2"]);
  assertEquals(pages, [1, 0]);
});

Deno.test("apps/sdk#R16: 페이지 줄은 행 범위를 보이고 행이 줄면 마지막 페이지로 당긴다", () => {
  using rendered = render(view({ rows: items([1, 2, 3, 4, 5]), pageSize: 2 }));
  const range = () => one(rendered.container, "[class*=range]").textContent;
  assertEquals(range(), "1–2 of 5");
  assert(
    (button(rendered.container, "Previous page") as HTMLButtonElement).disabled,
  );
  click(button(rendered.container, "Next page"));
  click(button(rendered.container, "Next page"));
  assertEquals(range(), "5–5 of 5");
  assert(
    (button(rendered.container, "Next page") as HTMLButtonElement).disabled,
  );
  rendered.rerender(view({ rows: items([1, 2, 3]), pageSize: 2 }));
  assertEquals(range(), "3–3 of 3");
  assertEquals(keys(rendered.container), ["item_2"]);
});

const columnsButton = (root: HTMLElement) =>
  [...root.querySelectorAll("button")].find((item) =>
    item.textContent === "Columns"
  )!;

const checkboxes =
  () => [...document.querySelectorAll("button[role=checkbox]")];

Deno.test("apps/sdk#R16: 열 선택은 Checkbox로 열을 숨기고 Escape로 닫으면 focus가 Columns 버튼으로 돌아온다", async () => {
  const chosen: (readonly string[])[] = [];
  using rendered = render(view({
    rows: items([1]),
    onVisibleColumnsChange: (ids) => chosen.push(ids),
  }));
  const trigger = columnsButton(rendered.container);
  click(trigger);
  await settle();
  assertEquals(trigger.getAttribute("aria-expanded"), "true");
  const boxes = checkboxes();
  assertEquals(boxes.length, 2);
  click(boxes[0]);
  assertEquals(chosen, [["size"]]);
  assertEquals(
    [...rendered.container.querySelectorAll("th")].map((th) => th.textContent),
    ["Size"],
  );
  // 마지막 남은 열은 끌 수 없다.
  assert((boxes[1] as HTMLButtonElement).disabled);
  focus(boxes[1]);
  await pressAsync(boxes[1], "Escape");
  assertEquals(trigger.getAttribute("aria-expanded"), "false");
  assert(isFocused(trigger), "focus did not return to Columns");
});

Deno.test("apps/sdk#R16 [ctx-I54]: Columns menu floats without moving Sort by", async () => {
  using rendered = render(view({ rows: items([1, 2]) }));
  const toolbar = one(rendered.container, "[class*=toolbar]");
  const sortBy = one(rendered.container, "[class*=sort]");
  const before = {
    toolbar: toolbar.children.length,
    index: [...toolbar.children].indexOf(sortBy),
    next: toolbar.nextElementSibling,
    sortParent: sortBy.parentElement,
  };
  const trigger = columnsButton(rendered.container);
  click(trigger);
  await settle();
  const boxes = checkboxes();
  assertEquals(boxes.length, 2);
  // 메뉴는 도구 줄 흐름 밖 popover 층에 그려진다.
  assert(!rendered.container.contains(boxes[0]), "menu is inside the table");
  assert(boxes[0].closest("[data-radix-popper-content-wrapper]"));
  assertEquals(toolbar.children.length, before.toolbar);
  assertEquals([...toolbar.children].indexOf(sortBy), before.index);
  assertEquals(toolbar.nextElementSibling, before.next);
  assertEquals(sortBy.parentElement, before.sortParent);
  assertEquals(rendered.container.querySelector("[class*=columnList]"), null);
});

Deno.test("apps/sdk#R16 [ctx-I54]: Escape closes the Columns menu and toggled columns stay hidden", async () => {
  using rendered = render(view({ rows: items([1]) }));
  const trigger = columnsButton(rendered.container);
  click(trigger);
  await settle();
  click(checkboxes()[0]);
  await pressAsync(checkboxes()[1], "Escape");
  await settle();
  assertEquals(checkboxes().length, 0);
  assertEquals(trigger.getAttribute("aria-expanded"), "false");
  assertEquals(
    [...rendered.container.querySelectorAll("th")].map((th) => th.textContent),
    ["Size"],
  );
  // 다시 열면 숨긴 열은 꺼진 채로 보인다.
  click(trigger);
  await settle();
  assertEquals(
    checkboxes().map((box) => box.getAttribute("aria-checked")),
    ["false", "true"],
  );
});

Deno.test("apps/sdk#R16: 1000행을 넘으면 component 안 scroll 칸에서 보이는 창만 그린다", () => {
  const sizes = Array.from({ length: 1500 }, (_, index) => index);
  using rendered = render(view({ rows: items(sizes) }));
  const frame = one(rendered.container, "[data-layout]");
  assertEquals(frame.getAttribute("data-layout"), "inline");
  const scroller = one(frame, "[data-virtual]");
  assert(frame.contains(scroller));
  assert(keys(rendered.container).length < 100);
  assertEquals(
    one(rendered.container, "[data-spacer=after]").getAttribute("data-rows"),
    String(1500 - keys(rendered.container).length),
  );
});

Deno.test("apps/sdk#R16: controlled 정렬·페이지·열 선택은 owner가 받을 때만 표시를 바꾼다", async () => {
  const changes: unknown[] = [];
  const props = {
    rows: items([3, 1, 2]),
    sort: { columnId: "size", direction: "ascending" as const },
    pageSize: 1,
    page: 0,
    visibleColumns: ["name", "size"],
    onSortChange: (value: SortState | null) => changes.push(value),
    onPageChange: (value: number) => changes.push(value),
    onVisibleColumnsChange: (value: readonly string[]) => changes.push(value),
  };
  using rendered = render(view(props));
  click(button(rendered.container, "Sort ascending"));
  click(button(rendered.container, "Next page"));
  click(columnsButton(rendered.container));
  await settle();
  click(checkboxes()[0]);
  assertEquals(changes, [
    { columnId: "size", direction: "descending" },
    1,
    ["size"],
  ]);
  assertEquals(keys(rendered.container), ["item_1"]);
  assertEquals(rendered.container.querySelectorAll("th").length, 2);
  rendered.rerender(view({
    ...props,
    sort: { columnId: "size", direction: "descending" },
    page: 1,
    visibleColumns: ["size"],
  }));
  assertEquals(keys(rendered.container), ["item_2"]);
  assertEquals(rendered.container.querySelectorAll("th").length, 1);
});

Deno.test("apps/sdk#R38: loading은 300ms 뒤에만 skeleton을 보이고 오류·빈 상태는 다음 행동 하나를 준다", () => {
  const timer = manualTimer();
  const retried: string[] = [];
  using rendered = render(view({ rows: [], loading: true, timer }));
  assertEquals(rendered.container.querySelector("[data-skeleton]"), null);
  timer.advance(299);
  assertEquals(rendered.container.querySelector("[data-skeleton]"), null);
  timer.advance(1);
  assert(rendered.container.querySelector("[data-skeleton]"));
  assertEquals(rendered.container.querySelector("table"), null);
  rendered.rerender(view({
    rows: [],
    failed: "orders",
    onRetry: () => retried.push("retry"),
  }));
  assertEquals(
    one(rendered.container, "[data-state=error]").textContent,
    "Couldn't load orders.Reload",
  );
  click(one(rendered.container, "[data-state=error] button"));
  assertEquals(retried, ["retry"]);
  rendered.rerender(view({ rows: [] }));
  const empty = one(rendered.container, "[data-state=empty]");
  assertEquals(empty.querySelectorAll("button").length, 1);
  assert(empty.textContent?.includes("Nothing here."));
});

Deno.test("apps/sdk#R38: 칸과 머리의 신뢰할 수 없는 글은 HTML로 해석하지 않고 글로만 보인다", () => {
  const hostile = '<img src=x onerror="globalThis.owned=1">';
  using rendered = render(
    <DataTable
      columns={[{
        id: "name",
        header: hostile,
        kind: "text",
        value: (row: Item) => row.name,
      }]}
      rows={[{ id: "a", name: hostile, size: 1 }]}
      rowKey={(row) => row.id}
      now={now}
      onRetry={() => {}}
      empty={{
        message: "Nothing here.",
        action: { label: "Add", onSelect: () => {} },
      }}
    />,
  );
  assertEquals(rendered.container.querySelector("img"), null);
  assertEquals(one(rendered.container, "th").textContent, hostile);
  assertEquals(one(rendered.container, "tbody td").textContent, hostile);
  assertEquals((globalThis as { owned?: number }).owned, undefined);
});

Deno.test("apps/sdk#R16 [ctx-I54]: link column passes through DataTable, sorts as text and opens the row", () => {
  const opened: Item[] = [];
  const rows = [
    { id: "b", name: "exp-010", size: 1 },
    { id: "a", name: "exp-009", size: 2 },
  ];
  using rendered = render(
    <DataTable
      columns={[{
        id: "name",
        header: "Name",
        kind: "link",
        value: (row: Item) => row.name,
        onOpen: (row: Item) => opened.push(row),
      }]}
      rows={rows}
      rowKey={(row) => row.id}
      now={now}
      defaultSort={{ columnId: "name", direction: "ascending" }}
      onRetry={() => {}}
      empty={{
        message: "Nothing here.",
        action: { label: "Add", onSelect: () => {} },
      }}
    />,
  );
  const links = [...rendered.container.querySelectorAll("td button")];
  assertEquals(links.map((item) => item.textContent), ["exp-009", "exp-010"]);
  click(links[0]);
  assertEquals(opened, [rows[1]]);
});

Deno.test("apps/sdk#R16 [ctx-T10c]: link column's dataAttributes reach the button through DataTable, also after a sort", () => {
  const rows = [
    { id: "b", name: "exp-010", size: 1 },
    { id: "a", name: "exp-009", size: 2 },
  ];
  using rendered = render(
    <DataTable
      columns={[{
        id: "name",
        header: "Name",
        kind: "link",
        value: (row: Item) => row.name,
        onOpen: () => {},
        dataAttributes: { "data-open-document": "" },
      }]}
      rows={rows}
      rowKey={(row) => row.id}
      now={now}
      defaultSort={{ columnId: "name", direction: "descending" }}
      onRetry={() => {}}
      empty={{
        message: "Nothing here.",
        action: { label: "Add", onSelect: () => {} },
      }}
    />,
  );
  const links = [...rendered.container.querySelectorAll("td button")];
  assertEquals(links.length, 2);
  assert(links.every((link) => link.hasAttribute("data-open-document")));
});
