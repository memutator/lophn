// Every kit part in its states, one page per family.
import {
  Act,
  AgentTurn,
  ApprovalCard,
  AskCard,
  AskTitle,
  Badge,
  Band,
  Banner,
  Button,
  Card,
  Checkbox,
  Chip,
  CodeBlock,
  Composer,
  ComputerPicker,
  DiffLine,
  Divider,
  Dot,
  Drawer,
  EditCard,
  ErrorLine,
  Fab,
  Field,
  FileChip,
  FilterChips,
  Group,
  Icon,
  IconButton,
  Input,
  Label,
  ListCard,
  Mark,
  Markdown,
  Menu,
  MessageList,
  Meta,
  NavRow,
  Pill,
  Plain,
  Pre,
  QuestionCard,
  Radio,
  Row,
  Screen,
  SecretCard,
  SegmentedControl,
  SessionRow,
  Sheet,
  SidebarFoot,
  SidebarHead,
  SidebarLabel,
  Stat,
  StatusMark,
  Switch,
  Tabs,
  Tag,
  Text,
  Thumb,
  Toast,
  TopBar,
  UserBubble,
  Working,
  WorkspaceRow,
  WorktreeLabel,
  useTheme,
} from "@lophn/ui-native";
import {
  Archive,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Ellipsis,
  Flashlight,
  FolderOpen,
  Gauge,
  Home,
  ListTodo,
  Monitor,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  WifiOff,
} from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { Character, Face } from "./face.tsx";

const noop = () => {};

function Page({
  title,
  onBack,
  tone,
  children,
}: {
  title: string;
  onBack: () => void;
  tone?: "base" | "floor" | "shell";
  children: ReactNode;
}) {
  return (
    <Screen tone={tone} top={<TopBar left="back" onLeft={onBack} title={title} />} scroll>
      {children}
    </Screen>
  );
}

function Pad({ children, gap = 12 }: { children: ReactNode; gap?: number }) {
  return <View style={{ paddingHorizontal: 20, gap }}>{children}</View>;
}

function Line({ children, gap = 8 }: { children: ReactNode; gap?: number }) {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap }}>
      {children}
    </View>
  );
}

// ── frame ────────────────────────────────────────────

export function FramePage({ onBack }: { onBack: () => void }) {
  const theme = useTheme();
  return (
    <Page title="Frame" onBack={onBack}>
      <Label>TopBar</Label>
      <View style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.color.border.subtle }}>
        <TopBar title="Home" menuDot right={<Pill lead={<Dot tone="good" />}>mina-desktop</Pill>} />
        <TopBar
          lead={<Face who="lophn" size={26} />}
          title="lophn"
          sub="Weekly report"
          right={<IconButton icon={Ellipsis} label="Menu" />}
        />
        <TopBar left="back" title="2026-w41.md" under="docs/reports · +38 −2" right={<IconButton icon={Monitor} label="Open" tone="muted" />} />
        <TopBar left="close" title="Add a phone" />
        <TopBar left="none" title="New session" />
      </View>
      <Label end="Inbox · 3">Label</Label>
      <Label end={<IconButton icon={Plus} label="Add" tone="muted" size={18} />}>Label with a button</Label>
      <Label>Row</Label>
      <Row lead={<Face who="Codex" />} title="Split the eval board loader" sub="Codex · phroner · 4m" end={<Dot tone="good" />} />
      <Divider />
      <Row lead={<Face who="lophn" />} title="Weekly report" strong sub="Was waiting for your approval" end={<Dot tone="warning" />} dim />
      <Divider />
      <Row title="Context" end="8% of 1.05M" onPress={noop} />
      <Divider />
      <Row
        title="A row whose second line wraps"
        sub="Sessions and apps that run on it are paused here. Apps that live on this phone keep working."
        wrap
      />
      <Label>Band</Label>
      <Band count={1}>Permission requests</Band>
      <Label>Card · Plain</Label>
      <Pad>
        <Card style={{ padding: 14 }}>
          <Text variant="detail">Card: subtle with a firm edge.</Text>
        </Card>
        <Card tone="base" style={{ padding: 14 }}>
          <Text variant="detail">Card tone base: a waiting request on Home.</Text>
        </Card>
        <Plain style={{ padding: 14 }}>
          <Text variant="detail">Plain: white with a faint edge.</Text>
        </Plain>
      </Pad>
      <Label>Group</Label>
      <Group>
        <Row title="Notifications" end="On" />
        <Divider />
        <Row title="Appearance" end="System" />
      </Group>
      <Label>ListCard</Label>
      <Pad>
        <ListCard>
          <Row title="#1043 · Hana Park" sub="Open · $18.50" end={<Button size="sm">Mark shipped</Button>} />
          <Divider />
          <Row title="#1041 · Jun Seo" sub="Shipped · $73.00" />
        </ListCard>
      </Pad>
      <Label>Banner</Label>
      <Banner
        icon={WifiOff}
        title="mina-desktop is offline"
        action={
          <Button size="sm" icon={RefreshCw}>
            Try again
          </Button>
        }
      >
        Sessions and apps that run on it are paused here.
      </Banner>
      <Label>Toast · Fab</Label>
      <View style={{ height: 150, marginHorizontal: 20, borderRadius: 16, backgroundColor: theme.color.surface.floor }}>
        <Toast
          lead={<Dot tone="good" />}
          action={
            <Button size="sm" variant="ghost">
              What changed
            </Button>
          }
        >
          <Text variant="detail">
            {"Updated to "}
            <Text variant="detail" weight="semibold">
              Release 8
            </Text>
          </Text>
        </Toast>
        <Fab icon={Plus} label="New" />
      </View>
      <View style={{ height: 24 }} />
    </Page>
  );
}

// ── display ──────────────────────────────────────────

export function DisplayPage({ onBack }: { onBack: () => void }) {
  return (
    <Page title="Display" onBack={onBack}>
      <Label>Dot</Label>
      <Pad>
        <Line gap={16}>
          <Dot tone="warning" />
          <Dot tone="good" />
          <Dot tone="critical" />
          <Dot tone="off" />
          <Dot />
        </Line>
      </Pad>
      <Label>Badge · Tag</Label>
      <Pad>
        <Line>
          <Badge count={1} />
          <Badge count={3} />
          <Badge count={128} />
          <Tag>Built-in</Tag>
          <Tag>Paused</Tag>
        </Line>
      </Pad>
      <Label>Mark</Label>
      <Pad>
        <Line>
          <Mark kind="project" name="phroner" />
          <Mark kind="project" name="lophn" tone={4} size="md" />
          <Mark kind="project" name="harness" tone={6} size="lg" />
          <Mark kind="app" name="Orders" tone={1} />
          <Mark kind="app" name="Orders" tone={1} size="md" />
          <Mark kind="app" name="Reading list" tone={2} size="lg" />
        </Line>
        <Line>
          <Mark kind="app" name="Calendar" icon={CalendarDays} />
          <Mark kind="app" name="Calendar" icon={CalendarDays} size="lg" />
          <Mark kind="app" name="Meal planner" tone={3} size="lg" />
          <Mark kind="app" name="+" tone="plain" icon={Plus} size="lg" />
        </Line>
      </Pad>
      <Label>StatusMark</Label>
      <Pad>
        <Line gap={16}>
          <StatusMark tone="good" label="Connected" />
          <StatusMark tone="warning" label="Waiting" />
          <StatusMark tone="critical" label="Failed" />
        </Line>
      </Pad>
      <Label>Pre</Label>
      <Pad>
        <Pre>rm -r docs/reports/2026-w40 and a much longer tail that is cut off</Pre>
        <Pre fit>rm -r *</Pre>
        <Pre wrap>{"> count --week 41\nscenarios  2,400\nregressed     11  (0.4%)\nexit 0"}</Pre>
      </Pad>
      <Label>Stat</Label>
      <Pad>
        <Line gap={40}>
          <Stat label="Open" value="12" />
          <Stat label="Revenue today" value="4,210" unit="USD" />
        </Line>
      </Pad>
      <View style={{ height: 24 }} />
    </Page>
  );
}

// ── controls ─────────────────────────────────────────

export function ControlsPage({ onBack }: { onBack: () => void }) {
  const theme = useTheme();
  const [text, setText] = useState("");
  const [search, setSearch] = useState("week");
  const [on, setOn] = useState(true);
  const [tab, setTab] = useState(0);
  const [seg, setSeg] = useState(1);
  const [filter, setFilter] = useState(1);
  const [pick, setPick] = useState(0);
  return (
    <Page title="Controls" onBack={onBack}>
      <Label>Button</Label>
      <Pad>
        <Line>
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger" icon={Trash2}>
            Delete
          </Button>
        </Line>
        <Line>
          <Button size="sm" icon={Check}>
            Small
          </Button>
          <Button size="sm" variant="primary" trailingIcon={ChevronRight}>
            Next
          </Button>
          <Button disabled>Disabled</Button>
        </Line>
        <Button variant="primary" size="lg" icon={Check}>
          Large in a column
        </Button>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button block icon={Check}>
            Block
          </Button>
          <Button block variant="primary" icon={Check}>
            Allow once
          </Button>
        </View>
      </Pad>
      <Label>IconButton</Label>
      <Pad>
        <Line gap={4}>
          <IconButton icon={Search} label="Search" />
          <IconButton icon={Search} label="Search" tone="muted" size={20} />
          <IconButton icon={Bell} label="Inbox" dot />
          <IconButton icon={Plus} label="Add" disabled />
          <View style={{ padding: 6, borderRadius: 12, backgroundColor: "#0b0b0b" }}>
            <IconButton icon={Flashlight} label="Light" tone="camera" />
          </View>
        </Line>
      </Pad>
      <Label>Field · Input</Label>
      <Pad>
        <Field label="Name" hint="Shown on the computer's list of phones.">
          <Input value={text} onChangeText={setText} placeholder="Mina’s phone" />
        </Field>
        <Input value="Focused" onChangeText={noop} focus />
        <Input value={search} onChangeText={setSearch} icon={Search} soft compact placeholder="Search models" />
      </Pad>
      <Label>Switch · Radio · Checkbox</Label>
      <Pad>
        <Line gap={16}>
          <Switch on={on} onChange={setOn} label="Notifications" />
          <Switch on={false} label="Off" />
          <Radio on />
          <Radio on={false} />
          <Checkbox on />
          <Checkbox on={false} />
        </Line>
      </Pad>
      <Label>Tabs</Label>
      <Tabs items={["Now", "History"]} on={tab} onChange={setTab} />
      <Label>SegmentedControl</Label>
      <Pad>
        <SegmentedControl items={["Low", "Medium", "High", "XHigh", "Max"]} on={seg} onChange={setSeg} />
      </Pad>
      <Label>FilterChips</Label>
      <Pad>
        <FilterChips items={["All", "Last 7 days", "Open"]} on={filter} onChange={setFilter} />
      </Pad>
      <Label>Chip · Pill</Label>
      <Pad>
        <Line gap={4}>
          <Chip>Sonnet 5.5 · Medium</Chip>
          <Chip lead={<Icon icon={Home} size={15} />}>Home</Chip>
        </Line>
        <Line>
          <Pill lead={<Dot tone="good" />}>mina-desktop</Pill>
          <Pill lead={<Dot tone="off" />}>mina-desktop</Pill>
          <Pill tall lead={<Icon icon={FolderOpen} size={16} />}>
            phroner
          </Pill>
        </Line>
      </Pad>
      <Label>Radio in rows</Label>
      <Pad gap={6}>
        {["docs/reports/", "eval/reports/"].map((label, at) => (
          <Row key={label} lead={<Radio on={pick === at} />} title={label} onPress={() => setPick(at)} />
        ))}
      </Pad>
      <View style={{ height: 24, backgroundColor: theme.color.surface.base }} />
    </Page>
  );
}

// ── overlays ─────────────────────────────────────────

export function OverlaysPage({ onBack }: { onBack: () => void }) {
  const [sheet, setSheet] = useState(false);
  const [form, setForm] = useState(false);
  const [menu, setMenu] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [text, setText] = useState("");
  return (
    <Page title="Overlays" onBack={onBack}>
      <Label>Open one</Label>
      <Pad>
        <Button onPress={() => setSheet(true)}>Sheet with rows</Button>
        <Button onPress={() => setForm(true)}>Sheet with a text box</Button>
        <Button onPress={() => setMenu(true)}>Menu</Button>
        <Button onPress={() => setDrawer(true)}>Drawer</Button>
      </Pad>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Computers">
        <Row lead={<Icon icon={Monitor} />} title="mina-desktop" strong sub={<><Dot tone="good" /><Text variant="small">Connected · same network</Text></>} end={<Icon icon={Check} />} />
        <Row lead={<Icon icon={Monitor} />} title="mini-pc" strong sub="Connected · through the relay" end={<Badge count={1} />} />
        <Divider spacing={8} />
        <Row lead={<Icon icon={Plus} />} title="Pair another computer" />
      </Sheet>
      <Sheet
        open={form}
        onClose={() => setForm(false)}
        title="Change Orders"
        end={
          <Button size="sm" variant="primary" onPress={() => setForm(false)}>
            Send
          </Button>
        }
      >
        <View style={{ paddingHorizontal: 20, paddingBottom: 8, gap: 10 }}>
          <Text variant="note" tone="muted">
            lophn works on it in the Orders workspace and asks you before a new version goes live.
          </Text>
          <Input value={text} onChangeText={setText} placeholder="Add a filter for the last 7 days" autoFocus />
        </View>
      </Sheet>
      <Menu
        open={menu}
        onClose={() => setMenu(false)}
        title="Weekly report"
        sub="lophn · phroner · Main"
        lead={<Face who="lophn" size={34} />}
        items={[
          { label: "Rename", icon: Pencil, onSelect: noop },
          { label: "Permissions", icon: ShieldCheck, end: "Ask when needed", onSelect: noop },
          { label: "Context", icon: Gauge, end: "8% of 1.05M", onSelect: noop },
          { label: "Show on mina-desktop", icon: Monitor, sub: "Brings this session to the front there", onSelect: noop },
          { label: "Archive", icon: Archive, apart: true, onSelect: noop },
          { label: "Delete", icon: Trash2, danger: true, onSelect: noop },
        ]}
      />
      <Drawer open={drawer} onClose={() => setDrawer(false)}>
        <SidebarHead lead={<Character size={26} />} title="lophn" />
        <NavRow icon={Bell} label="Inbox" end={<Badge count={3} />} on />
        <NavRow icon={Clock} label="Jobs" />
      </Drawer>
    </Page>
  );
}

// ── sidebar ──────────────────────────────────────────

export function SidebarPage({ onBack }: { onBack: () => void }) {
  return (
    <Page title="Sidebar parts" onBack={onBack} tone="shell">
      <SidebarHead
        lead={<Character size={26} />}
        title="lophn"
        right={<IconButton icon={Search} label="Search" tone="muted" size={20} />}
      />
      <ComputerPicker icon={Monitor} name="mina-desktop" state="Connected" tone="good" />
      <ComputerPicker icon={Monitor} name="work-laptop" state="Offline" tone="off" />
      <NavRow icon={Bell} label="Inbox" end={<Badge count={3} />} />
      <NavRow icon={Clock} label="Jobs" on />
      <SidebarLabel end={<IconButton icon={Plus} label="New workspace" tone="muted" size={18} />}>
        Workspaces
      </SidebarLabel>
      <WorkspaceRow lead={<Icon icon={Home} size={19} />} label="Home" on />
      <WorkspaceRow lead={<Icon icon={FolderOpen} size={19} />} label="phroner" />
      <WorktreeLabel>Main</WorktreeLabel>
      <SessionRow face={<Face who="lophn" size={20} />} title="Weekly report" tone="warning" on />
      <SessionRow face={<Face who="Claude Code" size={20} />} title="Fix flaky retry in the scenario runner" tone="good" />
      <SessionRow face={<Face who="Codex" size={20} />} title="Idle session" />
      <WorkspaceRow lead={<Mark kind="app" name="Orders" tone={1} />} label="Orders" />
      <SidebarFoot>
        <NavRow icon={Settings} label="Settings" />
      </SidebarFoot>
    </Page>
  );
}

// ── conversation ─────────────────────────────────────

const DIFF: [string, string, "add" | "del" | undefined][] = [
  ["11", "## Regressions", undefined],
  ["13", "Regression share: 0.9% (22 of 2,400)", "del"],
  ["13", "Regression share: 0.4% (11 of 2,400)", "add"],
  ["14", "", undefined],
  ["15", "| Finding | Scenarios | Cause |", "add"],
];

const READING =
  "# Weekly report\n\nThe regression share fell to **0.4%** this week. See `eval/findings`.\n\n## Regressions\n\n| Finding | Scenarios | Cause |\n|---|---|---|\n| F-011 | 6 | query-recipe gap |\n| F-012 | 3 | same lookup |\n\n## Next week\n\n1. Rerun exp-011 with the name fix\n2. Move the flaky set\n\n```ts\nconst share = regressed / scenarios;\n```";

export function ConversationPage({ onBack }: { onBack: () => void }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("Add the exp-008 numbers too");
  return (
    <Page title="Conversation" onBack={onBack}>
      <Label>UserBubble · AgentTurn</Label>
      <View style={{ paddingHorizontal: 16, gap: 18 }}>
        <UserBubble>Write this week’s eval report from the new findings.</UserBubble>
        <UserBubble note="Steer · went into the running turn" noteIcon={Pencil}>
          Also add the exp-008 numbers to the report.
        </UserBubble>
        <AgentTurn face={<Face who="lophn" size={20} />} name="lophn">
          <Act onPress={noop}>Read 2 files · Searched 1 time · Listed 1 folder</Act>
          <Markdown
            variant="chat"
            source={"The retry wrapper is applied in both `runner.ts` and `client.ts`.\n\n- F-011 is the query-recipe-gap regression\n- The other two changed for the same reason"}
          />
          <EditCard path="src/scenario/runner.ts" add={4} del={11} />
          <Meta onCopy={noop}>Worked for 1m 12s · 6:41 PM</Meta>
        </AgentTurn>
        <Working>Working · 42s</Working>
        <Working tone="warning">Waiting for your approval</Working>
        <ErrorLine
          action={
            <Button size="sm" icon={RefreshCw}>
              Retry
            </Button>
          }
        >
          Anthropic answered 529 (overloaded). Nothing was lost.
        </ErrorLine>
      </View>
      <Label>CodeBlock</Label>
      <View style={{ paddingHorizontal: 16 }}>
        <CodeBlock language="ts" code={"export function share(regressed: number, scenarios: number) {\n  return regressed / scenarios;\n}"} />
      </View>
      <Label>Markdown · reading</Label>
      <View style={{ paddingHorizontal: 20 }}>
        <Markdown source={READING} />
      </View>
      <Label>Waiting cards</Label>
      <View style={{ gap: 12 }}>
        <ApprovalCard
          title="lophn wants to run a command"
          facts={[
            { label: "Command", value: "rm -r docs/reports/2026-w40" },
            { label: "Always allow adds", value: "rm -r *", fit: true },
          ]}
          onAlways={noop}
        />
        <QuestionCard
          title="lophn is asking"
          at={2}
          of={2}
          question="Include the three flaky scenarios?"
          options={[{ label: "Include them" }, { label: "Leave them out", sub: "Counted next week" }]}
          nextLabel="Send"
          onNext={noop}
        />
        <SecretCard
          title="lophn needs a secret"
          secret="PAYMENTS_KEY → api.payments.example"
          note="Secrets are typed on the computer so they never pass through this phone. Open lophn on mina-desktop to enter it."
        />
        <AskCard compact>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <AskTitle icon={ListTodo}>Todo · 2 of 4 done</AskTitle>
            <Icon icon={ChevronDown} size={16} tone="muted" />
          </View>
        </AskCard>
      </View>
      <Label>DiffLine</Label>
      {DIFF.map(([no, text, kind], at) => (
        <DiffLine key={at} no={no} text={text} kind={kind} />
      ))}
      <Label>Composer</Label>
      <Composer value={a} onChangeText={setA} onSend={noop} onAttach={noop} placeholder="Reply…" chips={<Chip>Sonnet 5.5 · Medium</Chip>} />
      <Composer value={b} onChangeText={setB} onSend={noop} onAttach={noop} placeholder="Reply…" chips={<Chip>Sonnet 5.5 · Medium</Chip>} above={<><Thumb /><FileChip name="2026-w41.md" /></>} />
      <Composer value="" onChangeText={noop} onSend={noop} onAttach={noop} working onStop={noop} placeholder="Queue a message…" chips={<Chip>Opus 5.5 · High</Chip>} />
      <Composer value="" onChangeText={noop} onSend={noop} disabled placeholder="Cannot reach mina-desktop" />
      <View style={{ height: 24 }} />
    </Page>
  );
}

// A long thread: the list starts at the newest message and shows a button back to it after scrolling up.
export function ThreadPage({ onBack }: { onBack: () => void }) {
  const [draft, setDraft] = useState("");
  const [items, setItems] = useState(() =>
    Array.from({ length: 30 }, (_, at) => ({ id: String(at), mine: at % 2 === 0, text: `Message ${at + 1}. ${at % 2 === 0 ? "A question from the person." : "An answer from lophn, a little longer so it takes two lines on a phone."}` })),
  );
  return (
    <Screen
      top={<TopBar left="back" onLeft={onBack} title="MessageList" />}
      footer={
        <Composer
          value={draft}
          onChangeText={setDraft}
          onSend={() => {
            setItems((all) => [...all, { id: String(all.length), mine: true, text: draft }]);
            setDraft("");
          }}
          placeholder="Reply…"
        />
      }
    >
      <MessageList
        items={items}
        keyOf={(item) => item.id}
        renderItem={(item) =>
          item.mine ? (
            <UserBubble>{item.text}</UserBubble>
          ) : (
            <AgentTurn face={<Face who="lophn" size={20} />} name="lophn">
              <Markdown variant="chat" source={item.text} />
            </AgentTurn>
          )
        }
      />
    </Screen>
  );
}
