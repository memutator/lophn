// Flow 10. The computer's coding agents on the phone: the list, the chat, starting one, and continuing an ended one. A
// session that runs in a terminal opens as the terminal itself (flow 12, terminal.tsx).
import {
  Check,
  ChevronRight,
  Ellipsis,
  FilePen,
  FolderOpen,
  MessageSquare,
  Monitor,
  Plus,
  SquareTerminal,
  TriangleAlert,
  X,
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
  Sheet,
  Shot,
  s,
  Tabs,
  TopBar,
  Vend,
} from "./kit.tsx";

// ── conversation pieces (the same as flow 4) ─────────

function Head({ who, title }: { who: string; title: string }) {
  return (
    <TopBar
      lead={<Face who={who} size={26} />}
      title={who}
      sub={title}
      right={<IconBtn icon={Ellipsis} />}
    />
  );
}

function Who({ who }: { who: string }) {
  return (
    <div className={s.who}>
      <Face who={who} size={20} />
      {who}
    </div>
  );
}

function Act({ children }: { children: ReactNode }) {
  return (
    <div className={s.act}>
      <span className={s.actText}>{children}</span>
      <Ic icon={ChevronRight} size={15} />
    </div>
  );
}

function Edit({ path, add, del }: { path: string; add: number; del: number }) {
  return (
    <div className={s.edit}>
      <Ic icon={FilePen} size={17} className={s.muted} />
      <span className={`${s.grow} ${s.actText} ${s.mono}`}>{path}</span>
      <span className={`${s.good} ${s.mono}`}>+{add}</span>
      <span className={`${s.bad} ${s.mono}`}>−{del}</span>
      <Ic icon={ChevronRight} size={15} className={s.muted} />
    </div>
  );
}

function Working({
  children,
  tone = "good",
}: {
  children: ReactNode;
  tone?: "good" | "warning" | "off";
}) {
  return (
    <div className={s.working}>
      <Dot tone={tone} />
      {children}
    </div>
  );
}

/** What stands where the input would be: a line of text and the one thing to do about it. */
function Instead({ text, action }: { text: ReactNode; action: ReactNode }) {
  return (
    <div className={s.ask} style={{ marginBottom: 6 }}>
      <p
        className={s.p}
        style={{
          fontSize: 15,
          lineHeight: "22px",
          color: "var(--color-text-secondary)",
        }}
      >
        {text}
      </p>
      <div className={s.btnRow} data-end="" style={{ marginTop: 12 }}>
        {action}
      </div>
    </div>
  );
}

const OPUS = <Chip>Opus 5.5 · High</Chip>;

// ── the workspace's Sessions tab ─────────────────────

function TerminalMark() {
  return (
    <span className={s.tag} style={{ gap: 3, paddingLeft: 5 }}>
      <Ic icon={SquareTerminal} size={12} />
      Terminal
    </span>
  );
}

function Sessions() {
  return (
    <Phone>
      <TopBar
        lead={<Ic icon={FolderOpen} size={22} />}
        title="phroner"
        right={<IconBtn icon={Plus} />}
      />
      <Tabs items={["Sessions", "Workflows", "Files", "Jobs"]} on={0} />
      <div className={s.body}>
        <Label>Coding agents on mina-desktop</Label>
        <Row
          lead={<Face who="Claude Code" />}
          title="Fix flaky retry in the scenario runner"
          sub="Working · 2m"
          end={<Dot tone="working" />}
        />
        <Row
          lead={<Face who="Codex" />}
          title="Split the eval board loader"
          sub={
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <TerminalMark />
              Working · 4m
            </span>
          }
          end={<Dot tone="working" />}
        />
        <Label>Main</Label>
        <Row
          lead={<Face who="lophn" />}
          title="Weekly report"
          sub="Waiting for your approval"
          end={<Dot tone="warning" />}
        />
        <Row
          lead={<Face who="lophn" />}
          title="Harness change summary"
          sub="Done · yesterday"
          end={<Dot />}
        />
        <Label end="13">Recent</Label>
        <Row
          dim
          lead={<Face who="Claude Code" />}
          title="Stream eval results to the board"
          sub="2 days ago"
        />
        <Row
          dim
          lead={<Face who="Experiment planner" />}
          title="Tune the retry budget"
          sub="3 days ago"
        />
      </div>
      <Composer
        placeholder="Ask in phroner…"
        chips={<Chip lead={<Face who="lophn" size={18} />}>lophn</Chip>}
      />
    </Phone>
  );
}

// ── a coding session in chat ─────────────────────────

function Approve() {
  return (
    <Phone>
      <Head who="Claude Code" title="Fix flaky retry in the scenario runner" />
      <div className={s.thread}>
        <div className={s.turn}>
          <Who who="Claude Code" />
          <Act>Explored 6 files</Act>
          <p className={s.p}>
            The retry wrapper is applied twice, so one timeout is retried twice.
            I removed the outer one. Now I want to run the scenario tests.
          </p>
          <Edit path="src/scenario/runner.ts" add={4} del={11} />
        </div>
        <Working tone="warning">Waiting for your approval</Working>
      </div>
      <div className={s.ask}>
        <div className={s.askTitle}>
          <Ic icon={TriangleAlert} size={17} className={s.warnIcon} />
          Claude Code wants to run a command
        </div>
        <div className={s.fact}>
          <div className={s.factLabel}>Command</div>
          <div className={s.pre}>npm test -- scenario --runInBand</div>
        </div>
        <div className={s.fact}>
          <div className={s.factLabel}>Always allow adds</div>
          <div className={s.pre} style={{ display: "inline-block" }}>
            Bash(npm test:*)
          </div>
        </div>
        <div className={s.btnRow} style={{ marginTop: 14 }}>
          <Btn block icon={X}>
            Deny
          </Btn>
          <Btn block icon={Check}>
            Always allow
          </Btn>
        </div>
        <div className={s.btnRow} style={{ marginTop: 8 }}>
          <Btn block variant="primary" icon={Check}>
            Allow once
          </Btn>
        </div>
      </div>
      <Composer placeholder="Reply…" chips={OPUS} attach={false} />
    </Phone>
  );
}

// ── a new coding session ─────────────────────────────

function NewCoding({ over }: { over?: ReactNode }) {
  const picked = over === undefined;
  const who = picked ? "Claude Code" : "lophn";
  return (
    <Phone over={over}>
      <TopBar title="New session" />
      <div className={s.center}>
        <Face who={who} size={60} />
        <h1
          className={s.hero}
          style={{ marginTop: 14, fontSize: 22, lineHeight: "30px" }}
        >
          What should {who} work on?
        </h1>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <span className={s.pill} style={{ height: 36 }}>
            <Ic icon={FolderOpen} size={16} />
            phroner
          </span>
          <span className={s.pill} style={{ height: 36 }}>
            <Face who={who} size={18} />
            {who}
          </span>
        </div>
      </div>
      {picked && (
        <div
          className={s.note}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "0 20px 2px",
          }}
        >
          <Ic icon={Monitor} size={14} />
          Starts in a new terminal on the computer
        </div>
      )}
      <Composer
        placeholder="Describe a task or ask a question…"
        value={
          picked
            ? "The scenario runner retries twice on a timeout. Find out why and fix it."
            : undefined
        }
        action={picked ? "send" : "off"}
        attach={!picked}
      />
      {picked && <Keyboard />}
    </Phone>
  );
}

function Pick() {
  return (
    <Sheet title="Who works on it">
      <Label>Agents</Label>
      <Row
        lead={<Face who="lophn" size={30} />}
        title="lophn"
        strong
        sub="Built-in · plans and hands work on"
      />
      <Row
        lead={<Face who="Eval analyst" size={30} />}
        title="Eval analyst"
        strong
        sub="Every workspace"
      />
      <Label>Coding agents on mina-desktop</Label>
      <Row
        lead={<Face who="Claude Code" size={30} />}
        title="Claude Code"
        strong
        end={<Ic icon={Check} />}
      />
      <Row lead={<Face who="Codex" size={30} />} title="Codex" strong />
      <Row
        lead={<Vend vendor="opencode" size={26} />}
        title="OpenCode"
        strong
      />
      <Row lead={<Vend vendor="omp" size={26} />} title="omp" strong />
      <Row lead={<Ic icon={SquareTerminal} />} title="Terminal" strong />
    </Sheet>
  );
}

function Ended() {
  return (
    <Phone>
      <Head who="Claude Code" title="Stream eval results to the board" />
      <div className={s.thread}>
        <div className={s.bubble}>
          Make the eval board show results as they come in, not at the end.
        </div>
        <div className={s.turn}>
          <Who who="Claude Code" />
          <Act>Explored 9 files</Act>
          <p className={s.p}>
            The board now subscribes to the run’s events and adds a row per
            finished scenario. The final table is unchanged.
          </p>
          <Edit path="src/eval/board.ts" add={57} del={12} />
          <div className={s.meta}>
            <span>Ended · 2 days ago</span>
          </div>
        </div>
      </div>
      <Instead
        text="This session ended on mina-desktop. Continue it there as a chat to keep working from here."
        action={
          <Btn variant="primary" icon={MessageSquare}>
            Continue as chat
          </Btn>
        }
      />
    </Phone>
  );
}

export function CodingFlow() {
  return (
    <Flow
      title="10 · Coding agents"
      note="컴퓨터에서 도는 Claude Code, Codex, OpenCode, omp. 컴퓨터의 lophn 앱이 꺼져 있어도 목록이 보이고 열린다. 채팅 화면으로 도는 session은 lophn agent와 같은 대화와 card로 다룬다. 터미널로 도는 session을 열면 그 터미널 화면이 바로 열리고 거기서 치거나 menu로 채팅으로 바꾼다(flow 12 Terminal)."
    >
      <Shot
        title="Coding agents in the project"
        text="Sessions 탭 맨 위에 컴퓨터에서 지금 도는 coding session이 묶인다. 없으면 묶음이 서지 않는다. 채팅으로 도는 것은 상태만, 터미널로 도는 것은 작은 Terminal 표시가 붙고 누르면 flow 12의 터미널 화면이 열린다. 끝난 coding session은 Recent에 남는다."
      >
        <Sessions />
      </Shot>
      <Shot
        title="Approval from a coding agent"
        text="flow 4의 coding agent 화면과 같다. 승인 card도 lophn agent의 것과 같은 모양이고 이름만 coding agent다. 입력 칸의 +로 사진을 붙인다."
      >
        <Approve />
      </Shot>
      <Shot
        title="A new coding session"
        text="새 session의 단추는 workspace와 agent 둘이다. agent 단추의 Who works on it 안에 lophn agent 묶음 아래로 컴퓨터의 coding agent 묶음이 서고 그 끝에 Terminal이 온다. Terminal을 고르면 바로 컴퓨터의 그 project에 터미널을 열고 flow 12의 터미널 화면으로 간다(그 project를 보는 창이 있으면 탭도 선다). 목록은 정해진 것이라 바로 서고, 컴퓨터의 답이 오기 전에는 흐리고 누를 수 없다. 컴퓨터의 앱이 꺼져 있어도 고르고 열 수 있다."
      >
        <NewCoding over={<Pick />} />
      </Shot>
      <Shot
        title="The first message"
        text="고르기만 해서는 아무것도 열리지 않는다. 입력 칸 위에 컴퓨터의 새 터미널로 시작한다고 알린다. 첫 메시지를 보내면 그때 컴퓨터에 열고 그 메시지를 보내 flow 4의 대화 화면으로 간다. 못 열거나 못 보내면 글은 입력 칸에 남는다."
      >
        <NewCoding />
      </Shot>
      <Shot
        title="Continue an ended session"
        text="끝난 coding session은 읽기만 된다. Continue as chat을 누르면 컴퓨터에서 같은 CLI session을 되살려 채팅으로 이어 간다."
      >
        <Ended />
      </Shot>
    </Flow>
  );
}
