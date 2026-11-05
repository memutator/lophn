// harness-gui 창: `claude gui`가 여는 창 하나. 실제 창 컴포넌트(HarnessGuiWindow)를 main 대신 fake 통로로 그린다.
// fake 통로는 adapter가 낼 ACP 갱신을 붙을 때 한꺼번에 보내고, 보낸 말은 사람 메시지로 되돌려 준다.
import type { AcpUpdate } from "../../../../packages/protocol/acp/mod.ts";
import type { HarnessGuiApi } from "../../../../packages/shell/ipc/harness-gui.ts";
import { HarnessGuiWindow } from "../../../../packages/shell/renderer/harness-gui/harness-gui-window.tsx";
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

function fakeApi(): HarnessGuiApi {
  let push: (update: AcpUpdate) => void = () => {};
  let seq = 5;
  return {
    async connect(onUpdate) {
      push = onUpdate;
      for (const update of SCRIPT) onUpdate(update);
      return {
        harness: "claude",
        cwd: "/home/phroner/projects/upload-service",
      };
    },
    async input(input) {
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
  };
}

export const harnessGuiArea: Area = {
  id: "harness-gui",
  title: "Harness GUI",
  summary:
    "`claude gui`가 CLI 화면 대신 여는 lophn 창. CLI session 하나만 그린다.",
  pages: [
    {
      id: "new-harness-gui-window",
      title: "Harness GUI · window",
      description:
        "`claude gui`가 여는 창이다. lophn 채팅 화면을 그대로 쓰되 session이 CLI 자신의 것이라 session 목록, 이름 바꾸기·보관·fork, model·권한 단추, `/` 명령, 메시지의 Rewind·Fork가 없다. 머리에는 harness와 친 폴더만 보인다. 끝난 tool 줄 둘, 도는 tool 하나, 그 명령의 승인 카드(Deny, Always allow, Allow once), 흘러나오는 글이 한 번에 보이고, 보낸 말은 사람 메시지로 돌아온다.",
      render: () => <HarnessGuiWindow api={fakeApi()} />,
    },
  ],
};
