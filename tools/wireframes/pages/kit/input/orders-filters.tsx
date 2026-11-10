// 앱 화면 예: 기간·창고·상태·검색으로 주문 read tool의 입력을 만들고 바뀔 때마다 그 tool을 부른다.
import { useState } from "react";
import { Store, Warehouse } from "lucide-react";
import { iconPixels } from "@lophn/ui/shared";
import { Icon } from "@lophn/ui/primitives";
import {
  type DateRange,
  DateRangeFilter,
  FilterBar,
  MultiSelectFilter,
  resolveRange,
  SearchFilter,
  SelectFilter,
} from "@lophn/ui/input";

// 앱 선언의 read tool 입력. tool 이름과 화면 문구는 따로 둔다.
export interface OrdersQuery {
  from: string;
  to: string;
  warehouse: string | null;
  statuses: string[];
  text: string;
}

interface Filters {
  range: DateRange;
  warehouse: string | null;
  statuses: string[];
  text: string;
}

const DEFAULT: Filters = {
  range: { preset: "last-30-days" },
  warehouse: null,
  statuses: [],
  text: "",
};

// 앱이 자기 catalog에서 가져오는 문구 자리다.
const TEXT = {
  allWarehouses: "All warehouses",
  seoul: "Seoul hub",
  busan: "Busan store",
  statuses: "statuses",
  search: "Search orders",
  open: "Open",
  shipped: "Shipped",
  late: "Late",
};

export function queryOf(filters: Filters, now: Date): OrdersQuery {
  return {
    ...resolveRange(filters.range, now),
    warehouse: filters.warehouse,
    statuses: filters.statuses,
    text: filters.text.trim(),
  };
}

// `call`은 앱 view의 `lophnApp.callOperation`이다.
export function OrdersFilters({
  now,
  call,
}: {
  now: Date;
  call: (command: string, input: OrdersQuery) => Promise<unknown>;
}) {
  const [filters, setFilters] = useState(DEFAULT);
  const update = (next: Filters) => {
    setFilters(next);
    void call("list-orders", queryOf(next, now));
  };
  const dirty =
    filters.range.preset !== DEFAULT.range.preset ||
    filters.warehouse !== null ||
    filters.statuses.length > 0 ||
    filters.text !== "";
  return (
    <FilterBar dirty={dirty} onReset={() => update(DEFAULT)}>
      <DateRangeFilter
        value={filters.range}
        now={now}
        onChange={(range) => update({ ...filters, range })}
      />
      <SelectFilter
        allLabel={TEXT.allWarehouses}
        options={[
          {
            value: "seoul",
            label: TEXT.seoul,
            icon: <Icon icon={Warehouse} pixels={iconPixels("base")} />,
          },
          {
            value: "busan",
            label: TEXT.busan,
            icon: <Icon icon={Store} pixels={iconPixels("base")} />,
          },
        ]}
        value={filters.warehouse}
        onChange={(warehouse) => update({ ...filters, warehouse })}
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
