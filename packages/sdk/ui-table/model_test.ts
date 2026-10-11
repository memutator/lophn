import { assert, assertEquals } from "@std/assert";
import type { ColumnShape } from "./model.ts";
import {
  clampPage,
  pageCount,
  pageSlice,
  pickableColumns,
  sortable,
  sortRows,
  toggleColumn,
  validPageSize,
  visibleColumns,
} from "./model.ts";

interface Item {
  id: string;
  name: string | undefined;
  size: number | undefined;
  changed: Date | undefined;
}

const columns: (ColumnShape<Item> & { header: string })[] = [
  { id: "id", header: "ID", kind: "id", value: (row) => row.id },
  { id: "name", header: "Name", kind: "text", value: (row) => row.name },
  { id: "size", header: "Size", kind: "number", value: (row) => row.size },
  {
    id: "changed",
    header: "Changed",
    kind: "time",
    value: (row) => row.changed,
  },
];

const item = (
  id: string,
  size: number | undefined,
  name?: string,
  changed?: Date,
): Item => ({ id, name, size, changed });

const ids = (rows: readonly Item[]) => rows.map((row) => row.id);

Deno.test("apps/sdk#R16: 숫자 열은 글자가 아니라 수로 정렬하고 같은 값은 들어온 순서를 지킨다", () => {
  const rows = [
    item("a", 10),
    item("b", 9),
    item("c", 100),
    item("d", 9),
    item("e", -1),
  ];
  assertEquals(
    ids(
      sortRows(
        rows,
        columns,
        { columnId: "size", direction: "ascending" },
        "en",
      ),
    ),
    ["e", "b", "d", "a", "c"],
  );
  assertEquals(
    ids(
      sortRows(
        rows,
        columns,
        { columnId: "size", direction: "descending" },
        "en",
      ),
    ),
    ["c", "a", "b", "d", "e"],
  );
});

Deno.test("apps/sdk#R16: 빈 값·NaN·잘못된 날짜는 두 방향 모두 맨 뒤에 남는다", () => {
  const rows = [
    item("a", undefined),
    item("b", 2),
    item("c", Number.NaN),
    item("d", 1),
  ];
  for (const direction of ["ascending", "descending"] as const) {
    assertEquals(
      ids(sortRows(rows, columns, { columnId: "size", direction }, "en"))
        .slice(2),
      ["a", "c"],
    );
  }
  const dated = [
    item("x", 0, "", new Date(Number.NaN)),
    item("y", 0, "", new Date("2026-09-26T00:00:00Z")),
    item("z", 0, "", new Date("2026-09-25T00:00:00Z")),
  ];
  assertEquals(
    ids(
      sortRows(
        dated,
        columns,
        { columnId: "changed", direction: "descending" },
        "en",
      ),
    ),
    ["y", "z", "x"],
  );
});

Deno.test("apps/sdk#R16: 글 열은 locale collator로 숫자 조각을 수로 비교한다", () => {
  const rows = [
    item("a", 0, "file 10"),
    item("b", 0, "File 9"),
    item("c", 0, "file 1"),
  ];
  assertEquals(
    ids(
      sortRows(
        rows,
        columns,
        { columnId: "name", direction: "ascending" },
        "en",
      ),
    ),
    ["c", "b", "a"],
  );
});

Deno.test("apps/sdk#R16: 모르는 열·ID 열·정렬 없음은 들어온 순서를 그대로 둔다", () => {
  const rows = [item("b", 2), item("a", 1)];
  assertEquals(ids(sortRows(rows, columns, null, "en")), ["b", "a"]);
  assertEquals(
    ids(
      sortRows(
        rows,
        columns,
        { columnId: "gone", direction: "ascending" },
        "en",
      ),
    ),
    ["b", "a"],
  );
  assertEquals(
    ids(
      sortRows(rows, columns, { columnId: "id", direction: "ascending" }, "en"),
    ),
    ["b", "a"],
  );
});

Deno.test("apps/sdk#R16: 페이지는 행이 줄거나 크기가 바뀌어도 있는 페이지로 당긴다", () => {
  assertEquals(pageCount(0, 25), 1);
  assertEquals(pageCount(51, 25), 3);
  assertEquals(clampPage(5, 51, 25), 2);
  assertEquals(clampPage(-3, 51, 25), 0);
  assertEquals(clampPage(Number.NaN, 51, 25), 0);
  assertEquals(clampPage(1.7, 51, 25), 1);
  assertEquals(pageSlice(51, 9, 25), { start: 50, end: 51, page: 2, pages: 3 });
  // 정렬 뒤 행이 10개로 줄면 마지막 페이지로 당긴다.
  assertEquals(pageSlice(10, 2, 25), { start: 0, end: 10, page: 0, pages: 1 });
  assertEquals(pageSlice(10, 0, 4), { start: 0, end: 4, page: 0, pages: 3 });
});

Deno.test("apps/sdk#R16: 0·음수·소수·무한대 페이지 크기는 페이지를 나누지 않는다", () => {
  for (const size of [0, -5, 2.5, Number.POSITIVE_INFINITY, Number.NaN]) {
    assertEquals(validPageSize(size), undefined);
    assertEquals(pageSlice(30, 3, size), {
      start: 0,
      end: 30,
      page: 0,
      pages: 1,
    });
  }
});

Deno.test("apps/sdk#R16: 열 선택은 정의 순서를 지키고 마지막 열은 숨기지 않는다", () => {
  const pickable = pickableColumns(columns, false);
  assertEquals(pickable.map((column) => column.id), [
    "name",
    "size",
    "changed",
  ]);
  assertEquals(
    pickableColumns(columns, true).map((column) => column.id)[0],
    "id",
  );
  assertEquals(
    visibleColumns(pickable, ["changed", "name", "unknown"]).map((c) => c.id),
    ["name", "changed"],
  );
  assertEquals(visibleColumns(pickable, ["unknown"]).length, 3);
  assertEquals(toggleColumn(pickable, undefined, "size", false), [
    "name",
    "changed",
  ]);
  assertEquals(toggleColumn(pickable, ["changed"], "name", true), [
    "name",
    "changed",
  ]);
  assertEquals(toggleColumn(pickable, ["size"], "size", false), ["size"]);
});

Deno.test("apps/sdk#R16 [ctx-I54]: 링크 열은 글 열처럼 collator로 정렬되고 정렬할 수 있다", () => {
  const link = {
    id: "name",
    kind: "link" as const,
    value: (row: { name: string }) => row.name,
  };
  const rows = [{ name: "exp-10" }, { name: "exp-9" }];
  assert(sortable(link));
  assertEquals(
    sortRows(rows, [link], { columnId: "name", direction: "ascending" }, "en"),
    [rows[1], rows[0]],
  );
});
