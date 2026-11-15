// Flow 3. A person's own apps: the phone hosts them the way the desktop shell does.
import {
  CalendarDays,
  Ellipsis,
  History,
  Info,
  MessageSquarePlus,
  PencilLine,
  Plus,
  RefreshCw,
  ScrollText,
  SquarePlus,
} from "lucide-react";
import type { ReactNode } from "react";
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
  Mark,
  Phone,
  Row,
  Sheet,
  Shot,
  s,
  TopBar,
} from "./kit.tsx";
import { HomeScreen } from "./shell.tsx";

const ORDERS = [
  { id: "#1043", who: "Hana Park", state: "Open", total: "$18.50" },
  { id: "#1042", who: "Dae Kim", state: "Open", total: "$41.99" },
  { id: "#1041", who: "Jun Seo", state: "Shipped", total: "$73.00" },
  { id: "#1040", who: "Ari Choi", state: "Shipped", total: "$9.20" },
];

function Orders({
  over,
  updated,
}: {
  over?: ReactNode;
  /** Release 8: the filter the person asked for is there. */
  updated?: boolean;
}) {
  return (
    <Phone tone="floor" over={over}>
      <TopBar
        lead={<Mark kind="app" name="Orders" tone={1} />}
        title="Orders"
        right={<IconBtn icon={Ellipsis} />}
      />
      {updated && (
        <div className={s.toast}>
          <Dot tone="good" />
          <span className={s.grow}>
            Updated to <b>Release 8</b>
          </span>
          <Btn size="sm" variant="ghost">
            What changed
          </Btn>
        </div>
      )}
      <div className={s.appBody}>
        <div className={s.between}>
          <h1 className={s.h1}>Orders</h1>
          <Btn variant="primary" icon={Plus}>
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
          <div style={{ gridColumn: "1 / -1" }}>
            <div className={s.statLabel}>Revenue today</div>
            <div className={s.statValue}>
              4,210<span className={s.statUnit}>USD</span>
            </div>
          </div>
        </div>
        {updated && (
          <div className={s.filters}>
            <span className={s.filter}>All</span>
            <span className={s.filter} data-on="">
              Last 7 days
            </span>
            <span className={s.filter}>Open</span>
          </div>
        )}
        <div className={s.listCard}>
          {ORDERS.map((order, at) => (
            <div key={order.id}>
              {at > 0 && <div className={s.hair} />}
              <Row
                title={`${order.id} · ${order.who}`}
                sub={`${order.state} · ${order.total}`}
                end={
                  order.state === "Open" ? (
                    <Btn size="sm">Mark shipped</Btn>
                  ) : undefined
                }
              />
            </div>
          ))}
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
      <Row lead={<Ic icon={SquarePlus} />} title="Add to Home screen" />
    </Sheet>
  );
}

function AskChange() {
  return (
    <>
      <div className={s.scrim} />
      <div className={s.sheet} style={{ paddingBottom: 0 }}>
        <div className={s.grabber} />
        <div className={s.sheetHead}>
          <span className={s.sheetTitle}>Change Orders</span>
        </div>
        <p className={s.note} style={{ margin: "0 20px 8px" }}>
          lophn works on it in the Orders workspace and asks you before a new
          version goes live.
        </p>
        <Composer
          placeholder="What should be different?"
          value="Add a filter for orders from the last 7 days"
          action="send"
          chips={<Chip lead={<Face who="lophn" size={18} />}>lophn</Chip>}
        />
        <Keyboard />
        <div style={{ height: 26, background: "var(--color-surface-muted)" }} />
      </div>
    </>
  );
}

const DAYS = ["S", "M", "T", "W", "T", "F", "S"];

function Calendar() {
  return (
    <Phone tone="floor">
      <TopBar
        lead={<Mark kind="app" name="Calendar" tone={0} icon={CalendarDays} />}
        title="Calendar"
        under="On this phone · synced just now"
        right={<IconBtn icon={Ellipsis} />}
      />
      <div className={s.appBody}>
        <div className={s.between}>
          <h1 className={s.h1}>November</h1>
          <Btn size="sm">Today</Btn>
        </div>
        <div className={s.week}>
          {DAYS.map((day, at) => (
            <div key={`${day}${at}`}>
              <div className={s.weekDay}>{day}</div>
              <div className={s.weekNo} data-on={at === 0 || undefined}>
                {15 + at}
              </div>
            </div>
          ))}
        </div>
        <div className={s.listCard}>
          <div className={s.event}>
            <span className={s.eventTime}>09:30</span>
            <span className={s.eventBar} />
            <div>
              <div className={s.rowTitle}>Stand-up</div>
              <div className={s.rowSub}>30 min · Team</div>
            </div>
          </div>
          <div className={s.hair} />
          <div className={s.event}>
            <span className={s.eventTime}>13:00</span>
            <span className={s.eventBar} data-tone="1" />
            <div>
              <div className={s.rowTitle}>Lunch with Dae</div>
              <div className={s.rowSub}>1 hr · Mangwon</div>
            </div>
          </div>
          <div className={s.hair} />
          <div className={s.event}>
            <span className={s.eventTime}>16:00</span>
            <span className={s.eventBar} data-tone="2" />
            <div>
              <div className={s.rowTitle}>Dentist</div>
              <div className={s.rowSub}>45 min</div>
            </div>
          </div>
        </div>
        <div className={s.statLabel} style={{ marginBottom: -8 }}>
          Tomorrow
        </div>
        <div className={s.listCard}>
          <div className={s.event}>
            <span className={s.eventTime}>10:00</span>
            <span className={s.eventBar} />
            <div>
              <div className={s.rowTitle}>Weekly review</div>
              <div className={s.rowSub}>1 hr · added by lophn</div>
            </div>
          </div>
        </div>
      </div>
      <span className={s.fab}>
        <Ic icon={Plus} size={26} />
      </span>
    </Phone>
  );
}

function NeedsComputer() {
  return (
    <Phone tone="floor">
      <TopBar
        lead={<Mark kind="app" name="Orders" tone={1} />}
        title="Orders"
        right={<IconBtn icon={Ellipsis} />}
      />
      <div className={s.center}>
        <span style={{ opacity: 0.45 }}>
          <Mark kind="app" name="Orders" tone={1} size="lg" />
        </span>
        <h1 className={s.hero} style={{ fontSize: 22, lineHeight: "30px" }}>
          Orders runs on mina-desktop
        </h1>
        <p className={s.lead}>
          That computer is offline, so Orders cannot open right now. It comes
          back by itself when the computer does.
        </p>
        <div style={{ marginTop: 20 }}>
          <Btn icon={RefreshCw}>Try again</Btn>
        </div>
      </div>
    </Phone>
  );
}

function NewApp() {
  return (
    <HomeScreen
      over={
        <>
          <div className={s.scrim} />
          <div className={s.sheet} style={{ paddingBottom: 0 }}>
            <div className={s.grabber} />
            <div className={s.sheetHead}>
              <span className={s.sheetTitle}>New app</span>
            </div>
            <div
              className={s.pad}
              style={{ display: "grid", gap: 14, paddingBottom: 14 }}
            >
              <p className={s.note} style={{ margin: 0 }}>
                An app starts with a name and one line about what it is for.
                lophn builds it from there.
              </p>
              <div className={s.inlineField}>
                <span className={s.fieldLabel}>Name</span>
                <div className={s.field}>Reading list</div>
              </div>
              <div className={s.inlineField}>
                <span className={s.fieldLabel}>Purpose</span>
                <div className={s.field} data-focus="">
                  <span>
                    Books I want to read and what I thought of them
                    <span className={s.caret} />
                  </span>
                </div>
              </div>
              <div className={s.btnRow} data-end="">
                <Btn>Cancel</Btn>
                <Btn variant="primary" icon={Plus}>
                  Create
                </Btn>
              </div>
            </div>
            <Keyboard />
            <div
              style={{ height: 26, background: "var(--color-surface-muted)" }}
            />
          </div>
        </>
      }
    />
  );
}

function Activity() {
  return (
    <Phone>
      <TopBar left="back" title="Activity" under="Orders" />
      <div className={s.body}>
        <div className={s.label}>Today</div>
        <Row
          lead={<Ic icon={ScrollText} />}
          title="Export orders nightly"
          sub="orders.export_csv · 1 hour ago"
          end={<span className={s.good}>Done</span>}
        />
        <Row
          lead={<Ic icon={ScrollText} />}
          title="Mark shipped"
          sub="orders.mark_shipped · you, 3 hours ago"
          end={<span className={s.good}>Done</span>}
        />
        <div className={s.label}>Yesterday</div>
        <Row
          lead={<Ic icon={ScrollText} />}
          title="Sync inventory"
          sub="orders.sync_inventory · job"
          end={<span className={s.bad}>Failed</span>}
        />
        <div className={s.banner} style={{ margin: "4px 20px 0" }}>
          <Ic icon={Info} size={18} style={{ marginTop: 1 }} />
          <div className={s.grow}>
            <div>
              The stock service did not answer in 30 seconds. lophn noticed and
              opened a session about it.
            </div>
            <div style={{ marginTop: 8 }}>
              <Btn size="sm">Open the session</Btn>
            </div>
          </div>
        </div>
        <Row
          lead={<Ic icon={ScrollText} />}
          title="Export orders nightly"
          sub="orders.export_csv · job"
          end={<span className={s.good}>Done</span>}
        />
      </div>
    </Phone>
  );
}

export function AppsFlow() {
  return (
    <Flow
      title="3 · Apps"
      note="lophn이 있는 이유. 사람이 lophn agent에게 만들게 한 자기 앱이 폰에서 열린다. 앱 화면은 그 앱의 것이고 lophn은 위에 한 줄(sidebar 단추, 앱 이름, ⋯)만 둔다. 쓰다가 고치고 싶으면 그 자리에서 agent에게 말하고, 새 판은 내가 허락해야 바뀐다. 앱 화면 안의 조각(단추, 목록, 숫자)은 폰 UI kit의 것이다."
    >
      <Shot
        title="An app · Orders"
        text="컴퓨터에서 도는 앱의 폰 화면. sidebar나 Home의 앱 아이콘에서 연다. desktop의 표는 폰에서 목록이 된다."
      >
        <Orders />
      </Shot>
      <Shot
        title="App menu"
        text="⋯. 이 앱을 고쳐 달라고 하기, 화면에 표시해서 보내기, 이 앱을 다루는 session, 실행 기록, 지금 판, 홈 화면에 아이콘 두기."
      >
        <Orders over={<AppMenu />} />
      </Shot>
      <Shot
        title="Ask for a change"
        text="앱을 쓰다가 그 자리에서 말한다. 보내면 Orders workspace에 session이 생기고 lophn이 일한다. 진행은 sidebar의 그 session에서 본다."
      >
        <Orders over={<AskChange />} />
      </Shot>
      <Shot
        title="New version is live"
        text="Inbox에서 새 판을 허락하면 열려 있던 앱이 바뀌고 위에 한 줄로 알린다. 부탁한 Last 7 days 거르기가 생겼다."
      >
        <Orders updated />
      </Shot>
      <Shot
        title="An app on the phone · Calendar"
        text="폰에서 혼자 도는 앱. 컴퓨터가 꺼져 있어도 열리고 쓴다. 이름 아래 한 줄이 어디서 도는지와 맞춘 때를 말한다."
      >
        <Calendar />
      </Shot>
      <Shot
        title="App needs its computer"
        text="컴퓨터에서만 도는 앱을 컴퓨터가 꺼졌을 때 열면. 왜 안 열리는지와 언제 되는지를 말한다."
      >
        <NeedsComputer />
      </Shot>
      <Shot
        title="Activity"
        text="앱 menu의 Activity. 그 앱이 한 일과 실패. 실패는 lophn이 먼저 알고 session을 열어 둔다."
      >
        <Activity />
      </Shot>
      <Shot
        title="New app"
        text="Home의 New app이나 sidebar의 +. 이름과 한 줄 목적만 적으면 lophn이 그 앱의 workspace에서 짓기 시작한다."
      >
        <NewApp />
      </Shot>
    </Flow>
  );
}
