// Flow 11. Widgets and the home screen: a person's app on the phone's Home screen as a widget and as an icon,
// and the one question about the phone's location. Android draws the launcher, the widget frame and the OS
// permission box; lophn draws what is inside the widget and the screens in the app.
import {
  CalendarDays,
  Camera,
  Check,
  Ellipsis,
  History,
  LayoutGrid,
  Mail,
  MapPin,
  MessageSquarePlus,
  PencilLine,
  Phone as PhoneIcon,
  Plus as PlusIcon,
  RefreshCw,
  ScrollText,
  SquarePlus,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { AgentCharacter } from "../../../../packages/shell/renderer/parts/avatar/character.tsx";
import {
  Badge,
  Btn,
  Dot,
  Face,
  Flow,
  Ic,
  IconBtn,
  Label,
  Mark,
  Phone,
  Row,
  Sheet,
  Shot,
  s,
  TopBar,
} from "./kit.tsx";
import w from "./widgets.module.css";

// ── widget value: the four nodes ─────────────────────

type Tone = "neutral" | "good" | "warn" | "bad";

type Node =
  | {
      kind: "text";
      text: string;
      style: "title" | "body" | "caption";
      tone?: Tone;
    }
  | { kind: "stat"; value: string; label: string; tone?: Tone }
  | { kind: "progress"; value: number; label?: string; tone?: Tone }
  | { kind: "list"; items: { text: string; trail?: string; tone?: Tone }[] };

function Nodes({ rows }: { rows: Node[] }) {
  return (
    <>
      {rows.map((node, at) => {
        const key = `${node.kind}${at}`;
        if (node.kind === "text") {
          return (
            <div
              key={key}
              className={`${w[node.style]} ${w.tone}`}
              data-tone={node.tone}
            >
              {node.text}
            </div>
          );
        }
        if (node.kind === "stat") {
          return (
            <div key={key} className={w.stat}>
              <span
                className={`${w.statValue} ${w.tone}`}
                data-tone={node.tone}
              >
                {node.value}
              </span>
              <span className={w.statLabel}>{node.label}</span>
            </div>
          );
        }
        if (node.kind === "progress") {
          return (
            <div key={key} className={w.progress}>
              <div className={w.track}>
                <div
                  className={w.fill}
                  data-tone={node.tone}
                  style={{ width: `${node.value * 100}%` }}
                />
              </div>
              {node.label !== undefined && (
                <span className={w.statLabel}>{node.label}</span>
              )}
            </div>
          );
        }
        return (
          <div key={key} className={w.list}>
            {node.items.map((item) => (
              <div
                key={item.text}
                className={`${w.item} ${w.tone}`}
                data-tone={item.tone}
              >
                <span className={w.itemText}>{item.text}</span>
                {item.trail !== undefined && (
                  <span className={w.trail}>{item.trail}</span>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

// ── widget ───────────────────────────────────────────

function Widget({
  size,
  app,
  label,
  rows,
  foot = "Updated 14:05",
  dim,
}: {
  size: "small" | "wide";
  app: string;
  label: string;
  rows: Node[];
  foot?: string;
  /** The last try failed: the rows are the ones fetched before. */
  dim?: boolean;
}) {
  return (
    <div className={w.widget} data-size={size} data-dim={dim || undefined}>
      <div className={w.head}>
        <span className={w.headText}>
          {app} · {label}
        </span>
        <span className={w.refresh}>
          <Ic icon={RefreshCw} size={14} />
        </span>
      </div>
      <div className={w.body}>
        <Nodes rows={rows} />
      </div>
      <div className={w.foot}>{foot}</div>
    </div>
  );
}

/** A widget with no value to draw: one centred line, and no header. */
function Placeholder({
  size,
  children,
}: {
  size: "small" | "wide";
  children: ReactNode;
}) {
  return (
    <div className={w.widget} data-size={size}>
      <div className={w.empty}>{children}</div>
    </div>
  );
}

function LophnMark({ size = 28 }: { size?: number }) {
  return (
    <span className={s.box} style={{ width: size, height: size }}>
      <AgentCharacter
        look={{ kind: "character", shape: "square", color: "coral" }}
      />
    </span>
  );
}

const ORDERS_TODAY: Node[] = [
  { kind: "stat", value: "12", label: "Open orders" },
  { kind: "progress", value: 0.78, label: "31 of 40 shipped", tone: "good" },
];

const STOCK_LOW: Node[] = [
  {
    kind: "list",
    items: [
      { text: "Green tea 200 g", trail: "3 left", tone: "bad" },
      { text: "Oat milk 1 L", trail: "8 left", tone: "warn" },
      { text: "Paper cups", trail: "21 left" },
      { text: "Filters", trail: "34 left" },
      { text: "Syrup", trail: "40 left" },
    ],
  },
];

const DEPLOY: Node[] = [
  { kind: "text", text: "Release 8 is live", style: "title", tone: "good" },
  { kind: "text", text: "Payments sync failed", style: "body", tone: "bad" },
  { kind: "text", text: "Retry in 10 min", style: "caption" },
];

const NEXT: Node[] = [
  { kind: "text", text: "Stand-up", style: "title" },
  { kind: "text", text: "09:30 · 30 min", style: "body" },
  { kind: "text", text: "Team", style: "caption" },
];

// ── launcher ─────────────────────────────────────────

function Icon({
  label,
  dim,
  children,
}: {
  label: string;
  dim?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={w.icon} data-dim={dim || undefined}>
      {children}
      <span>{label}</span>
    </div>
  );
}

const OrdersIcon = () => <Mark kind="app" name="Orders" tone={1} size="lg" />;

/** A phone's own apps, just to fill the grid. */
function Filler({ at }: { at: 0 | 1 | 2 | 3 }) {
  const list = [
    { label: "Phone", icon: PhoneIcon, tone: 4 },
    { label: "Mail", icon: Mail, tone: 2 },
    { label: "Maps", icon: MapPin, tone: 3 },
    { label: "Camera", icon: Camera, tone: 6 },
  ] as const;
  const one = list[at];
  return (
    <Icon label={one.label}>
      <Mark
        kind="app"
        name={one.label}
        tone={one.tone}
        size="lg"
        icon={one.icon}
      />
    </Icon>
  );
}

function Dock() {
  return (
    <div className={w.dock}>
      <Filler at={0} />
      <Filler at={1} />
      <Filler at={2} />
      <Filler at={3} />
    </div>
  );
}

function Launcher({
  date = true,
  over,
  children,
}: {
  date?: boolean;
  over?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Phone tone="shell" over={over}>
      <div className={w.launcher}>
        {date && <div className={w.date}>Sun, Nov 15</div>}
        {children}
        <div className={s.grow} />
        <Dock />
      </div>
    </Phone>
  );
}

function Slot({
  size,
  children,
}: {
  size: "small" | "wide";
  children: ReactNode;
}) {
  return (
    <div className={`${w.cell} ${size === "wide" ? w.slotWide : w.slotSmall}`}>
      {children}
    </div>
  );
}

function Home() {
  return (
    <Launcher>
      <Slot size="wide">
        <Widget size="wide" app="Orders" label="Today" rows={ORDERS_TODAY} />
      </Slot>
      <div className={w.slots}>
        <Slot size="small">
          <Widget size="small" app="Calendar" label="Next" rows={NEXT} />
        </Slot>
        <Slot size="small">
          <Placeholder size="small">
            <LophnMark />
            Tap to choose
          </Placeholder>
        </Slot>
      </div>
      <div className={w.icons}>
        <Icon label="Orders">
          <OrdersIcon />
        </Icon>
        <Filler at={2} />
        <Icon label="lophn">
          <span className={w.tile}>
            <LophnMark />
          </span>
        </Icon>
      </div>
    </Launcher>
  );
}

function Widgets({ size }: { size: "small" | "wide" }) {
  const nodes =
    size === "wide"
      ? [ORDERS_TODAY, STOCK_LOW, DEPLOY]
      : [ORDERS_TODAY, NEXT, STOCK_LOW, DEPLOY];
  const names =
    size === "wide"
      ? ["Orders · Today", "Stock · Low items", "Deploy · Status"]
      : ["Orders · Today", "Calendar · Next", "Stock · Low", "Deploy · Last"];
  const cells = nodes.map((rows, at) => {
    const [app, label] = names[at]!.split(" · ") as [string, string];
    return (
      <Slot key={names[at]} size={size}>
        <Widget size={size} app={app} label={label} rows={rows} />
      </Slot>
    );
  });
  return (
    <Launcher>
      {size === "wide" ? cells : <div className={w.slots}>{cells}</div>}
    </Launcher>
  );
}

function States({ size }: { size: "small" | "wide" }) {
  const rows = size === "wide" ? STOCK_LOW : ORDERS_TODAY;
  const cells = [
    <Widget
      key="offline"
      size={size}
      app={size === "wide" ? "Stock" : "Orders"}
      label={size === "wide" ? "Low items" : "Today"}
      rows={rows}
      foot="Offline 14:05"
      dim
    />,
    <Placeholder key="choose" size={size}>
      <LophnMark />
      Tap to choose
    </Placeholder>,
    <Placeholder key="gone" size={size}>
      This widget is no longer available
    </Placeholder>,
    <Placeholder key="removed" size={size}>
      Computer removed
    </Placeholder>,
  ];
  return (
    <Launcher>
      {size === "wide" ? (
        cells.map((cell) => (
          <Slot key={cell.key} size="wide">
            {cell}
          </Slot>
        ))
      ) : (
        <div className={w.slots}>
          {cells.map((cell) => (
            <Slot key={cell.key} size="small">
              {cell}
            </Slot>
          ))}
        </div>
      )}
    </Launcher>
  );
}

// ── Choose a widget ──────────────────────────────────

function Pick({
  label,
  rows,
  wide,
}: {
  label: string;
  rows: Node[];
  wide?: boolean;
}) {
  return (
    <div className={`${w.pick} ${wide ? w.pickWide : ""}`}>
      <div className={w.pickLabel}>{label}</div>
      <div className={w.preview}>
        <Nodes rows={rows} />
      </div>
    </div>
  );
}

function AppHead({
  name,
  tone,
  letter,
}: {
  name: string;
  tone: 0 | 1 | 2 | 3 | 4 | 6;
  letter?: string;
}) {
  return (
    <div className={w.appHead}>
      <Mark kind="app" name={letter ?? name} tone={tone} size="md" />
      {name}
    </div>
  );
}

const OPEN_ORDERS: Node[] = [
  { kind: "stat", value: "12", label: "Open" },
  { kind: "stat", value: "31", label: "Shipped today" },
];

const LOW_PREVIEW: Node[] = [
  {
    kind: "list",
    items: [
      { text: "Green tea 200 g", trail: "3 left", tone: "bad" },
      { text: "Oat milk 1 L", trail: "8 left", tone: "warn" },
    ],
  },
];

const BUDGET: Node[] = [
  {
    kind: "progress",
    value: 0.64,
    label: "64% of November used",
    tone: "warn",
  },
];

function Choose() {
  return (
    <Phone>
      <TopBar left="close" title="Choose a widget" />
      <div className={s.body}>
        <Label end={<Dot tone="good" />}>mina-desktop</Label>
        <AppHead name="Orders" tone={1} />
        <Pick label="Today" rows={ORDERS_TODAY} />
        <Pick label="Open and shipped" rows={OPEN_ORDERS} />
        <AppHead name="Stock" tone={3} />
        <Pick label="Low items" rows={LOW_PREVIEW} />
        <Label end={<Dot tone="good" />}>office-mac</Label>
        <AppHead name="Budget" tone={4} />
        <Pick label="This month" rows={BUDGET} />
      </div>
    </Phone>
  );
}

function ChooseApp() {
  return (
    <Phone>
      <TopBar
        left="close"
        title="Choose a widget"
        under="Orders · mina-desktop"
      />
      <div className={s.body}>
        <AppHead name="Orders" tone={1} />
        <Pick label="Today" rows={ORDERS_TODAY} wide />
        <Pick label="Open and shipped" rows={OPEN_ORDERS} wide />
      </div>
    </Phone>
  );
}

function ChooseEmpty() {
  return (
    <Phone>
      <TopBar left="close" title="Choose a widget" />
      <div className={s.center}>
        <p className={s.lead} style={{ marginTop: 0 }}>
          None of your apps has a widget yet.
        </p>
      </div>
    </Phone>
  );
}

// ── the app and its menu ─────────────────────────────

function OrdersBack({ over }: { over?: ReactNode }) {
  return (
    <Phone tone="floor" over={over}>
      <TopBar
        lead={<Mark kind="app" name="Orders" tone={1} />}
        title="Orders"
        right={<IconBtn icon={Ellipsis} />}
      />
      <div className={s.appBody}>
        <div className={s.between}>
          <h1 className={s.h1}>Orders</h1>
          <Btn variant="primary" icon={PlusIcon}>
            New order
          </Btn>
        </div>
        <div className={s.grid2}>
          <div>
            <div className={s.statLabel}>Open</div>
            <div className={s.statValue}>12</div>
          </div>
          <div>
            <div className={s.statLabel}>Shipped today</div>
            <div className={s.statValue}>31</div>
          </div>
        </div>
      </div>
    </Phone>
  );
}

function AppMenu() {
  return (
    <Sheet>
      <div className={s.sheetLead}>
        <Mark kind="app" name="Orders" tone={1} size="md" />
        <div>
          <div className={s.sheetTitle}>Orders</div>
          <div className={s.note}>Runs on mina-desktop</div>
        </div>
      </div>
      <Row
        lead={<Ic icon={MessageSquarePlus} />}
        title="Ask lophn to change this app"
        sub="Say what should be different"
      />
      <Row
        lead={<Ic icon={PencilLine} />}
        title="Annotate this screen"
        sub="Mark the spot and send it to the agent"
      />
      <div className={s.hair} style={{ margin: "6px 20px" }} />
      <Row
        lead={<Face who="lophn" />}
        title="Sessions about this app"
        end={<Badge n={1} />}
      />
      <Row
        lead={<Ic icon={ScrollText} />}
        title="Activity"
        sub="Runs and logs · 1 failed yesterday"
      />
      <Row
        lead={<Ic icon={History} />}
        title="Release 7"
        sub="Went live 2 days ago"
      />
      <div className={s.hair} style={{ margin: "6px 20px" }} />
      <Row
        lead={<Ic icon={LayoutGrid} />}
        title="Add widget"
        sub="Today, Open and shipped"
      />
      <Row lead={<Ic icon={SquarePlus} />} title="Add to Home screen" />
    </Sheet>
  );
}

// ── what Android asks ────────────────────────────────

function PinIcon({ children }: { children: ReactNode }) {
  return <div className={w.osRow}>{children}</div>;
}

function PinConfirm() {
  return (
    <Launcher
      over={
        <>
          <div className={s.scrim} />
          <div className={`${w.osDialog} ${w.os}`} style={{ bottom: 140 }}>
            <PinIcon>
              <OrdersIcon />
              <div>
                <div className={w.osTitle}>Add to Home screen?</div>
                <div className={s.note}>Orders</div>
              </div>
            </PinIcon>
            <div className={w.osActions}>
              <span className={w.osAction}>Cancel</span>
              <span className={w.osAction} data-on="">
                Add
              </span>
            </div>
          </div>
        </>
      }
    >
      <Slot size="wide">
        <Widget size="wide" app="Orders" label="Today" rows={ORDERS_TODAY} />
      </Slot>
    </Launcher>
  );
}

function IconPlaced() {
  return (
    <Launcher>
      <div className={w.icons}>
        <Icon label="Orders">
          <OrdersIcon />
        </Icon>
        <Icon label="Stock">
          <Mark kind="app" name="Stock" tone={3} size="lg" />
        </Icon>
        <Icon label="Calendar">
          <Mark
            kind="app"
            name="Calendar"
            tone={0}
            size="lg"
            icon={CalendarDays}
          />
        </Icon>
        <Icon label="lophn">
          <span className={w.tile}>
            <LophnMark />
          </span>
        </Icon>
        <Filler at={2} />
      </div>
    </Launcher>
  );
}

function IconRemoved() {
  return (
    <Launcher
      over={
        <div className={w.osToast}>This app was removed from mina-desktop</div>
      }
    >
      <div className={w.icons}>
        <Icon label="Orders" dim>
          <OrdersIcon />
        </Icon>
        <Icon label="Calendar">
          <Mark
            kind="app"
            name="Calendar"
            tone={0}
            size="lg"
            icon={CalendarDays}
          />
        </Icon>
        <Icon label="lophn">
          <span className={w.tile}>
            <LophnMark />
          </span>
        </Icon>
        <Filler at={2} />
      </div>
    </Launcher>
  );
}

function Plus({
  kind,
  children,
  plain,
}: {
  kind: string;
  children: ReactNode;
  plain?: boolean;
}) {
  return (
    <div className={s.plus}>
      <span className={s.plusKind}>{kind}</span>
      <span
        className={plain ? undefined : s.mono}
        style={{ overflowWrap: "anywhere" }}
      >
        {children}
      </span>
    </div>
  );
}

function Consent() {
  return (
    <Phone>
      <TopBar left="back" title="New version of Orders" />
      <div className={s.body}>
        <div className={s.sheetLead} style={{ paddingTop: 4 }}>
          <Mark kind="app" name="Orders" tone={1} size="md" />
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, lineHeight: "22px" }}>
              Orders · Release 9
            </div>
            <div className={s.note}>Built by lophn · asked 3 minutes ago</div>
          </div>
        </div>
        <p
          className={s.p}
          style={{ margin: "0 20px 12px", fontSize: 15, lineHeight: "22px" }}
        >
          Shows the pickup points nearest to you and adds a widget with today's
          orders.
        </p>
        <div
          className={s.card}
          style={{ margin: "0 16px", padding: "12px 14px" }}
        >
          <div className={s.fieldLabel} style={{ marginBottom: 4 }}>
            New since the last version
          </div>
          <Plus kind="+ Network host">api.pickup.example:443</Plus>
          <Plus kind="+ Phone" plain>
            Use your phone's location
          </Plus>
        </div>
        <p className={s.note} style={{ margin: "10px 20px 0" }}>
          Only what this version adds and what it would delete is shown. You can
          go back to Release 8 afterwards from the app menu.
        </p>
      </div>
      <div className={s.foot} style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Btn icon={X} size="lg">
          Deny
        </Btn>
        <Btn icon={Check} size="lg" variant="primary">
          Allow
        </Btn>
      </div>
    </Phone>
  );
}

function OsLocation() {
  return (
    <OrdersBack
      over={
        <>
          <div className={s.scrim} />
          <div className={`${w.osDialog} ${w.os}`} style={{ top: 230 }}>
            <Ic icon={MapPin} size={28} />
            <div className={w.osTitle}>
              Allow lophn to access this device's location?
            </div>
            <div className={w.osOption}>While using the app</div>
            <div className={w.osOption}>Only this time</div>
            <div className={w.osOption}>Don't allow</div>
          </div>
        </>
      }
    />
  );
}

export function WidgetsFlow() {
  return (
    <Flow
      title="11 · Widgets and the home screen"
      note="내 앱이 폰의 Home 화면에 위젯과 아이콘으로 놓인다. 위젯은 앱이 선언한 data를 폰이 그리는 것이라 앱이 위젯 안에 마음대로 그리지 못하고, 머리(앱 이름과 위젯 label)와 꼬리(가져온 시각)는 폰이 붙인다. 위젯 칸은 launcher 기준 1칸 약 73dp이고 위젯은 73n−16dp라서 작은 것(2x2)이 130x130dp, 넓은 것(4x2)이 276x130dp다. 점선 회색 상자와 launcher 화면은 Android가 그리는 것이고 lophn은 그 안의 내용만 정한다."
    >
      <Shot
        title="Home screen"
        text="launcher 위에 넓은 위젯 하나, 작은 위젯 하나, 놓았지만 아직 앱을 고르지 않은 위젯 하나. 앱 아이콘은 같은 줄에 놓인다."
      >
        <Home />
      </Shot>
      <Shot
        title="Wide widgets (4x2)"
        text="276x130dp. 머리 줄(앱 이름 · label, 오른쪽 끝에 새로 하기 아이콘), 본문, 꼬리 줄. 본문은 stat과 progress, list, text(title·body·caption)다. list는 다섯 줄까지 받지만 이 높이에는 네 줄이 들어가서 다섯째는 잘린다."
      >
        <Widgets size="wide" />
      </Shot>
      <Shot
        title="Small widgets (2x2)"
        text="130x130dp. 같은 모양이고 아래 줄이 줄임표 없이 잘린다. tone(neutral·good·warn·bad)은 글 색으로만 보이고 progress 막대는 같은 색이다."
      >
        <Widgets size="small" />
      </Shot>
      <Shot
        title="States · small"
        text="왼쪽 위부터 마지막 시도가 실패한 위젯(본문이 흐리고 꼬리가 Offline 14:05), 놓았지만 아직 안 고른 위젯, 앱이 보관되거나 선언에서 빠진 위젯, 컴퓨터를 지운 위젯. 회전 표시는 없다."
      >
        <States size="small" />
      </Shot>
      <Shot
        title="States · wide"
        text="넓은 위젯의 같은 네 상태. 없어지거나 지운 위젯은 눌러도 lophn만 열린다."
      >
        <States size="wide" />
      </Shot>
      <Shot
        title="Choose a widget"
        text="폰 앱 안의 화면. 컴퓨터마다 묶고 그 아래 앱마다 앱 이름, 그 앱이 선언한 위젯의 label과 지금 값의 작은 미리보기. 위젯을 놓을 때나 'Tap to choose'를 누를 때 열린다."
      >
        <Choose />
      </Shot>
      <Shot
        title="Choose a widget · one app"
        text="앱 menu의 Add widget에서 들어오면 그 앱의 위젯만 보인다. 하나를 고르면 launcher가 놓을지 묻는다."
      >
        <ChooseApp />
      </Shot>
      <Shot
        title="Choose a widget · none"
        text="위젯을 선언한 앱이 없을 때. 위젯은 앱이 선언해야 하므로 사람이 만들 수 있는 것이 없다."
      >
        <ChooseEmpty />
      </Shot>
      <Shot
        title="App menu"
        text="Add to Home screen 위에 Add widget 줄이 있다. 그 앱이 위젯을 선언하지 않았으면 Add widget 줄은 없고 Add to Home screen만 보인다."
      >
        <OrdersBack over={<AppMenu />} />
      </Shot>
      <Shot
        title="Add to Home screen"
        text="Add to Home screen을 누르면 launcher가 앱 아이콘과 이름과 Add 단추로 묻는다. 이 상자는 lophn이 아니라 Android가 그린다. 위젯도 놓을 때 launcher가 비슷하게 묻는다."
      >
        <PinConfirm />
      </Shot>
      <Shot
        title="App icon on the Home screen"
        text="Add를 누르면 앱 아이콘과 이름이 Home 화면에 놓인다. 누르면 폰 앱 안에서 그 앱이 열린다."
      >
        <IconPlaced />
      </Shot>
      <Shot
        title="Icon of a removed app"
        text="컴퓨터에서 지워진 앱의 아이콘은 흐려지고, 누르면 launcher가 'This app was removed from mina-desktop'을 보인다. 폰이 컴퓨터에 닿아야 알 수 있어서 연결된 뒤에 흐려진다."
      >
        <IconRemoved />
      </Shot>
      <Shot
        title="Consent · location"
        text="앱이 폰의 위치를 쓰겠다고 하면 Inbox의 앱 새 판 동의 카드에 'Phone · Use your phone's location' 줄이 더해진다. 허락하면 앱 backend가 위치를 한 번씩 물을 수 있다."
      >
        <Consent />
      </Shot>
      <Shot
        title="Android location permission"
        text="앱이 처음 위치를 물으면 Android가 OS 권한 창을 띄운다. 이 상자는 Android의 것이라 표시만 한다. lophn 동의와 OS 권한은 두 번 따로 묻는다."
      >
        <OsLocation />
      </Shot>
    </Flow>
  );
}
