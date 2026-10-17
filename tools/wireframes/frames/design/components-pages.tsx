// 디자인 시스템 · Components. 실제 @lophn/ui component를 고정 data로 그린다.
// Menu·Dialog·Sheet·Palette는 modal이라 열어 두면 page 전체가 잠겨서(Radix가 body를 inert로 만든다) 같은
// CSS Module을 import해 같은 모양으로 짠 look-alike를 stage 안에 그린다. Popover·Tooltip은 실제 component를
// 열어 두고 stage에 portal한다.
import { useState } from "react";
import {
  Button,
  CopyButton,
  Icon,
  IconButton,
  Kbd,
} from "@lophn/ui/primitives";
import {
  Checkbox,
  Field,
  Input,
  Select,
  Switch,
  Textarea,
} from "@lophn/ui/input";
import {
  Card,
  DashboardCell,
  DashboardFrame,
  FormFrame,
  ListDetailFrame,
  ReadingFrame,
  TableFrame,
} from "@lophn/ui/layout";
import { Tab, TabList, TabPanel, Tabs } from "@lophn/ui/navigation";
import {
  List,
  ListItem,
  StatRow,
  StatTile,
  Table,
  type TableColumn,
  Tree,
  type TreeNode,
} from "@lophn/ui/data";
import {
  EmptyState,
  ErrorState,
  Skeleton,
  StaleNote,
  StatusMark,
} from "@lophn/ui/feedback";
import { Popover, PopoverRow, Toast, Tooltip } from "@lophn/ui/overlay";
import { DiffMark } from "@lophn/ui/reading";
import { iconPixels } from "@lophn/ui/shared";
import {
  launcherEmptyIcon,
  lophnSpaceIcons,
  paletteIcons,
  workspaceIcons,
} from "../../../../packages/shell/renderer/icons/mod.ts";

import dialogStyles from "../../../../packages/design/components/overlay/dialog/dialog.module.css";
import sheetStyles from "../../../../packages/design/components/overlay/sheet/sheet.module.css";
import paletteStyles from "../../../../packages/design/components/overlay/palette/palette.module.css";
import menuStyles from "../../../../packages/design/components/overlay/menu/menu.module.css";
import { FROZEN_TIMER, kit, Page, Row, Section, Stage } from "./kit.tsx";

const NOW = new Date("2026-10-11T12:00:00Z");
const NOOP = () => {};

const clipboard = { writeText: () => Promise.resolve() };

/** Components · buttons. */
export function ComponentsButtons() {
  const variants = ["primary", "secondary", "ghost", "danger"] as const;
  const sizes = ["sm", "md", "lg"] as const;
  return (
    <Page>
      <Section
        title="Button"
        note="variant 네 가지와 크기 세 가지. 크기는 Input·Select와 높이가 같다."
      >
        {variants.map((variant) => (
          <Row key={variant} label={variant}>
            {sizes.map((size) => (
              <Button key={size} variant={variant} size={size}>
                {size} Save
              </Button>
            ))}
            <Button variant={variant} icon={lophnSpaceIcons.add}>
              With icon
            </Button>
            <Button variant={variant} disabled>
              Disabled
            </Button>
          </Row>
        ))}
      </Section>
      <Section
        title="IconButton"
        note="이름은 aria-label이다. 아이콘만 보인다."
      >
        {(["secondary", "ghost", "danger"] as const).map((variant) => (
          <Row key={variant} label={variant}>
            {sizes.map((size) => (
              <IconButton
                key={size}
                icon={workspaceIcons.splitPane}
                label="Split pane"
                variant={variant}
                size={size}
              />
            ))}
            <IconButton
              icon={workspaceIcons.close}
              label="Close"
              variant={variant}
              disabled
            />
          </Row>
        ))}
      </Section>
      <Section title="Kbd">
        <Row label="keys">
          <Kbd keys={["Ctrl", "K"]} />
          <Kbd keys={["Ctrl", "Shift", "P"]} />
          <Kbd keys={["Esc"]} />
          <Kbd keys={["↑", "↓"]} />
        </Row>
      </Section>
      <Section title="CopyButton">
        <Row label="text">
          <span className={kit.mono}>lophn/weekly-report</span>
          <CopyButton
            text="lophn/weekly-report"
            label="Copy address"
            clipboard={clipboard}
          />
        </Row>
      </Section>
    </Page>
  );
}

/** Components · form controls. */
export function ComponentsForms() {
  const options = [
    { value: "daily", label: "Daily" },
    { value: "weekly", label: "Weekly" },
    { value: "monthly", label: "Monthly", disabled: true },
  ];
  return (
    <Page>
      <div className={kit.colTwo}>
        <Section title="Input">
          <div className={kit.column}>
            <div className={kit.field}>
              <Field label="Project name" help="Letters, numbers and dashes.">
                <Input placeholder="phroner" />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Project name" error="That name is already used.">
                <Input defaultValue="phroner" />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Disabled">
                <Input defaultValue="Read only" disabled />
              </Field>
            </div>
            {(["sm", "md", "lg"] as const).map((size) => (
              <div key={size} className={kit.field}>
                <Field label={`Size ${size}`}>
                  <Input size={size} defaultValue={size} />
                </Field>
              </div>
            ))}
          </div>
        </Section>
        <Section title="Textarea and Select">
          <div className={kit.column}>
            <div className={kit.field}>
              <Field label="Purpose" help="One or two sentences.">
                <Textarea
                  rows={3}
                  defaultValue="Keep the monthly food spending under the plan."
                />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Repeat">
                <Select options={options} defaultValue="weekly" />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Repeat" error="Pick how often.">
                <Select options={options} placeholder="Choose" />
              </Field>
            </div>
            <div className={kit.field}>
              <Field label="Disabled select">
                <Select options={options} defaultValue="daily" disabled />
              </Field>
            </div>
          </div>
        </Section>
      </div>
      <Section title="Checkbox and Switch">
        <div className={kit.colTwo}>
          <div className={kit.column}>
            <Checkbox label="Track Markdown files" defaultChecked />
            <Checkbox label="Use .gitignore" />
            <Checkbox label="Disabled, checked" defaultChecked disabled />
            <Checkbox label="Disabled" disabled />
          </div>
          <div className={kit.column}>
            <Switch label="Show line numbers" defaultChecked />
            <Switch label="Wrap long lines" />
            <Switch label="Disabled, on" defaultChecked disabled />
            <Switch label="Disabled" disabled />
          </div>
        </div>
      </Section>
    </Page>
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

/** Components · tabs, tree & list. */
export function ComponentsNavigation() {
  return (
    <Page>
      <Section title="Tabs" note="일반 탭. 작업대의 문서 탭 줄은 따로 있다.">
        <Tabs defaultValue="connections">
          <TabList>
            <Tab value="connections">Connections</Tab>
            <Tab value="general">General</Tab>
            <Tab value="update" disabled>Update</Tab>
          </TabList>
          <TabPanel value="connections">
            <p className={kit.note}>활성 탭 아래 2px 표시와 본문 간격 24px.</p>
          </TabPanel>
          <TabPanel value="general">{null}</TabPanel>
          <TabPanel value="update">{null}</TabPanel>
        </Tabs>
      </Section>
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
    </Page>
  );
}

interface Order {
  id: string;
  customer: string;
  total: number | undefined;
  placed: Date;
}

const ORDERS: readonly Order[] = [
  {
    id: "ord_a1",
    customer: "Harbor Books",
    total: 125,
    placed: new Date("2026-10-10T09:00:00Z"),
  },
  {
    id: "ord_a2",
    customer: "Yeon-ho Kim",
    total: 1843.5,
    placed: new Date("2026-10-08T16:30:00Z"),
  },
  {
    id: "ord_a3",
    customer: "Northwind",
    total: undefined,
    placed: new Date("2026-09-30T08:00:00Z"),
  },
  {
    id: "ord_a4",
    customer: "민아 상점",
    total: 64,
    placed: new Date("2026-09-12T11:15:00Z"),
  },
];

const COLUMNS: readonly TableColumn<Order>[] = [
  { id: "id", header: "Order ID", kind: "id", value: (row) => row.id },
  {
    id: "customer",
    header: "Customer",
    kind: "text",
    value: (row) => row.customer,
  },
  {
    id: "total",
    header: "Total",
    unit: "USD",
    kind: "number",
    value: (row) => row.total,
  },
  { id: "placed", header: "Placed", kind: "time", value: (row) => row.placed },
];

/** Components · table. */
export function ComponentsTable() {
  return (
    <Page>
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
    </Page>
  );
}

/** Components · menu, popover & tooltip. */
export function ComponentsMenus() {
  return (
    <Page>
      <Section
        title="Menu"
        note="Radix 메뉴는 열면 page 전체가 inert가 되어서 같은 CSS Module로 짠 정적 모양이다. 위쪽 행이 highlight다."
      >
        <div className={kit.panel}>
          <div
            className={`${menuStyles.menu}`}
            role="menu"
            style={{ minWidth: "200px", display: "inline-block" }}
          >
            {["Open", "Open read-only", "Rename", "Move…", "Archive"].map((
              label,
              index,
            ) => (
              <div
                key={label}
                role="menuitem"
                className={menuStyles.item}
                data-highlighted={index === 0 ? "" : undefined}
                data-disabled={label === "Archive" ? "" : undefined}
              >
                {label}
              </div>
            ))}
          </div>
        </div>
      </Section>
      <Section
        title="Popover and Tooltip"
        note="실제 component를 열어 둔 채로 아래 상자에 그린다."
      >
        <Stage height={220} center>
          {(container) => (
            <div className={kit.row} style={{ gap: "160px" }}>
              <Popover
                open
                container={container}
                trigger={<Button>Move to…</Button>}
              >
                <PopoverRow onSelect={NOOP}>Grocery budget</PopoverRow>
                <PopoverRow onSelect={NOOP}>Home office</PopoverRow>
                <PopoverRow onSelect={NOOP} disabled>phroner</PopoverRow>
              </Popover>
              <Tooltip open container={container} content="Split pane">
                <IconButton
                  icon={workspaceIcons.splitPane}
                  label="Split pane"
                />
              </Tooltip>
            </div>
          )}
        </Stage>
      </Section>
    </Page>
  );
}

/** Components · dialog, sheet & palette. */
export function ComponentsDialogs() {
  const item = (label: string, group: string, hint?: string) => ({
    label,
    group,
    hint,
  });
  const rows = [
    item("Projects", "Go to"),
    item("Things to confirm", "Go to", "G C"),
    item("exp-008-query-tools.md", "Documents"),
    item("Search phroner", "Actions", "Ctrl K"),
  ];
  return (
    <Page>
      <Section
        title="Dialog"
        note="modal. backdrop 위 dialog 층, 오른쪽 끝에 주 행동. 같은 CSS Module로 짠 정적 모양이다."
      >
        <Stage height={320}>
          {() => (
            <>
              <div className={dialogStyles.backdrop} />
              <div
                className={`${dialogStyles.dialog} ${dialogStyles.default}`}
                role="dialog"
              >
                <h2 className={dialogStyles.title}>Archive this project?</h2>
                <div className={dialogStyles.body}>
                  Its documents stay where they are. You can bring the project
                  back from Projects.
                </div>
                <div className={dialogStyles.actions}>
                  <Button>Cancel</Button>
                  <Button variant="danger">Archive</Button>
                </div>
              </div>
            </>
          )}
        </Stage>
      </Section>
      <Section
        title="Sheet"
        note="backdrop 없는 non-modal 패널. 같은 CSS Module로 짠 정적 모양이다."
      >
        <Stage height={320}>
          {() => (
            <div
              className={sheetStyles.sheet}
              role="dialog"
              style={{ width: "var(--dialog-width-default)" }}
            >
              <h2 className={dialogStyles.title}>Document details</h2>
              <div className={dialogStyles.body}>
                Version 3, saved 2 hours ago. 3 contexts include this document.
              </div>
              <div className={dialogStyles.actions}>
                <Button>Close</Button>
              </div>
            </div>
          )}
        </Stage>
      </Section>
      <Section
        title="Palette"
        note="폭 640px, 항목 36px, 묶음 이름 아래에 행이 모인다. 같은 CSS Module로 짠 정적 모양이다."
      >
        <Stage height={380}>
          {() => (
            <>
              <div className={dialogStyles.backdrop} />
              <div className={paletteStyles.palette} role="dialog">
                <label className={paletteStyles.title}>Command palette</label>
                <div className={paletteStyles.search}>
                  <Icon
                    icon={paletteIcons.search}
                    pixels={iconPixels("base")}
                    className={paletteStyles.icon}
                  />
                  <input
                    className={paletteStyles.input}
                    defaultValue="plan"
                    readOnly
                  />
                </div>
                <div className={paletteStyles.list} role="listbox">
                  {rows.map((row, index) => (
                    <div key={row.label} role="presentation">
                      {row.group !== rows[index - 1]?.group
                        ? <div className={paletteStyles.group}>{row.group}</div>
                        : null}
                      <div
                        role="option"
                        aria-selected={index === 1}
                        className={`${paletteStyles.item} ${
                          index === 1 ? paletteStyles.active : ""
                        }`}
                      >
                        <span className={paletteStyles.text}>
                          <span className={paletteStyles.label}>
                            {row.label}
                          </span>
                        </span>
                        {row.hint === undefined
                          ? null
                          : (
                            <span className={paletteStyles.hint}>
                              {row.hint}
                            </span>
                          )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className={paletteStyles.footer}>
                  <span className={paletteStyles.key}>
                    <Kbd keys={["↑", "↓"]} /> Move
                  </span>
                  <span className={paletteStyles.key}>
                    <Kbd keys={["↵"]} /> Open
                  </span>
                  <span className={paletteStyles.key}>
                    <Kbd keys={["Esc"]} /> Close
                  </span>
                </div>
              </div>
            </>
          )}
        </Stage>
      </Section>
    </Page>
  );
}

/** Components · toast. */
export function ComponentsToast() {
  const stop = { timer: FROZEN_TIMER, onClose: NOOP };
  return (
    <Page>
      <Section
        title="Toast"
        note="행동은 최대 둘. 시간이 가지 않는 timer를 줘서 열린 채로 둔다. error는 시간으로 닫지 않는다."
      >
        <div className={kit.column}>
          <Toast title="Saved" duration="brief" {...stop} />
          <Toast
            title="1 Operator repeats a check here"
            actions={[{ id: "see", label: "See Operators" }]}
            {...stop}
          />
          <Toast
            title="eval: 2 documents don't match the contract"
            body="Open the Violations tab to see which ones."
            actions={[{ id: "view", label: "View" }, {
              id: "later",
              label: "Later",
            }]}
            {...stop}
          />
          <Toast
            title="Couldn't save the document"
            body="The folder isn't reachable."
            tone="error"
            actions={[{ id: "retry", label: "Try again" }]}
            {...stop}
          />
        </div>
      </Section>
    </Page>
  );
}

/** Components · states. */
export function ComponentsStates() {
  const [reloads, setReloads] = useState(0);
  return (
    <Page>
      <div className={kit.colTwo}>
        <Section title="EmptyState" note="다음 행동은 언제나 하나다.">
          <div className={kit.panel}>
            <EmptyState
              icon={launcherEmptyIcon}
              message="No projects yet."
              action={{ label: "Register project", onSelect: NOOP }}
            />
          </div>
        </Section>
        <Section title="ErrorState" note="원인은 추측하지 않는다.">
          <div className={kit.panel}>
            <ErrorState
              target="projects"
              onRetry={() => setReloads(reloads + 1)}
            />
          </div>
        </Section>
      </div>
      <Section
        title="Skeleton"
        note="내용과 같은 자리를 지킨다. 300ms 뒤에만 보인다."
      >
        <Row label="line ×3">
          <Skeleton lines={3} />
        </Row>
        <Row label="control">
          <Skeleton shape="control" />
        </Row>
        <Row label="icon">
          <Skeleton shape="icon" />
        </Row>
      </Section>
      <Section title="StaleNote">
        <Row label="2 hours ago">
          <StaleNote updatedAt={new Date("2026-10-11T10:00:00Z")} now={NOW} />
        </Row>
        <Row label="3 days ago">
          <StaleNote updatedAt={new Date("2026-10-08T12:00:00Z")} now={NOW} />
        </Row>
      </Section>
      <Section
        title="StatusMark"
        note="색 없이도 아이콘 모양과 글자로 구별한다."
      >
        <div className={kit.row}>
          <StatusMark tone="good" label="Running" />
          <StatusMark tone="warning" label="Needs attention" />
          <StatusMark tone="serious" label="Failing" />
          <StatusMark tone="critical" label="Stopped" />
          <StatusMark tone="neutral" label="Not checked" />
        </div>
      </Section>
      <Section title="DiffMark">
        <div className={kit.row}>
          <DiffMark kind="add" />
          <DiffMark kind="delete" />
        </div>
      </Section>
    </Page>
  );
}

/** Components · card & stat tile. */
export function ComponentsCards() {
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
    </Page>
  );
}

function Slot({ children }: { children: string }) {
  return <div className={kit.frameBox}>{children}</div>;
}

/** Components · page frames. */
export function ComponentsFrames() {
  const [at, setAt] = useState<"list" | "detail">("list");
  return (
    <Page>
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
    </Page>
  );
}
