// 블록 renderer 테스트의 시각 블록. contracts#T30 VisualBlock 모양 그대로이며 registry_test가
// contract schema로도 통과하는지 본다.
const ULID = "01h455vb4pex5v6nkc6gd5fdw1";
export const DOC = `doc_${ULID}`;
export const VER = `ver_${ULID}`;
export const APP = `app_${ULID}`;
export const REL = `rel_${ULID}`;
export const TCL = `tcl_${ULID}`;
export const OBSERVED = "2026-10-05T08:30:00.000Z";

export const documentSource = {
  kind: "document",
  reference: { document: DOC, version: VER, section: "Spend" },
  observed_at: null,
};

export const appSource = {
  kind: "app_command",
  reference: { app: APP, release: REL, command: "list_orders", tool_call: TCL },
  observed_at: OBSERVED,
};

export const estimateSource = {
  kind: "estimate",
  reference: { label: "lophn's estimate from last week" },
  observed_at: null,
};

export const tableBlock = {
  key: "orders",
  schema_version: 1,
  kind: "table",
  title: "Open orders",
  description: "Orders that are not shipped yet. One total is missing.",
  sources: [appSource],
  payload: {
    columns: [
      { key: "customer", label: "Customer", type: "string" },
      { key: "total", label: "Total", type: "number", unit: "USD" },
      { key: "paid", label: "Paid", type: "boolean" },
    ],
    rows: [
      { customer: "Harbor Books", total: 125, paid: true },
      { customer: "Lumen Cafe", total: null, paid: false },
    ],
  },
};

export const barBlock = {
  key: "spend",
  schema_version: 1,
  kind: "chart",
  title: "Monthly spend",
  description: "Spend per month from the budget document.",
  sources: [documentSource],
  payload: {
    type: "bar",
    x: { label: "Month", type: "category" },
    y: { label: "Spend", unit: "USD" },
    series: [{
      key: "spend",
      label: "Spend",
      points: [{ x: "Aug", y: 1200 }, { x: "Sep", y: 900 }, {
        x: "Oct",
        y: null,
      }],
    }],
  },
};

export const lineBlock = {
  key: "visits",
  schema_version: 1,
  kind: "chart",
  title: "Visits",
  description: "Daily visits.",
  sources: [estimateSource],
  payload: {
    type: "line",
    x: { label: "Day", type: "time" },
    y: { label: "Visits" },
    series: [{
      key: "visits",
      label: "Visits",
      points: [
        { x: "2026-10-01T00:00:00.000Z", y: 10 },
        { x: "2026-10-02T00:00:00.000Z", y: 14 },
        { x: "2026-10-03T00:00:00.000Z", y: 12 },
      ],
    }],
  },
};

export const scatterBlock = {
  key: "size-cost",
  schema_version: 1,
  kind: "chart",
  title: "Size and cost",
  description: "Each point is one order.",
  sources: [],
  payload: {
    type: "scatter",
    x: { label: "Items", type: "number" },
    y: { label: "Cost" },
    series: [{
      key: "orders",
      label: "Orders",
      points: [{ x: 1, y: 3 }, { x: 4, y: 9 }, { x: 2, y: null }],
    }],
  },
};

export const categoryLineBlock = {
  key: "steps",
  schema_version: 1,
  kind: "chart",
  title: "Steps",
  description: "Steps by stage.",
  sources: [],
  payload: {
    type: "line",
    x: { label: "Stage", type: "category" },
    y: { label: "Count" },
    series: [{
      key: "count",
      label: "Count",
      points: [{ x: "Draft", y: 3 }, { x: "Review", y: 1 }],
    }],
  },
};

export const diagramBlock = {
  key: "flow",
  schema_version: 1,
  kind: "diagram",
  title: "Order flow",
  description: "How an order moves.",
  sources: [],
  payload: {
    nodes: [
      { key: "new", label: "New", description: "The order arrived." },
      { key: "paid", label: "Paid" },
      { key: "shipped", label: "Shipped" },
    ],
    edges: [
      { from: "new", to: "paid", label: "pay" },
      { from: "paid", to: "shipped" },
    ],
  },
};

export const appCardBlock = {
  key: "card",
  schema_version: 1,
  kind: "app_card",
  title: "Orders card",
  description: "The orders app's card.",
  sources: [],
  payload: { app: APP, release: REL, view: "summary", input: { range: "7d" } },
};

export const VALID_BLOCKS = [
  tableBlock,
  barBlock,
  lineBlock,
  scatterBlock,
  categoryLineBlock,
  diagramBlock,
  appCardBlock,
] as const;
