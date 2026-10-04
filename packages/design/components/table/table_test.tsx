import { assert, assertEquals, assertThrows } from "@std/assert";
import { act } from "react";
import { ResizeSourceProvider } from "../resize.ts";
import { click, manualResize, one, render, settle, style } from "../testing.ts";
import type { Density } from "./model.ts";
import { Table, type TableColumn } from "./table.tsx";
import {
  domTableViewport,
  reservedHeight,
  type TableViewport,
} from "./viewport.ts";

interface File {
  id: string;
  name: string;
  size: number;
  changed: Date;
}

const now = new Date("2026-10-04T12:00:00Z");
const columns: TableColumn<File>[] = [
  { id: "id", header: "ID", kind: "id", value: (row) => row.id },
  { id: "name", header: "Name", kind: "text", value: (row) => row.name },
  {
    id: "size",
    header: "Size",
    unit: "MB",
    kind: "number",
    value: (row) => row.size,
  },
  {
    id: "changed",
    header: "Changed",
    kind: "time",
    value: (row) => row.changed,
  },
];

function files(count: number): File[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `file_${String(index).padStart(12, "0")}`,
    name: `Quarterly planning notes with a long title ${index}`,
    size: 1234.5 + index,
    changed: new Date(now.getTime() - 3 * 3_600_000),
  }));
}

function table(
  rows: File[],
  options: {
    density?: Density;
    diagnostics?: boolean;
    viewport?: TableViewport;
    writeText?: (text: string) => Promise<void>;
  } = {},
) {
  return (
    <Table
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      now={now}
      timeZone="UTC"
      density={options.density}
      diagnostics={options.diagnostics}
      viewport={options.viewport}
      clipboard={{ writeText: options.writeText ?? (() => Promise.resolve()) }}
    />
  );
}

Deno.test("shell/design-system#R30: 표는 행 36/44px·칸 12px/첫끝 16px·sticky 머리·1px subtle 선·줄무늬 없음이다", () => {
  using view = render(table(files(3)));
  const rows = [...view.container.querySelectorAll("tbody tr")];
  assertEquals(rows.length, 3);
  for (const row of rows) assertEquals(style(row).height, "36px");
  assertEquals(
    new Set(rows.map((row) => style(row).backgroundColor)).size,
    1,
  );
  const cells = [...rows[1].querySelectorAll("td")].map(style);
  assertEquals(cells.map((cell) => [cell.paddingLeft, cell.paddingRight]), [
    ["16px", "12px"],
    ["12px", "12px"],
    ["12px", "16px"],
  ]);
  for (const cell of cells) {
    assertEquals(cell.borderBottomWidth, "1px");
    assertEquals(cell.borderBottomColor, "#e8e7e2");
  }
  const head = style(one(view.container, "th"));
  assertEquals([head.position, head.top, head.zIndex], ["sticky", "0px", "10"]);
  // happy-dom은 부모 attribute가 바뀐 뒤 계산 style을 다시 읽지 않아 새로 그려 본다.
  using comfortable = render(table(files(3), { density: "comfortable" }));
  assertEquals(style(one(comfortable.container, "tbody tr")).height, "44px");
});

Deno.test("shell/design-system#R30: 숫자는 오른쪽·tabular, 단위는 머리에 한 번, 글은 말줄임과 tooltip이다", () => {
  using view = render(table(files(2)));
  const heads = [...view.container.querySelectorAll("th")];
  assertEquals(heads.map((head) => head.textContent), [
    "Name",
    "Size (MB)",
    "Changed",
  ]);
  assertEquals(style(heads[1]).textAlign, "right");
  const number = one(view.container, "td[data-kind=number]");
  assertEquals(number.textContent, "1,234.5");
  assertEquals(style(number).textAlign, "right");
  assertEquals(style(number).fontVariantNumeric, "tabular-nums");
  assert(!view.container.querySelector("tbody")!.textContent!.includes("MB"));
  const text = one(view.container, "td[data-kind=text]");
  assertEquals(text.title, "Quarterly planning notes with a long title 0");
  const computed = style(text);
  assertEquals(
    [computed.overflow, computed.textOverflow, computed.whiteSpace],
    ["hidden", "ellipsis", "nowrap"],
  );
});

Deno.test("shell/design-system#R30: 시각은 주입한 지금 기준 상대 시각과 Intl 절대 시각 tooltip이다", () => {
  using view = render(table(files(1)));
  const time = one(view.container, "time");
  assertEquals(time.textContent, "3 hours ago");
  assertEquals(time.getAttribute("datetime"), "2026-10-04T09:00:00.000Z");
  assertEquals(
    time.title,
    new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(new Date("2026-10-04T09:00:00Z")),
  );
});

Deno.test("shell/design-system#R30: ID는 diagnostics에서만 앞 8자와 복사로 보이고 기본 화면에는 없다", async () => {
  const copied: string[] = [];
  const writeText = (text: string) => {
    copied.push(text);
    return Promise.resolve();
  };
  using view = render(table(files(1), { writeText }));
  assertEquals(view.container.querySelectorAll("th").length, 3);
  assert(!view.container.textContent!.includes("file_"));
  assertEquals(view.container.querySelector("[aria-label='Copy ID']"), null);
  view.rerender(table(files(1), { diagnostics: true, writeText }));
  const id = one(view.container, "td[data-kind=id]");
  assertEquals(id.querySelector("code")!.textContent, "file_000");
  click(one(id, "button[aria-label='Copy ID']"));
  await Promise.resolve();
  assertEquals(copied, ["file_000000000000"]);
});

Deno.test("shell/design-system#R30: diagnostics ID 복사 실패는 칸 안 중립 문장이고 다시 누르면 성공해 지운다", async () => {
  let fail = true;
  const writeText = () =>
    fail ? Promise.reject(new Error("denied")) : Promise.resolve();
  using view = render(table(files(1), { diagnostics: true, writeText }));
  const button = one(view.container, "button[aria-label='Copy ID']");
  click(button);
  await settle();
  const cell = one(view.container, "td[data-kind=id]");
  assertEquals(
    one(cell, "[role=status]").textContent,
    "Couldn't copy. Try again.",
  );
  fail = false;
  click(button);
  await settle();
  assertEquals(cell.querySelector("[role=status]"), null);
});

function scripted() {
  const reserved: { edge: string; rows: number; density: Density }[] = [];
  let top = 0;
  const viewport: TableViewport = {
    scrollTop: () => top,
    reserve: (spacer, rows, density) =>
      reserved.push({ edge: spacer.dataset.spacer!, rows, density }),
  };
  return {
    viewport,
    reserved,
    scrollTo(scroller: Element, next: number) {
      top = next;
      act(() => {
        scroller.dispatchEvent(new Event("scroll", { bubbles: false }));
      });
    },
  };
}

function keys(container: HTMLElement): string[] {
  return [...container.querySelectorAll("tbody tr[data-key]")].map((row) =>
    (row as HTMLElement).dataset.key!
  );
}

Deno.test("shell/design-system#R30: 1,000행을 넘으면 scroll 위치와 칸 높이로 창만 그리고 위아래 자리를 행 수로 지킨다", () => {
  const resize = manualResize();
  const script = scripted();
  const rows = files(5000);
  using view = render(
    <ResizeSourceProvider value={resize}>
      {table(rows, { viewport: script.viewport })}
    </ResizeSourceProvider>,
  );
  resize.resize({ width: 900, height: 360 });
  const scroller = one(view.container, "[data-virtual]");
  assertEquals(keys(view.container).length, 18);
  assertEquals(script.reserved.at(-1), {
    edge: "after",
    rows: 4982,
    density: "compact",
  });
  script.scrollTo(scroller, 36_000);
  const shown = keys(view.container);
  assertEquals(shown[0], rows[992].id);
  assertEquals(shown.at(-1), rows[1017].id);
  assertEquals(
    script.reserved.slice(-2).map(({ edge, rows }) => [edge, rows]),
    [["before", 992], ["after", 3982]],
  );
  // 같은 행은 창이 움직여도 같은 DOM이다.
  const kept = one(view.container, `[data-key="${rows[1000].id}"]`);
  script.scrollTo(scroller, 36_036);
  assertEquals(keys(view.container)[0], rows[993].id);
  assert(one(view.container, `[data-key="${rows[1000].id}"]`) === kept);
  resize.resize({ width: 900, height: 720 });
  assertEquals(keys(view.container).length, 36);
});

Deno.test("shell/design-system#R30: 1,000행 이하는 모두 그리고 자리 행이 없다", () => {
  using view = render(table(files(1000), { viewport: scripted().viewport }));
  assertEquals(keys(view.container).length, 1000);
  assertEquals(view.container.querySelector("[data-spacer]"), null);
  assertEquals(view.container.querySelector("[data-virtual]"), null);
});

Deno.test("shell/design-system#R30: 기본 viewport는 DOM scroll 위치를 읽고 자리 높이를 행 수 × 행 token으로만 쓴다", () => {
  const resize = manualResize();
  const rows = files(2000);
  using view = render(
    <ResizeSourceProvider value={resize}>{table(rows)}</ResizeSourceProvider>,
  );
  resize.resize({ width: 900, height: 360 });
  const scroller = one(view.container, "[data-virtual]");
  const after = one(view.container, "[data-spacer=after]");
  assertEquals(after.style.height, "calc(1982 * var(--table-row-compact))");
  act(() => {
    scroller.scrollTop = 3600;
    scroller.dispatchEvent(new Event("scroll"));
  });
  assertEquals(keys(view.container)[0], rows[92].id);
  assertEquals(
    one(view.container, "[data-spacer=before]").style.height,
    "calc(92 * var(--table-row-compact))",
  );
  assertEquals(domTableViewport.scrollTop(scroller), 3600);
  assertEquals(
    reservedHeight(0, "comfortable"),
    "calc(0 * var(--table-row-comfortable))",
  );
  assertThrows(() => reservedHeight(-1, "compact"));
  assertThrows(() => reservedHeight(1.5, "compact"));
});
