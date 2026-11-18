// Flow 2. Home and the sidebar: the frame every other screen lives in.
import {
  ArrowLeft,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Clock,
  FileText,
  FolderOpen,
  Globe,
  Home,
  Laptop,
  type LucideIcon,
  Monitor,
  Plus,
  RefreshCw,
  Search,
  Server,
  Settings,
  Users,
  WifiOff,
  Workflow,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { AgentCharacter } from "../../../../packages/shell/renderer/parts/avatar/character.tsx";
import type { SessionDot } from "../../../../packages/shell/renderer/parts/agent-session/activity.ts";
import { TabStateDot } from "../../../../packages/shell/renderer/parts/tab-state-dot/tab-state-dot.tsx";
import {
  Badge,
  Btn,
  Chip,
  Composer,
  Dot,
  Face,
  Flow,
  Ic,
  IconBtn,
  Keyboard,
  Label,
  Mark,
  Phone,
  Row,
  Sheet,
  Shot,
  s,
  TopBar,
} from "./kit.tsx";

export const COMPUTER = "mina-desktop";

export function ComputerChip({ off }: { off?: boolean }) {
  return (
    <span className={s.pill} style={{ marginRight: 8 }}>
      <Dot tone={off ? "off" : "good"} />
      {COMPUTER}
      <Ic icon={ChevronDown} size={14} />
    </span>
  );
}

// ── sidebar ──────────────────────────────────────────

function Nav({
  icon,
  children,
  end,
  on,
}: {
  icon: LucideIcon;
  children: ReactNode;
  end?: ReactNode;
  on?: boolean;
}) {
  return (
    <div className={s.dRow} data-on={on || undefined}>
      <Ic icon={icon} size={19} />
      <span className={s.dText}>{children}</span>
      {end}
    </div>
  );
}

function Space({
  lead,
  children,
  on,
}: {
  lead: ReactNode;
  children: ReactNode;
  on?: boolean;
}) {
  return (
    <div className={s.dRow} data-kind="space" data-on={on || undefined}>
      {lead}
      <span className={s.dText}>{children}</span>
    </div>
  );
}

// The desktop's state dot: waiting yellow, working ink that breathes, a turn ended and not seen green, ended gray.
function Session({
  who,
  children,
  dot,
  on,
}: {
  who: string;
  children: ReactNode;
  dot?: SessionDot;
  on?: boolean;
}) {
  return (
    <div className={s.dRow} data-kind="session" data-on={on || undefined}>
      <Face who={who} size={20} />
      <span className={s.dText}>{children}</span>
      {dot !== undefined && <TabStateDot dot={dot} />}
    </div>
  );
}

export type Place =
  | "home"
  | "inbox"
  | "jobs"
  | "agents"
  | "pages"
  | "weekly-report"
  | "phroner"
  | "orders"
  | "calendar";

/** The same list as the desktop sidebar: Inbox, Jobs, Agents, the computer's Pages, then every workspace with its sessions. */
export function SidebarBody({ on }: { on: Place }) {
  return (
    <>
      <div className={s.brand}>
        <span className={s.box} style={{ width: 26, height: 26 }}>
          <AgentCharacter
            profile={{ kind: "character", shape: "square", color: "coral" }}
          />
        </span>
        <span className={s.grow}>lophn</span>
        <IconBtn icon={Search} tone="muted" size={20} />
      </div>
      <div className={s.computer}>
        <Ic icon={Monitor} size={20} />
        <div className={s.grow}>
          <div style={{ fontSize: 15, fontWeight: 500, lineHeight: "20px" }}>
            {COMPUTER}
          </div>
          <div
            className={s.muted}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              lineHeight: "16px",
            }}
          >
            <Dot tone="good" />
            Connected
          </div>
        </div>
        <Ic icon={ChevronsUpDown} size={16} className={s.muted} />
      </div>
      <div className={s.drawerScroll}>
        <Nav icon={Bell} end={<Badge n={3} />} on={on === "inbox"}>
          Inbox
        </Nav>
        <Nav icon={Clock} on={on === "jobs"}>
          Jobs
        </Nav>
        <Nav icon={Users} on={on === "agents"}>
          Agents
        </Nav>
        <Nav icon={Globe} on={on === "pages"}>
          Pages
        </Nav>

        <div className={s.dLabel}>
          Workspaces
          <IconBtn icon={Plus} tone="muted" size={18} />
        </div>
        <Space lead={<Ic icon={Home} size={19} />} on={on === "home"}>
          Home
        </Space>
        <Session who="lophn" dot="finished">
          Plan the week
        </Session>

        <Space lead={<Ic icon={FolderOpen} size={19} />} on={on === "phroner"}>
          phroner
        </Space>
        <div className={s.dSub}>Main</div>
        <Session who="lophn" dot="waiting" on={on === "weekly-report"}>
          Weekly report
        </Session>
        <Session who="Claude Code" dot="working">
          Fix flaky retry in the scenario runner
        </Session>
        <div className={s.dSub}>weekly-review</div>
        <div className={s.dRow} data-kind="session">
          <span className={s.box} style={{ width: 20, height: 20 }}>
            <Ic icon={Workflow} size={17} />
          </span>
          <span className={s.dText}>weekly-review</span>
          <Dot tone="warning" />
        </div>
        <Session who="Codex" dot="working">
          Split the eval board loader
        </Session>
        {(on === "phroner" || on === "weekly-report") && (
          // The workspace on screen keeps the rest of its last 7 days under a folded Recent, as on the desktop.
          <div className={s.dRow} data-kind="session">
            <span className={s.box} style={{ width: 20, height: 20 }}>
              <Ic icon={ChevronRight} size={15} />
            </span>
            <span className={s.dText}>Recent · 13</span>
          </div>
        )}

        <Space
          lead={<Mark kind="app" name="Orders" tone={1} />}
          on={on === "orders"}
        >
          Orders
        </Space>
        <Session who="lophn" dot="waiting">
          Add a CSV export
        </Session>
        <Space
          lead={
            <Mark kind="app" name="Calendar" tone={0} icon={CalendarDays} />
          }
          on={on === "calendar"}
        >
          Calendar
        </Space>
        <Space lead={<Mark kind="app" name="Meal planner" tone={3} />}>
          Meal planner
        </Space>
        <Space lead={<Mark kind="app" name="Reading list" tone={2} />}>
          Reading list
        </Space>
      </div>
      <div className={s.drawerFoot}>
        <Nav icon={Settings}>Settings</Nav>
      </div>
    </>
  );
}

export function Sidebar({ on }: { on: Place }) {
  return (
    <>
      <div className={s.scrim} />
      <div className={s.drawer}>
        <div style={{ height: 46, flex: "none" }} />
        <SidebarBody on={on} />
        <div style={{ height: 26, flex: "none" }} />
      </div>
    </>
  );
}

// ── Home ─────────────────────────────────────────────

function Tile({
  children,
  name,
  dim,
}: {
  children: ReactNode;
  name: string;
  dim?: boolean;
}) {
  return (
    <div className={s.tile} data-dim={dim || undefined}>
      {children}
      <span className={s.tileName}>{name}</span>
    </div>
  );
}

function Apps({ offline }: { offline?: boolean }) {
  return (
    <div className={s.tiles}>
      <Tile name="Orders" dim={offline}>
        <Mark kind="app" name="Orders" tone={1} size="lg" />
      </Tile>
      <Tile name="Calendar">
        <Mark
          kind="app"
          name="Calendar"
          tone={0}
          size="lg"
          icon={CalendarDays}
        />
      </Tile>
      <Tile name="Meal planner" dim={offline}>
        <Mark kind="app" name="Meal planner" tone={3} size="lg" />
      </Tile>
      <Tile name="Reading list">
        <Mark kind="app" name="Reading list" tone={2} size="lg" />
      </Tile>
      <Tile name="New app">
        <Mark kind="app" name="+" tone="plain" size="lg" icon={Plus} />
      </Tile>
    </div>
  );
}

export function HomeScreen({ over }: { over?: ReactNode }) {
  return (
    <Phone over={over}>
      <TopBar title="Home" right={<ComputerChip />} />
      <div className={s.body}>
        <Label
          end={
            <>
              Inbox · 3
              <Ic icon={ChevronRight} size={15} />
            </>
          }
        >
          Needs you
        </Label>
        <div className={s.need}>
          <div className={s.needHead}>
            <Face who="lophn" size={22} />
            <span className={s.grow}>Run a command</span>
            <span className={s.note}>now</span>
          </div>
          <div className={s.note} style={{ marginTop: 2 }}>
            Weekly report · phroner
          </div>
          <div className={s.pre} style={{ marginTop: 8 }}>
            rm -r docs/reports/2026-w40
          </div>
          <div className={s.btnRow} style={{ marginTop: 10 }}>
            <Btn block icon={X}>
              Deny
            </Btn>
            <Btn block variant="primary" icon={Check}>
              Allow once
            </Btn>
          </div>
        </div>
        <div className={s.need}>
          <div className={s.needHead}>
            <Face who="lophn" size={22} />
            <span className={s.grow}>Question</span>
            <span className={s.note}>4m</span>
          </div>
          <div className={s.note} style={{ marginTop: 2 }}>
            Add a CSV export · Orders
          </div>
          <p className={s.needText}>
            Should the export include orders that were cancelled?
          </p>
        </div>

        <Label>Apps</Label>
        <Apps />

        <Label>Working now</Label>
        <Row
          lead={<Face who="Codex" />}
          title="Split the eval board loader"
          sub="Codex · phroner · 4m"
          end={<TabStateDot dot="working" />}
        />
      </div>
      <Composer
        placeholder="Ask lophn…"
        chips={<Chip lead={<Ic icon={Home} size={15} />}>Home</Chip>}
      />
    </Phone>
  );
}

function Device({ icon }: { icon: LucideIcon }) {
  return (
    <span
      className={s.box}
      style={{
        width: 40,
        height: 40,
        borderRadius: 12,
        background: "var(--color-surface-muted)",
      }}
    >
      <Ic icon={icon} />
    </span>
  );
}

function Computers() {
  return (
    <Sheet title="Computers">
      <Row
        lead={<Device icon={Monitor} />}
        title="mina-desktop"
        strong
        sub={
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Dot tone="good" /> Connected · same network
          </span>
        }
        end={<Ic icon={Check} />}
      />
      <Row
        lead={<Device icon={Server} />}
        title="mini-pc"
        strong
        sub={
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Dot tone="good" /> Connected · through the relay
          </span>
        }
        end={<Badge n={1} />}
      />
      <Row
        lead={<Device icon={Laptop} />}
        title="work-laptop"
        strong
        sub={
          <span
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Dot tone="off" /> Offline · last seen yesterday
          </span>
        }
      />
      <div className={s.hair} style={{ margin: "8px 20px" }} />
      <Row
        lead={
          <span className={s.box} style={{ width: 40, height: 40 }}>
            <Ic icon={Plus} />
          </span>
        }
        title="Pair another computer"
      />
    </Sheet>
  );
}

function Offline() {
  return (
    <Phone>
      <TopBar title="Home" right={<ComputerChip off />} />
      <div className={s.body}>
        <div className={s.banner}>
          <Ic icon={WifiOff} size={20} style={{ marginTop: 1 }} />
          <div className={s.grow}>
            <div style={{ fontWeight: 600 }}>mina-desktop is offline</div>
            <div className={s.muted} style={{ marginTop: 2 }}>
              Sessions and apps that run on it are paused here. Apps that live
              on this phone keep working and sync when it is back.
            </div>
            <div style={{ marginTop: 10 }}>
              <Btn size="sm" icon={RefreshCw}>
                Try again
              </Btn>
            </div>
          </div>
        </div>
        <Label>Apps</Label>
        <Apps offline />
        <Label>Last seen 12 minutes ago</Label>
        <Row
          dim
          lead={<Face who="lophn" />}
          title="Weekly report"
          sub="Was waiting for your approval"
          end={<Dot tone="warning" />}
        />
        <Row
          dim
          lead={<Face who="Codex" />}
          title="Split the eval board loader"
          sub="Was working"
          end={<TabStateDot dot="working" />}
        />
        <Row
          dim
          lead={<Face who="lophn" />}
          title="Add a CSV export"
          sub="Was waiting for your answer"
          end={<Dot tone="warning" />}
        />
      </div>
      <Composer placeholder="Cannot reach mina-desktop" attach={false} />
    </Phone>
  );
}

function SearchScreen() {
  return (
    <Phone>
      <div className={s.top}>
        <IconBtn icon={ArrowLeft} />
        <div
          className={s.field}
          data-soft=""
          style={{ flex: 1, minHeight: 40, marginRight: 8 }}
        >
          <Ic icon={Search} size={18} className={s.muted} />
          <span>
            week
            <span className={s.caret} />
          </span>
        </div>
      </div>
      <div className={s.body}>
        <Label>Sessions</Label>
        <Row
          lead={<Face who="lophn" />}
          title="Weekly report"
          sub="lophn · phroner"
          end={<Dot tone="warning" />}
        />
        <Row
          lead={<Face who="lophn" />}
          title="Plan the week"
          sub="lophn · Home"
          end={<Dot />}
        />
        <Label>Workflows</Label>
        <Row
          lead={
            <span className={s.box} style={{ width: 24, height: 24 }}>
              <Ic icon={Workflow} />
            </span>
          }
          title="weekly-review"
          sub="phroner · your turn"
          end={<Dot tone="warning" />}
        />
        <Label>Files</Label>
        <Row
          lead={
            <span className={s.box} style={{ width: 24, height: 24 }}>
              <Ic icon={FileText} />
            </span>
          }
          title="2026-w41.md"
          sub="phroner / docs / reports"
        />
        <Label>Jobs</Label>
        <Row
          lead={
            <span className={s.box} style={{ width: 24, height: 24 }}>
              <Ic icon={Clock} />
            </span>
          }
          title="Weekly review"
          sub="Every 7 days at 10:00"
        />
      </div>
      <Keyboard />
    </Phone>
  );
}

export function ShellFlow() {
  return (
    <Flow
      title="2 · Home and the sidebar"
      note="앱의 뼈대. 왼쪽 위 단추나 왼쪽 가장자리를 밀어 sidebar를 연다. sidebar는 desktop과 같은 목록이다: 컴퓨터, Inbox, Jobs, Agents, Workspaces(Home, project, 앱)와 그 아래 session. 본문에는 거기서 고른 것 하나가 뜬다. 아래 tab bar는 없다. 폭이 넓은 기기(600 이상)에서는 sidebar가 늘 열려 있다."
    >
      <Shot
        title="Home"
        text="켜면 여기다. 나를 기다리는 것(그 자리에서 답한다), 내 앱, 지금 일하는 session, 그리고 맨 아래에서 바로 lophn에게 말을 건다. 오른쪽 위는 지금 붙은 컴퓨터다."
      >
        <HomeScreen />
      </Shot>
      <Shot
        title="Sidebar"
        text="desktop sidebar 그대로다. workspace마다 그 안의 session이 달리고 점이 상태다(노랑은 나를 기다림, 초록은 일하는 중). 앱 workspace를 누르면 그 앱 화면이 열린다. 위에서 컴퓨터를 바꾸고, 아래에 설정이 있다."
      >
        <HomeScreen over={<Sidebar on="home" />} />
      </Shot>
      <Shot
        title="Computers"
        text="컴퓨터마다 lophn이 하나다. 고르면 sidebar 전체가 그 컴퓨터의 것으로 바뀐다. 다른 컴퓨터에서 기다리는 것이 있으면 수가 붙는다."
      >
        <HomeScreen over={<Computers />} />
      </Shot>
      <Shot
        title="Computer offline"
        text="컴퓨터가 꺼졌거나 닿지 않을 때. 무엇이 멈췄고 무엇이 되는지 말한다. 폰에서 도는 앱은 그대로 열리고, 컴퓨터가 필요한 것은 흐리게 보인다."
      >
        <Offline />
      </Shot>
      <Shot
        title="Search"
        text="sidebar의 돋보기. session, workflow, file, job, 앱, agent를 한 번에 찾는다."
      >
        <SearchScreen />
      </Shot>
    </Flow>
  );
}
