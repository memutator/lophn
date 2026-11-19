// Flow 5. Inbox: everything that waits on the person, across every workspace.
import {
  Bell,
  Check,
  ChevronRight,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { AgentCharacter } from "../../../../packages/shell/renderer/parts/avatar/character.tsx";
import {
  Btn,
  Face,
  Flow,
  Ic,
  Mark,
  Phone,
  Row,
  Shot,
  s,
  Tabs,
  TopBar,
} from "./kit.tsx";

function Band({ children, n }: { children: ReactNode; n: number }) {
  return (
    <div className={s.band}>
      <span>{children}</span>
      <span>{n}</span>
    </div>
  );
}

function Item({
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
    <div className={s.item}>
      <Face who={who} size={24} />
      <div className={s.grow}>
        <div className={s.between} style={{ alignItems: "flex-start" }}>
          <span className={s.itemTitle}>{title}</span>
          <span className={s.note} style={{ flex: "none", marginTop: 2 }}>
            {time}
          </span>
        </div>
        <div className={s.itemText}>{text}</div>
        <div className={s.note} style={{ marginTop: 2 }}>
          {meta}
        </div>
        {children}
      </div>
    </div>
  );
}

function Now() {
  return (
    <Phone>
      <TopBar title="Inbox" />
      <Tabs items={["Now", "History"]} on={0} />
      <div className={s.body}>
        <Band n={1}>Permission requests</Band>
        <Item
          who="Budget reviewer"
          title="Run a command"
          time="1m"
          text="Runs the command shown below."
          meta="Budget reviewer · Weekly report · phroner"
        >
          <div className={s.pre} style={{ marginTop: 8 }}>
            git push --force origin main
          </div>
          <div className={s.btnRow} data-end="" style={{ marginTop: 10 }}>
            <Btn size="sm" icon={X}>
              Deny
            </Btn>
            <Btn size="sm" icon={Check}>
              Always allow
            </Btn>
            <Btn size="sm" variant="primary" icon={Check}>
              Allow once
            </Btn>
          </div>
        </Item>
        <Band n={1}>Questions</Band>
        <Item
          who="lophn"
          title="Question"
          time="now"
          text="Include the three flaky scenarios in this week’s regression count?"
          meta="lophn · Harness change summary · phroner"
        >
          <div className={s.btnRow} data-end="" style={{ marginTop: 10 }}>
            <Btn size="sm">Leave them out</Btn>
            <Btn size="sm" variant="primary">
              Include them
            </Btn>
          </div>
        </Item>
        <Band n={1}>App updates</Band>
        <Item
          who="lophn"
          title="Activate a new version of Orders"
          time="3m"
          text="4 new declarations and 3 data-loss steps since the last version."
          meta="Orders"
        >
          <div className={s.btnRow} data-end="" style={{ marginTop: 10 }}>
            <Btn size="sm">
              Review
              <Ic icon={ChevronRight} size={15} />
            </Btn>
          </div>
        </Item>
        <Band n={1}>Jobs</Band>
        <Item
          who="lophn"
          title="Morning digest"
          time="9h"
          text="Missed once. The last turn was due 9 hours ago."
          meta="Asks lophn"
        />
      </div>
    </Phone>
  );
}

function Plus({ kind, children }: { kind: string; children: ReactNode }) {
  return (
    <div className={s.plus}>
      <span className={s.plusKind}>{kind}</span>
      <span className={s.mono} style={{ overflowWrap: "anywhere" }}>
        {children}
      </span>
    </div>
  );
}

function Update() {
  return (
    <Phone>
      <TopBar left="back" title="New version of Orders" />
      <div className={s.body}>
        <div className={s.sheetLead} style={{ paddingTop: 4 }}>
          <Mark kind="app" name="Orders" tone={1} size="md" />
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, lineHeight: "22px" }}>
              Orders · Release 8
            </div>
            <div className={s.note}>Built by lophn · asked 3 minutes ago</div>
          </div>
        </div>
        <p
          className={s.p}
          style={{ margin: "0 20px 12px", fontSize: 15, lineHeight: "22px" }}
        >
          Adds a filter for the last 7 days and sends exports to the payments
          service.
        </p>
        <div
          className={s.card}
          style={{ margin: "0 16px", padding: "12px 14px" }}
        >
          <div className={s.fieldLabel} style={{ marginBottom: 4 }}>
            New since the last version
          </div>
          <Plus kind="+ Network host">api.payments.example:443</Plus>
          <Plus kind="+ Secret">PAYMENTS_KEY</Plus>
          <Plus kind="+ File (write)">/exports/**</Plus>
          <Plus kind="+ Other app">Stock › stock.adjust</Plus>
          <div
            className={s.fieldLabel}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              margin: "10px 0 4px",
            }}
          >
            <Ic icon={TriangleAlert} size={16} className={s.warnIcon} />
            Data loss
          </div>
          <Plus kind="Drops table">legacy_orders</Plus>
          <Plus kind="Drops column">orders.note</Plus>
          <Plus kind="Narrows type">orders.total</Plus>
        </div>
        <p className={s.note} style={{ margin: "10px 20px 0" }}>
          Only what this version adds and what it would delete is shown. You can
          go back to Release 7 afterwards from the app menu.
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

function History() {
  return (
    <Phone>
      <TopBar title="Inbox" />
      <Tabs items={["Now", "History"]} on={1} />
      <div className={s.body}>
        <div
          className={s.pad}
          style={{ display: "grid", gap: 10, padding: "12px 20px 4px" }}
        >
          <div className={s.field} data-soft="" style={{ minHeight: 40 }}>
            <Ic icon={Search} size={18} className={s.muted} />
            <span className={s.muted}>Search</span>
          </div>
          <div className={s.filters}>
            <span className={s.filter} data-on="">
              All
            </span>
            <span className={s.filter}>From apps</span>
            <span className={s.filter}>From lophn</span>
          </div>
        </div>
        <div className={s.label}>Today</div>
        <Row
          lead={<Ic icon={Bell} className={s.muted} />}
          title="3 overdue invoices"
          sub="Orders · Needs follow-up before Friday"
          end="2h"
        />
        <Row
          lead={<Ic icon={Check} className={s.good} />}
          title="Orders Release 7 activated"
          sub="Orders · Release activated"
          end="3h"
        />
        <Row
          lead={<Ic icon={TriangleAlert} className={s.warnIcon} />}
          title="Stock sync failed"
          sub="Stock · App unavailable"
          end="5h"
        />
        <div className={s.label}>Yesterday</div>
        <Row
          lead={<Ic icon={Bell} className={s.muted} />}
          title="Daily export finished"
          sub="Orders · 128 rows exported"
          end="1d"
        />
        <Row
          lead={<Ic icon={TriangleAlert} className={s.warnIcon} />}
          title="Orders Release 6 rolled back"
          sub="Orders · Rolled back"
          end="1d"
        />
      </div>
    </Phone>
  );
}

function Empty() {
  return (
    <Phone>
      <TopBar title="Inbox" />
      <Tabs items={["Now", "History"]} on={0} />
      <div className={s.center}>
        <span className={s.box} style={{ width: 64, height: 64, opacity: 0.9 }}>
          <AgentCharacter
            profile={{ kind: "character", shape: "square", color: "coral" }}
          />
        </span>
        <h1
          className={s.hero}
          style={{ marginTop: 14, fontSize: 20, lineHeight: "28px" }}
        >
          Nothing needs you right now
        </h1>
        <p className={s.lead} style={{ fontSize: 15, lineHeight: "22px" }}>
          Approvals, questions, app updates and missed jobs from every workspace
          show up here.
        </p>
      </div>
    </Phone>
  );
}

function Notice({
  title,
  text,
  time,
}: {
  title: string;
  text: string;
  time: string;
}) {
  return (
    <div className={s.notice}>
      <span className={s.noticeIcon}>
        <span className={s.box} style={{ width: 26, height: 26 }}>
          <AgentCharacter
            profile={{ kind: "character", shape: "square", color: "coral" }}
          />
        </span>
      </span>
      <div className={s.grow}>
        <div className={s.between}>
          <span style={{ fontSize: 15, fontWeight: 600, lineHeight: "20px" }}>
            {title}
          </span>
          <span className={s.noticeText} style={{ flex: "none", fontSize: 12 }}>
            {time}
          </span>
        </div>
        <div className={s.noticeText}>{text}</div>
      </div>
    </div>
  );
}

function Lock() {
  return (
    <Phone tone="camera">
      <div className={s.lockTime}>9:41</div>
      <div className={s.lockDate}>Sunday, November 15</div>
      <div className={s.grow} />
      <Notice
        title="Weekly report is waiting for you"
        text="lophn asks for approval on mina-desktop."
        time="now"
      />
      <Notice
        title="Add a CSV export has a question"
        text="Orders · mina-desktop"
        time="4m"
      />
      <Notice
        title="Split the eval board loader finished"
        text="Codex worked for 14 minutes."
        time="12m"
      />
      <div style={{ height: 18 }} />
    </Phone>
  );
}

export function InboxFlow() {
  return (
    <Flow
      title="5 · Inbox"
      note="모든 workspace에서 나를 기다리는 것이 한곳에 모인다. desktop Inbox와 같은 묶음(승인, 질문, 앱 update, job)이고 대화에 들어가지 않고 그 자리에서 답한다. sidebar의 Inbox, Home의 Needs you, 알림이 모두 여기로 온다."
    >
      <Shot
        title="Now"
        text="종류마다 묶고 개수를 보인다. 제목을 누르면 그 session으로 간다. 단추는 desktop처럼 오른쪽 끝에 붙고 주 단추가 맨 오른쪽이다."
      >
        <Now />
      </Shot>
      <Shot
        title="A new version of an app"
        text="앱 update의 Review. 이 판이 새로 얻는 것과 지우는 data만 보인다. 허락해야 앱이 바뀐다."
      >
        <Update />
      </Shot>
      <Shot
        title="History"
        text="앱과 lophn이 남긴 알림 기록. 글과 출처(앱·lophn)로 찾는다."
      >
        <History />
      </Shot>
      <Shot title="Nothing waiting" text="비었을 때.">
        <Empty />
      </Shot>
      <Shot
        title="Notifications"
        text="잠금 화면. session 이름과 상태만 있고 대화 내용이나 명령은 없다. 누르면 그 항목이 열린다. 컴퓨터 앞에 앉아 있는 동안에는 오지 않는다."
      >
        <Lock />
      </Shot>
    </Flow>
  );
}
