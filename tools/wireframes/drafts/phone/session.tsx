// Flow 4. A session: the conversation with an agent, and everything that hangs off it.
import {
  Archive,
  AtSign,
  Camera,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleX,
  Copy,
  Ellipsis,
  ExternalLink,
  FilePen,
  FileText,
  FolderOpen,
  Gauge,
  Image,
  KeyRound,
  ListTodo,
  LogIn,
  Monitor,
  Paperclip,
  Pencil,
  RefreshCw,
  Search,
  ShieldCheck,
  SquareSlash,
  Terminal,
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
  Seg,
  Sheet,
  Shot,
  s,
  TopBar,
  Vend,
} from "./kit.tsx";

// The session's name leads; who runs it and in which project is the quiet line under it.
function Head({
  who = "lophn",
  title = "Weekly report",
  project = "phroner",
}: {
  who?: string;
  title?: string;
  project?: string;
}) {
  return (
    <TopBar
      lead={<Face who={who} size={26} />}
      title={title}
      under={`${who} · ${project}`}
      right={<IconBtn icon={Ellipsis} />}
    />
  );
}

function Who({ who = "lophn" }: { who?: string }) {
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
  tone?: "good" | "warning";
}) {
  return (
    <div className={s.working}>
      <Dot tone={tone} />
      {children}
    </div>
  );
}

const MODEL = <Chip>Sonnet 5.5 · Medium</Chip>;

function Answer() {
  return (
    <div className={s.thread}>
      <div className={s.bubble}>
        Write this week’s eval report from the new findings.
      </div>
      <div className={s.turn}>
        <Who />
        <Act>Read 2 files · Searched 1 time · Listed 1 folder</Act>
        <Act>Thought for 12s</Act>
        <p className={s.p}>
          I wrote the report from the three findings. The regression share fell
          to <b>0.4%</b> this week.
        </p>
        <ul className={s.ul}>
          <li>F-011 is the query-recipe-gap regression</li>
          <li>The other two changed for the same reason</li>
        </ul>
        <Edit path="docs/reports/2026-w41.md" add={38} del={2} />
        <div className={s.meta}>
          <span>Worked for 1m 12s · 6:41 PM</span>
          <Ic icon={Copy} size={15} />
        </div>
      </div>
    </div>
  );
}

function Done({ over }: { over?: ReactNode }) {
  return (
    <Phone over={over}>
      <Head />
      <Answer />
      <Composer placeholder="Reply…" chips={MODEL} />
    </Phone>
  );
}

function Running() {
  return (
    <Phone>
      <Head />
      <div className={s.thread}>
        <div className={s.bubble}>
          Also add the exp-008 numbers to the report.
        </div>
        <div className={s.bubbleNote}>
          <Ic icon={Pencil} size={12} />
          Steer · went into the running turn
        </div>
        <div className={s.turn}>
          <Who />
          <p className={s.p}>
            Got it. I will add the exp-008 numbers when I reach the regression
            section.
          </p>
          <Act>Count regressions per scenario · 3s</Act>
          <p className={s.p}>
            F-011 is the query-recipe-gap regression. The other two changed for
            the same
            <span className={s.caret} style={{ opacity: 0.5 }} />
          </p>
        </div>
        <Working>Working · 42s</Working>
      </div>
      <Composer placeholder="Queue a message…" chips={MODEL} action="stop" />
    </Phone>
  );
}

function Approval({ over }: { over?: ReactNode }) {
  return (
    <Phone over={over}>
      <Head />
      <div className={s.thread}>
        <div className={s.turn}>
          <Who />
          <p className={s.p}>
            The 2026-w40 report is superseded by this week’s. I can delete the
            old folder with a shell command, so I need your OK first.
          </p>
        </div>
        <Working tone="warning">Waiting for your approval</Working>
      </div>
      <div className={s.ask}>
        <div className={s.askTitle}>
          <Ic icon={TriangleAlert} size={17} className={s.warnIcon} />
          lophn wants to run a command
        </div>
        <div className={s.fact}>
          <div className={s.factLabel}>Command</div>
          <div className={s.pre}>rm -r docs/reports/2026-w40</div>
        </div>
        <div className={s.fact}>
          <div className={s.factLabel}>Always allow adds</div>
          <div className={s.pre} style={{ display: "inline-block" }}>
            rm -r *
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
      <Composer placeholder="Reply…" chips={MODEL} />
    </Phone>
  );
}

// Deny asks why, in one optional line; the agent gets it with the refusal. Inbox and Home deny through the same sheet.
function DenyReason() {
  return (
    <Sheet title="Reason for denying">
      <div
        className={s.pad}
        style={{ display: "grid", gap: 12, paddingBottom: 8 }}
      >
        <div className={s.field} style={{ minHeight: 40 }}>
          <span>Not on main, use a branch</span>
          <span className={s.caret} />
        </div>
        <div className={s.btnRow} data-end="">
          <Btn icon={X}>Deny</Btn>
        </div>
      </div>
    </Sheet>
  );
}

// `/` typed in the message: the commands that match stand over the composer, the same list as + › Commands and skills.
function TypedCommand() {
  return (
    <Phone>
      <Head />
      <Answer />
      <Row
        lead={<Ic icon={SquareSlash} />}
        title="/rename"
        sub="Rename this session"
      />
      <Row
        lead={<Ic icon={SquareSlash} />}
        title="/review"
        sub="Review the changes on this branch"
      />
      <Composer placeholder="Reply…" value="/re" chips={MODEL} action="send" />
    </Phone>
  );
}

// A subagent's line opens its conversation, read only. Steering or stopping it is done on the computer.
function Subagent() {
  return (
    <Sheet title="Explore · Find where the upload retry is called">
      <div className={s.thread}>
        <div className={s.bubble}>
          Find every caller of withRetry in src/scenario and say which ones wrap
          a timeout.
        </div>
        <div className={s.turn}>
          <Who who="Explore" />
          <Act>Searched for withRetry · 4 matches</Act>
          <p className={s.p}>
            runner.ts and client.ts both wrap the request in withRetry, so a
            timeout is retried by each.
          </p>
        </div>
      </div>
    </Sheet>
  );
}

function Option({
  label,
  sub,
  on,
}: {
  label: string;
  sub: string;
  on?: boolean;
}) {
  return (
    <div className={s.option}>
      <span className={s.radio} data-on={on || undefined} />
      <div>
        <div style={{ fontWeight: 500 }}>{label}</div>
        <div className={s.optionSub}>{sub}</div>
      </div>
    </div>
  );
}

function Question() {
  return (
    <Phone>
      <Head />
      <div className={s.thread}>
        <div className={s.turn}>
          <Who />
          <p className={s.p}>
            There are 3 new findings since last week. Before I write the report
            I need two answers.
          </p>
        </div>
        <Working tone="warning">Waiting for your answer</Working>
      </div>
      <div className={s.ask}>
        <div className={s.between}>
          <span className={s.askTitle}>lophn is asking</span>
          <span
            className={s.note}
            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
          >
            <Ic icon={ChevronLeft} size={15} />1 of 2
            <Ic icon={ChevronRight} size={15} />
          </span>
        </div>
        <div
          style={{
            margin: "10px 0 0",
            fontSize: 16,
            fontWeight: 600,
            lineHeight: "22px",
          }}
        >
          Where should the weekly report go?
        </div>
        <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
          <Option on label="docs/reports/" sub="Next to last week’s reports" />
          <Option label="eval/reports/" sub="Inside the eval folder" />
          <Option
            label="A new file each week"
            sub="Named by date, no fixed folder"
          />
          <div className={s.option}>
            <span className={s.radio} />
            <span className={s.muted}>Something else…</span>
          </div>
        </div>
        <div className={s.btnRow} data-end="" style={{ marginTop: 12 }}>
          <Btn variant="primary">
            Next
            <Ic icon={ChevronRight} size={16} />
          </Btn>
        </div>
      </div>
      <Composer placeholder="Reply instead…" chips={MODEL} />
    </Phone>
  );
}

function Steps() {
  return (
    <Sheet title="What lophn did">
      <Row
        lead={<Ic icon={FileText} />}
        title="Read F-011.md"
        sub="eval/findings"
        end="0.2s"
      />
      <Row
        lead={<Ic icon={FileText} />}
        title="Read F-012.md"
        sub="eval/findings"
        end="0.1s"
      />
      <Row
        lead={<Ic icon={Search} />}
        title="Searched “regression”"
        sub="eval/ · 12 matches"
        end="0.4s"
      />
      <Row
        lead={<Ic icon={Terminal} />}
        title="Ran a command"
        sub="npm run count -- --week 41"
        end="3s"
      />
      <div className={s.pad} style={{ paddingTop: 4, paddingBottom: 10 }}>
        <div className={s.pre} data-wrap="">
          {
            "> count --week 41\nscenarios  2,400\nregressed     11  (0.4%)\nexit 0"
          }
        </div>
      </div>
    </Sheet>
  );
}

const DIFF: [string, string, "add" | "del" | undefined][] = [
  ["11", "## Regressions", undefined],
  ["12", "", undefined],
  ["13", "Regression share: 0.9% (22 of 2,400)", "del"],
  ["13", "Regression share: 0.4% (11 of 2,400)", "add"],
  ["14", "", undefined],
  ["15", "| Finding | Scenarios | Cause |", "add"],
  ["16", "|---|---|---|", "add"],
  ["17", "| F-011 | 6 | query-recipe gap |", "add"],
  ["18", "| F-012 | 3 | same lookup |", "add"],
  ["19", "| F-013 | 2 | same lookup |", "add"],
  ["20", "", "add"],
  ["21", "exp-008 moved 4 scenarios out of", "add"],
  ["22", "the flaky set.", "add"],
  ["23", "", undefined],
  ["24", "## Next week", undefined],
  ["25", "- rerun exp-011 on the full set", "del"],
  ["25", "- rerun exp-011 with the name fix", "add"],
];

function Diff() {
  return (
    <Phone>
      <TopBar
        left="back"
        title="2026-w41.md"
        under="docs/reports · +38 −2"
        right={<IconBtn icon={Monitor} tone="muted" />}
      />
      <div className={s.body} style={{ paddingTop: 6 }}>
        {DIFF.map(([no, text, kind], at) => (
          <div key={at} className={s.diffLine} data-kind={kind}>
            <span className={s.diffNo}>{no}</span>
            <span>
              {kind === "add" ? "+ " : kind === "del" ? "− " : "  "}
              {text}
            </span>
          </div>
        ))}
      </div>
    </Phone>
  );
}

function Attach() {
  return (
    <Sheet title="Add to the message">
      <div style={{ display: "flex", gap: 8, padding: "2px 20px 10px" }}>
        <span className={s.thumb} />
        <span className={s.thumb} style={{ filter: "hue-rotate(60deg)" }} />
        <span className={s.thumb} style={{ filter: "hue-rotate(140deg)" }} />
        <span className={s.thumb} style={{ filter: "hue-rotate(220deg)" }} />
        <span className={s.thumb} style={{ filter: "grayscale(1)" }} />
      </div>
      <Row lead={<Ic icon={Image} />} title="Photos" />
      <Row lead={<Ic icon={Camera} />} title="Camera" />
      <Row lead={<Ic icon={Paperclip} />} title="Files" />
      <div className={s.hair} style={{ margin: "6px 20px" }} />
      <Row
        lead={<Ic icon={AtSign} />}
        title="A file in phroner"
        sub="Point lophn at it by name"
      />
      <Row
        lead={<Ic icon={SquareSlash} />}
        title="Commands and skills"
        sub="Or type / in the message"
      />
    </Sheet>
  );
}

function Models() {
  return (
    <Sheet title="Model">
      <div className={s.pad} style={{ paddingBottom: 6 }}>
        <div className={s.field} data-soft="" style={{ minHeight: 40 }}>
          <Ic icon={Search} size={18} className={s.muted} />
          <span className={s.muted}>Search models</span>
        </div>
      </div>
      <Row
        lead={<Vend vendor="anthropic" />}
        title="Anthropic"
        strong
        end={<Ic icon={ChevronDown} size={16} />}
      />
      <Row lead={<span style={{ width: 24 }} />} title="Opus 5.5" />
      <Row
        lead={<span style={{ width: 24 }} />}
        title="Sonnet 5.5"
        end={<Ic icon={Check} />}
      />
      <Row
        lead={<Vend vendor="openai" />}
        title="OpenAI"
        strong
        end={<Ic icon={ChevronRight} size={16} />}
      />
      <Row
        lead={<Vend vendor="xai" />}
        title="xAI"
        strong
        end={<Ic icon={ChevronRight} size={16} />}
      />
      <div className={s.hair} style={{ margin: "6px 20px 12px" }} />
      <div
        className={s.pad}
        style={{ display: "grid", gap: 8, paddingBottom: 8 }}
      >
        <span className={s.fieldLabel}>Effort</span>
        <Seg items={["Low", "Medium", "High", "XHigh", "Max"]} on={1} />
      </div>
    </Sheet>
  );
}

function SessionMenu() {
  return (
    <Sheet>
      <div className={s.sheetLead}>
        <Face who="lophn" size={34} />
        <div>
          <div className={s.sheetTitle}>Weekly report</div>
          <div className={s.note}>lophn · phroner · Main</div>
        </div>
      </div>
      <Row lead={<Ic icon={Pencil} />} title="Rename" />
      <Row
        lead={<Ic icon={ShieldCheck} />}
        title="Permissions"
        end={
          <>
            Ask when needed
            <Ic icon={ChevronRight} size={16} />
          </>
        }
      />
      <Row lead={<Ic icon={Gauge} />} title="Context" end="8% of 1.05M" />
      <Row
        lead={<Ic icon={Monitor} />}
        title="Show on mina-desktop"
        sub="Brings this session to the front there"
      />
      <div className={s.hair} style={{ margin: "6px 20px" }} />
      <Row lead={<Ic icon={Archive} />} title="Archive" />
    </Sheet>
  );
}

function Coding({ over }: { over?: ReactNode }) {
  return (
    <Phone over={over}>
      <Head who="Claude Code" title="Fix flaky retry in the scenario runner" />
      <div className={s.thread}>
        <div className={s.bubble}>
          The scenario runner retries twice on a timeout. Find out why and fix
          it.
        </div>
        <div className={s.turn}>
          <Who who="Claude Code" />
          <Act>Explored 6 files</Act>
          <Act>Explore · Find where the upload retry is called · 38s</Act>
          <p className={s.p}>
            The retry wrapper is applied in both{" "}
            <span className={s.mono}>runner.ts</span> and{" "}
            <span className={s.mono}>client.ts</span>, so one timeout is retried
            twice. I am removing the outer one.
          </p>
          <Edit path="src/scenario/runner.ts" add={4} del={11} />
          <Act>Running npm test -- scenario</Act>
        </div>
        <Working>Working · 2m 08s</Working>
      </div>
      <div className={s.ask} style={{ padding: "10px 12px", marginBottom: 2 }}>
        <div className={s.between}>
          <span className={s.askTitle}>
            <Ic icon={ListTodo} size={17} />
            Todo · 2 of 4 done
          </span>
          <Ic icon={ChevronDown} size={16} className={s.muted} />
        </div>
      </div>
      <Composer
        placeholder="Queue a message…"
        chips={<Chip>Opus 5.5 · High</Chip>}
        action="stop"
      />
    </Phone>
  );
}

// What stays on the computer: a site login, a sign-in that comes back to the computer's own browser (ChatGPT, Claude,
// Antigravity) and an app's or an MCP server's sign-in. The card says so in one line and only cancels.
function Stuck() {
  return (
    <Phone>
      <Head title="Order the printer paper" />
      <div className={s.thread}>
        <div className={s.turn}>
          <Who />
          <p className={s.p}>
            The cart is ready on shop.example. To check out I need your login
            there.
          </p>
        </div>
        <div className={s.working} style={{ alignItems: "flex-start" }}>
          <Ic
            icon={CircleX}
            size={17}
            className={s.bad}
            style={{ marginTop: 1 }}
          />
          <span
            className={s.grow}
            style={{ color: "var(--color-text-secondary)" }}
          >
            Anthropic answered 529 (overloaded). Nothing was lost.
          </span>
          <Btn size="sm" icon={RefreshCw}>
            Retry
          </Btn>
        </div>
      </div>
      <div className={s.ask}>
        <div className={s.askTitle}>
          <Ic icon={KeyRound} size={17} />
          lophn asks you to save a login for this page
        </div>
        <div className={s.fact}>
          <div className={s.factLabel}>Page origin</div>
          <div className={s.pre}>https://shop.example</div>
        </div>
        <p className={s.note} style={{ margin: "10px 0 0" }}>
          Site logins are saved on the computer. Open lophn on mina-desktop to
          enter it.
        </p>
        <div className={s.btnRow} data-end="" style={{ marginTop: 12 }}>
          <Btn icon={X}>Cancel the request</Btn>
        </div>
      </div>
      <Composer placeholder="Reply…" chips={MODEL} />
    </Phone>
  );
}

// A secret the agent asks for, typed here. The field hides what is typed; Save sends it to the computer and empties the
// field. The value is not kept on the phone.
function SecretAsk() {
  return (
    <Phone>
      <Head title="Add a CSV export" />
      <div className={s.thread}>
        <div className={s.turn}>
          <Who />
          <p className={s.p}>
            The export works on the sample data. To send it to the payments
            service I need its key.
          </p>
        </div>
        <Working tone="warning">Waiting for you</Working>
      </div>
      <div className={s.ask}>
        <div className={s.askTitle}>
          <Ic icon={KeyRound} size={17} />
          lophn asks you to enter a secret for the app Payments
        </div>
        <div className={s.fact}>
          <div className={s.factLabel}>Sent to</div>
          <div className={s.pre}>api.payments.example</div>
        </div>
        <div className={s.fact}>
          <div className={s.factLabel}>PAYMENTS_KEY</div>
          <div className={s.field} data-focus="" style={{ minHeight: 44 }}>
            <span style={{ letterSpacing: 2 }}>••••••••••••••</span>
            <span className={s.caret} />
          </div>
        </div>
        <p className={s.note} style={{ margin: "8px 0 0" }}>
          The value goes straight to mina-desktop. It is never shown in the app
          or in a conversation.
        </p>
        <div className={s.btnRow} style={{ marginTop: 12 }}>
          <Btn block icon={X}>
            Cancel the request
          </Btn>
          <Btn block variant="primary" icon={Check}>
            Save
          </Btn>
        </div>
      </div>
      <Keyboard />
    </Phone>
  );
}

// A provider sign-in that ends in any browser (device code). Sign in starts it on the computer; the card then shows the
// code to copy and opens the page. The computer waits for the provider, so the card only follows.
function SignInAsk() {
  return (
    <Phone>
      <Head title="Compare the Grok answers" />
      <div className={s.thread}>
        <div className={s.turn}>
          <Who />
          <p className={s.p}>
            To run the comparison I need Grok. You have SuperGrok, so sign in
            and I will use it.
          </p>
        </div>
        <Working tone="warning">Waiting for you</Working>
      </div>
      <div className={s.ask}>
        <div className={s.askTitle}>
          <Ic icon={LogIn} size={17} />
          lophn asks you to sign in to xAI
        </div>
        <div className={s.fact}>
          <div className={s.factLabel}>Sign in at</div>
          <div className={s.pre}>https://accounts.x.ai</div>
        </div>
        <div className={s.fact}>
          <div className={s.factLabel}>Code</div>
          <div className={s.between}>
            <span
              className={s.mono}
              style={{ fontSize: 22, lineHeight: "30px", letterSpacing: 2 }}
            >
              WDJB-MJHT
            </span>
            <Btn size="sm" icon={Copy}>
              Copy
            </Btn>
          </div>
        </div>
        <div className={s.working} style={{ marginTop: 10 }}>
          <Dot tone="working" />
          Enter the code on the page, then come back.
        </div>
        <div className={s.btnRow} style={{ marginTop: 12 }}>
          <Btn block icon={X}>
            Cancel the request
          </Btn>
          <Btn block variant="primary" icon={ExternalLink}>
            Open the page
          </Btn>
        </div>
      </div>
      <Composer placeholder="Reply…" chips={MODEL} />
    </Phone>
  );
}

function Fresh({ over }: { over?: ReactNode }) {
  return (
    <Phone over={over}>
      <TopBar title="New session" />
      <div className={s.center}>
        <Face who="lophn" size={60} />
        <h1
          className={s.hero}
          style={{ marginTop: 14, fontSize: 22, lineHeight: "30px" }}
        >
          What should lophn work on?
        </h1>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <span className={s.pill} style={{ height: 36 }}>
            <Ic icon={FolderOpen} size={16} />
            phroner
            <Ic icon={ChevronDown} size={14} />
          </span>
          <span className={s.pill} style={{ height: 36 }}>
            <Face who="lophn" size={18} />
            lophn
            <Ic icon={ChevronDown} size={14} />
          </span>
        </div>
      </div>
      <Composer
        placeholder="Describe a task or ask a question…"
        chips={MODEL}
      />
      {over === undefined && <Keyboard />}
    </Phone>
  );
}

function Agents() {
  return (
    <Sheet title="Who works on it">
      <Label>Agents</Label>
      <Row
        lead={<Face who="lophn" size={30} />}
        title="lophn"
        strong
        sub="Built-in · plans and hands work on"
        end={<Ic icon={Check} />}
      />
      <Row
        lead={<Face who="Eval analyst" size={30} />}
        title="Eval analyst"
        strong
        sub="Every workspace"
      />
      <Row
        lead={<Face who="Experiment planner" size={30} />}
        title="Experiment planner"
        strong
        sub="Only in phroner"
      />
      <Label>Coding agents on mina-desktop</Label>
      <Row
        lead={<Face who="Claude Code" size={30} />}
        title="Claude Code"
        strong
      />
      <Row lead={<Face who="Codex" size={30} />} title="Codex" strong />
    </Sheet>
  );
}

export function SessionFlow() {
  return (
    <Flow
      title="4 · Session"
      note="agent와 일하는 화면. desktop의 대화와 같은 것을 같은 모양으로 보인다: 내 말은 오른쪽 말풍선, agent의 답은 왼쪽 글, 한 일은 한 줄로 접힌다. 나를 기다리는 것(승인, 질문)은 입력 칸 바로 위에 붙어 손이 닿는 곳에서 답한다. 입력 칸 문구는 상태를 따른다(Reply…, Queue a message…)."
    >
      <Shot
        title="Answer"
        text="위쪽: sidebar 단추, 큰 글로 session 이름과 그 아래 작은 회색 글로 agent · project, ⋯. 한 일은 접힌 줄이고 누르면 펼친다. 고친 file은 card로, 누르면 diff다. 입력 칸 아래 줄에 첨부(+)와 model이 있다."
      >
        <Done />
      </Shot>
      <Shot
        title="Working"
        text="일하는 동안 보낸 말은 지금 turn에 끼어들거나(Steer) 다음 차례로 줄 선다. 보내기 단추는 멈춤이 된다. 글은 오는 대로 보인다."
      >
        <Running />
      </Shot>
      <Shot
        title="Approval"
        text="agent가 멈추고 묻는다. 무엇을 하려는지 그대로 보이고, 가장 흔한 답(Allow once)이 가장 크고 엄지에 가깝다."
      >
        <Approval />
      </Shot>
      <Shot
        title="Deny with a reason"
        text="Deny를 누르면 이유 한 줄을 묻는다(비워도 된다). agent는 거절과 함께 이 글을 받는다. Inbox와 Home의 Deny도 같은 sheet다."
      >
        <Approval over={<DenyReason />} />
      </Shot>
      <Shot
        title="Question"
        text="한 번에 하나씩 묻는다. 고르거나 직접 쓴다. 질문에 답하는 대신 그냥 말을 보내도 된다."
      >
        <Question />
      </Shot>
      <Shot
        title="What it did"
        text="접힌 줄을 누르면 아래에서 올라온다. 읽은 file, 찾은 것, 돌린 명령과 그 출력."
      >
        <Done over={<Steps />} />
      </Shot>
      <Shot
        title="Diff"
        text="고친 file의 card를 누르면. 오른쪽 위 단추는 이 file을 컴퓨터에서 연다."
      >
        <Diff />
      </Shot>
      <Shot
        title="Add to the message"
        text="+. 최근 사진, 사진첩, camera, file. 그리고 workspace의 file을 가리키거나 명령과 skill을 고른다."
      >
        <Done over={<Attach />} />
      </Shot>
      <Shot
        title="Typed command"
        text="입력 칸에 /를 치면 맞는 명령이 입력 칸 위에 선다. desktop과 같은 규칙: /rename 새 이름은 바로 이름을 바꾸고, model·context 같은 것은 그 sheet를 연다. 폰에서 못 하는 명령(fork, rewind)은 컴퓨터에서 하라고 말하고 메시지로 보내지 않는다."
      >
        <TypedCommand />
      </Shot>
      <Shot
        title="Model"
        text="입력 칸의 model 이름. provider마다 묶인 model과 effort. model을 더하고 빼는 관리는 컴퓨터에서 한다."
      >
        <Done over={<Models />} />
      </Shot>
      <Shot
        title="Session menu"
        text="⋯. 이름, 권한 방식, context가 얼마나 찼는지, 컴퓨터 화면에 이 session 띄우기, 보관."
      >
        <Done over={<SessionMenu />} />
      </Shot>
      <Shot
        title="A coding agent"
        text="컴퓨터의 Claude Code나 Codex도 같은 화면이다. 아이콘만 다르다. 할 일 목록은 입력 칸 위에 접혀 있다."
      >
        <Coding />
      </Shot>
      <Shot
        title="A subagent"
        text="subagent 줄을 누르면 그 대화가 읽기로 올라온다."
      >
        <Coding over={<Subagent />} />
      </Shot>
      <Shot
        title="A secret"
        text="agent가 secret을 청하면 card 안 입력 칸에 바로 친다. 친 글은 가려지고, Save가 값을 컴퓨터로 보내고 칸을 비운다. 값이 들어가면 card가 사라지고 agent가 이어 간다."
      >
        <SecretAsk />
      </Shot>
      <Shot
        title="Sign in with a code"
        text="SuperGrok처럼 code로 끝나는 로그인은 폰에서 한다. Sign in을 누르면 code가 나오고, code를 복사해 Open the page로 연 곳에 넣는다. 로그인이 끝나면 card가 사라지고 agent가 이어 간다."
      >
        <SignInAsk />
      </Shot>
      <Shot
        title="When the phone cannot do it"
        text="provider 오류는 한 줄과 Retry. site login, 컴퓨터의 browser로 돌아와야 하는 로그인(ChatGPT, Claude, Antigravity), 앱과 MCP server의 로그인은 무엇이 필요한지 보이고 컴퓨터에서 하라고 말한다."
      >
        <Stuck />
      </Shot>
      <Shot
        title="New session"
        text="Home 아래의 입력 칸에 바로 쓰거나, sidebar의 workspace에서 +. 어느 workspace에서 누가 일할지 고르고 말한다."
      >
        <Fresh />
      </Shot>
      <Shot
        title="Who works on it"
        text="lophn agent와 컴퓨터의 coding agent. 그 workspace에서 일할 수 있는 agent만 나온다."
      >
        <Fresh over={<Agents />} />
      </Shot>
    </Flow>
  );
}
