// 표의 순수 규칙: 정렬, 페이지, 보이는 열. React·DOM을 모른다.

// @lophn/design의 TableColumn과 같은 모양. 컴포넌트 module(CSS)을 끌어오지 않으려고 필요한 만큼만 적는다.
export type ColumnKind = "text" | "number" | "time" | "id";

export interface ColumnShape<Row> {
  readonly id: string;
  readonly kind: ColumnKind;
  readonly value: (row: Row) => string | number | Date | undefined;
}

export type SortDirection = "ascending" | "descending";

export interface SortState {
  readonly columnId: string;
  readonly direction: SortDirection;
}

type SortValue = string | number | Date | undefined;

// 빈 값(undefined, NaN, 잘못된 Date)은 정렬 방향과 상관없이 맨 뒤에 둔다.
function empty(value: SortValue): boolean {
  if (value === undefined) return true;
  if (typeof value === "number") return Number.isNaN(value);
  if (value instanceof Date) return Number.isNaN(value.getTime());
  return false;
}

function comparer(
  kind: ColumnKind,
  locale: string,
): (a: SortValue, b: SortValue) => number {
  if (kind === "number") return (a, b) => (a as number) - (b as number);
  if (kind === "time") {
    return (a, b) => (a as Date).getTime() - (b as Date).getTime();
  }
  const collator = new Intl.Collator(locale, {
    numeric: true,
    sensitivity: "base",
  });
  return (a, b) => collator.compare(a as string, b as string);
}

export function sortable(column: { kind: ColumnKind }): boolean {
  return column.kind !== "id";
}

// 안정 정렬. 같은 값은 들어온 순서를 지킨다. 알 수 없는 열이면 들어온 순서 그대로다.
export function sortRows<Row>(
  rows: readonly Row[],
  columns: readonly ColumnShape<Row>[],
  sort: SortState | null,
  locale: string,
): readonly Row[] {
  const column = sort && columns.find((item) => item.id === sort.columnId);
  if (!sort || !column || !sortable(column)) return rows;
  const compare = comparer(column.kind, locale);
  const sign = sort.direction === "ascending" ? 1 : -1;
  const read = column.value;
  return rows
    .map((row, index) => ({ row, index, value: read(row) }))
    .sort((a, b) => {
      const aEmpty = empty(a.value);
      const bEmpty = empty(b.value);
      if (aEmpty || bEmpty) {
        return aEmpty === bEmpty ? a.index - b.index : aEmpty ? 1 : -1;
      }
      return sign * compare(a.value, b.value) || a.index - b.index;
    })
    .map((item) => item.row);
}

// 0이나 음수, 소수, 무한대 같은 잘못된 크기는 페이지를 나누지 않는 것으로 본다.
export function validPageSize(
  pageSize: number | undefined,
): number | undefined {
  return pageSize !== undefined && Number.isSafeInteger(pageSize) &&
      pageSize > 0
    ? pageSize
    : undefined;
}

export function pageCount(total: number, pageSize: number | undefined): number {
  const size = validPageSize(pageSize);
  return size === undefined ? 1 : Math.max(1, Math.ceil(total / size));
}

// 행이 줄거나 페이지 크기가 바뀌어도 언제나 있는 페이지(0부터)를 가리킨다.
export function clampPage(
  page: number,
  total: number,
  pageSize: number | undefined,
): number {
  const last = pageCount(total, pageSize) - 1;
  if (!Number.isFinite(page)) return 0;
  return Math.min(last, Math.max(0, Math.floor(page)));
}

export interface PageSlice {
  // 보이는 행 [start, end). 사람에게는 start + 1부터 보인다.
  readonly start: number;
  readonly end: number;
  readonly page: number;
  readonly pages: number;
}

export function pageSlice(
  total: number,
  page: number,
  pageSize: number | undefined,
): PageSlice {
  const size = validPageSize(pageSize);
  if (size === undefined) return { start: 0, end: total, page: 0, pages: 1 };
  const current = clampPage(page, total, size);
  const start = current * size;
  return {
    start,
    end: Math.min(total, start + size),
    page: current,
    pages: pageCount(total, size),
  };
}

// 고를 수 있는 열. 내부 ID 열은 diagnostics에서만 나온다.
export function pickableColumns<
  C extends Pick<ColumnShape<never>, "id" | "kind">,
>(
  columns: readonly C[],
  diagnostics: boolean,
): readonly C[] {
  return columns.filter((column) => diagnostics || column.kind !== "id");
}

// 열 순서는 정의 순서를 따른다. 모르는 id는 무시하고, 남는 열이 없으면 모두 보인다.
export function visibleColumns<
  C extends Pick<ColumnShape<never>, "id" | "kind">,
>(
  columns: readonly C[],
  visible: readonly string[] | undefined,
): readonly C[] {
  if (visible === undefined) return columns;
  const wanted = new Set(visible);
  const shown = columns.filter((column) => wanted.has(column.id));
  return shown.length > 0 ? shown : columns;
}

// 마지막 남은 열은 숨기지 않는다. 결과는 정의 순서다.
export function toggleColumn<C extends Pick<ColumnShape<never>, "id" | "kind">>(
  columns: readonly C[],
  visible: readonly string[] | undefined,
  id: string,
  show: boolean,
): readonly string[] {
  const current = new Set(
    visibleColumns(columns, visible).map((column) => column.id),
  );
  if (show) current.add(id);
  else if (current.size > 1) current.delete(id);
  return columns.filter((column) => current.has(column.id)).map((column) =>
    column.id
  );
}
