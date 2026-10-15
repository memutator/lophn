// 앱 공간 page들이 같이 쓰는 고정 데이터. Orders 앱 하나의 release, 호출 기록, 문제, 바깥 자원이다.

export const APP_NAME = "Orders";

export type Effect = "read" | "write" | "external";

// ---- release ----

export interface Release {
  readonly id: string;
  readonly schema: string;
  readonly replaced: string;
}

/** 지금 활성인 release 앞의 release들. 지금 data schema(v4)와 같은 것만 돌아갈 수 있다. */
export const EARLIER_RELEASES: readonly Release[] = [
  { id: "r6", schema: "v4", replaced: "Oct 15, 13:58" },
  { id: "r5", schema: "v3", replaced: "Oct 11, 09:40" },
];

export const CURRENT_SCHEMA = "v4";

// ---- 바깥 자원 (Access) ----

export type ResourceKind = "network host" | "secret" | "file";

export interface Resource {
  readonly id: string;
  readonly kind: ResourceKind;
  readonly name: string;
  readonly detail: string;
}

export const RESOURCES: readonly Resource[] = [
  {
    id: "host",
    kind: "network host",
    name: "api.shipbob.com",
    detail: "Allowed when r7 was applied, Oct 15, 13:58",
  },
  {
    id: "secret",
    kind: "secret",
    name: "SHIPBOB_API_KEY",
    detail: "Name only. The value is never shown here.",
  },
  {
    id: "file",
    kind: "file",
    name: "~/Documents/orders-export",
    detail: "Read and write, allowed when r6 was applied",
  },
];

export interface AppApi {
  readonly id: string;
  readonly app: string;
  readonly api: string;
  readonly effect: Effect;
}

export const APP_APIS: readonly AppApi[] = [
  {
    id: "lookup",
    app: "Customers",
    api: "customers.lookup",
    effect: "read",
  },
  {
    id: "reserve",
    app: "Inventory",
    api: "stock.reserve",
    effect: "write",
  },
];

// ---- 호출 기록 (Activity) ----

export type CallerKind = "person" | "agent" | "app" | "start";

export interface Caller {
  readonly kind: CallerKind;
  /** 행에 보이는 이름. */
  readonly label: string;
  /** agent session의 이름. 눌러서 그 session으로 간다. */
  readonly session?: string;
}

export type CallState =
  | "done"
  | "failed"
  | "waiting"
  | "unknown";

export interface Invocation {
  readonly id: string;
  readonly time: string;
  readonly caller: Caller;
  readonly api: string;
  readonly project: string | null;
  readonly effect: Effect;
  readonly state: CallState;
  /** 되돌림이 이 호출을 되돌렸다. */
  readonly undone?: string;
  /** 지금 release보다 앞선 release의 호출이다. */
  readonly earlier?: string;
  /** 한 줄 요약. */
  readonly result: string;
}

const ANALYST: Caller = {
  kind: "agent",
  label: "Order analyst",
  session: "Weekly order digest",
};
const YOU: Caller = { kind: "person", label: "You (app screen)" };

/** 새것부터. 성공한 읽기는 기록하지 않으므로 실패한 읽기만 있다. */
export const INVOCATIONS: readonly Invocation[] = [
  {
    id: "i-41",
    time: "14:41",
    caller: { kind: "app", label: "Customers (app)" },
    api: "orders.attachNote",
    project: "grocery",
    effect: "write",
    state: "waiting",
    result: "Waiting behind the running write",
  },
  {
    id: "i-39",
    time: "14:39",
    caller: YOU,
    api: "orders.create",
    project: "phroner",
    effect: "write",
    state: "done",
    result: "Created order 1043",
  },
  {
    id: "i-38",
    time: "14:38",
    caller: ANALYST,
    api: "orders.exportToSheet",
    project: "phroner",
    effect: "external",
    state: "done",
    result: "Sent 31 rows to the Orders digest sheet",
  },
  {
    id: "i-36",
    time: "14:36",
    caller: ANALYST,
    api: "orders.refund",
    project: "phroner",
    effect: "write",
    state: "unknown",
    result: "Result unknown. lophn stopped during the call",
  },
  {
    id: "i-32",
    time: "14:32",
    caller: YOU,
    api: "orders.markShipped",
    project: "phroner",
    effect: "write",
    state: "done",
    result: "Order 1042 marked shipped",
  },
  {
    id: "i-22",
    time: "14:22",
    caller: YOU,
    api: "orders.markShipped",
    project: "phroner",
    effect: "write",
    state: "done",
    undone: "Oct 15, 14:30",
    result: "Order 1041 marked shipped",
  },
  {
    id: "i-20",
    time: "14:20",
    caller: ANALYST,
    api: "orders.cancel",
    project: "grocery",
    effect: "write",
    state: "done",
    undone: "Oct 15, 14:30",
    result: "Order 1040 cancelled",
  },
  {
    id: "i-11",
    time: "14:11",
    caller: YOU,
    api: "orders.list",
    project: "phroner",
    effect: "read",
    state: "failed",
    result: "Failed: the query timed out",
  },
  {
    id: "i-05",
    time: "13:58",
    caller: { kind: "start", label: "App start (r7)" },
    api: "start",
    project: null,
    effect: "write",
    state: "done",
    result: "Seeded 3 carriers",
  },
  {
    id: "i-r6",
    time: "13:20",
    caller: YOU,
    api: "orders.markShipped",
    project: "phroner",
    effect: "write",
    state: "done",
    earlier: "r6",
    result: "Order 1039 marked shipped",
  },
];

export const PROJECTS = ["All projects", "phroner", "grocery"] as const;

/** rewind panel이 가리키는 호출: 14:32 markShipped. */
export const REWIND_FROM = "i-32";

// ---- 문제 (Issues) ----

export type IssueStatus = "open" | "resolved" | "ignored";

export interface Occurrence {
  readonly time: string;
  readonly release: string;
  readonly kind: "App error" | "Report";
}

export interface Issue {
  readonly id: string;
  /** 영향 한 문장. */
  readonly impact: string;
  readonly status: IssueStatus;
  readonly count: number;
  readonly first: string;
  readonly last: string;
  /** 해결됨이던 문제가 다시 열렸다. */
  readonly recurred?: { readonly resolvedAt: string; readonly release: string };
  readonly occurrences: readonly Occurrence[];
  /** 원래 source 위치의 stack. */
  readonly stack: string;
  readonly log: string;
  readonly commit: string;
  readonly reports: readonly { readonly by: string; readonly text: string }[];
}

export const ISSUES: readonly Issue[] = [
  {
    id: "iss-1",
    impact:
      "Marking an order as shipped fails when the address has no postal code.",
    status: "open",
    count: 14,
    first: "Oct 12, 09:14",
    last: "Oct 15, 14:32",
    occurrences: [
      { time: "Oct 15, 14:32", release: "r7", kind: "App error" },
      { time: "Oct 15, 11:50", release: "r7", kind: "Report" },
      { time: "Oct 14, 16:03", release: "r6", kind: "App error" },
    ],
    stack:
      "TypeError: Cannot read properties of undefined (reading 'trim')\n  at normalizeAddress (src/orders/address.ts:27:31)\n  at markShipped (src/orders/ship.ts:48:11)",
    log:
      "14:32:07 orders.markShipped order=1042\n14:32:07 carrier lookup skipped: no postal code",
    commit: "3f9a1c2",
    reports: [
      { by: "Mina", text: "Shipping order 1042 just shows a red error." },
    ],
  },
  {
    id: "iss-2",
    impact: "Order totals are one cent off after a percentage discount.",
    status: "open",
    count: 5,
    first: "Oct 8, 10:02",
    last: "Oct 15, 14:21",
    recurred: { resolvedAt: "Oct 9, 16:20", release: "r7" },
    occurrences: [
      { time: "Oct 15, 14:21", release: "r7", kind: "Report" },
      { time: "Oct 15, 11:05", release: "r7", kind: "App error" },
      { time: "Oct 9, 09:12", release: "r5", kind: "Report" },
    ],
    stack:
      "RangeError: total mismatch (expected 4200, got 4199)\n  at roundTotal (src/orders/totals.ts:31:18)\n  at applyDiscount (src/orders/discount.ts:12:5)",
    log:
      "11:05:44 orders.create order=1038 discount=10%\n11:05:44 total check failed: 4199 != 4200",
    commit: "3f9a1c2",
    reports: [
      {
        by: "Mina",
        text: "The total says 41.99 but the 10% discount should give 42.00.",
      },
    ],
  },
  {
    id: "iss-3",
    impact: "The order list is empty when two filters are applied together.",
    status: "resolved",
    count: 3,
    first: "Oct 9, 13:30",
    last: "Oct 10, 08:45",
    occurrences: [
      { time: "Oct 10, 08:45", release: "r5", kind: "Report" },
    ],
    stack: "Error: empty result\n  at listOrders (src/orders/list.ts:64:9)",
    log: "08:45:10 orders.list filters=status,carrier rows=0",
    commit: "b81e7d0",
    reports: [{
      by: "Mina",
      text: "Filtering by status and carrier shows nothing.",
    }],
  },
  {
    id: "iss-4",
    impact: "A packing slip shows the customer's old address.",
    status: "ignored",
    count: 1,
    first: "Oct 13, 15:12",
    last: "Oct 13, 15:12",
    occurrences: [
      { time: "Oct 13, 15:12", release: "r6", kind: "Report" },
    ],
    stack: "No stack. This was a report from a person.",
    log: "No log lines near this report.",
    commit: "9d04ac1",
    reports: [{ by: "Mina", text: "The slip printed my old street." }],
  },
];

export const STATUS_LABEL: Record<IssueStatus, string> = {
  open: "Open",
  resolved: "Resolved",
  ignored: "Ignored",
};

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
