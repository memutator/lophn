// 디자인 시스템 · SDK. pages/kit의 예제를 고치지 않고 그대로 그린다. 예제가 받는
// props(시각, 데이터, 앱 bridge)만 고정 값으로 준다.
import { kit, Page, Section } from "./kit.tsx";
import type { ReactNode } from "react";
import { tokens } from "@lophn/ui";

import {
  otherColor,
  seriesColors,
} from "../../pages/kit/tokens/chart-colors.ts";
import { OrdersApp } from "../../pages/kit/layout/orders-app.tsx";
import { OrdersTable } from "../../pages/kit/data/orders-table.tsx";
import { OrderActions } from "../../pages/kit/app-ui/order-actions.tsx";
import { ControlSizes } from "../../pages/kit/input/control-sizes.tsx";
import { OrdersFilters } from "../../pages/kit/input/orders-filters.tsx";
import {
  AppRoot,
  OrdersStatus,
} from "../../pages/kit/feedback/orders-status.tsx";
import { WeeklyReport } from "../../pages/kit/reading/weekly-report.tsx";
import { OverlayExample } from "../../pages/kit/overlay/overlays.tsx";
import { OrdersSummary } from "../../pages/kit/data/orders-summary.tsx";
import { SalesDashboard } from "../../pages/kit/data/sales-dashboard.tsx";

const NOW = new Date("2026-10-06T15:30:00Z");
const NOOP = () => {};

function Example(
  { children, height }: { children: ReactNode; height?: number },
) {
  return (
    <div
      className={kit.sdkStage}
      style={height === undefined ? undefined : { height }}
    >
      {children}
    </div>
  );
}

/** SDK · tokens. */
export function SdkTokens() {
  return (
    <Page>
      <Section
        title="chart-colors"
        note="앱 CSS 밖에서 token 값이 필요할 때: 차트 계열 색과 기타 회색을 theme별로 읽는다."
      >
        {(["light", "dark"] as const).map((theme) => (
          <div key={theme} className={kit.row}>
            <span className={kit.label}>seriesColors("{theme}")</span>
            <div className={kit.value}>
              {seriesColors(theme).map((color) => (
                <span key={color} className={kit.swatch}>
                  <span
                    className={kit.chipColor}
                    style={{ background: color }}
                  />
                  <span className={kit.hex}>{color}</span>
                </span>
              ))}
            </div>
          </div>
        ))}
        <div className={kit.row}>
          <span className={kit.label}>otherColor</span>
          <div className={kit.value}>
            <span className={kit.hex}>{otherColor}</span>
            <span
              className={kit.chipColor}
              style={{ background: otherColor }}
            />
          </div>
        </div>
        <p className={kit.note}>
          export된 token은 {Object.keys(tokens).length}묶음이다(@lophn/ui).
        </p>
      </Section>
    </Page>
  );
}

/** SDK · layout. */
export function SdkLayout() {
  return (
    <Example height={640}>
      <OrdersApp now={NOW} />
    </Example>
  );
}

const ORDERS = [
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

/** SDK · table. */
export function SdkTable() {
  return (
    <Example>
      <OrdersTable
        orders={ORDERS}
        now={NOW}
        loading={false}
        failed={false}
        reload={NOOP}
      />
    </Example>
  );
}

/** SDK · actions. */
export function SdkActions() {
  return (
    <Example>
      <div className={kit.panel}>
        <OrderActions selected={() => ["ord_1"]} />
      </div>
    </Example>
  );
}

/** SDK · controls. */
export function SdkControls() {
  return (
    <Example>
      <div className={kit.panel}>
        <ControlSizes />
      </div>
    </Example>
  );
}

/** SDK · filters. */
export function SdkFilters() {
  return (
    <Example>
      <div className={kit.panel}>
        <OrdersFilters now={NOW} call={() => Promise.resolve()} />
      </div>
    </Example>
  );
}

const READY = {
  loading: false,
  failed: false,
  orders: ["ord_1 · Harbor Books", "ord_2 · Yeon-ho Kim"],
  updatedAt: new Date("2026-10-06T15:20:00Z"),
};

/** SDK · states. */
export function SdkStates() {
  const status = (result: typeof READY, now = NOW) => (
    <OrdersStatus result={result} now={now} reload={NOOP} />
  );
  return (
    <Page>
      <Section title="Ready">
        <AppRoot>{status(READY)}</AppRoot>
      </Section>
      <Section title="Empty">
        <AppRoot>{status({ ...READY, orders: [] })}</AppRoot>
      </Section>
      <Section title="Failed">
        <AppRoot>{status({ ...READY, failed: true })}</AppRoot>
      </Section>
      <Section title="Stale (read an hour ago)">
        <AppRoot>{status(READY, new Date("2026-10-06T17:30:00Z"))}</AppRoot>
      </Section>
    </Page>
  );
}

/** SDK · reading. */
export function SdkReading() {
  return (
    <Example>
      <WeeklyReport />
    </Example>
  );
}

/** SDK · overlays. */
export function SdkOverlays() {
  return (
    <Example>
      <div className={kit.panel}>
        <OverlayExample />
      </div>
    </Example>
  );
}

/** SDK · stats. */
export function SdkStats() {
  return (
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
  );
}

/** SDK · charts. */
export function SdkCharts() {
  return (
    <Example>
      <SalesDashboard loading={false} failed={false} reload={NOOP} />
    </Example>
  );
}
