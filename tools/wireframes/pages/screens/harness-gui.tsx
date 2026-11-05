// harness-gui: 터미널 탭에서 `claude gui`를 치면 그 탭이 바뀌는 채팅 화면. 실제 탭 화면(TerminalGui)을 main 대신 fake 통로로
// 그린다. fake 통로는 adapter가 낼 ACP 갱신을 붙을 때 한꺼번에 보내고, 보낸 말은 사람 메시지로 되돌려 준다. card 머리는
// 이 page가 한 줄로 흉내 낸다(실제 앱은 ContentCard가 머리에 올린다).
import { type ReactNode, useMemo, useState } from "react";

import type {
  AcpChildUpdate,
  AcpToolBody,
  AcpToolDetail,
  AcpUpdate,
} from "../../../../packages/protocol/acp/mod.ts";
import type { HarnessGuiTabApi } from "../../../../packages/shell/ipc/harness-gui.ts";
import {
  CardHeadContext,
  type CardHeadSpec,
} from "../../../../packages/shell/renderer/shell/card-head.tsx";
import { TerminalGui } from "../../../../packages/shell/renderer/terminal/terminal-gui.tsx";
import { fakeHarnessMeta } from "../../../../packages/shell/renderer/conversation/agent-tab-fake-source.ts";
import {
  click,
  press,
  runSteps,
  type Step,
  type,
  useDrive,
} from "../../mock/drive.ts";
import type { Area } from "../types.ts";

const TURN = "trn-1";
const at = (second: number) =>
  `2026-11-05T09:00:${String(second).padStart(2, "0")}.000Z`;
const text = (value: string) => [{ type: "text" as const, text: value }];

// 화면이 "지금"으로 보는 시각. 도는 줄의 경과 시간이 gallery마다 같다.
const NOW = Date.parse("2026-11-05T09:02:00.000Z");

const message = (
  id: string,
  seq: number,
  second: number,
  actor: "user" | "agent",
  value: string,
  turn = TURN,
): AcpChildUpdate => ({
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
    turn: actor === "agent" ? turn : null,
    origin: null,
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
  category: "read" | "search" | "command" | "other",
  title: string,
  body: AcpToolBody | null = null,
  detail: AcpToolDetail = { kind: "generic" },
  turn = TURN,
): AcpChildUpdate => ({
  type: "tool_started",
  item: {
    kind: "tool",
    id,
    seq,
    at: at(second),
    turn,
    tool: name,
    category,
    title,
    state: "running",
    duration_ms: null,
    detail,
    body,
  },
});

const done = (
  id: string,
  second: number,
  body: AcpToolBody | null = null,
): AcpChildUpdate => ({
  type: "tool_ended",
  tool_call: id,
  state: "ok",
  at: at(second),
  detail: null,
  body,
});

// harness가 tool 줄에 싣는 입력·출력 글(JSON이면 그 글). 줄을 펼치면 따옴표 없이 그대로 보인다.
const READ_BODY: AcpToolBody = {
  input: '{"file_path":"src/upload.ts"}',
  output: [
    "export async function upload(file: Blob) {",
    '  const response = await fetch(UPLOAD_URL, { method: "POST", body: file });',
    '  if (!response.ok) throw new Error("upload failed");',
    "  return response.json();",
    "}",
  ].join("\n"),
  truncated: false,
};

const CONTEXT_OUTPUT = [
  "## Context usage",
  "",
  "`claude-sonnet-5-5` · 43k / 200k tokens (21%)",
  "",
  "| Category | Tokens | Share |",
  "| --- | ---: | ---: |",
  "| System prompt | 3.2k | 1.6% |",
  "| System tools | 11.8k | 5.9% |",
  "| MCP tools | 4.1k | 2.1% |",
  "| Memory files | 2.0k | 1.0% |",
  "| Messages | 21.9k | 10.9% |",
  "| Free space | 157k | 78.5% |",
].join("\n");

// composer 위 dock이 그리는 것: 계획(하나 취소), 도는 subagent 하나(자식 대화), 도는 shell task 하나, 줄 선 메시지.
// goal·toggle·role·사용 한도는 session 기능(`fakeHarnessMeta`)에 실린다.
const CHILD = "chd-1";
const CHILD_TURN = "trn-c1";
const child = (update: AcpChildUpdate): AcpUpdate => ({
  type: "child_update",
  child: CHILD,
  update,
});

const DOCK: readonly AcpUpdate[] = [
  {
    type: "plan_changed",
    entries: [
      { text: "Read src/upload.ts", status: "completed" },
      { text: "Wrap upload() in a retry", status: "completed" },
      { text: "Run npm test -- upload", status: "in_progress" },
      { text: "Add src/upload.test.ts", status: "pending" },
      { text: "Retry on 4xx too", status: "cancelled" },
    ],
  },
  tool("tcl-4", 8, 8, "Task", "other", "Find where upload() is called", null, {
    kind: "subagent",
    agent: "Explore",
    description: "Find where upload() is called",
    child: CHILD,
    state: "running",
    model: "Haiku 5.5",
    last: "Reading src/queue/worker.ts",
  }),
  child({ type: "turn_started", turn: CHILD_TURN, at: at(8) }),
  child(
    message(
      "msg-c1",
      1,
      8,
      "user",
      "Find where upload() is called.",
      CHILD_TURN,
    ),
  ),
  child(
    tool(
      "tcl-c1",
      2,
      8,
      "Grep",
      "search",
      "Search upload( in src",
      null,
      { kind: "generic" },
      CHILD_TURN,
    ),
  ),
  child(done("tcl-c1", 9)),
  child(
    message(
      "msg-c2",
      3,
      10,
      "agent",
      "`upload()` is called from `src/queue/worker.ts` and from the CLI entry. I am reading the worker to see how it handles a failed upload.",
      CHILD_TURN,
    ),
  ),
  {
    type: "tasks_changed",
    tasks: [
      {
        id: "tsk-1",
        kind: "shell",
        description: "npm run dev",
        state: "running",
        started_at: at(5),
        output: [
          "> upload-service@1.4.0 dev",
          "> node --watch src/server.ts",
          "",
          "listening on :3000",
          "GET /health 200 2ms",
          "POST /upload 500 41ms",
        ].join("\n"),
      },
    ],
  },
  {
    type: "message_queued",
    queued: {
      id: "msg-q1",
      at: at(9),
      content: text("Also add a test for the 4xx case."),
    },
  },
];

// 일하는 중인 turn: session 기능(명령 목록)과 끝난 tool 둘(본문이 있는 tool 하나), 명령 출력과 알림, 도는 tool 하나.
// 순번은 위에서 아래로 1부터 센다.
const BASE: readonly AcpUpdate[] = [
  { type: "session_changed", session: fakeHarnessMeta() },
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
  tool("tcl-1", 3, 3, "Read", "read", "Read src/upload.ts", READ_BODY),
  done("tcl-1", 4, READ_BODY),
  tool("tcl-2", 4, 5, "Edit", "other", "Edit src/upload.ts"),
  done("tcl-2", 6),
  {
    type: "notice_added",
    item: {
      kind: "notice",
      id: "ntc-1",
      seq: 5,
      at: at(6),
      turn: null,
      notice: {
        type: "command_output",
        command: "context",
        text: CONTEXT_OUTPUT,
        format: "markdown",
      },
    },
  },
  {
    type: "notice_added",
    item: {
      kind: "notice",
      id: "ntc-2",
      seq: 6,
      at: at(6),
      turn: null,
      notice: {
        type: "info",
        text: "You've used 82% of your 5-hour limit. It resets at 11:30.",
        level: "warning",
      },
    },
  },
  tool("tcl-3", 7, 7, "Bash", "command", "Run npm test -- upload"),
  ...DOCK,
];

// 승인 카드: 기본은 shell 명령이고 plan 승인 page는 Claude가 내는 plan 카드다.
const SHELL_APPROVAL: AcpUpdate = {
  type: "approval_opened",
  approval: {
    id: "apr-1",
    choices: ["once", "session", "reject"],
    subject: { kind: "shell", command: "npm test -- upload" },
    always_patterns: ["npm test *"],
  },
};

const PLAN_APPROVAL: AcpUpdate = {
  type: "approval_opened",
  approval: {
    id: "apr-1",
    choices: ["reject"],
    subject: {
      kind: "plan",
      plan: [
        "## Plan: retry the upload",
        "",
        "1. Wrap `upload()` in a retry with a 200 ms backoff that doubles each time.",
        "2. Give up after three tries and keep the original error.",
        "3. Do not retry a 4xx response: the request itself is wrong.",
        "4. Add `src/upload.test.ts` with three cases: first try, second try, gave up.",
        "5. Run `npm test -- upload`.",
        "",
        "### Files",
        "",
        "- `src/upload.ts` (edit)",
        "- `src/upload.test.ts` (new)",
        "",
        "### Risks",
        "",
        "- A flaky network now takes up to 600 ms longer before it fails.",
        "- The tests use a fake clock so they stay fast.",
        "",
        "Nothing outside `src/` changes.",
      ].join("\n"),
      modes: [
        { id: "acceptEdits", label: "Accept edits" },
        { id: "default", label: "Ask for edits" },
      ],
    },
    always_patterns: [],
  },
};

const STREAMING = [
  "Waiting on the test run. ",
  "The retry wrapper backs off 200 ms, then 400 ms, and gives up after three tries, ",
  "so a flaky network no longer fails the whole upload",
].map(
  (chunk, index, all): AcpUpdate => ({
    type: "writing_streamed",
    turn: TURN,
    model_call: "mcl-1",
    kind: "text",
    offset: all.slice(0, index).join("").length,
    text: chunk,
    at: at(8),
  }),
);

const CWD = "/home/phroner/projects/upload-service";

function fakeApi(
  approval: AcpUpdate | null,
  extra: readonly AcpUpdate[],
  harness: "claude" | "omp",
): HarnessGuiTabApi {
  let push: (update: AcpUpdate) => void = () => {};
  let seq = 8;
  return {
    onOpened: () => () => {},
    ackOpened: async () => {},
    onView: () => () => {},
    async connect(_handle, onUpdate) {
      push = onUpdate;
      for (const update of [
        ...BASE,
        ...(approval === null ? [] : [approval]),
        ...STREAMING,
        ...extra,
      ])
        onUpdate(update);
      return { harness, cwd: CWD };
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
            origin: null,
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
      <div
        style={{
          position: "relative",
          flex: 1,
          display: "flex",
          minHeight: 0,
        }}
      >
        <CardHeadContext.Provider value={setHead}>
          {children}
        </CardHeadContext.Provider>
      </div>
    </div>
  );
}

const NO_UPDATES: readonly AcpUpdate[] = [];

// role은 omp만 가진다. omp session 기능으로 바꿔 보낸다.
const OMP_META: readonly AcpUpdate[] = [
  { type: "session_changed", session: fakeHarnessMeta("omp") },
];

function TerminalTabGui({
  steps = [],
  approval = SHELL_APPROVAL,
  extra = NO_UPDATES,
  harness = "claude",
}: {
  steps?: readonly Step[];
  /** null이면 승인 카드 없이 dock과 composer만 보인다. */
  approval?: AcpUpdate | null;
  /** 갈무리 뒤에 더 보내는 갱신. */
  extra?: readonly AcpUpdate[];
  harness?: "claude" | "omp";
}) {
  useDrive(() => runSteps(steps));
  const api = useMemo(
    () => fakeApi(approval, extra, harness),
    [approval, extra, harness],
  );
  return (
    <Card>
      <TerminalGui
        api={api}
        gui={{ handle: "win_gallery", harness, handoff: "restart" }}
        terminalRef="trm_gallery"
        now={() => NOW}
      />
    </Card>
  );
}

// 숨겼다가 되살린 구간. 항목이 제자리로 돌아와 숨긴 구간 줄이 남지 않는다.
const REWOUND: readonly AcpUpdate[] = [
  {
    type: "hidden_added",
    item: {
      kind: "hidden",
      id: "rwd-1",
      seq: 2,
      at: at(11),
      checkpoint: "msg-2",
      choice: "messages_only",
      count: 1,
      restored: 0,
      left: [],
      items: [
        {
          kind: "message",
          id: "msg-2",
          seq: 2,
          at: at(2),
          actor: "agent",
          sender: null,
          call: null,
          reply_to: null,
          delivery: "next_turn",
          turn: TURN,
          origin: null,
          content: text(
            "I'll read the helper first, then wrap the request in a retry.",
          ),
          reasoning: null,
          cards: [],
          complete: true,
        },
      ],
    },
  },
  { type: "hidden_restored", hidden: "rwd-1" },
];

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
        "`claude gui`를 친 터미널 탭이 바뀐 모습이다. lophn 채팅 화면을 그대로 쓰고 session은 CLI 자신의 것이다(agent 얼굴은 Claude 아이콘). 끝난 tool 줄 둘, 명령 출력과 알림 줄, 도는 tool 하나, 그 명령의 승인 카드(Deny, Always allow, Allow once), 흘러나오는 글이 한 번에 보이고, 보낸 말은 사람 메시지로 돌아온다. card 머리 오른쪽의 Terminal 단추가 같은 대화를 CLI의 화면으로 돌려 보낸다.",
      render: () => <TerminalTabGui />,
    },
    {
      id: "harness-gui-slash-empty",
      title: "Harness GUI · commands",
      description:
        "composer에 /만 친 명령 메뉴다. 머리 글이 있는 묶음이 lophn(화면이 하는 동작: Model, Effort, Permissions, Status, Usage, Context, Rewind, Compact), Claude Code(CLI 명령, vendor 아이콘), Skills, Plugins & MCP, Custom 순으로 선다. 아이콘은 lophn 동작이면 열 화면에 맞는 lucide, harness 명령이면 그 harness의 아이콘, skill·plugin·MCP·사람 명령 file이면 출처마다 다르다. 인자를 받는 명령은 이름 뒤에 흐린 hint가 붙는다.",
      render: () => (
        <TerminalTabGui steps={[() => type("[data-composer-input]", "/")]} />
      ),
    },
    {
      id: "harness-gui-slash-query",
      title: "Harness GUI · commands filtered",
      description:
        "composer에 /con을 친 메뉴다. 묶음 머리 글 없이 순위대로 한 목록이고 줄 끝에 출처 배지가 붙는다. 이름이 con으로 시작하는 것이 위이고(짧은 이름이 먼저: config, context, consolidate-docs) 설명에만 context가 든 compact는 그 아래다. 맞은 글자는 굵다.",
      render: () => (
        <TerminalTabGui steps={[() => type("[data-composer-input]", "/con")]} />
      ),
    },
    {
      id: "harness-gui-command-output",
      title: "Harness GUI · command output",
      description:
        'CLI 명령(/context)이 낸 출력이다. 머리에 /context와 시각이 있고 본문은 markdown(표)으로 그리며 10줄을 넘으면 접혀 있다가(첫 page에서 보인다) [Show more]로 펼친 모습이다. turn 밖의 출력이라 agent 이름도 "Worked for" 줄도 붙지 않는다. 바로 아래 한 줄 알림(rate limit 경고)은 회색 한 줄에 경고 표시가 붙는다.',
      render: () => (
        <TerminalTabGui steps={[() => click("[data-fold-toggle]")]} />
      ),
    },
    {
      id: "harness-gui-tool-body",
      title: "Harness GUI · tool body",
      description:
        "harness tool 줄(Read src/upload.ts)을 펼친 모습이다. harness가 싣는 입력과 출력 글이 따옴표와 이스케이프 없이 그대로 보인다.",
      render: () => (
        <TerminalTabGui
          steps={[() => click("[data-tool-call=tcl-1] button")]}
        />
      ),
    },
    {
      id: "harness-gui-plan-card",
      title: "Harness GUI · plan card",
      description:
        "Claude가 plan mode를 나가며 내는 plan 승인 카드다. plan markdown을 12줄에서 접고 [Show full plan]으로 펼친다. 주 단추는 Claude가 주는 다음 mode마다 하나(Approve · Accept edits가 맨 오른쪽, Approve · Ask for edits)이고 [Keep planning]은 이유 칸을 여는 거절이다.",
      render: () => <TerminalTabGui approval={PLAN_APPROVAL} />,
    },
    {
      id: "harness-gui-dock",
      title: "Harness GUI · dock",
      description:
        "composer 위 dock이 접힌 모습이다. 승인·질문 카드 아래, composer 위에 Goal → Todo → Running → Queue 순서로 card가 한 줄씩 선다. Todo는 지금 하는 항목과 2/5, Running은 도는 일의 수, Queue는 줄 선 메시지 수를 요약한다. 내용이 없는 card는 없고 하나도 없으면 dock도 없다. composer 입력칸 안에는 Plan mode·Fast chip이 mode 옆에 있다.",
      render: () => <TerminalTabGui approval={null} />,
    },
    {
      id: "harness-gui-dock-running",
      title: "Harness GUI · dock running",
      description:
        "Running card를 펼친 모습이다(다른 card는 접힌다). 도는 subagent 줄(상태 · agent · 마지막 한 줄 · 경과)과 background shell task 줄(아이콘 · 명령 · 경과)이 있고, 줄에 마우스를 올리거나 focus하면 경과 시간 자리에 [Stop]이 뜬다. subagent 줄을 누르면 자식 대화가 열리고 task 줄을 누르면 출력이 펼쳐진다. 펼친 card는 최대 높이 안에서 scroll한다.",
      render: () => (
        <TerminalTabGui
          approval={null}
          steps={[
            () => click("[data-dock-card=running] button"),
            () => click("[data-run-task] button"),
          ]}
        />
      ),
    },
    {
      id: "harness-gui-subagent",
      title: "Harness GUI · subagent",
      description:
        "대화 안 subagent 줄(Explore · 설명 · 경과, 아래에 마지막 말이 흐리게)을 눌러 연 자식 대화다. 대화 위 한 겹이고 머리는 [← Back] · 상태 · agent · model · 경과다. 본문은 읽기만 하는 자식 대화이고 아래 줄에서 방향을 주거나(Send) 멈춘다(Stop). 자식 상태가 갱신되면 같이 바뀐다.",
      render: () => (
        <TerminalTabGui
          approval={null}
          steps={[() => click("[data-subagent=tcl-4]")]}
        />
      ),
    },
    {
      id: "harness-gui-roles",
      title: "Harness GUI · roles",
      description:
        "omp session에서 model picker를 연 모습이다(role은 omp만 가진다). 맨 아래 Roles 절에 chat 묶음과 model 묶음이 있고 줄마다 role 이름과 지금 model(vendor 아이콘, 배정이 없으면 —)이 보인다. 줄을 누르면 이 session만 그 role의 model로 바뀐다. role 배정을 바꾸는 칸은 없다.",
      render: () => (
        <TerminalTabGui
          approval={null}
          harness="omp"
          extra={OMP_META}
          steps={[() => press("[data-model-button]")]}
        />
      ),
    },
    {
      id: "harness-gui-status-limits",
      title: "Harness GUI · status limits",
      description:
        "composer 아래 사용량 줄을 눌러 연 status 층이다. 창 막대 아래에 context 분해(항목 · token · 창 대비 %)가 붙고, Limits 절에 사용 한도가 한 줄씩 있다: 이름 · 막대(80%부터 경고색, 90%부터 위험색) · 풀리는 시각. 사용률을 모르는 한도는 막대 없이 남은 글이 보인다.",
      render: () => (
        <TerminalTabGui
          approval={null}
          steps={[() => click("[data-status-footer]")]}
        />
      ),
    },
    {
      id: "harness-gui-hidden-restored",
      title: "Harness GUI · hidden restored",
      description:
        "rewind가 숨긴 구간이 다시 보이는 갱신(`hidden_restored`, OpenCode redo)을 받은 결과다. 숨긴 항목이 같은 자리로 돌아와 숨긴 구간 줄은 남지 않고 대화는 숨기기 전과 같다.",
      render: () => <TerminalTabGui approval={null} extra={REWOUND} />,
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
