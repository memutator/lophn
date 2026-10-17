// Kit · layout. @lophn/ui/layout의 Card와 페이지 틀, 예제(orders-app).
import { useState } from "react";
import {
  AppShell,
  Card,
  DashboardCell,
  DashboardFrame,
  FormFrame,
  Grid,
  ListDetailFrame,
  ReadingFrame,
  TableFrame,
} from "@lophn/ui/layout";
import { Table } from "@lophn/ui/data";
import { Button } from "@lophn/ui/primitives";
import { Sidebar } from "@lophn/ui/navigation";

import { COLUMNS, ORDERS } from "../data/orders-rows.ts";
import { OrdersApp } from "./orders-app.tsx";
import { Example, kit, Page, Row, Section } from "../kit.tsx";

const NOW = new Date("2026-10-11T12:00:00Z");
const EXAMPLE_NOW = new Date("2026-10-06T15:30:00Z");

const NAV = [
  { id: "overview", label: "Overview" },
  { id: "orders", label: "Orders" },
  { id: "settings", label: "Settings" },
];

// AppShell은 넣은 영역의 폭을 보고 모양을 바꾼다. 폭이 다른 상자에 넣어 셋을 나란히 보인다.
function ShellBox(
  { width, nav = true, actions = true }: {
    width: string;
    nav?: boolean;
    actions?: boolean;
  },
) {
  return (
    <div className={kit.frameStage} style={{ width, height: 240 }}>
      <AppShell
        title="Orders"
        actions={actions
          ? <Button variant="primary" size="sm">New order</Button>
          : undefined}
        nav={nav
          ? <Sidebar items={NAV} current="overview" onSelect={() => {}} />
          : undefined}
      >
        <Slot>screen</Slot>
      </AppShell>
    </div>
  );
}

function Cells({ count }: { count: number }) {
  return (
    <Grid>
      {Array.from({ length: count }, (_, index) => (
        <Card key={index}>
          <strong>Cell {index + 1}</strong>
        </Card>
      ))}
    </Grid>
  );
}

function Slot({ children }: { children: string }) {
  return <div className={kit.frameBox}>{children}</div>;
}

export function KitLayout() {
  const [at, setAt] = useState<"list" | "detail">("list");
  return (
    <Page>
      <Section
        title="Card"
        note="독립 객체 하나만 카드로 묶는다. 카드 안 카드는 만들 수 없다."
      >
        <div className={kit.grid}>
          <Card>
            <strong>Grocery budget</strong>
            <p className={kit.note}>
              Keep the monthly food spending under the plan.
            </p>
          </Card>
          <Card>
            <strong>Home office</strong>
            <p className={kit.note}>Tax papers and receipts for the desk.</p>
          </Card>
        </div>
      </Section>
      <Section
        title="Grid"
        note="카드 폭 240px 이상의 칸을 영역 폭에 맞게 채운다. 240px 영역에서는 한 줄에 한 칸이다."
      >
        <Row label="2 cells · 100%">
          <div style={{ width: "100%" }}>
            <Cells count={2} />
          </div>
        </Row>
        <Row label="6 cells · 100%">
          <div style={{ width: "100%" }}>
            <Cells count={6} />
          </div>
        </Row>
        <Row label="6 cells · 240px">
          <div style={{ width: "var(--layout-container-card)" }}>
            <Cells count={6} />
          </div>
        </Row>
      </Section>
      <Section
        title="AppShell"
        note="넣은 영역이 320px 미만이면 card, 640px 미만이면 panel이고 nav는 본문 위 한 줄이 된다. nav나 행동이 없으면 그 자리가 비고 본문이 전체 폭을 쓴다."
      >
        <Row label="full · nav">
          <ShellBox width="100%" />
        </Row>
        <Row label="panel · nav">
          <ShellBox width="480px" />
        </Row>
        <Row label="card · nav">
          <ShellBox width="var(--layout-container-card)" />
        </Row>
        <Row label="full · no nav">
          <ShellBox width="100%" nav={false} />
        </Row>
        <Row label="full · no actions">
          <ShellBox width="100%" actions={false} />
        </Row>
      </Section>
      <Section title="FormFrame · 640px">
        <div className={kit.frameStage}>
          <FormFrame header={<strong>Register project</strong>}>
            <Slot>form body</Slot>
          </FormFrame>
        </div>
      </Section>
      <Section title="DashboardFrame · 12 columns, max 1440px">
        <div className={kit.frameStage}>
          <DashboardFrame header={<strong>Dashboard</strong>}>
            <DashboardCell span={12}>
              <Slot>span 12</Slot>
            </DashboardCell>
            <DashboardCell span={8}>
              <Slot>span 8</Slot>
            </DashboardCell>
            <DashboardCell span={4}>
              <Slot>span 4</Slot>
            </DashboardCell>
            <DashboardCell span={6}>
              <Slot>span 6</Slot>
            </DashboardCell>
            <DashboardCell span={6}>
              <Slot>span 6</Slot>
            </DashboardCell>
          </DashboardFrame>
        </div>
      </Section>
      <Section
        title="ListDetailFrame · list 360px"
        note="640px 미만 칸에서는 한 쪽씩 보인다."
      >
        <div className={kit.frameStage}>
          <ListDetailFrame
            active={at}
            onBack={() => setAt("list")}
            list={<Slot>list</Slot>}
            detail={<Slot>detail</Slot>}
          />
        </div>
      </Section>
      <Section title="TableFrame · full width">
        <div className={kit.frameStage}>
          <TableFrame header={<strong>Orders</strong>}>
            <Table
              columns={COLUMNS}
              rows={ORDERS}
              rowKey={(row) => row.id}
              now={NOW}
            />
          </TableFrame>
        </div>
      </Section>
      <Section title="ReadingFrame · default, with table of contents">
        <div className={kit.frameStage}>
          <ReadingFrame
            width="default"
            header={<strong>Weekly report</strong>}
            toc={<Slot>table of contents</Slot>}
          >
            <Slot>article</Slot>
          </ReadingFrame>
        </div>
      </Section>
      <Section
        title="orders-app"
        note="앱 shell·sidebar·tab·grid·card와 다섯 가지 페이지 틀을 연다."
      >
        <Example height={640}>
          <OrdersApp now={EXAMPLE_NOW} />
        </Example>
      </Section>
    </Page>
  );
}
