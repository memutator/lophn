// Table 견본과 layout 견본(TableFrame)이 같이 쓰는 주문 몇 줄.
import type { TableColumn } from "@lophn/ui/data";

export interface Order {
  id: string;
  customer: string;
  total: number | undefined;
  placed: Date;
}

export const ORDERS: readonly Order[] = [
  {
    id: "ord_a1",
    customer: "Harbor Books",
    total: 125,
    placed: new Date("2026-10-10T09:00:00Z"),
  },
  {
    id: "ord_a2",
    customer: "Yeon-ho Kim",
    total: 1843.5,
    placed: new Date("2026-10-08T16:30:00Z"),
  },
  {
    id: "ord_a3",
    customer: "Northwind",
    total: undefined,
    placed: new Date("2026-09-30T08:00:00Z"),
  },
  {
    id: "ord_a4",
    customer: "민아 상점",
    total: 64,
    placed: new Date("2026-09-12T11:15:00Z"),
  },
];

export const COLUMNS: readonly TableColumn<Order>[] = [
  { id: "id", header: "Order ID", kind: "id", value: (row) => row.id },
  {
    id: "customer",
    header: "Customer",
    kind: "text",
    value: (row) => row.customer,
  },
  {
    id: "total",
    header: "Total",
    unit: "USD",
    kind: "number",
    value: (row) => row.total,
  },
  { id: "placed", header: "Placed", kind: "time", value: (row) => row.placed },
];
