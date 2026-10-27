// 앱 화면 예: 같은 데이터를 여섯 가지 차트로 보인다. 세션 시각 블록도 같은 props를 넘긴다.
// 색과 글꼴은 정본 token CSS를 그대로 불러 쓴다.
import "@lophn/ui/base.css";
import "@lophn/ui/tokens.css";
import { t } from "@lophn/wording";
import {
  BarChart,
  DistributionChart,
  GraphDiagram,
  LineChart,
  ScatterChart,
} from "@lophn/ui/data";

// 모든 차트에서 같은 domain을 넘겨 store를 걸러도 남은 store의 색이 그대로다.
export const STORES = ["north", "south", "online"] as const;

export const DAYS = [
  new Date("2026-09-24T00:00:00Z"),
  new Date("2026-09-25T00:00:00Z"),
  new Date("2026-09-26T00:00:00Z"),
];

export const SALES = [
  { key: "north", label: "North", values: [120, 140, 135] },
  { key: "south", label: "South", values: [80, null, 95] },
  { key: "online", label: "Online", values: [210, 250, 240] },
];

export const ORDER_SIZES = [12, 18, 22, 25, 31, 40, 41, 44, 58, 63, 70];

export const VISITS = [
  {
    key: "north",
    label: "North",
    points: [
      { x: 120, y: 14 },
      { x: 140, y: 18 },
    ],
  },
  { key: "online", label: "Online", points: [{ x: 210, y: 30 }] },
];

export const STEPS = {
  nodes: [
    { id: "order", label: "Order placed" },
    { id: "pack", label: "Packed" },
    { id: "ship", label: "Shipped" },
  ],
  edges: [
    { from: "order", to: "pack" },
    { from: "pack", to: "ship", label: "same day" },
  ],
};

export function SalesDashboard({
  loading,
  failed,
  reload,
}: {
  loading: boolean;
  failed: boolean;
  reload: () => void;
}) {
  const state = {
    loading,
    failed: failed ? "sales" : undefined,
    onRetry: reload,
    empty: {
      message: "No sales yet.",
      action: { label: t("common.button.reload"), onSelect: reload },
    },
    timeZone: "UTC",
  };
  return (
    <>
      <LineChart
        {...state}
        x={DAYS}
        series={SALES}
        domain={STORES}
        xLabel="Day"
      />
      <BarChart
        {...state}
        categories={["Sep 24", "Sep 25", "Sep 26"]}
        series={SALES}
        domain={STORES}
        xLabel="Day"
      />
      <BarChart
        {...state}
        stacked
        categories={["Sep 24", "Sep 25", "Sep 26"]}
        series={SALES}
        domain={STORES}
        xLabel="Day"
      />
      <DistributionChart
        {...state}
        values={ORDER_SIZES}
        valueLabel="Order size"
      />
      <ScatterChart
        {...state}
        groups={VISITS}
        domain={STORES}
        xLabel="Visits"
        yLabel="Orders"
      />
      <GraphDiagram {...state} nodes={STEPS.nodes} edges={STEPS.edges} />
    </>
  );
}
