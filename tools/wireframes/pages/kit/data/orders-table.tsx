// 앱 화면 예: 주문 목록을 금액으로 정렬하고 25행씩 나누어 본다. 같은 props를 세션 시각 블록도 넘긴다.
import { t } from "@lophn/wording";
import { DataTable, type TableColumn } from "@lophn/ui/data";

export interface Order {
  id: string;
  customer: string;
  total: number | undefined;
  placed: Date;
}

export const ORDER_COLUMNS: readonly TableColumn<Order>[] = [
  { id: "id", header: "Order ID", kind: "id", value: (order) => order.id },
  {
    id: "customer",
    header: "Customer",
    kind: "text",
    value: (order) => order.customer,
  },
  {
    id: "total",
    header: "Total",
    unit: "USD",
    kind: "number",
    value: (order) => order.total,
  },
  {
    id: "placed",
    header: "Placed",
    kind: "time",
    value: (order) => order.placed,
  },
];

export function OrdersTable({
  orders,
  now,
  loading,
  failed,
  reload,
}: {
  orders: readonly Order[];
  // 상대 시각의 기준은 앱의 clock에서 받는다.
  now: Date;
  loading: boolean;
  failed: boolean;
  reload: () => void;
}) {
  return (
    <DataTable
      columns={ORDER_COLUMNS}
      rows={orders}
      rowKey={(order) => order.id}
      now={now}
      defaultSort={{ columnId: "total", direction: "descending" }}
      pageSize={25}
      loading={loading}
      failed={failed ? "orders" : undefined}
      onRetry={reload}
      empty={{
        message: "No orders yet.",
        action: { label: t("common.button.reload"), onSelect: reload },
      }}
    />
  );
}
