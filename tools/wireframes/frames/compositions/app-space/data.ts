// 앱 공간 gallery page들이 같이 쓰는 고정 데이터. 운영 패널과 문제 목록은 앞 화면의 fake source가 채우고 여기는 Orders 앱이 그린
// 화면과 coding 터미널의 가짜 출력에 쓰는 것만 둔다.

export const APP_NAME = "Orders";

// ---- 앱 화면 (Orders가 그린 view) ----

export interface OrderRow {
  readonly id: string;
  readonly customer: string;
  readonly status: "Open" | "Shipped";
  readonly total: string;
}

export const ORDER_ROWS: readonly OrderRow[] = [
  { id: "1043", customer: "Hana Park", status: "Open", total: "$18.50" },
  { id: "1042", customer: "Dae Kim", status: "Open", total: "$41.99" },
  { id: "1041", customer: "Jun Seo", status: "Shipped", total: "$73.00" },
  { id: "1040", customer: "Ari Choi", status: "Shipped", total: "$9.20" },
];

// ---- coding 터미널 ----

export const TICKET = "ORD-12";
export const TICKET_TITLE = "Round discounted totals to the nearest cent";
