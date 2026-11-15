// Flow 10. The computer's coding agents on the phone: the list, the chat, switching a terminal session to chat,
// starting one, and the terminal itself.
import {
  ArrowUp,
  Check,
  ChevronRight,
  Ellipsis,
  FilePen,
  FolderOpen,
  KeyboardOff,
  MessageSquare,
  Monitor,
  Play,
  Plus,
  RefreshCw,
  SquareTerminal,
  TriangleAlert,
  X,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import c from "./coding.module.css";
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

function Sessions({ down }: { down?: boolean }) {
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
        {down ? (
          <div className={s.pad} style={{ paddingBottom: 6 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <Ic icon={Monitor} size={22} className={s.muted} />
              <div>
                <div style={{ fontSize: 16, lineHeight: "22px" }}>
                  lophn is not running on mina-desktop
                </div>
                <div className={s.note} style={{ marginTop: 2 }}>
                  Coding agents run in the desktop app. Starting it opens a
                  window there.
                </div>
              </div>
            </div>
            <div className={s.btnRow} data-end="" style={{ marginTop: 12 }}>
              <Btn size="sm" variant="primary" icon={Play}>
                Start lophn on the computer
              </Btn>
            </div>
          </div>
        ) : (
          <>
            <Row
              lead={<Face who="Claude Code" />}
              title="Fix flaky retry in the scenario runner"
              sub="Working · 2m"
              end={<Dot tone="good" />}
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
              end={<Dot tone="good" />}
            />
          </>
        )}
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

// ── a coding session in a terminal ───────────────────

function InTerminal({
  state = "working",
  blocked,
  over,
}: {
  state?: "working" | "idle";
  blocked?: boolean;
  over?: ReactNode;
}) {
  const working = state === "working";
  return (
    <Phone over={over}>
      <Head who="Codex" title="Split the eval board loader" />
      <div className={s.center}>
        <Face who="Codex" size={56} />
        <h1
          className={s.hero}
          style={{ marginTop: 14, fontSize: 20, lineHeight: "28px" }}
        >
          Codex is running in a terminal
        </h1>
        <div
          className={s.working}
          style={{ marginTop: 6, justifyContent: "center" }}
        >
          <Dot tone={working ? "good" : "off"} />
          {working ? "Working · 4m" : "Idle · since 6:12 PM"}
        </div>
        <div style={{ marginTop: 18 }}>
          <Btn icon={SquareTerminal}>View terminal</Btn>
        </div>
      </div>
      {blocked ? (
        <Instead
          text="Codex hasn’t reported its session yet. Send it a message in the terminal first, then switch."
          action={
            <Btn disabled icon={MessageSquare}>
              Switch to chat
            </Btn>
          }
        />
      ) : (
        <Instead
          text="This chat is open in a terminal on the computer. Switch to chat to reply here."
          action={
            <Btn variant="primary" icon={MessageSquare}>
              Switch to chat
            </Btn>
          }
        />
      )}
    </Phone>
  );
}

function SwitchSheet({ running }: { running?: boolean }) {
  return (
    <Sheet title="Switch Codex to chat?">
      <div className={s.pad}>
        <p className={s.p} style={{ color: "var(--color-text-secondary)" }}>
          {running
            ? "The running turn will be interrupted, 2 background tasks stop, and the terminal tab on mina-desktop becomes the chat view."
            : "Codex keeps the same conversation, and the terminal tab on mina-desktop becomes the chat view."}
        </p>
        <div className={s.btnRow} style={{ marginTop: 20 }}>
          <Btn block>Cancel</Btn>
          <Btn block variant="primary" icon={RefreshCw}>
            Switch
          </Btn>
        </div>
      </div>
    </Sheet>
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
          Starts in a new terminal tab on the computer
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

// ── the terminal ─────────────────────────────────────

type Ansi =
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "bright-black";
type Run = [text: string, fg?: Ansi | "", flags?: "b" | "d" | "bd" | "cur"];

// One Codex screen, 80 columns, the way the terminal host would hand it over: rows of styled runs.
const SCREEN: Run[][] = [
  [
    [">_ ", "", "d"],
    ["OpenAI Codex", "", "b"],
    [" (v0.58.0)", "", "d"],
  ],
  [],
  [
    ["model:     ", "", "d"],
    ["gpt-5.1-codex high", ""],
    ["   ", ""],
    ["/model", "cyan"],
    [" to change", "", "d"],
  ],
  [
    ["directory: ", "", "d"],
    ["~/phroner", ""],
  ],
  [],
  [
    ["› ", "", "b"],
    ["Split the eval board loader so each board loads on its own.", ""],
  ],
  [],
  [
    ["• ", "bright-black"],
    ["Explored", "", "b"],
  ],
  [
    ["  └ ", "bright-black"],
    ["Read ", "cyan"],
    ["loader.ts, board.ts, cache.ts", ""],
  ],
  [
    ["    ", ""],
    ["Search ", "cyan"],
    ["loadBoard", ""],
    [" in src/eval", "", "d"],
  ],
  [],
  [
    ["• ", "bright-black"],
    ["The loader reads every board in one pass, so one slow board holds", ""],
  ],
  [
    [
      "  up the rest. I'll give each board its own load and keep the cache.",
      "",
    ],
  ],
  [],
  [
    ["• ", "green"],
    ["Edited ", "", "b"],
    ["src/eval/loader.ts ", ""],
    ["(", "", "d"],
    ["+42", "green"],
    [" ", ""],
    ["-18", "red"],
    [")", "", "d"],
  ],
  [
    ["    18 ", "bright-black"],
    ["-export async function loadAll(boards: Board[]) {", "red"],
  ],
  [
    ["    18 ", "bright-black"],
    ["+export async function loadBoard(board: Board) {", "green"],
  ],
  [
    ["    19 ", "bright-black"],
    ["+  const cached = cache.get(board.id);", "green"],
  ],
  [
    ["    20 ", "bright-black"],
    ["+  if (cached !== undefined) return cached;", "green"],
  ],
  [],
  [
    ["• ", "green"],
    ["Ran ", "", "b"],
    ["npm test -- eval", ""],
  ],
  [
    ["  └ ", "bright-black"],
    ["48 passed", "green"],
    [", 0 failed (3.1s)", "", "d"],
  ],
  [],
  [
    ["◦ ", "", "b"],
    ["Working", "", "b"],
    [" (4m 12s • esc to interrupt)", "", "d"],
  ],
  [],
  [
    ["▌ ", "cyan"],
    [" ", "", "cur"],
    ["Ask Codex to do anything", "", "d"],
  ],
  [],
  [
    [
      "  ⏎ send   ⌃J newline   ⌃T transcript   ⌃C quit        81% context left",
      "",
      "d",
    ],
  ],
];

function runStyle(fg: Run[1], flags: Run[2]): CSSProperties {
  return {
    color: fg ? `var(--terminal-${fg})` : undefined,
    fontWeight: flags?.includes("b") ? 700 : undefined,
    opacity: flags?.includes("d") ? 0.55 : undefined,
  };
}

function Screen({ fit }: { fit?: boolean }) {
  return (
    <div className={c.term} data-fit={fit || undefined}>
      {SCREEN.map((line, y) => (
        <div key={y}>
          {line.length === 0
            ? " "
            : line.map(([text, fg, flags], x) => (
                <span
                  key={x}
                  className={flags === "cur" ? c.cursor : undefined}
                  style={runStyle(fg, flags)}
                >
                  {text}
                </span>
              ))}
        </div>
      ))}
      {!fit && <span className={c.hScroll} />}
    </div>
  );
}

function Fit({ on }: { on: number }) {
  return (
    <div style={{ flex: "none", padding: "6px 12px 4px", width: 200 }}>
      <Seg items={["Fit width", "100%"]} on={on} />
    </div>
  );
}

const KEYS = ["Esc", "Tab", "Ctrl-C", "↑", "↓", "←", "→", "Enter"];

function Term({ typing }: { typing?: boolean }) {
  return (
    <Phone>
      <TopBar
        left="back"
        lead={<Face who="Codex" size={26} />}
        title="Codex"
        sub="Split the eval board loader"
        right={
          typing ? undefined : (
            <span className={s.tag} style={{ marginRight: 14 }}>
              View only
            </span>
          )
        }
      />
      {typing ? (
        <>
          <Screen fit />
          <Fit on={0} />
          <div className={s.dock} style={{ paddingBottom: 0 }}>
            <div
              className={s.field}
              data-focus=""
              style={{ minHeight: 44, paddingRight: 6 }}
            >
              <span className={s.grow}>
                Also keep the old loadAll as a wrapper
                <span className={s.caret} />
              </span>
              <span className={s.send}>
                <ArrowUp size={20} strokeWidth={2} />
              </span>
            </div>
          </div>
          <div className={c.keys}>
            {KEYS.map((key) => (
              <span key={key} className={c.key}>
                {key}
              </span>
            ))}
          </div>
          <Keyboard />
        </>
      ) : (
        <>
          <Screen />
          <Fit on={1} />
          <div
            className={s.note}
            style={{
              display: "flex",
              gap: 8,
              alignItems: "flex-start",
              padding: "6px 20px 10px",
            }}
          >
            <Ic icon={KeyboardOff} size={16} style={{ marginTop: 1 }} />
            Typing is off for this phone. Turn it on in Settings › Remote on the
            computer.
          </div>
        </>
      )}
    </Phone>
  );
}

export function CodingFlow() {
  return (
    <Flow
      title="10 · Coding agents and terminal"
      note="컴퓨터의 lophn 앱에서 도는 Claude Code, Codex, OpenCode, omp. 채팅 화면으로 도는 session은 lophn agent와 같은 대화와 card로 다루고, 터미널로 도는 session은 사람이 확인한 뒤 채팅으로 바꾸거나 터미널 그대로 본다. 폰은 터미널 크기를 바꾸지 않는다."
    >
      <Shot
        title="Coding agents in the project"
        text="Sessions 탭 맨 위에 컴퓨터에서 지금 도는 coding session이 묶인다. 채팅으로 도는 것은 상태만, 터미널로 도는 것은 작은 Terminal 표시가 붙는다. 끝난 coding session은 Recent에 남는다."
      >
        <Sessions />
      </Shot>
      <Shot
        title="lophn is not running on the computer"
        text="desktop 앱이 꺼져 있으면 묶음 자리에 한 줄과 단추. 누르면 컴퓨터에서 앱이 창과 함께 뜬다. 저절로 깨우지 않는다. 앱이 막 떴을 때는 도는 터미널이 없어서 목록이 비어 있다."
      >
        <Sessions down />
      </Shot>
      <Shot
        title="Approval from a coding agent"
        text="flow 4의 coding agent 화면과 같다. 승인 card도 lophn agent의 것과 같은 모양이고 이름만 coding agent다. 폰에서는 이미지를 붙이지 않아 입력 칸에 +가 없다."
      >
        <Approve />
      </Shot>
      <Shot
        title="A session running in a terminal"
        text="터미널로 도는 동안 대화는 폰에 오지 않는다. 입력 칸 자리에 한 줄과 Switch to chat. 터미널 화면을 그대로 볼 수도 있다."
      >
        <InTerminal />
      </Shot>
      <Shot
        title="Switch to chat, nothing running"
        text="늘 먼저 묻는다. 대화는 이어지고, 컴퓨터의 터미널 탭이 채팅 화면으로 바뀐다는 것을 말한다. Switch는 주 단추(되돌릴 수 없는 삭제가 아니라 빨강이 아니다)."
      >
        <InTerminal state="idle" over={<SwitchSheet />} />
      </Shot>
      <Shot
        title="Switch to chat while it works"
        text="도는 turn이 있으면 그 turn이 끊기고 background task가 멈추고 컴퓨터 탭도 바뀐다는 것을 한 문장으로 말한다. 끊을지는 사람이 고른다."
      >
        <InTerminal over={<SwitchSheet running />} />
      </Shot>
      <Shot
        title="When it cannot switch"
        text="단추가 꺼지고 이유가 한 줄로 보인다. 그 밖의 이유: “The coding agents extension is off on mina-desktop.”, “Switching to chat doesn’t work on Windows yet.”, “No coding agent is running in this terminal now.”"
      >
        <InTerminal blocked />
      </Shot>
      <Shot
        title="A new coding session"
        text="새 session의 Who works on it에 컴퓨터의 coding agent 넷이 묶여 있다. 앱이 꺼져 있으면 이 묶음 자리에도 Start lophn on the computer가 온다."
      >
        <NewCoding over={<Pick />} />
      </Shot>
      <Shot
        title="The first message"
        text="고르면 컴퓨터에 새 터미널 탭이 열리고 채팅으로 시작한다고 입력 칸 위에 알린다. 보내면 flow 4의 대화 화면으로 간다."
      >
        <NewCoding />
      </Shot>
      <Shot
        title="Continue an ended session"
        text="끝난 coding session은 읽기만 된다. Continue as chat을 누르면 컴퓨터에서 같은 CLI session을 되살려 채팅으로 이어 간다."
      >
        <Ended />
      </Shot>
      <Shot
        title="The terminal, view only"
        text="View terminal을 누르면. 컴퓨터 터미널의 글과 색 그대로이고 바탕은 화면과 같다. 100%는 글자 크기를 두고 가로로 민다. 이 폰에 입력이 허락되지 않았으면 아래에 그 한 줄."
      >
        <Term />
      </Shot>
      <Shot
        title="The terminal, typing on"
        text="컴퓨터에서 이 폰의 입력을 켜 두었으면. 글 칸의 보내기는 글만 치고, key 줄로 Esc, Tab, Ctrl-C, 화살표, Enter를 따로 보낸다. Fit width는 줄 전체를 폭에 맞춰 글자를 줄인다."
      >
        <Term typing />
      </Shot>
    </Flow>
  );
}
