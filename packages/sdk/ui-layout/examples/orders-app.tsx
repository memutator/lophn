// 앱 화면 예: 앱 shell·sidebar·tab·grid·card와 5가지 페이지 틀. 같은 화면을 전체·320px 패널·240px 카드에 넣는다.
import { useState } from "react";
import {
  BookOpen,
  LayoutDashboard,
  List as ListIcon,
  Settings,
  Table,
} from "lucide-react";
import { Button, Field, Input, Switch } from "@lophn/ui-control";
import { DataTable, type TableColumn } from "@lophn/ui-table";
import {
  AppShell,
  Card,
  DashboardCell,
  DashboardFrame,
  FormFrame,
  Grid,
  List,
  ListDetailFrame,
  ListItem,
  ReadingFrame,
  Sidebar,
  Tab,
  TableFrame,
  TabList,
  TabPanel,
  Tabs,
} from "@lophn/ui-layout";
import styles from "./orders-app.module.css";

export type OrdersPage = "overview" | "orders" | "table" | "settings" | "guide";

interface Order {
  id: string;
  customer: string;
  total: number;
}

const ORDERS: readonly Order[] = [
  { id: "A-1001", customer: "North Shop", total: 120 },
  { id: "A-1002", customer: "Harbor Cafe", total: 48 },
  { id: "A-1003", customer: "Hill Books", total: 310 },
];

// 앱이 자기 catalog에서 가져오는 문구 자리다.
const TEXT = {
  app: "Orders",
  newOrder: "New order",
  overview: "Overview",
  orders: "Orders",
  table: "All orders",
  settings: "Settings",
  guide: "Guide",
  summary: "Summary",
  activity: "Activity",
  activityBody: "Three orders arrived today.",
  latest: "Latest order",
  today: "Today",
  week: "This week",
  month: "This month",
  pick: "Pick an order to see it here.",
  shopName: "Shop name",
  sync: "Sync every hour",
  save: "Save",
  guideBody:
    "Orders arrive from the shop every hour. Open one to see its items and total.",
  empty: "No orders yet.",
  reload: "Reload",
  customer: "Customer",
  total: "Total",
  id: "Order ID",
};

const COLUMNS: readonly TableColumn<Order>[] = [
  { id: "id", header: TEXT.id, kind: "id", value: (order) => order.id },
  {
    id: "customer",
    header: TEXT.customer,
    kind: "text",
    value: (order) => order.customer,
  },
  {
    id: "total",
    header: TEXT.total,
    kind: "number",
    value: (order) => order.total,
  },
];

export function OrdersApp(
  { initial = "overview", now }: { initial?: OrdersPage; now: Date },
) {
  const [page, setPage] = useState<OrdersPage>(initial);
  const [order, setOrder] = useState<Order>();
  return (
    <AppShell
      title={TEXT.app}
      actions={<Button variant="primary" size="sm">{TEXT.newOrder}</Button>}
      nav={
        <Sidebar
          current={page}
          onSelect={(id) => setPage(id as OrdersPage)}
          items={[
            { id: "overview", label: TEXT.overview, icon: LayoutDashboard },
            { id: "orders", label: TEXT.orders, icon: ListIcon },
            { id: "table", label: TEXT.table, icon: Table },
            { id: "settings", label: TEXT.settings, icon: Settings },
            { id: "guide", label: TEXT.guide, icon: BookOpen },
          ]}
        />
      }
    >
      {page === "overview" && (
        <DashboardFrame header={<h2>{TEXT.overview}</h2>}>
          <DashboardCell span={8}>
            <Tabs defaultValue="summary">
              <TabList>
                <Tab value="summary">{TEXT.summary}</Tab>
                <Tab value="activity">{TEXT.activity}</Tab>
              </TabList>
              <TabPanel value="summary">
                <Grid>
                  {[TEXT.today, TEXT.week, TEXT.month].map((label, index) => (
                    <Card key={label}>
                      <p>{label}</p>
                      <p>{ORDERS.length * (index + 1)}</p>
                    </Card>
                  ))}
                </Grid>
              </TabPanel>
              <TabPanel value="activity">
                <p>{TEXT.activityBody}</p>
              </TabPanel>
            </Tabs>
          </DashboardCell>
          <DashboardCell span={4}>
            <Card>
              <p>{TEXT.latest}</p>
              <p>{ORDERS[0].customer}</p>
            </Card>
          </DashboardCell>
        </DashboardFrame>
      )}
      {page === "orders" && (
        <ListDetailFrame
          active={order ? "detail" : "list"}
          onBack={() => setOrder(undefined)}
          list={
            <List>
              {ORDERS.map((item) => (
                <ListItem
                  key={item.id}
                  title={item.customer}
                  selected={item.id === order?.id}
                  onSelect={() => setOrder(item)}
                />
              ))}
            </List>
          }
          detail={
            <div className={styles.detail}>
              {order
                ? (
                  <Card>
                    <p>{order.customer}</p>
                    <p>{order.id}</p>
                  </Card>
                )
                : <p>{TEXT.pick}</p>}
            </div>
          }
        />
      )}
      {page === "table" && (
        <TableFrame header={<h2>{TEXT.table}</h2>}>
          <DataTable
            columns={COLUMNS}
            rows={ORDERS}
            rowKey={(item) => item.id}
            now={now}
            onRetry={() => {}}
            empty={{
              message: TEXT.empty,
              action: { label: TEXT.reload, onSelect: () => {} },
            }}
          />
        </TableFrame>
      )}
      {page === "settings" && (
        <FormFrame header={<h2>{TEXT.settings}</h2>}>
          <div className={styles.form}>
            <Field label={TEXT.shopName}>
              <Input />
            </Field>
            <Switch label={TEXT.sync} />
            <div className={styles.actions}>
              <Button variant="primary">{TEXT.save}</Button>
            </div>
          </div>
        </FormFrame>
      )}
      {page === "guide" && (
        <ReadingFrame width="default" header={<h2>{TEXT.guide}</h2>}>
          <p>{TEXT.guideBody}</p>
        </ReadingFrame>
      )}
    </AppShell>
  );
}
