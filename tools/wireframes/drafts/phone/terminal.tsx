// Flow 12. A terminal on the computer, seen and typed into from the phone: the phone sizes it to its own screen (the
// last device that claimed wins; the computer's tab takes its size back when it gets focus or the phone leaves). A
// coding session that runs in a terminal opens here directly, and its menu switches it to chat.
import {
  ArrowUp,
  ClipboardPaste,
  Ellipsis,
  KeyboardOff,
  MessageSquare,
  Minimize2,
  RefreshCw,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import c from "./coding.module.css";
import {
  Btn,
  Face,
  Flow,
  Ic,
  IconBtn,
  Keyboard,
  Phone,
  Row,
  Sheet,
  Shot,
  s,
  TopBar,
} from "./kit.tsx";

type Ansi = "red" | "green" | "cyan" | "bright-black";
type Run = [text: string, fg?: Ansi | "", flags?: "b" | "d" | "cur"];

// Codex redrawn at the phone's 44 columns.
const NARROW: Run[][] = [
  [
    [">_ ", "", "d"],
    ["OpenAI Codex", "", "b"],
    [" (v0.58.0)", "", "d"],
  ],
  [],
  [
    ["› ", "cyan"],
    ["Split loadAll into one loader per", ""],
  ],
  [["  board and keep the cache.", ""]],
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
    ["  18 ", "bright-black"],
    ["-export async function loadAll(", "red"],
  ],
  [
    ["  18 ", "bright-black"],
    ["+export async function loadBoard(", "green"],
  ],
  [
    ["  19 ", "bright-black"],
    ["+  const cached = cache.get(id);", "green"],
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
  [["  ⏎ send  ⌃J newline  81% context left", "", "d"]],
];

// The same screen drawn at the computer's 96 columns after its tab took the size back.
const WIDE: Run[][] = [
  [
    [">_ ", "", "d"],
    ["OpenAI Codex", "", "b"],
    [" (v0.58.0)", "", "d"],
  ],
  [],
  [
    ["› ", "cyan"],
    [
      "Split loadAll into one loader per board and keep the cache for the boards that did not change.",
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
    [
      "-export async function loadAll(boards: Board[]): Promise<Loaded[]> {",
      "red",
    ],
  ],
  [
    ["    18 ", "bright-black"],
    [
      "+export async function loadBoard(board: Board): Promise<Loaded> {",
      "green",
    ],
  ],
  [],
  [
    ["◦ ", "", "b"],
    ["Working", "", "b"],
    [" (4m 40s • esc to interrupt)", "", "d"],
  ],
  [],
  [
    ["▌ ", "cyan"],
    [" ", "", "cur"],
    ["Ask Codex to do anything", "", "d"],
  ],
];

// A shell the phone opened in the project's folder.
const SHELL: Run[][] = [
  [
    ["mina@desk ", "green"],
    ["~/phroner ", "cyan"],
    ["$ ", ""],
    ["git status -s", ""],
  ],
  [
    [" M ", "red"],
    ["src/eval/loader.ts", ""],
  ],
  [
    ["?? ", "red"],
    ["src/eval/board-cache.ts", ""],
  ],
  [
    ["mina@desk ", "green"],
    ["~/phroner ", "cyan"],
    ["$ ", ""],
    ["npm test -- eval", ""],
  ],
  [["", ""]],
  [["> phroner@0.4.0 test", "", "d"]],
  [["> node --test src/eval", "", "d"]],
  [["", ""]],
  [
    ["✔ ", "green"],
    ["48 passed ", ""],
    ["(3.1s)", "", "d"],
  ],
  [
    ["mina@desk ", "green"],
    ["~/phroner ", "cyan"],
    ["$ ", ""],
    [" ", "", "cur"],
  ],
];

function runStyle(fg: Run[1], flags: Run[2]): CSSProperties {
  return {
    color: fg ? `var(--terminal-${fg})` : undefined,
    fontWeight: flags === "b" ? 700 : undefined,
    opacity: flags === "d" ? 0.55 : undefined,
  };
}

function Screen({ lines, wide }: { lines: Run[][]; wide?: boolean }) {
  return (
    <div className={c.term}>
      {lines.map((line, y) => (
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
      {wide && <span className={c.hScroll} />}
      {wide && (
        <span
          className={s.tag}
          style={{
            position: "absolute",
            top: 10,
            left: "50%",
            transform: "translateX(-50%)",
            gap: 6,
            height: 34,
            padding: "0 14px",
            borderRadius: 999,
            fontSize: 14,
            background: "var(--color-surface-base)",
            boxShadow: "var(--shadow-popover)",
          }}
        >
          <Ic icon={Minimize2} size={16} />
          Fit to phone
        </span>
      )}
    </div>
  );
}

// Two rows: Ctrl, Alt and Shift hold for the next key (from the bar or the keyboard), then let go.
const ROWS = [
  ["Esc", "Tab", "Ctrl", "Alt", "Shift", "Ctrl-C"],
  ["Paste", "←", "↑", "↓", "→", "Enter"],
];

function Keys({ armed }: { armed?: string }) {
  return (
    <>
      {ROWS.map((row, at) => (
        <div
          key={at}
          className={c.keys}
          style={at === 0 ? { paddingBottom: 0 } : undefined}
        >
          {row.map((key) => (
            <span
              key={key}
              className={c.key}
              style={
                key === armed
                  ? {
                      background: "var(--color-ink-background)",
                      color: "var(--color-ink-text)",
                      borderColor: "var(--color-ink-background)",
                    }
                  : undefined
              }
            >
              {key === "Paste" ? <Ic icon={ClipboardPaste} size={16} /> : key}
            </span>
          ))}
        </div>
      ))}
    </>
  );
}

function Typing({ text }: { text?: string }) {
  return (
    <div className={s.dock} style={{ paddingBottom: 0 }}>
      <div
        className={s.field}
        data-focus=""
        style={{ minHeight: 44, paddingRight: 6 }}
      >
        <span className={s.grow}>
          {text}
          <span className={s.caret} />
        </span>
        <span className={s.send} data-off={text === undefined || undefined}>
          <ArrowUp size={20} strokeWidth={2} />
        </span>
      </div>
    </div>
  );
}

// The session's own place, so the sidebar's menu is on the left. Under the name: how it is doing and the project.
function CodexHead({ viewOnly }: { viewOnly?: boolean }) {
  return (
    <TopBar
      lead={<Face who="Codex" size={26} />}
      title="Split the eval board loader"
      under="Working · 4m · phroner"
      right={
        <span style={{ display: "inline-flex", alignItems: "center" }}>
          {viewOnly && (
            <span className={s.tag} style={{ marginRight: 4 }}>
              View only
            </span>
          )}
          <IconBtn icon={Ellipsis} />
        </span>
      }
    />
  );
}

function SessionMenu() {
  return (
    <Sheet title="Split the eval board loader">
      <Row lead={<Ic icon={MessageSquare} />} title="Switch to chat" />
    </Sheet>
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

function BlockedSheet() {
  return (
    <Sheet title="Switch Codex to chat?">
      <div className={s.pad}>
        <p className={s.p} style={{ color: "var(--color-text-secondary)" }}>
          Codex hasn’t reported its session yet. Send it a message in the
          terminal first, then switch.
        </p>
        <div className={s.btnRow} style={{ marginTop: 20 }}>
          <Btn block>Cancel</Btn>
          <Btn block disabled variant="primary" icon={RefreshCw}>
            Switch
          </Btn>
        </div>
      </div>
    </Sheet>
  );
}

function CodexTerminal({ over }: { over?: ReactNode }) {
  return (
    <Phone over={over}>
      <CodexHead />
      <Screen lines={NARROW.slice(5)} />
      <Typing />
      <Keys />
    </Phone>
  );
}

export function TerminalFlow() {
  return (
    <Flow
      title="12 · Terminal"
      note="컴퓨터의 터미널을 폰에서 보고 친다. 터미널로 도는 coding session을 열면 안내 화면 없이 이 화면이 열린다. 폰이 터미널 화면을 열면 자기 화면의 열과 줄 수로 PTY 크기를 잡아 TUI가 폰 폭으로 다시 그린다. 컴퓨터에서 그 탭에 focus가 오면 컴퓨터가 다시 잡는다(마지막에 잡은 쪽이 이긴다). 폰이 떠나면 컴퓨터의 탭이 자기 크기로 되돌린다. 확대와 Fit width는 없다."
    >
      <Shot
        title="Sized for this phone, view only"
        text="머리 줄은 session 이름이 큰 글이고 상태와 project가 아래 작은 글이다. 오른쪽 …은 session menu다. 글자는 늘 같은 크기이고 줄이 폰 폭에 맞는다. 입력은 pairing 때 기본으로 켜진다. 컴퓨터에서 이 폰의 입력을 꺼 두었으면 아래에 그 한 줄."
      >
        <Phone>
          <CodexHead viewOnly />
          <Screen lines={NARROW} />
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
        </Phone>
      </Shot>
      <Shot
        title="Typing on"
        text="화면을 누르면 크기를 다시 잡고 글 칸에 keyboard가 뜬다. 보내기는 글만 친다. Ctrl·Alt·Shift는 다음 key 하나(key 줄이나 keyboard의 글자)에만 걸리고 풀린다(여기는 Ctrl이 걸려 있다). Paste는 폰 clipboard의 글을 그대로 친다."
      >
        <Phone>
          <CodexHead />
          <Screen lines={NARROW.slice(5)} />
          <Typing />
          <Keys armed="Ctrl" />
          <Keyboard />
        </Phone>
      </Shot>
      <Shot
        title="The computer took the size back"
        text="사람이 컴퓨터의 그 탭을 누르면 컴퓨터 폭으로 다시 그려진다. 폰은 글자 크기를 두고 가로로 밀고, 위의 Fit to phone이나 화면을 누르면 다시 폰에 맞춘다."
      >
        <Phone>
          <CodexHead />
          <Screen lines={WIDE} wide />
          <Typing />
          <Keys />
        </Phone>
      </Shot>
      <Shot
        title="A terminal opened from the phone"
        text="새 session의 Who works on it에서 coding agent 묶음 끝의 Terminal을 고르면(flow 10) 컴퓨터의 그 project 창에 터미널 탭이 열리고(창이 없으면 focus 없이 하나 연다) 이 화면으로 온다. shell만 돌고, 입력 허락은 coding session의 터미널과 같다."
      >
        <Phone>
          <TopBar left="back" title="Terminal" under="phroner" />
          <Screen lines={SHELL} />
          <Typing text="ls src/eval" />
          <Keys />
        </Phone>
      </Shot>
      <Shot
        title="The session menu"
        text="터미널로 도는 coding session의 …에 Switch to chat이 있다. 고르면 바로 바꾸지 않고 먼저 묻는다."
      >
        <CodexTerminal over={<SessionMenu />} />
      </Shot>
      <Shot
        title="Switch to chat while it works"
        text="늘 먼저 묻는다. 대화는 이어지고 컴퓨터의 터미널 탭이 채팅 화면으로 바뀐다. 도는 turn이 있으면 그 turn이 끊기고 background task가 멈춘다는 것을 한 문장으로 말한다. Switch는 주 단추(되돌릴 수 없는 삭제가 아니라 빨강이 아니다). 바뀌면 이 자리가 flow 4의 대화 화면이 된다."
      >
        <CodexTerminal over={<SwitchSheet running />} />
      </Shot>
      <Shot
        title="Switch to chat, nothing running"
        text="도는 turn이 없으면 대화가 이어진다는 것과 컴퓨터 탭이 바뀐다는 것만 말한다."
      >
        <CodexTerminal over={<SwitchSheet />} />
      </Shot>
      <Shot
        title="When it cannot switch"
        text="Switch가 꺼지고 이유가 한 줄로 보인다. 그 밖의 이유: “The coding agents extension is off on mina-desktop.”, “Switching to chat doesn’t work on Windows yet.”, “No coding agent is running in this terminal now.”"
      >
        <CodexTerminal over={<BlockedSheet />} />
      </Shot>
    </Flow>
  );
}
