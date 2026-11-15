// Flow 6. A project workspace: its sessions, workflows and files.
import {
  Check,
  ChevronRight,
  CircleDot,
  FileText,
  Folder,
  FolderOpen,
  MessageCircle,
  Monitor,
  Play,
  Plus,
  Square,
  Workflow,
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
  Label,
  Phone,
  Row,
  Shot,
  s,
  Tabs,
  TopBar,
} from "./kit.tsx";

const TABS = ["Sessions", "Workflows", "Files", "Jobs"];

function Head() {
  return (
    <>
      <TopBar
        lead={<Ic icon={FolderOpen} size={22} />}
        title="phroner"
        right={<IconBtn icon={Plus} />}
      />
    </>
  );
}

function Sessions() {
  return (
    <Phone>
      <Head />
      <Tabs items={TABS} on={0} />
      <div className={s.body}>
        <Label>Main</Label>
        <Row
          lead={<Face who="lophn" />}
          title="Weekly report"
          sub="Waiting for your approval"
          end={<Dot tone="warning" />}
        />
        <Row
          lead={<Face who="Claude Code" />}
          title="Fix flaky retry in the scenario runner"
          sub="Working · 2m"
          end={<Dot tone="good" />}
        />
        <Row
          lead={<Face who="lophn" />}
          title="Harness change summary"
          sub="Done · yesterday"
          end={<Dot />}
        />
        <Label>weekly-review</Label>
        <Row
          lead={<Face who="Codex" />}
          title="Split the eval board loader"
          sub="Working · 4m"
          end={<Dot tone="good" />}
        />
        <Label end="13">Recent</Label>
        <Row
          dim
          lead={<Face who="Experiment planner" />}
          title="Tune the retry budget"
          sub="3 days ago"
        />
        <Row
          dim
          lead={<Face who="lophn" />}
          title="Explain the scoring change"
          sub="Last week"
        />
      </div>
      <Composer
        placeholder="Ask in phroner…"
        chips={<Chip lead={<Face who="lophn" size={18} />}>lophn</Chip>}
      />
    </Phone>
  );
}

function Run({
  title,
  state,
  at,
  mine,
}: {
  title: string;
  state: string;
  at: string;
  mine?: boolean;
}) {
  return (
    <Row
      title={title}
      sub={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            className={mine ? s.warn : s.good}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontWeight: 500,
            }}
          >
            <Ic icon={mine ? MessageCircle : Play} size={13} />
            {state}
          </span>
          {at}
        </span>
      }
      end={<Ic icon={ChevronRight} size={16} />}
    />
  );
}

function Workflows() {
  return (
    <Phone>
      <Head />
      <Tabs items={TABS} on={1} />
      <div className={s.body}>
        <div className={s.row} style={{ paddingTop: 14 }}>
          <span className={s.box} style={{ width: 24, height: 24 }}>
            <Ic icon={Workflow} />
          </span>
          <div className={s.rowMain}>
            <div className={s.rowTitle} data-strong="">
              eval-loop
            </div>
            <div className={s.rowSub}>agent · 4 running</div>
          </div>
          <Btn size="sm" variant="primary" icon={Play}>
            Start
          </Btn>
        </div>
        <Label end="6">Instances</Label>
        <Run
          mine
          title="Check whether the chest-name fix holds"
          state="Your turn"
          at="at review · 2h"
        />
        <Run
          title="Plan the next round of ftb quests experiments"
          state="Running"
          at="at execute · 5h"
        />
        <Run
          title="Look into why the recipe lookups flip"
          state="Running"
          at="at execute · 1d"
        />
        <Run
          title="Re-check the inventory read scenarios"
          state="Running"
          at="at plan · 1d"
        />
        <div className={s.hair} style={{ margin: "8px 20px" }} />
        <div className={s.row}>
          <span className={s.box} style={{ width: 24, height: 24 }}>
            <Ic icon={Workflow} />
          </span>
          <div className={s.rowMain}>
            <div className={s.rowTitle} data-strong="">
              weekly-review
            </div>
            <div className={s.rowSub}>
              flow · started by the Weekly review job
            </div>
          </div>
          <Btn size="sm" icon={Play}>
            Start
          </Btn>
        </div>
      </div>
    </Phone>
  );
}

function StepRow({
  name,
  who,
  children,
  state,
}: {
  name: string;
  who: string;
  children: ReactNode;
  state: "done" | "mine";
}) {
  return (
    <div className={s.stepRow}>
      <Ic
        icon={state === "done" ? Check : CircleDot}
        size={18}
        className={state === "done" ? s.good : s.warn}
        style={{ marginTop: 2 }}
      />
      <div className={s.grow}>
        <div className={s.between}>
          <span>
            <b>{name}</b> <span className={s.muted}>{who}</span>
          </span>
          <span className={s.note}>
            {state === "done" ? "Reported" : "Now"}
          </span>
        </div>
        <div
          className={s.itemText}
          style={{ fontSize: 14, lineHeight: "20px" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

function Instance() {
  return (
    <Phone>
      <TopBar left="back" title="eval-loop" under="phroner · workflow" />
      <div className={s.body}>
        <div className={s.pad} style={{ paddingTop: 6 }}>
          <h1 className={s.h2}>
            Check whether the chest-name fix holds on the full scenario set
          </h1>
          <div
            className={s.warn}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              marginTop: 6,
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            <Ic icon={MessageCircle} size={15} />
            Your turn
            <span className={s.muted} style={{ fontWeight: 400 }}>
              · started 2 hours ago
            </span>
          </div>
        </div>
        <div className={s.ask} style={{ margin: "14px 16px 6px" }}>
          <div style={{ fontSize: 15, lineHeight: "22px" }}>
            Your turn on <b>review</b>. lophn is waiting to talk it through with
            you.
          </div>
          <div className={s.btnRow} style={{ marginTop: 12 }}>
            <Btn block variant="primary" icon={MessageCircle}>
              Open the conversation
            </Btn>
          </div>
        </div>
        <StepRow name="plan" who="lophn" state="done">
          Repeat exp-011 on the full scenario set with the chest-name fix.
        </StepRow>
        <StepRow name="execute" who="Eval analyst" state="done">
          Ran exp-013 on 24 scenarios. 19 passed, 5 failed, all five on quest
          lookups with more than one quest line.
        </StepRow>
        <StepRow name="review" who="you and lophn" state="mine">
          Decide whether the fix is good enough to keep.
        </StepRow>
      </div>
      <div className={s.foot} style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Btn icon={FileText}>Open the report</Btn>
        <Btn icon={Square}>Stop this run</Btn>
      </div>
    </Phone>
  );
}

function File({
  name,
  sub,
  folder,
}: {
  name: string;
  sub?: string;
  folder?: boolean;
}) {
  return (
    <Row
      lead={<Ic icon={folder ? Folder : FileText} />}
      title={name}
      sub={sub}
      end={folder ? <Ic icon={ChevronRight} size={16} /> : undefined}
    />
  );
}

function Files() {
  return (
    <Phone>
      <Head />
      <Tabs items={TABS} on={2} />
      <div className={s.body}>
        <div className={s.crumbs}>
          phroner
          <Ic icon={ChevronRight} size={13} />
          docs
          <Ic icon={ChevronRight} size={13} />
          <span style={{ color: "var(--color-text-primary)" }}>reports</span>
        </div>
        <File folder name="archive" sub="12 files" />
        <File name="2026-w41.md" sub="lophn edited it · 6:41 PM" />
        <File name="2026-w40.md" sub="Last week" />
        <File name="2026-w39.md" sub="2 weeks ago" />
        <File name="template.md" sub="Sep 30" />
        <File name="regressions.csv" sub="Yesterday" />
      </div>
    </Phone>
  );
}

function Reader() {
  return (
    <Phone>
      <TopBar
        left="back"
        title="2026-w41.md"
        under="phroner / docs / reports"
        right={<IconBtn icon={Monitor} tone="muted" />}
      />
      <div className={`${s.body} ${s.md}`} style={{ padding: "8px 20px 0" }}>
        <h1>Week 41 report</h1>
        <p>
          The regression share fell to <b>0.4%</b> this week (11 of 2,400
          scenarios). All eleven trace back to the same recipe lookup.
        </p>
        <h2>Regressions</h2>
        <table>
          <thead>
            <tr>
              <th>Finding</th>
              <th>Scenarios</th>
              <th>Cause</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>F-011</td>
              <td>6</td>
              <td>query-recipe gap</td>
            </tr>
            <tr>
              <td>F-012</td>
              <td>3</td>
              <td>same lookup</td>
            </tr>
            <tr>
              <td>F-013</td>
              <td>2</td>
              <td>same lookup</td>
            </tr>
          </tbody>
        </table>
        <h2>Next week</h2>
        <p>Rerun exp-011 with the name fix and compare against this table.</p>
      </div>
      <Composer
        placeholder="Ask about this file…"
        chips={<Chip lead={<Face who="lophn" size={18} />}>lophn</Chip>}
      />
    </Phone>
  );
}

export function WorkspaceFlow() {
  return (
    <Flow
      title="6 · Project workspace"
      note="sidebar에서 project 이름을 누르면. 그 project의 session, workflow, file, job이 탭으로 나뉜다. 폰은 보는 곳이고 일은 agent에게 시킨다: file은 읽기만 하고, 고치고 싶으면 그 자리에서 agent에게 말한다."
    >
      <Shot
        title="Sessions"
        text="worktree마다 묶인 session과 그 상태. 맨 아래에서 이 project의 새 session을 바로 시작한다."
      >
        <Sessions />
      </Shot>
      <Shot
        title="Workflows"
        text="사람과 agent가 step을 넘기며 도는 일. 내 차례인 것이 노랗게 보인다. Start로 새로 돌린다."
      >
        <Workflows />
      </Shot>
      <Shot
        title="A workflow, my turn"
        text="어디까지 왔고 지금 누구 차례인지. 내 차례면 대화로 들어가는 단추가 맨 위다."
      >
        <Instance />
      </Shot>
      <Shot
        title="Files"
        text="project 폴더를 훑는다. 누가 언제 고쳤는지 보인다."
      >
        <Files />
      </Shot>
      <Shot
        title="Reading a file"
        text="문서는 읽기 좋게 그린다. 아래에서 이 file에 대해 바로 묻거나 고쳐 달라고 한다. 오른쪽 위는 컴퓨터에서 열기."
      >
        <Reader />
      </Shot>
    </Flow>
  );
}
