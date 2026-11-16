// Flows 7 to 9. Jobs and agents, settings, and the same app on a wide screen.
import {
  Bell,
  ChevronRight,
  CircleCheck,
  Clock,
  Copy,
  Ellipsis,
  Info,
  Laptop,
  type LucideIcon,
  MessageSquarePlus,
  Monitor,
  Palette,
  Play,
  Plus,
  Server,
  Smartphone,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import {
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
  Phone,
  Row,
  Seg,
  Sheet,
  Shot,
  s,
  TopBar,
} from "./kit.tsx";
import { SidebarBody } from "./shell.tsx";

function Switch({ on }: { on?: boolean }) {
  return <span className={s.switch} data-on={on || undefined} />;
}

// ── Jobs ─────────────────────────────────────────────

function Job({
  name,
  when,
  does,
  last,
  on = true,
}: {
  name: string;
  when: string;
  does: string;
  last: string;
  on?: boolean;
}) {
  return (
    <div className={s.item} style={{ gap: 12 }}>
      <div className={s.grow}>
        <div className={s.itemTitle}>{name}</div>
        <div
          className={s.itemText}
          style={{ fontSize: 14, lineHeight: "20px" }}
        >
          {when}
        </div>
        <div style={{ marginTop: 4, fontSize: 14, lineHeight: "20px" }}>
          {does}
        </div>
        <div
          className={s.note}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 4,
          }}
        >
          {on && <Ic icon={CircleCheck} size={15} className={s.good} />}
          {last}
        </div>
      </div>
      <Switch on={on} />
    </div>
  );
}

function Jobs() {
  return (
    <Phone>
      <TopBar title="Jobs" />
      <div className={s.body}>
        <p className={s.note} style={{ margin: "2px 20px 6px" }}>
          Work your agents set up to start on a schedule or when something
          happens. Jobs start only while lophn is on.
        </p>
        <Job
          name="Morning digest"
          when="Every day at 09:00 · next in 3 hours"
          does="Asks lophn"
          last="Done 21 hours ago"
        />
        <div className={s.hair} />
        <Job
          name="Wrap up at the usage limit"
          when="When Orders publishes usage.limit"
          does="Asks Bookkeeper"
          last="Done 2 hours ago · fired 3 times"
        />
        <div className={s.hair} />
        <Job
          name="Weekly review"
          when="Every 7 days at 10:00 · next in 4 days"
          does="Starts the weekly-review workflow"
          last="Done 3 days ago"
        />
        <div className={s.hair} />
        <Job
          name="Export orders nightly"
          when="Every day at 02:00"
          does="Calls orders.export_csv"
          last="Off since Nov 9"
          on={false}
        />
      </div>
    </Phone>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      className={s.row}
      style={{ minHeight: 44, alignItems: "flex-start", paddingTop: 10 }}
    >
      <span
        className={s.muted}
        style={{ flex: "none", width: 92, fontSize: 14 }}
      >
        {label}
      </span>
      <span className={s.grow} style={{ fontSize: 15, lineHeight: "22px" }}>
        {children}
      </span>
    </div>
  );
}

function JobDetail() {
  return (
    <Phone>
      <TopBar left="back" title="Morning digest" right={<Switch on />} />
      <div className={s.body}>
        <Fact label="When">Every day at 09:00</Fact>
        <Fact label="Next">In 3 hours</Fact>
        <Fact label="Does">
          Asks lophn: “Summarize yesterday’s finished tasks and list the open
          questions for today.”
        </Fact>
        <Fact label="If missed">Asks you first</Fact>
        <Fact label="Made by">lophn</Fact>
        <Label>Runs</Label>
        <Row
          lead={<Ic icon={CircleCheck} className={s.good} />}
          title="Done"
          sub="Opened “Morning digest · Nov 14”"
          end="21h"
        />
        <Row
          lead={<Ic icon={CircleCheck} className={s.good} />}
          title="Done"
          sub="Opened “Morning digest · Nov 13”"
          end="2d"
        />
        <Row
          lead={<Ic icon={Clock} className={s.warn} />}
          title="Missed"
          sub="lophn was off · you chose Skip"
          end="3d"
        />
      </div>
      <div className={s.foot}>
        <Btn variant="primary" size="lg" icon={Play}>
          Start now
        </Btn>
        <p className={s.note} style={{ margin: 0, textAlign: "center" }}>
          Jobs are edited and deleted on the computer.
        </p>
      </div>
    </Phone>
  );
}

// ── Agents ───────────────────────────────────────────

function Agents() {
  return (
    <Phone>
      <TopBar title="Agents" />
      <div className={s.body}>
        <Label>Agents</Label>
        <Row
          lead={<Face who="lophn" size={36} />}
          title={
            <span
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              lophn <span className={s.tag}>Built-in</span>
            </span>
          }
          strong
          sub="Home · Sonnet 5.5"
          end={<Ic icon={ChevronRight} size={16} />}
        />
        <Row
          lead={<Face who="Eval analyst" size={36} />}
          title="Eval analyst"
          strong
          sub="Every workspace · Sonnet 5.5"
          end={<Ic icon={ChevronRight} size={16} />}
        />
        <Row
          lead={<Face who="Experiment planner" size={36} />}
          title="Experiment planner"
          strong
          sub="phroner · Sonnet 5.5"
          end={<Ic icon={ChevronRight} size={16} />}
        />
        <Row
          lead={<Face who="Budget reviewer" size={36} />}
          title="Budget reviewer"
          strong
          sub="Orders · Sonnet 5.5"
          end={<Ic icon={ChevronRight} size={16} />}
        />
        <Label>Coding agents on mina-desktop</Label>
        <Row
          lead={<Face who="Claude Code" size={36} />}
          title="Claude Code"
          strong
          sub="2 sessions · 1 working"
          end={<Ic icon={ChevronRight} size={16} />}
        />
        <Row
          lead={<Face who="Codex" size={36} />}
          title="Codex"
          strong
          sub="1 session · working"
          end={<Ic icon={ChevronRight} size={16} />}
        />
      </div>
    </Phone>
  );
}

function AgentDetail() {
  return (
    <Phone>
      <TopBar left="back" title="Agents" right={<IconBtn icon={Ellipsis} />} />
      <div className={s.body}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "6px 20px 12px",
          }}
        >
          <Face who="Experiment planner" size={64} />
          <div>
            <h1 className={s.h2}>Experiment planner</h1>
            <div className={s.note}>Works only in phroner</div>
          </div>
        </div>
        <p
          className={s.p}
          style={{ margin: "0 20px 6px", fontSize: 15, lineHeight: "22px" }}
        >
          Plans the next eval experiment from the findings, cheapest first, and
          writes the plan where the runner picks it up.
        </p>
        <Fact label="Model">Sonnet 5.5 · Medium</Fact>
        <Fact label="Can use">5 skills · 2 MCP servers</Fact>
        <Fact label="Takes">Text, images, files</Fact>
        <Label>Recent sessions</Label>
        <Row
          lead={<Face who="Experiment planner" />}
          title="Tune the retry budget"
          sub="phroner · 3 days ago"
        />
        <Row
          lead={<Face who="Experiment planner" />}
          title="Plan exp-012"
          sub="phroner · last week"
        />
      </div>
      <div className={s.foot}>
        <Btn variant="primary" size="lg" icon={MessageSquarePlus}>
          New session
        </Btn>
        <p className={s.note} style={{ margin: 0, textAlign: "center" }}>
          Agents are created and edited on the computer.
        </p>
      </div>
    </Phone>
  );
}

// ── Settings ─────────────────────────────────────────

function Tile({ icon }: { icon: LucideIcon }) {
  return (
    <span className={s.box} style={{ width: 24, height: 24 }}>
      <Ic icon={icon} />
    </span>
  );
}

const NEXT = <Ic icon={ChevronRight} size={16} />;

function Settings({ over }: { over?: ReactNode }) {
  return (
    <Phone tone="floor" over={over}>
      <TopBar left="back" title="Settings" />
      <div className={s.body} style={{ gap: 0 }}>
        <Label>Computers</Label>
        <div className={s.group}>
          <Row
            lead={<Tile icon={Monitor} />}
            title="mina-desktop"
            sub={
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Dot tone="good" /> Connected
              </span>
            }
            end={NEXT}
          />
          <div className={s.hair} />
          <Row
            lead={<Tile icon={Server} />}
            title="mini-pc"
            sub={
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Dot tone="good" /> Connected
              </span>
            }
            end={NEXT}
          />
          <div className={s.hair} />
          <Row
            lead={<Tile icon={Laptop} />}
            title="work-laptop"
            sub={
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Dot tone="off" /> Offline
              </span>
            }
            end={NEXT}
          />
          <div className={s.hair} />
          <Row lead={<Tile icon={Plus} />} title="Pair another computer" />
        </div>
        <Label>This phone</Label>
        <div className={s.group}>
          <Row
            lead={<Tile icon={Smartphone} />}
            title="Name"
            end={
              <>
                Mina’s phone
                {NEXT}
              </>
            }
          />
          <div className={s.hair} />
          <Row
            lead={<Tile icon={Bell} />}
            title="Notifications"
            end={
              <>
                On
                {NEXT}
              </>
            }
          />
          <div className={s.hair} />
          <Row
            lead={<Tile icon={Palette} />}
            title="Appearance"
            end={
              <>
                System
                {NEXT}
              </>
            }
          />
        </div>
        <p className={s.note} style={{ margin: "8px 20px 0" }}>
          Computers show this name for your phone. A name you gave the phone on
          a computer shows there instead.
        </p>
        <Label>About</Label>
        <div className={s.group}>
          <Row
            lead={<Tile icon={Info} />}
            title="lophn for phone"
            end="0.24.0"
          />
        </div>
      </div>
    </Phone>
  );
}

function Computer({ over }: { over?: ReactNode }) {
  return (
    <Phone tone="floor" over={over}>
      <TopBar left="back" title="My Galaxy" />
      <div className={s.body}>
        <Label>Connection</Label>
        <div className={s.group}>
          <Row
            title="Status"
            end={
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <Dot tone="good" /> Connected
              </span>
            }
          />
          <div className={s.hair} />
          <Row title="Path" end="Same network" />
          <div className={s.hair} />
          <Row title="Away from home" end="Through the relay" />
          <div className={s.hair} />
          <Row title="lophn on it" end="0.23.61" />
        </div>
        <p className={s.note} style={{ margin: "8px 20px 0" }}>
          The relay only passes sealed messages along. It cannot read them.
        </p>
        <Label>On this phone</Label>
        <div className={s.group}>
          <Row
            title="Shown as"
            sub="Calls itself mina-desktop"
            end={<>My Galaxy{NEXT}</>}
          />
          <div className={s.hair} />
          <Row title="Paired" end="Nov 15, 2026" />
          <div className={s.hair} />
          <Row
            title="Key"
            end={
              <>
                <span className={s.mono}>k9Fq…2aTz</span>
                <Ic icon={Copy} size={15} />
              </>
            }
          />
        </div>
      </div>
      <div className={s.foot}>
        <Btn icon={Trash2}>
          <span className={s.bad}>Remove this computer</span>
        </Btn>
        <p className={s.note} style={{ margin: 0, textAlign: "center" }}>
          Also takes this phone off the computer’s list.
        </p>
      </div>
    </Phone>
  );
}

// The name the computer announces is the placeholder; a name given here wins and the button takes it back.
function ShownAsSheet() {
  return (
    <Sheet title="Shown as">
      <div
        className={s.pad}
        style={{ display: "grid", gap: 12, paddingBottom: 14 }}
      >
        <div className={s.field} data-focus="">
          My Galaxy
        </div>
        <Btn block>Use the computer’s name</Btn>
        <div className={s.btnRow}>
          <Btn block>Cancel</Btn>
          <Btn block variant="primary">
            Save
          </Btn>
        </div>
      </div>
      <Keyboard />
    </Sheet>
  );
}

function PhoneNameSheet() {
  return (
    <Sheet title="Name">
      <div
        className={s.pad}
        style={{ display: "grid", gap: 12, paddingBottom: 14 }}
      >
        <div className={s.field} data-focus="">
          Mina’s phone
        </div>
        <div className={s.btnRow}>
          <Btn block>Cancel</Btn>
          <Btn block variant="primary">
            Save
          </Btn>
        </div>
      </div>
      <Keyboard />
    </Sheet>
  );
}

function Toggle({
  title,
  sub,
  on,
}: {
  title: string;
  sub?: string;
  on?: boolean;
}) {
  return <Row title={title} sub={sub} wrap end={<Switch on={on} />} />;
}

function Notifications() {
  return (
    <Phone tone="floor">
      <TopBar left="back" title="Notifications" />
      <div className={s.body}>
        <Label>Tell me when</Label>
        <div className={s.group}>
          <Toggle title="An agent needs me" sub="Approvals and questions" on />
          <div className={s.hair} />
          <Toggle
            title="Long work finishes"
            sub="A turn that ran longer than a minute"
            on
          />
          <div className={s.hair} />
          <Toggle title="An app update waits" on />
          <div className={s.hair} />
          <Toggle title="A job was missed" />
          <div className={s.hair} />
          <Toggle
            title="My apps notify me"
            sub="Whatever an app sends with notify"
            on
          />
        </div>
        <Label>How</Label>
        <div className={s.group}>
          <Toggle
            title="Stay quiet while I am at the computer"
            sub="lophn knows when you are using it there"
            on
          />
          <div className={s.hair} />
          <Toggle
            title="Show session names"
            sub="Off shows only “An agent needs you”"
            on
          />
        </div>
        <p className={s.note} style={{ margin: "8px 20px 0" }}>
          A notification never carries what was said or the command an agent
          wants to run.
        </p>
      </div>
    </Phone>
  );
}

function Appearance() {
  return (
    <Phone tone="floor">
      <TopBar left="back" title="Appearance" />
      <div className={s.body}>
        <Label>Theme</Label>
        <div className={s.pad}>
          <Seg items={["System", "Light", "Dark"]} on={0} />
        </div>
        <Label>Text size</Label>
        <div className={s.pad}>
          <Seg items={["Small", "Default", "Large"]} on={1} />
        </div>
        <Label>Preview</Label>
        <div
          className={s.group}
          style={{ padding: 14, display: "grid", gap: 12 }}
        >
          <div className={s.bubble} style={{ justifySelf: "end" }}>
            Write this week’s eval report.
          </div>
          <div className={s.turn}>
            <div className={s.who}>
              <Face who="lophn" size={20} />
              lophn
            </div>
            <p className={s.p}>
              I wrote the report from the three findings. The regression share
              fell to <b>0.4%</b>.
            </p>
          </div>
        </div>
        <p className={s.note} style={{ margin: "10px 20px 0" }}>
          Colors and fonts follow lophn. The theme you picked on a computer
          stays on that computer.
        </p>
      </div>
    </Phone>
  );
}

// ── wide ─────────────────────────────────────────────

function Wide() {
  return (
    <div className={s.wide}>
      <div className={s.wideSide}>
        <SidebarBody on="weekly-report" />
      </div>
      <div className={s.wideMain}>
        <TopBar
          left="none"
          lead={<Face who="lophn" size={26} />}
          title="lophn"
          sub="Weekly report"
          right={<IconBtn icon={Ellipsis} />}
        />
        <div className={s.wideColumn}>
          <div className={s.thread}>
            <div className={s.bubble}>
              Write this week’s eval report from the new findings.
            </div>
            <div className={s.turn}>
              <div className={s.who}>
                <Face who="lophn" size={20} />
                lophn
              </div>
              <div className={s.act}>
                <span className={s.actText}>
                  Read 2 files · Searched 1 time · Listed 1 folder
                </span>
                <Ic icon={ChevronRight} size={15} />
              </div>
              <p className={s.p}>
                I wrote the report from the three findings. The regression share
                fell to <b>0.4%</b> this week.
              </p>
              <ul className={s.ul}>
                <li>F-011 is the query-recipe-gap regression</li>
                <li>The other two changed for the same reason</li>
              </ul>
              <div className={s.meta}>
                <span>Worked for 1m 12s · 6:41 PM</span>
                <Ic icon={Copy} size={15} />
              </div>
            </div>
          </div>
          <Composer
            placeholder="Reply…"
            chips={<Chip>Sonnet 5.5 · Medium</Chip>}
          />
        </div>
      </div>
    </div>
  );
}

export function OpsFlow() {
  return (
    <Flow
      title="7 · Jobs and agents"
      note="sidebar의 Jobs와 Agents. 폰은 보고, 켜고 끄고, 지금 돌리고, 새 session을 여는 곳이다. 만들고 고치고 지우는 일은 컴퓨터에서 한다."
    >
      <Shot
        title="Jobs"
        text="agent가 만든 정해진 때의 일. 언제 도는지, 무엇을 하는지, 마지막 결과. 오른쪽 스위치로 켜고 끈다."
      >
        <Jobs />
      </Shot>
      <Shot
        title="A job"
        text="자세한 내용과 지난 실행. 놓친 차례를 어떻게 했는지도 남는다. Start now로 지금 한 번 돌린다."
      >
        <JobDetail />
      </Shot>
      <Shot
        title="Agents"
        text="lophn agent와 컴퓨터의 coding agent. 어디서 일하는지와 model이 보인다."
      >
        <Agents />
      </Shot>
      <Shot
        title="An agent"
        text="무엇을 하는 agent인지, 쓸 수 있는 것, 최근 session. 아래 단추로 이 agent와 새 session을 연다."
      >
        <AgentDetail />
      </Shot>
    </Flow>
  );
}

export function SettingsFlow() {
  return (
    <Flow
      title="8 · Settings"
      note="sidebar 맨 아래. 폰 앱 자체의 설정만 있다: 붙은 컴퓨터, 이 폰의 이름, 알림, 모양. provider key나 agent 같은 lophn의 설정은 컴퓨터에 있다."
    >
      <Shot
        title="Settings"
        text="컴퓨터 목록이 맨 위다. 여기서 더 붙이고 뗀다."
      >
        <Settings />
      </Shot>
      <Shot
        title="A computer"
        text="어떻게 붙어 있는지와 이 폰에서의 이름. 별명을 붙였으면 그 컴퓨터가 스스로 알린 이름이 그 아래 작게 보인다. Remove는 양쪽 등록을 다 지운다."
      >
        <Computer />
      </Shot>
      <Shot
        title="Shown as"
        text="입력 칸을 비우면 컴퓨터가 알린 이름이 보인다. 별명이 있으면 Use the computer’s name으로 별명을 지운다. 컴퓨터 이름이 바뀌어도 별명은 그대로다."
      >
        <Computer over={<ShownAsSheet />} />
      </Shot>
      <Shot
        title="This phone’s name"
        text="컴퓨터에 알리는 이 폰의 이름. 비우면 기기 model로 돌아간다. 바꾸면 곧바로 컴퓨터에 알린다."
      >
        <Settings over={<PhoneNameSheet />} />
      </Shot>
      <Shot
        title="Notifications"
        text="무엇을 알릴지와 어떻게. 컴퓨터 앞에 있으면 조용하고, 잠금 화면에 session 이름을 숨길 수 있다."
      >
        <Notifications />
      </Shot>
      <Shot
        title="Appearance"
        text="밝기와 글자 크기. 색과 글꼴은 lophn의 것을 쓴다."
      >
        <Appearance />
      </Shot>
    </Flow>
  );
}

export function WideFlow() {
  return (
    <Flow
      title="9 · Wide screens"
      note="폰 크기는 하나가 아니다. 모든 화면은 폭에 따라 늘고 줄고(320부터), 600보다 넓으면(접는 폰을 편 것, tablet, 가로) sidebar가 늘 열려 desktop과 같은 두 칸이 된다. 본문은 읽기 좋은 폭에서 멈추고 가운데에 선다."
    >
      <figure style={{ margin: 0 }}>
        <Wide />
        <figcaption className={s.caption}>
          <p className={s.captionTitle}>Sidebar stays open</p>
          <p className={s.captionText}>
            같은 sidebar, 같은 대화. 왼쪽 위 단추가 사라지고 고른 session이
            sidebar에서 표시된다.
          </p>
        </figcaption>
      </figure>
    </Flow>
  );
}
