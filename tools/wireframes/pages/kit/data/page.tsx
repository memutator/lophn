// Kit · data. @lophn/ui/data의 Tree·List·Table·StatTile·StatRow와 예제(orders-table, orders-summary, sales-dashboard).
import {
  List,
  ListItem,
  StatRow,
  StatTile,
  Table,
  Tree,
  type TreeNode,
} from "@lophn/ui/data";

import { COLUMNS, ORDERS } from "./orders-rows.ts";
import { OrdersSummary } from "./orders-summary.tsx";
import { OrdersTable } from "./orders-table.tsx";
import { SalesDashboard } from "./sales-dashboard.tsx";
import { Example, kit, Page, Section } from "../kit.tsx";

const NOW = new Date("2026-10-11T12:00:00Z");
const EXAMPLE_NOW = new Date("2026-10-06T15:30:00Z");
const NOOP = () => {};

const clipboard = { writeText: () => Promise.resolve() };

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
      <div className={kit.colTwo}>
        <Section
          title="Tree"
          note="행 28px, 깊이당 12px. 지금 연 항목은 왼쪽 표시, 선택은 배경."
        >
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
        </Section>
        <Section title="List">
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
        </Section>
      </div>
      <Section
        title="Compact (default)"
        note="id 열은 진단이 아니면 그리지 않는다. 숫자는 오른쪽 맞춤이고 값이 없으면 빈 표시다."
      >
        <Table
          columns={COLUMNS}
          rows={ORDERS}
          rowKey={(row) => row.id}
          now={NOW}
        />
      </Section>
      <Section title="Comfortable">
        <Table
          columns={COLUMNS}
          rows={ORDERS}
          rowKey={(row) => row.id}
          now={NOW}
          density="comfortable"
        />
      </Section>
      <Section title="Diagnostics" note="diagnostics를 켜면 id 열이 보인다.">
        <Table
          columns={COLUMNS}
          rows={ORDERS.slice(0, 2)}
          rowKey={(row) => row.id}
          now={NOW}
          diagnostics
          clipboard={clipboard}
        />
      </Section>
      <Section
        title="StatTile and StatRow"
        note="변화는 부호와 방향 아이콘을 함께 쓴다. 한 줄 최대 네 개."
      >
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
