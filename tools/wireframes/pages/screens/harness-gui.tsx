// harness-gui: 터미널 탭에서 `claude gui`를 치면 그 탭이 바뀌는 채팅 화면. 실제 탭 화면(TerminalGui)을 main 대신 fake 통로로
// 그린다. fake 통로는 adapter가 낼 ACP 갱신을 붙을 때 한꺼번에 보내고, 보낸 말은 사람 메시지로 되돌려 준다. card 머리는
// 이 page가 한 줄로 흉내 낸다(실제 앱은 ContentCard가 머리에 올린다).
import { type ReactNode, useState } from "react";

import type { AcpUpdate } from "../../../../packages/protocol/acp/mod.ts";
import type { HarnessGuiTabApi } from "../../../../packages/shell/ipc/harness-gui.ts";
import {
  CardHeadContext,
  type CardHeadSpec,
} from "../../../../packages/shell/renderer/shell/card-head.tsx";
import { TerminalGui } from "../../../../packages/shell/renderer/terminal/terminal-gui.tsx";
import { click, runSteps, type Step, useDrive } from "../../mock/drive.ts";
import type { Area } from "../types.ts";

const TURN = "trn-1";
const at = (second: number) =>
  `2026-11-05T09:00:${String(second).padStart(2, "0")}.000Z`;
const text = (value: string) => [{ type: "text" as const, text: value }];

const message = (
  id: string,
  seq: number,
  second: number,
  actor: "user" | "agent",
  value: string,
): AcpUpdate => ({
  type: "message_added",
  item: {
    kind: "message",
    id,
    seq,
    at: at(second),
    actor,
    sender: null,
    call: null,
    reply_to: null,
    delivery: "next_turn",
    turn: actor === "agent" ? TURN : null,
    content: text(value),
    reasoning: null,
    cards: [],
    complete: true,
  },
});

const tool = (
  id: string,
  seq: number,
  second: number,
  name: string,
  category: "read" | "command" | "other",
  title: string,
): AcpUpdate => ({
  type: "tool_started",
  item: {
    kind: "tool",
    id,
    seq,
    at: at(second),
    turn: TURN,
    tool: name,
    category,
    title,
    state: "running",
    duration_ms: null,
    detail: { kind: "generic" },
  },
});

const done = (id: string, second: number): AcpUpdate => ({
  type: "tool_ended",
  tool_call: id,
  state: "ok",
  at: at(second),
  detail: null,
});

const STREAMING = [
  "Waiting on the test run. ",
  "The retry wrapper backs off 200 ms, then 400 ms, and gives up after three tries, ",
  "so a flaky network no longer fails the whole upload",
];

// 일하는 중인 turn: 끝난 tool 둘, 도는 tool 하나, 그 명령의 승인 카드, 흘러나오는 글.
const SCRIPT: readonly AcpUpdate[] = [
  message(
    "msg-1",
    1,
    0,
    "user",
    "Add a retry to the upload helper and run its tests.",
  ),
  { type: "turn_started", turn: TURN, at: at(1) },
  message(
    "msg-2",
    2,
    2,
    "agent",
    "I'll read the helper first, then wrap the request in a retry.",
  ),
  tool("tcl-1", 3, 3, "Read", "read", "Read src/upload.ts"),
  done("tcl-1", 4),
  tool("tcl-2", 4, 5, "Edit", "other", "Edit src/upload.ts"),
  done("tcl-2", 6),
  tool("tcl-3", 5, 7, "Bash", "command", "Run npm test -- upload"),
  {
    type: "approval_opened",
    approval: {
      id: "apr-1",
      choices: ["once", "session", "reject"],
      subject: { kind: "shell", command: "npm test -- upload" },
      always_patterns: ["npm test *"],
    },
  },
  ...STREAMING.map(
    (chunk, index): AcpUpdate => ({
      type: "writing_streamed",
      turn: TURN,
      model_call: "mcl-1",
      kind: "text",
      offset: STREAMING.slice(0, index).join("").length,
      text: chunk,
      at: at(8),
    }),
  ),
];

const CWD = "/home/phroner/projects/upload-service";

function fakeApi(): HarnessGuiTabApi {
  let push: (update: AcpUpdate) => void = () => {};
  let seq = 5;
  return {
    onOpened: () => () => {},
    ackOpened: async () => {},
    onView: () => () => {},
    async connect(_handle, onUpdate) {
      push = onUpdate;
      for (const update of SCRIPT) onUpdate(update);
      return { harness: "claude", cwd: CWD };
    },
    disconnect: async () => {},
    async input(_handle, input) {
      if (input.type === "send") {
        seq += 1;
        push({
          type: "message_added",
          item: {
            kind: "message",
            id: input.id,
            seq,
            at: at(30),
            actor: "user",
            sender: null,
            call: null,
            reply_to: null,
            delivery: input.delivery,
            turn: null,
            content: input.content,
            reasoning: null,
            cards: [],
            complete: true,
          },
        });
      }
      return true;
    },
    running: async () => ({ turn: true, tasks: 2 }),
    toggle: async () => ({ ok: true }),
    uploadImage: async () => null,
  };
}

// 실제 앱에서 card 머리는 본문이 올린 actions를 오른쪽에 그린다. 그 한 줄만 흉내 낸다.
function Card({ children }: { children: ReactNode }) {
  const [head, setHead] = useState<CardHeadSpec | null>(null);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        background: "var(--color-surface-base)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: "var(--space-2)",
          padding: "var(--space-2) var(--space-3)",
        }}
      >
        {head?.center}
        {head?.actions}
      </div>
      <div style={{ position: "relative", flex: 1, display: "flex" }}>
        <CardHeadContext.Provider value={setHead}>
          {children}
        </CardHeadContext.Provider>
      </div>
    </div>
  );
}

function TerminalTabGui({ steps = [] }: { steps?: readonly Step[] }) {
  useDrive(() => runSteps(steps));
  return (
    <Card>
      <TerminalGui
        api={fakeApi()}
        gui={{ handle: "win_gallery", harness: "claude", handoff: "restart" }}
        terminalRef="trm_gallery"
      />
    </Card>
  );
}

export const harnessGuiArea: Area = {
  id: "harness-gui",
  title: "Harness GUI",
  summary:
    "터미널 탭에서 `claude gui`를 치면 그 탭이 바뀌는 채팅 화면. CLI session 하나를 그리고, card 머리의 단추로 터미널과 오간다.",
  pages: [
    {
      id: "harness-gui-terminal-tab",
      title: "Harness GUI · terminal tab",
      description:
        "`claude gui`를 친 터미널 탭이 바뀐 모습이다. lophn 채팅 화면을 그대로 쓰고 session은 CLI 자신의 것이다. 끝난 tool 줄 둘, 도는 tool 하나, 그 명령의 승인 카드(Deny, Always allow, Allow once), 흘러나오는 글이 한 번에 보이고, 보낸 말은 사람 메시지로 돌아온다. card 머리 오른쪽의 Terminal 단추가 같은 대화를 CLI의 화면으로 돌려 보낸다.",
      render: () => <TerminalTabGui />,
    },
    {
      id: "harness-gui-restart-modal",
      title: "Harness GUI · restart modal",
      description:
        "Claude와 omp는 process를 한 번 끄고 같은 session으로 다른 쪽을 띄우므로 Terminal 단추를 누르면 먼저 묻는다. 도는 turn이 있으면 멈춘다고 한 줄 더 알린다. Codex와 OpenCode는 같은 server에 붙어 있어 묻지 않고 화면만 바꾼다.",
      render: () => (
        <TerminalTabGui steps={[() => click("[data-gui-toggle]")]} />
      ),
    },
  ],
};
