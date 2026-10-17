// Kit · layout. @lophn/ui/layout의 Card와 페이지 틀, 예제(orders-app).
import { useState } from "react";
import {
  Card,
  DashboardCell,
  DashboardFrame,
  FormFrame,
  ListDetailFrame,
  ReadingFrame,
  TableFrame,
} from "@lophn/ui/layout";
import { Table } from "@lophn/ui/data";

import { COLUMNS, ORDERS } from "../data/orders-rows.ts";
import { OrdersApp } from "./orders-app.tsx";
import { Example, kit, Page, Section } from "../kit.tsx";

const NOW = new Date("2026-10-11T12:00:00Z");
const EXAMPLE_NOW = new Date("2026-10-06T15:30:00Z");

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
