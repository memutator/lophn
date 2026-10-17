// Kit · data. @lophn/ui/data의 모든 component를 상태별로, 그리고 예제(orders-table, orders-summary, sales-dashboard).
import type { ReactNode } from "react";
import { Rows3 } from "lucide-react";
import { Skeleton } from "@lophn/ui/feedback";
import {
  BarChart,
  DataState,
  DataTable,
  DistributionChart,
  GraphDiagram,
  LineChart,
  List,
  ListItem,
  ScatterChart,
  StatRow,
  StatTile,
  Table,
  Tree,
  type TreeNode,
} from "@lophn/ui/data";

import { COLUMNS, ORDERS } from "./orders-rows.ts";
import { OrdersSummary } from "./orders-summary.tsx";
import { OrdersTable } from "./orders-table.tsx";
import {
  DAYS,
  ORDER_SIZES,
  SALES,
  SalesDashboard,
  STEPS,
  STORES,
  VISITS,
} from "./sales-dashboard.tsx";
import { Example, kit, Page, Row, Section } from "../kit.tsx";

const NOW = new Date("2026-10-11T12:00:00Z");
const EXAMPLE_NOW = new Date("2026-10-06T15:30:00Z");
const NOOP = () => {};

const clipboard = { writeText: () => Promise.resolve() };

// 300ms를 기다리지 않고 바로 지난 것으로 쳐서 loading의 skeleton이 그려진다.
const SKELETON_NOW = {
  set: (callback: () => void) => (callback(), 0),
  clear: NOOP,
};

const RELOAD = {
  message: "No data yet.",
  action: { label: "Reload", onSelect: NOOP },
};
const CATEGORIES = ["Sep 24", "Sep 25", "Sep 26"];

const CHART_STATE = { onRetry: NOOP, empty: RELOAD, timeZone: "UTC" };

// 차트는 칸 폭을 재서 그린다. Row의 value 안에서 폭을 다 쓰게 한다.
function Wide({ children }: { children: ReactNode }) {
  return (
    <div style={{ flex: 1, minWidth: "var(--layout-container-panel)" }}>
      {children}
    </div>
  );
}

const TREE: readonly TreeNode[] = [
  {
    id: "docs",
    label: "docs",
    children: [{ id: "docs/plan.md", label: "plan.md" }, {
      id: "docs/notes.md",
      label: "notes.md",
    }],
  },
  {
    id: "eval",
    label: "eval",
    children: [
      {
        id: "eval/experiments",
        label: "experiments",
        children: [{
          id: "eval/experiments/exp-008.md",
          label: "exp-008-query-tools.md",
        }],
      },
    ],
  },
  { id: "README.md", label: "README.md" },
];

const TABLE_ORDERS = [
  {
    id: "ord_1",
    customer: "Harbor Books",
    total: 125,
    placed: new Date("2026-10-04T09:00:00Z"),
  },
  {
    id: "ord_2",
    customer: "Yeon-ho Kim",
    total: 1843.5,
    placed: new Date("2026-10-02T16:30:00Z"),
  },
  {
    id: "ord_3",
    customer: "Northwind",
    total: 64,
    placed: new Date("2026-09-28T08:00:00Z"),
  },
  {
    id: "ord_4",
    customer: "Minah Shop",
    total: undefined,
    placed: new Date("2026-09-12T11:15:00Z"),
  },
];

export function KitData() {
  return (
    <Page>
      <Section
        title="Tree"
        note="행 28px, 깊이당 12px. 지금 연 항목은 왼쪽 표시, 선택은 배경. 가지는 펼침과 접힘이 있다."
      >
        <Row label="expanded">
          <div className={kit.panel}>
            <Tree
              nodes={TREE}
              expanded={new Set(["docs", "eval", "eval/experiments"])}
              onExpandedChange={NOOP}
              currentId="eval/experiments/exp-008.md"
              selectedIds={new Set(["docs/notes.md"])}
              label="Folders"
            />
          </div>
        </Row>
        <Row label="collapsed">
          <div className={kit.panel}>
            <Tree
              nodes={TREE}
              expanded={new Set()}
              onExpandedChange={NOOP}
              label="Folders"
            />
          </div>
        </Row>
      </Section>
      <Section
        title="List and ListItem"
        note="selected는 지금 항목, onSelect가 있으면 항목 전체가 버튼이다."
      >
        <Row label="mixed">
          <div className={kit.panel}>
            <List>
              <ListItem title="Grocery budget" meta="12 documents" />
              <ListItem
                title="Home office"
                meta="4 documents"
                selected
                onSelect={NOOP}
              />
              <ListItem title="phroner" meta="Tracking files" onSelect={NOOP} />
            </List>
          </div>
        </Row>
      </Section>
      <Section
        title="Table"
        note="id 열은 진단이 아니면 그리지 않는다. 숫자는 오른쪽 맞춤이고 값이 없으면 빈 표시다."
      >
        <Row label="compact (default)">
          <Wide>
            <Table
              columns={COLUMNS}
              rows={ORDERS}
              rowKey={(row) => row.id}
              now={NOW}
            />
          </Wide>
        </Row>
        <Row label="comfortable">
          <Wide>
            <Table
              columns={COLUMNS}
              rows={ORDERS}
              rowKey={(row) => row.id}
              now={NOW}
              density="comfortable"
            />
          </Wide>
        </Row>
        <Row label="diagnostics">
          <Wide>
            <Table
              columns={COLUMNS}
              rows={ORDERS.slice(0, 2)}
              rowKey={(row) => row.id}
              now={NOW}
              diagnostics
              clipboard={clipboard}
            />
          </Wide>
        </Row>
      </Section>
      <Section
        title="DataTable"
        note="정렬·페이지·열 고르기와 loading·error·empty를 갖춘 표. 상태는 props로 건다."
      >
        <Row label="sorted descending">
          <Wide>
            <DataTable
              columns={COLUMNS}
              rows={ORDERS}
              rowKey={(row) => row.id}
              now={NOW}
              defaultSort={{ columnId: "total", direction: "descending" }}
              onRetry={NOOP}
              empty={RELOAD}
            />
          </Wide>
        </Row>
        <Row label="sorted ascending">
          <Wide>
            <DataTable
              columns={COLUMNS}
              rows={ORDERS}
              rowKey={(row) => row.id}
              now={NOW}
              defaultSort={{ columnId: "customer", direction: "ascending" }}
              onRetry={NOOP}
              empty={RELOAD}
            />
          </Wide>
        </Row>
        <Row label="pageSize 2">
          <Wide>
            <DataTable
              columns={COLUMNS}
              rows={ORDERS}
              rowKey={(row) => row.id}
              now={NOW}
              pageSize={2}
              onRetry={NOOP}
              empty={RELOAD}
            />
          </Wide>
        </Row>
        <Row label="visibleColumns">
          <Wide>
            <DataTable
              columns={COLUMNS}
              rows={ORDERS}
              rowKey={(row) => row.id}
              now={NOW}
              visibleColumns={["customer", "total"]}
              onRetry={NOOP}
              empty={RELOAD}
            />
          </Wide>
        </Row>
        <Row label="loading">
          <Wide>
            <DataTable
              columns={COLUMNS}
              rows={ORDERS}
              rowKey={(row) => row.id}
              now={NOW}
              loading
              timer={SKELETON_NOW}
              onRetry={NOOP}
              empty={RELOAD}
            />
          </Wide>
        </Row>
        <Row label="empty">
          <Wide>
            <DataTable
              columns={COLUMNS}
              rows={[]}
              rowKey={(row) => row.id}
              now={NOW}
              onRetry={NOOP}
              empty={RELOAD}
            />
          </Wide>
        </Row>
        <Row label="error">
          <Wide>
            <DataTable
              columns={COLUMNS}
              rows={ORDERS}
              rowKey={(row) => row.id}
              now={NOW}
              failed="orders"
              onRetry={NOOP}
              empty={RELOAD}
            />
          </Wide>
        </Row>
      </Section>
      <Section
        title="DataState"
        note="loading, error, empty, 내용 중 하나만 그린다. 표가 아닌 data 화면에도 쓴다."
      >
        <Row label="content">
          <DataState
            onRetry={NOOP}
            empty={RELOAD}
            defaultIcon={Rows3}
            isEmpty={false}
            placeholder={<Skeleton lines={3} />}
          >
            <div className={kit.panel}>Content</div>
          </DataState>
        </Row>
        <Row label="loading">
          <DataState
            loading
            timer={SKELETON_NOW}
            onRetry={NOOP}
            empty={RELOAD}
            defaultIcon={Rows3}
            isEmpty={false}
            placeholder={<Skeleton lines={3} />}
          >
            <div className={kit.panel}>Content</div>
          </DataState>
        </Row>
        <Row label="empty">
          <Wide>
            <DataState
              onRetry={NOOP}
              empty={RELOAD}
              defaultIcon={Rows3}
              isEmpty
              placeholder={<Skeleton lines={3} />}
            >
              <div className={kit.panel}>Content</div>
            </DataState>
          </Wide>
        </Row>
        <Row label="error">
          <Wide>
            <DataState
              failed="report"
              onRetry={NOOP}
              empty={RELOAD}
              defaultIcon={Rows3}
              isEmpty={false}
              placeholder={<Skeleton lines={3} />}
            >
              <div className={kit.panel}>Content</div>
            </DataState>
          </Wide>
        </Row>
      </Section>
      <Section
        title="StatTile"
        note="변화는 부호와 방향 아이콘을 함께 쓴다. 변화량을 주지 않으면 수치만 보인다."
      >
        <Row label="up">
          <StatTile
            label="Orders"
            value={1284}
            change={144}
            changeLabel="vs last period"
          />
        </Row>
        <Row label="down, unit">
          <StatTile
            label="Revenue"
            value={182400}
            unit="USD"
            change={-7600}
            changeLabel="vs last period"
          />
        </Row>
        <Row label="flat">
          <StatTile
            label="Late shipments"
            value={2}
            change={0}
            changeLabel="vs last period"
          />
        </Row>
        <Row label="no change">
          <StatTile label="Open questions" value={3} />
        </Row>
      </Section>
      <Section title="StatRow" note="한 줄 최대 네 개. 좁은 칸에서는 두 개씩.">
        <StatRow>
          <StatTile
            label="Orders"
            value={1284}
            change={144}
            changeLabel="vs last period"
          />
          <StatTile
            label="Revenue"
            value={182400}
            unit="USD"
            change={-7600}
            changeLabel="vs last period"
          />
          <StatTile
            label="Late shipments"
            value={2}
            change={0}
            changeLabel="vs last period"
          />
          <StatTile label="Open questions" value={3} />
        </StatRow>
      </Section>
      <Section
        title="LineChart"
        note="시계열. 상태는 값 있음, 비어 있음, 오류."
      >
        <Row label="values">
          <Wide>
            <LineChart
              {...CHART_STATE}
              x={DAYS}
              series={SALES}
              domain={STORES}
              xLabel="Day"
            />
          </Wide>
        </Row>
        <Row label="empty">
          <Wide>
            <LineChart {...CHART_STATE} x={[]} series={[]} xLabel="Day" />
          </Wide>
        </Row>
        <Row label="error">
          <Wide>
            <LineChart
              {...CHART_STATE}
              failed="sales"
              x={DAYS}
              series={SALES}
              xLabel="Day"
            />
          </Wide>
        </Row>
      </Section>
      <Section
        title="BarChart"
        note="범주별 값 비교. stacked로 쌓는다."
      >
        <Row label="values">
          <Wide>
            <BarChart
              {...CHART_STATE}
              categories={CATEGORIES}
              series={SALES}
              domain={STORES}
              xLabel="Day"
            />
          </Wide>
        </Row>
        <Row label="stacked">
          <Wide>
            <BarChart
              {...CHART_STATE}
              stacked
              categories={CATEGORIES}
              series={SALES}
              domain={STORES}
              xLabel="Day"
            />
          </Wide>
        </Row>
        <Row label="empty">
          <Wide>
            <BarChart
              {...CHART_STATE}
              categories={[]}
              series={[]}
              xLabel="Day"
            />
          </Wide>
        </Row>
        <Row label="error">
          <Wide>
            <BarChart
              {...CHART_STATE}
              failed="sales"
              categories={CATEGORIES}
              series={SALES}
              xLabel="Day"
            />
          </Wide>
        </Row>
      </Section>
      <Section
        title="DistributionChart"
        note="잰 값들의 분포를 구간별 수로 보인다."
      >
        <Row label="values">
          <Wide>
            <DistributionChart
              {...CHART_STATE}
              values={ORDER_SIZES}
              valueLabel="Order size"
            />
          </Wide>
        </Row>
        <Row label="empty">
          <Wide>
            <DistributionChart
              {...CHART_STATE}
              values={[]}
              valueLabel="Order size"
            />
          </Wide>
        </Row>
        <Row label="error">
          <Wide>
            <DistributionChart
              {...CHART_STATE}
              failed="sales"
              values={ORDER_SIZES}
              valueLabel="Order size"
            />
          </Wide>
        </Row>
      </Section>
      <Section
        title="ScatterChart"
        note="두 값의 관계를 점으로 본다. 3계열까지만 그린다."
      >
        <Row label="values">
          <Wide>
            <ScatterChart
              {...CHART_STATE}
              groups={VISITS}
              domain={STORES}
              xLabel="Visits"
              yLabel="Orders"
            />
          </Wide>
        </Row>
        <Row label="empty">
          <Wide>
            <ScatterChart
              {...CHART_STATE}
              groups={[]}
              xLabel="Visits"
              yLabel="Orders"
            />
          </Wide>
        </Row>
        <Row label="error">
          <Wide>
            <ScatterChart
              {...CHART_STATE}
              failed="sales"
              groups={VISITS}
              xLabel="Visits"
              yLabel="Orders"
            />
          </Wide>
        </Row>
      </Section>
      <Section
        title="GraphDiagram"
        note="node와 edge의 연결 구조. 값의 크기가 아니라 관계를 보인다."
      >
        <Row label="values">
          <Wide>
            <GraphDiagram
              {...CHART_STATE}
              nodes={STEPS.nodes}
              edges={STEPS.edges}
            />
          </Wide>
        </Row>
        <Row label="empty">
          <Wide>
            <GraphDiagram {...CHART_STATE} nodes={[]} edges={[]} />
          </Wide>
        </Row>
        <Row label="error">
          <Wide>
            <GraphDiagram
              {...CHART_STATE}
              failed="sales"
              nodes={STEPS.nodes}
              edges={STEPS.edges}
            />
          </Wide>
        </Row>
      </Section>
      <Section
        title="orders-table"
        note="금액으로 정렬하고 25행씩 나누어 본다."
      >
        <Example>
          <OrdersTable
            orders={TABLE_ORDERS}
            now={EXAMPLE_NOW}
            loading={false}
            failed={false}
            reload={NOOP}
          />
        </Example>
      </Section>
      <Section
        title="orders-summary"
        note="이번 기간과 지난 기간 값으로 수치와 변화량을 보인다."
      >
        <Example>
          <div className={kit.panel}>
            <OrdersSummary
              result={{
                orders: { current: 1284, previous: 1140 },
                revenue: { current: 182400, previous: 190000 },
                late: { current: 2, previous: 2 },
              }}
            />
          </div>
        </Example>
      </Section>
      <Section
        title="sales-dashboard"
        note="시계열·막대·누적 막대·분포·산점·node-edge 여섯 차트를 보인다."
      >
        <Example>
          <SalesDashboard loading={false} failed={false} reload={NOOP} />
        </Example>
      </Section>
    </Page>
  );
}
