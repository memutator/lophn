// Example screens assembled from the kit with the wireframes' data (tools/wireframes/drafts/phone/).
import {
  Act,
  AgentTurn,
  ApprovalCard,
  Band,
  Button,
  Card,
  Chip,
  Composer,
  ComputerPicker,
  Divider,
  Dot,
  Drawer,
  EditCard,
  Group,
  Icon,
  IconButton,
  Label,
  ListCard,
  Markdown,
  Mark,
  MessageList,
  Meta,
  NavRow,
  Pill,
  Plain,
  Pre,
  QuestionCard,
  Row,
  Screen,
  SessionRow,
  Sheet,
  SidebarFoot,
  SidebarHead,
  SidebarLabel,
  SidebarList,
  Stat,
  Tabs,
  Text,
  TopBar,
  UserBubble,
  Working,
  WorkspaceRow,
  WorktreeLabel,
  Badge,
  useTheme,
} from "@lophn/ui-native";
import {
  Bell,
  CalendarDays,
  Check,
  ChevronRight,
  Clock,
  Ellipsis,
  FileText,
  FolderOpen,
  Home,
  Info,
  Laptop,
  type LucideIcon,
  Monitor,
  Palette,
  Pencil,
  Plus,
  QrCode,
  Search,
  Server,
  Settings,
  Smartphone,
  Terminal,
  Users,
  Workflow,
  X,
} from "lucide-react-native";
import { type ReactElement, type ReactNode, useState } from "react";
import { View } from "react-native";
import { Character, Face } from "./face.tsx";

const noop = () => {};
const COMPUTER = "mina-desktop";

// ── Welcome ──────────────────────────────────────────

function Step({ n, children }: { n: number; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 16,
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          backgroundColor: theme.color.ink.background,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Text variant="caption" weight="semibold" tone="inverse">
          {String(n)}
        </Text>
      </View>
      <Text variant="control" grow>
        {children}
      </Text>
    </View>
  );
}

export function WelcomeScreen() {
  return (
    <Screen
      footer={
        <View style={{ gap: 8, paddingTop: 12, paddingHorizontal: 20, paddingBottom: 10 }}>
          <Button variant="primary" size="lg" icon={QrCode}>
            Scan the code
          </Button>
          <Button variant="ghost">Enter a pairing code instead</Button>
          <Text variant="note" tone="muted" align="center" style={{ marginTop: 4 }}>
            End-to-end encrypted. Only this phone and your computer can read what passes between them.
          </Text>
        </View>
      }
    >
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 28 }}>
        <Character size={92} />
        <Text variant="hero" weight="semibold" align="center" style={{ marginTop: 20 }}>
          lophn on your phone
        </Text>
        <Text tone="secondary" align="center" style={{ marginTop: 10 }}>
          Use your apps, talk to your agents and answer what they ask, wherever you are.
        </Text>
        <Plain style={{ alignSelf: "stretch", marginTop: 28 }}>
          <Step n={1}>Open lophn on your computer</Step>
          <Divider inset={16} />
          <Step n={2}>
            {"Go to "}
            <Text variant="control" weight="semibold">
              Settings › Remote
            </Text>
          </Step>
          <Divider inset={16} />
          <Step n={3}>
            {"Choose "}
            <Text variant="control" weight="semibold">
              Add a phone
            </Text>
            {" and scan the code it shows"}
          </Step>
        </Plain>
      </View>
    </Screen>
  );
}

// ── Home and the sidebar ─────────────────────────────

function ComputerPill() {
  return (
    <View style={{ marginRight: 8 }}>
      <Pill lead={<Dot tone="good" />}>{COMPUTER}</Pill>
    </View>
  );
}

function Tile({ name, children }: { name: string; children: ReactNode }) {
  return (
    <View style={{ flex: 1, minWidth: 0, alignItems: "center", gap: 6, paddingVertical: 6 }}>
      {children}
      <Text variant="caption" numberOfLines={1} style={{ paddingHorizontal: 2 }}>
        {name}
      </Text>
    </View>
  );
}

function NeedHead({ title, time }: { title: string; time: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Face who="lophn" size={22} />
      <Text variant="control" weight="medium" grow style={{ lineHeight: 20 }}>
        {title}
      </Text>
      <Text variant="note" tone="muted">
        {time}
      </Text>
    </View>
  );
}

function HomeBody() {
  return (
    <>
      <Label
        end={
          <>
            <Text variant="small" weight="medium">
              Inbox · 3
            </Text>
            <Icon icon={ChevronRight} size={15} />
          </>
        }
      >
        Needs you
      </Label>
      <Card tone="base" style={{ marginHorizontal: 16, marginBottom: 8, paddingVertical: 12, paddingHorizontal: 14 }}>
        <NeedHead title="Run a command" time="now" />
        <Text variant="note" tone="muted" style={{ marginTop: 2 }}>
          Weekly report · phroner
        </Text>
        <View style={{ marginTop: 8 }}>
          <Pre>rm -r docs/reports/2026-w40</Pre>
        </View>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10 }}>
          <Button block icon={X}>
            Deny
          </Button>
          <Button block variant="primary" icon={Check}>
            Allow once
          </Button>
        </View>
      </Card>
      <Card tone="base" style={{ marginHorizontal: 16, marginBottom: 8, paddingVertical: 12, paddingHorizontal: 14 }}>
        <NeedHead title="Question" time="4m" />
        <Text variant="note" tone="muted" style={{ marginTop: 2 }}>
          Add a CSV export · Orders
        </Text>
        <Text variant="control" style={{ marginTop: 6 }}>
          Should the export include orders that were cancelled?
        </Text>
      </Card>
      <Label>Apps</Label>
      <View style={{ flexDirection: "row", gap: 4, paddingTop: 2, paddingHorizontal: 12 }}>
        <Tile name="Orders">
          <Mark kind="app" name="Orders" tone={1} size="lg" />
        </Tile>
        <Tile name="Calendar">
          <Mark kind="app" name="Calendar" tone={0} size="lg" icon={CalendarDays} />
        </Tile>
        <Tile name="Meal planner">
          <Mark kind="app" name="Meal planner" tone={3} size="lg" />
        </Tile>
        <Tile name="Reading list">
          <Mark kind="app" name="Reading list" tone={2} size="lg" />
        </Tile>
        <Tile name="New app">
          <Mark kind="app" name="+" tone="plain" size="lg" icon={Plus} />
        </Tile>
      </View>
      <Label>Working now</Label>
      <Row
        lead={<Face who="Codex" />}
        title="Split the eval board loader"
        sub="Codex · phroner · 4m"
        end={<Dot tone="good" />}
      />
    </>
  );
}

export function HomeScreen({ sidebar }: { sidebar?: boolean }) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(sidebar === true);
  return (
    <Screen
      top={<TopBar title="Home" onLeft={() => setOpen(true)} right={<ComputerPill />} />}
      scroll
      footer={
        <Composer
          value={draft}
          onChangeText={setDraft}
          onSend={() => setDraft("")}
          onAttach={noop}
          placeholder="Ask lophn…"
          chips={<Chip lead={<Icon icon={Home} size={15} />}>Home</Chip>}
        />
      }
    >
      <HomeBody />
      <Drawer open={open} onClose={() => setOpen(false)}>
        <SidebarBody />
      </Drawer>
    </Screen>
  );
}

function SidebarBody() {
  return (
    <>
      <SidebarHead
        lead={<Character size={26} />}
        title="lophn"
        right={<IconButton icon={Search} label="Search" tone="muted" size={20} />}
      />
      <ComputerPicker icon={Monitor} name={COMPUTER} state="Connected" tone="good" />
      <SidebarList>
        <NavRow icon={Bell} label="Inbox" end={<Badge count={3} />} />
        <NavRow icon={Clock} label="Jobs" />
        <NavRow icon={Users} label="Agents" />
        <SidebarLabel end={<IconButton icon={Plus} label="New workspace" tone="muted" size={18} />}>
          Workspaces
        </SidebarLabel>
        <WorkspaceRow lead={<Icon icon={Home} size={19} />} label="Home" on />
        <SessionRow face={<Face who="lophn" size={20} />} title="Plan the week" />
        <WorkspaceRow lead={<Icon icon={FolderOpen} size={19} />} label="phroner" />
        <WorktreeLabel>Main</WorktreeLabel>
        <SessionRow face={<Face who="lophn" size={20} />} title="Weekly report" tone="warning" />
        <SessionRow
          face={<Face who="Claude Code" size={20} />}
          title="Fix flaky retry in the scenario runner"
          tone="good"
        />
        <WorktreeLabel>weekly-review</WorktreeLabel>
        <SessionRow face={<Icon icon={Workflow} size={17} />} title="weekly-review" tone="warning" />
        <SessionRow face={<Face who="Codex" size={20} />} title="Split the eval board loader" tone="good" />
        <WorkspaceRow lead={<Mark kind="app" name="Orders" tone={1} />} label="Orders" />
        <SessionRow face={<Face who="lophn" size={20} />} title="Add a CSV export" tone="warning" />
        <WorkspaceRow
          lead={<Mark kind="app" name="Calendar" tone={0} icon={CalendarDays} />}
          label="Calendar"
        />
        <WorkspaceRow lead={<Mark kind="app" name="Meal planner" tone={3} />} label="Meal planner" />
        <WorkspaceRow lead={<Mark kind="app" name="Reading list" tone={2} />} label="Reading list" />
      </SidebarList>
      <SidebarFoot>
        <NavRow icon={Settings} label="Settings" />
      </SidebarFoot>
    </>
  );
}

// ── Session ──────────────────────────────────────────

type Item = { id: string; draw: () => ReactElement };

function SessionTop() {
  return (
    <TopBar
      lead={<Face who="lophn" size={26} />}
      title="lophn"
      sub="Weekly report"
      right={<IconButton icon={Ellipsis} label="Session menu" />}
    />
  );
}

const MODEL = <Chip>Sonnet 5.5 · Medium</Chip>;

function Session({
  items,
  tail,
  ask,
  placeholder = "Reply…",
  working,
  children,
}: {
  items: Item[];
  tail?: ReactNode;
  ask?: ReactNode;
  placeholder?: string;
  working?: boolean;
  children?: ReactNode;
}) {
  const [draft, setDraft] = useState("");
  return (
    <Screen
      top={<SessionTop />}
      footer={
        <>
          {ask}
          <Composer
            value={draft}
            onChangeText={setDraft}
            onSend={() => setDraft("")}
            onAttach={noop}
            working={working}
            onStop={noop}
            placeholder={placeholder}
            chips={MODEL}
          />
        </>
      }
    >
      <MessageList items={items} keyOf={(item) => item.id} renderItem={(item) => item.draw()} tail={tail} />
      {children}
    </Screen>
  );
}

const ANSWER: Item[] = [
  {
    id: "ask",
    draw: () => <UserBubble>Write this week’s eval report from the new findings.</UserBubble>,
  },
  {
    id: "turn",
    draw: () => (
      <AgentTurn face={<Face who="lophn" size={20} />} name="lophn">
        <Act>Read 2 files · Searched 1 time · Listed 1 folder</Act>
        <Act>Thought for 12s</Act>
        <Markdown
          variant="chat"
          source={
            "I wrote the report from the three findings. The regression share fell to **0.4%** this week.\n\n- F-011 is the query-recipe-gap regression\n- The other two changed for the same reason"
          }
        />
        <EditCard path="docs/reports/2026-w41.md" add={38} del={2} />
        <Meta onCopy={noop}>Worked for 1m 12s · 6:41 PM</Meta>
      </AgentTurn>
    ),
  },
];

export function AnswerScreen({ steps }: { steps?: boolean }) {
  const [open, setOpen] = useState(steps === true);
  return (
    <Session items={ANSWER}>
      <Sheet open={open} onClose={() => setOpen(false)} title="What lophn did">
        <Row lead={<Icon icon={FileText} />} title="Read F-011.md" sub="eval/findings" end="0.2s" />
        <Row lead={<Icon icon={FileText} />} title="Read F-012.md" sub="eval/findings" end="0.1s" />
        <Row lead={<Icon icon={Search} />} title="Searched “regression”" sub="eval/ · 12 matches" end="0.4s" />
        <Row lead={<Icon icon={Terminal} />} title="Ran a command" sub="npm run count -- --week 41" end="3s" />
        <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 10 }}>
          <Pre wrap>{"> count --week 41\nscenarios  2,400\nregressed     11  (0.4%)\nexit 0"}</Pre>
        </View>
      </Sheet>
    </Session>
  );
}

export function WorkingScreen() {
  return (
    <Session
      placeholder="Queue a message…"
      working
      tail={<Working>Working · 42s</Working>}
      items={[
        {
          id: "steer",
          draw: () => (
            <UserBubble note="Steer · went into the running turn" noteIcon={Pencil}>
              Also add the exp-008 numbers to the report.
            </UserBubble>
          ),
        },
        {
          id: "turn",
          draw: () => (
            <AgentTurn face={<Face who="lophn" size={20} />} name="lophn">
              <Markdown
                variant="chat"
                source="Got it. I will add the exp-008 numbers when I reach the regression section."
              />
              <Act>Count regressions per scenario · 3s</Act>
              <Markdown
                variant="chat"
                streaming
                source="F-011 is the query-recipe-gap regression. The other two changed for the same"
              />
            </AgentTurn>
          ),
        },
      ]}
    />
  );
}

export function ApprovalScreen() {
  return (
    <Session
      tail={<Working tone="warning">Waiting for your approval</Working>}
      ask={
        <ApprovalCard
          title="lophn wants to run a command"
          facts={[
            { label: "Command", value: "rm -r docs/reports/2026-w40" },
            { label: "Always allow adds", value: "rm -r *", fit: true },
          ]}
          onDeny={noop}
          onAlways={noop}
          onOnce={noop}
        />
      }
      items={[
        {
          id: "turn",
          draw: () => (
            <AgentTurn face={<Face who="lophn" size={20} />} name="lophn">
              <Markdown
                variant="chat"
                source="The 2026-w40 report is superseded by this week’s. I can delete the old folder with a shell command, so I need your OK first."
              />
            </AgentTurn>
          ),
        },
      ]}
    />
  );
}

export function QuestionScreen() {
  return (
    <Session
      placeholder="Reply instead…"
      tail={<Working tone="warning">Waiting for your answer</Working>}
      ask={
        <QuestionCard
          title="lophn is asking"
          at={1}
          of={2}
          onPrev={noop}
          onSkip={noop}
          question="Where should the weekly report go?"
          options={[
            { label: "docs/reports/", sub: "Next to last week’s reports" },
            { label: "eval/reports/", sub: "Inside the eval folder" },
            { label: "A new file each week", sub: "Named by date, no fixed folder" },
          ]}
          initial={{ choices: [0], text: null }}
          onNext={noop}
        />
      }
      items={[
        {
          id: "turn",
          draw: () => (
            <AgentTurn face={<Face who="lophn" size={20} />} name="lophn">
              <Markdown
                variant="chat"
                source="There are 3 new findings since last week. Before I write the report I need two answers."
              />
            </AgentTurn>
          ),
        },
      ]}
    />
  );
}

// ── Inbox ────────────────────────────────────────────

function InboxItem({
  who,
  title,
  time,
  text,
  meta,
  children,
}: {
  who: string;
  title: string;
  time: string;
  text: string;
  meta: string;
  children?: ReactNode;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 10, paddingTop: 12, paddingBottom: 14, paddingHorizontal: 20 }}>
      <Face who={who} size={24} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <Text weight="semibold" style={{ lineHeight: 22, flexShrink: 1 }}>
            {title}
          </Text>
          <Text variant="note" tone="muted" style={{ marginTop: 2 }}>
            {time}
          </Text>
        </View>
        <Text variant="control" tone="secondary" style={{ marginTop: 2, lineHeight: 21 }}>
          {text}
        </Text>
        <Text variant="note" tone="muted" style={{ marginTop: 2 }}>
          {meta}
        </Text>
        {children}
      </View>
    </View>
  );
}

function Buttons({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
      {children}
    </View>
  );
}

export function InboxScreen() {
  const [tab, setTab] = useState(0);
  return (
    <Screen
      top={
        <>
          <TopBar title="Inbox" />
          <Tabs items={["Now", "History"]} on={tab} onChange={setTab} />
        </>
      }
      scroll
    >
      <Band count={1}>Permission requests</Band>
      <InboxItem
        who="Budget reviewer"
        title="Run a command"
        time="1m"
        text="Runs the command shown below."
        meta="Budget reviewer · Weekly report · phroner"
      >
        <View style={{ marginTop: 8 }}>
          <Pre>git push --force origin main</Pre>
        </View>
        <Buttons>
          <Button size="sm" icon={X}>
            Deny
          </Button>
          <Button size="sm" icon={Check}>
            Always allow
          </Button>
          <Button size="sm" variant="primary" icon={Check}>
            Allow once
          </Button>
        </Buttons>
      </InboxItem>
      <Band count={1}>Questions</Band>
      <InboxItem
        who="lophn"
        title="Question"
        time="now"
        text="Include the three flaky scenarios in this week’s regression count?"
        meta="lophn · Harness change summary · phroner"
      >
        <Buttons>
          <Button size="sm">Leave them out</Button>
          <Button size="sm" variant="primary">
            Include them
          </Button>
        </Buttons>
      </InboxItem>
      <Band count={1}>App updates</Band>
      <InboxItem
        who="lophn"
        title="Activate a new version of Orders"
        time="3m"
        text="4 new declarations and 3 data-loss steps since the last version."
        meta="Orders"
      >
        <Buttons>
          <Button size="sm" trailingIcon={ChevronRight}>
            Review
          </Button>
        </Buttons>
      </InboxItem>
      <Band count={1}>Jobs</Band>
      <InboxItem
        who="lophn"
        title="Morning digest"
        time="9h"
        text="Missed once. The last turn was due 9 hours ago."
        meta="Asks lophn"
      />
    </Screen>
  );
}

// ── An app: Orders ───────────────────────────────────

const ORDERS = [
  { id: "#1043", who: "Hana Park", state: "Open", total: "$18.50" },
  { id: "#1042", who: "Dae Kim", state: "Open", total: "$41.99" },
  { id: "#1041", who: "Jun Seo", state: "Shipped", total: "$73.00" },
  { id: "#1040", who: "Ari Choi", state: "Shipped", total: "$9.20" },
];

export function OrdersScreen() {
  return (
    <Screen
      tone="floor"
      top={
        <TopBar
          lead={<Mark kind="app" name="Orders" tone={1} />}
          title="Orders"
          right={<IconButton icon={Ellipsis} label="App menu" />}
        />
      }
      scroll
    >
      <View style={{ gap: 16, paddingTop: 12, paddingHorizontal: 16 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <Text variant="h1" weight="semibold">
            Orders
          </Text>
          <Button variant="primary" icon={Plus}>
            New order
          </Button>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 16, columnGap: 12 }}>
          <View style={{ flex: 1 }}>
            <Stat label="Open" value="12" />
          </View>
          <View style={{ flex: 1 }}>
            <Stat label="Shipped today" value="31" />
          </View>
          <View style={{ width: "100%" }}>
            <Stat label="Revenue today" value="4,210" unit="USD" />
          </View>
        </View>
        <ListCard>
          {ORDERS.map((order, at) => (
            <View key={order.id}>
              {at > 0 && <Divider />}
              <Row
                title={`${order.id} · ${order.who}`}
                sub={`${order.state} · ${order.total}`}
                end={order.state === "Open" ? <Button size="sm">Mark shipped</Button> : undefined}
              />
            </View>
          ))}
        </ListCard>
      </View>
    </Screen>
  );
}

// ── Settings ─────────────────────────────────────────

function Lead({ icon }: { icon: LucideIcon }) {
  return (
    <View style={{ width: 24, height: 24, alignItems: "center", justifyContent: "center" }}>
      <Icon icon={icon} />
    </View>
  );
}

const NEXT = <Icon icon={ChevronRight} size={16} />;

function State({ tone, children }: { tone: "good" | "off"; children: string }) {
  return (
    <>
      <Dot tone={tone} />
      <Text variant="small">{children}</Text>
    </>
  );
}

function Value({ children }: { children: string }) {
  return (
    <>
      <Text variant="small">{children}</Text>
      {NEXT}
    </>
  );
}

export function SettingsScreen() {
  return (
    <Screen tone="floor" top={<TopBar left="back" title="Settings" />} scroll>
      <Label>Computers</Label>
      <Group>
        <Row lead={<Lead icon={Monitor} />} title="mina-desktop" sub={<State tone="good">Connected</State>} end={NEXT} />
        <Divider />
        <Row lead={<Lead icon={Server} />} title="mini-pc" sub={<State tone="good">Connected</State>} end={NEXT} />
        <Divider />
        <Row lead={<Lead icon={Laptop} />} title="work-laptop" sub={<State tone="off">Offline</State>} end={NEXT} />
        <Divider />
        <Row lead={<Lead icon={Plus} />} title="Pair another computer" />
      </Group>
      <Label>This phone</Label>
      <Group>
        <Row lead={<Lead icon={Smartphone} />} title="Name" end={<Value>Mina’s phone</Value>} />
        <Divider />
        <Row lead={<Lead icon={Bell} />} title="Notifications" end={<Value>On</Value>} />
        <Divider />
        <Row lead={<Lead icon={Palette} />} title="Appearance" end={<Value>System</Value>} />
      </Group>
      <Label>About</Label>
      <Group>
        <Row lead={<Lead icon={Info} />} title="lophn for phone" end="0.24.0" />
      </Group>
    </Screen>
  );
}
