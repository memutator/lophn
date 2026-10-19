// 앱 화면 예: 기간·상태·검색으로 주문 read tool의 입력을 만들고 바뀔 때마다 그 tool을 부른다.
import { useState } from "react";
import {
  type DateRange,
  DateRangeFilter,
  FilterBar,
  MultiSelectFilter,
  resolveRange,
  SearchFilter,
} from "@lophn/ui/input";

// 앱 blueprint의 read tool 입력. tool 이름과 화면 문구는 따로 둔다.
export interface OrdersQuery {
  from: string;
  to: string;
  statuses: string[];
  text: string;
}

interface Filters {
  range: DateRange;
  statuses: string[];
  text: string;
}

const DEFAULT: Filters = {
  range: { preset: "last-30-days" },
  statuses: [],
  text: "",
};

// 앱이 자기 catalog에서 가져오는 문구 자리다.
const TEXT = {
  statuses: "statuses",
  search: "Search orders",
  open: "Open",
  shipped: "Shipped",
  late: "Late",
};

export function queryOf(filters: Filters, now: Date): OrdersQuery {
  return {
    ...resolveRange(filters.range, now),
    statuses: filters.statuses,
    text: filters.text.trim(),
  };
}

// `call`은 앱 view의 `lophnApp.call`이다.
export function OrdersFilters(
  { now, call }: {
    now: Date;
    call: (command: string, input: OrdersQuery) => Promise<unknown>;
  },
) {
  const [filters, setFilters] = useState(DEFAULT);
  const update = (next: Filters) => {
    setFilters(next);
    void call("list-orders", queryOf(next, now));
  };
  const dirty = filters.range.preset !== DEFAULT.range.preset ||
    filters.statuses.length > 0 || filters.text !== "";
  return (
    <FilterBar dirty={dirty} onReset={() => update(DEFAULT)}>
      <DateRangeFilter
        value={filters.range}
        now={now}
        onChange={(range) => update({ ...filters, range })}
      />
      <MultiSelectFilter
        dimension={TEXT.statuses}
        options={[
          { value: "open", label: TEXT.open },
          { value: "shipped", label: TEXT.shipped },
          { value: "late", label: TEXT.late },
        ]}
        value={filters.statuses}
        onChange={(statuses) => update({ ...filters, statuses })}
      />
      <SearchFilter
        label={TEXT.search}
        value={filters.text}
        onChange={(text) => update({ ...filters, text })}
      />
    </FilterBar>
  );
}
