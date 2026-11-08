// harness-gui: 터미널 탭에서 `claude gui`를 치면 그 탭이 바뀌는 채팅 화면. 실제 탭 화면(TerminalGui)을 main 대신 fake 통로로
// 그린다. fake 통로는 adapter가 낼 ACP 갱신을 붙을 때 한꺼번에 보내고, 보낸 말은 사람 메시지로 되돌려 준다. card 머리는
// 이 page가 한 줄로 흉내 낸다(실제 앱은 ContentCard가 머리에 올린다).
import { Profiler, type ReactNode, useEffect, useMemo } from "react";

import type {
  AcpChildUpdate,
  AcpToolBody,
  AcpToolDetail,
  AcpUpdate,
} from "../../../../packages/protocol/acp/mod.ts";
import type { HarnessGuiTabApi } from "../../../../packages/shell/ipc/harness-gui.ts";
import type { TerminalAgent } from "../../../../packages/shell/ipc/terminal.ts";
import type { ThreadBookmarksApi } from "../../../../packages/shell/ipc/thread-bookmarks.ts";
import { CommandsProvider } from "../../../../packages/shell/renderer/commands/react.tsx";
import { createWindowCommands } from "../../../../packages/shell/renderer/commands/window.ts";
import { TerminalGui } from "../../../../packages/shell/renderer/terminal/terminal-gui.tsx";
import { TerminalAgentBody } from "./bodies.tsx";
import { fakeHarnessMeta } from "../../../../packages/shell/renderer/conversation/agent-tab-fake-source.ts";
import {
  click,
  find,
  press,
  runSteps,
  type Step,
  type,
  useDrive,
  wait,
} from "../../mock/drive.ts";
import type { Area } from "../types.ts";
import { HeadCard } from "./agent-tab/head-card.tsx";

const TURN = "trn-1";
const at = (second: number) =>
  `2026-11-05T09:00:${String(second).padStart(2, "0")}.000Z`;
const text = (value: string) => [{ type: "text" as const, text: value }];

// 화면이 "지금"으로 보는 시각. 도는 줄의 경과 시간이 gallery마다 같다.
const NOW = Date.parse("2026-11-05T09:02:00.000Z");

/** 창의 key 표를 gallery에도 건다(Desktop과 같은 길). 그러지 않으면 Enter·Esc·Ctrl+F 같은 agent key가 gallery에서 죽는다. */
function GalleryKeys({ children }: { children: ReactNode }) {
  const commands = useMemo(
    () =>
      createWindowCommands({
        platform: "other",
        log: (message, error) => console.error(message, error),
      }),
    [],
  );
  useEffect(() => {
    const listening = commands.keybindings.listen(document);
    return () => listening.dispose();
  }, [commands]);
  return <CommandsProvider value={commands}>{children}</CommandsProvider>;
}

const message = (
  id: string,
  seq: number,
  second: number,
  actor: "user" | "agent",
  value: string,
  turn = TURN,
  origin: string | null = null,
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
    origin,
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
    by: "agent",
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

// thread index: 사람 메시지 여섯과 답. 사람 메시지는 CLI 자신의 message id(`origin`)를 가진다. 답이 길어 처음에는 아래쪽
// 메시지만 화면에 보인다.
const ASKS: readonly (readonly [string, string])[] = [
  [
    "Add a retry to the upload helper and run its tests.",
    "I wrapped the request in `upload()` in a retry with a 200 ms backoff and ran `npm test -- upload`.\n\n- the first try still goes out at once\n- a second try waits 200 ms\n- the tests pass",
  ],
  [
    "Make the backoff double each time, but stop after three tries.",
    "The delay now goes 200, 400, 800 ms and the helper gives up after the third try, keeping the original error so the caller still sees why the upload failed.\n\nI also added a fake clock to the tests so they stay fast.",
  ],
  [
    "Do not retry a 4xx response.",
    "A 4xx response now fails at once: the request itself is wrong, so a retry would only repeat it.\n\n- `src/upload.ts` checks the status before it waits\n- `src/upload.test.ts` has a new case for it",
  ],
  [
    "Show me where upload() is called.",
    "`upload()` is called from `src/queue/worker.ts` and from the CLI entry point.\n\nThe worker passes each file from the queue and logs a failure. The CLI entry point exits with code 1 when the upload fails.",
  ],
  [
    "Rename the helper to uploadWithRetry.",
    "Renamed it in `src/upload.ts` and in both callers. The type check is clean and the old name is gone from the docs too.\n\nNothing outside `src/` changed.",
  ],
  [
    "Run the whole test suite once more.",
    "All 48 tests pass in 3.1 s. The retry cases take 4 ms each because of the fake clock.",
  ],
];

const INDEX_SCRIPT: readonly AcpUpdate[] = [
  { type: "session_changed", session: fakeHarnessMeta() },
  ...ASKS.flatMap(([ask, reply], index): AcpChildUpdate[] => [
    message(
      `msg-u${index}`,
      index * 2 + 1,
      index * 4,
      "user",
      ask,
      TURN,
      `origin-${index}`,
    ),
    message(`msg-a${index}`, index * 2 + 2, index * 4 + 2, "agent", reply),
  ]),
];

// 실제 앱에서는 main 파일이 하는 bookmark 저장. 이 문서 안 메모리에 둔다.
function installFakeBookmarks(marked: readonly string[]): void {
  const keys = new Set(marked);
  const listeners = new Set<(session: string) => void>();
  const api: ThreadBookmarksApi = {
    list: async () => [...keys],
    set: async ({ session, message: key, on }) => {
      if (on) keys.add(key);
      else keys.delete(key);
      for (const listener of listeners) listener(session);
    },
    onChanged: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  (
    globalThis as { lophnThreadBookmarks?: ThreadBookmarksApi }
  ).lophnThreadBookmarks = api;
}

/** 요소에 pointer를 올린 것처럼 pointerover를 낸다. */
async function hover(selector: string, at = 0): Promise<void> {
  const element = await find(selector, undefined, at);
  element.dispatchEvent(
    new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }),
  );
  await wait(60);
}

// 사람이 `!`로 돌린 명령의 출력. adapter가 item의 body에 싣는다.
const LS_OUTPUT = [
  "total 48",
  "drwxr-xr-x  7 phroner phroner 4096 Nov  5 09:00 .",
  "drwxr-xr-x 14 phroner phroner 4096 Nov  4 18:40 ..",
  "-rw-r--r--  1 phroner phroner  231 Nov  5 09:02 README.md",
  "-rw-r--r--  1 phroner phroner  612 Nov  4 18:40 package.json",
  "drwxr-xr-x  2 phroner phroner 4096 Nov  5 09:02 src",
  "drwxr-xr-x  3 phroner phroner 4096 Nov  4 18:41 test",
  "-rw-r--r--  1 phroner phroner  190 Nov  4 18:40 tsconfig.json",
].join("\n");

/** composer에서 ↓를 `times`번 누른다. */
async function arrowDown(times: number): Promise<void> {
  const input = await find("[data-composer-input]");
  for (let index = 0; index < times; index += 1) {
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
        cancelable: true,
      }),
    );
    await wait(10);
  }
}

// fork한 session: turn 밖의 한 줄 알림이 맨 위에 서고 제목은 session_changed의 title로 바뀐다.
const FORKED: readonly AcpUpdate[] = [
  {
    type: "session_changed",
    session: { ...fakeHarnessMeta(), title: "Retry the upload helper" },
  },
  {
    type: "notice_added",
    item: {
      kind: "notice",
      id: "ntc-f",
      seq: 1,
      at: at(0),
      turn: null,
      notice: {
        type: "info",
        text: "Forked from Add a retry to the upload helper (9f2c7d1e)",
        level: "info",
      },
    },
  },
  message("msg-f1", 2, 1, "user", "Now make the backoff double each time."),
  message(
    "msg-f2",
    3,
    3,
    "agent",
    "The delay doubles on each try: 200, 400, then 800 ms.",
  ),
];

// 대화 속 코드 블록: 긴 줄은 줄바꿈하고, `!`로 시작하는 블록에는 복사 단추 왼쪽에 shell mode 단추가 선다.
const CODE_BLOCKS: readonly AcpUpdate[] = [
  { type: "session_changed", session: fakeHarnessMeta() },
  message("msg-c1", 1, 0, "user", "How do I find the slow upload tests?"),
  message(
    "msg-c2",
    2,
    2,
    "agent",
    [
      "Run this in shell mode:",
      "",
      "```bash",
      "!find /home/dev/projects/upload-service/src/queue/workers -type f -name '*.test.ts' -newer /home/dev/projects/upload-service/package.json -not -path '*/node_modules/*' -exec grep -l 'retry' {} + | sort | head -n 50",
      "```",
      "",
      "A plain block keeps its own wrapping and has no shell button:",
      "",
      "```ts",
      "const delays = [200, 400, 800].map((ms) => new Promise((resolve) => setTimeout(resolve, ms, 'a-long-literal-that-goes-past-the-right-edge-of-the-block')));",
      "```",
    ].join("\n"),
  ),
];

const CWD = "/home/phroner/projects/upload-service";

// 머리 session menu의 목록: 그 CLI가 이 폴더에 가진 지난 session. 앞의 것이 지금 열린 session(fakeHarnessMeta)이다.
const CLI_SESSIONS: readonly {
  id: string;
  title: string;
  updated_at: string;
  question: string;
  answer: string;
}[] = [
  {
    id: "9f2c7d1e-5b1a-4c58-8a3e-0d6b7f2a41c9",
    title: "Add a retry to the upload helper",
    updated_at: "2026-11-05T08:55:00.000Z",
    question: "Add a retry to the upload helper and run its tests.",
    answer: "Done. The helper retries three times with a doubling delay.",
  },
  {
    id: "3b7e41aa-6c20-47d8-9d15-71e0a3c58f02",
    title: "Fix the flaky upload test",
    updated_at: "2026-11-05T07:10:00.000Z",
    question: "The upload test fails one run in five. Can you find out why?",
    answer:
      "It races the mock server against the retry timer. I made the test wait for the first retry before it asserts.",
  },
  {
    id: "c0a1d2e3-7f4b-4a19-b6c8-2e9d5f1a7b34",
    title: "Week 40 summary",
    updated_at: "2026-11-03T16:20:00.000Z",
    question: "Summarize last week's eval runs.",
    answer: "Pass rate held at 91%. Two regressions, both in the date parser.",
  },
  {
    id: "58d9f0b2-1e6a-4c37-8b4d-a3f7c2e91d60",
    title: "Rename the config loader",
    updated_at: "2026-10-30T10:05:00.000Z",
    question: "Rename loadConfig to readConfig everywhere.",
    answer: "Done. 14 call sites changed and the exports file is updated.",
  },
];

function fakeApi(
  approval: AcpUpdate | null,
  extra: readonly AcpUpdate[],
  harness: "claude" | "omp" | "codex",
  base: readonly AcpUpdate[],
): HarnessGuiTabApi {
  let push: (update: AcpUpdate) => void = () => {};
  let seq = 8;
  return {
    onOpened: () => () => {},
    ackOpened: async () => {},
    onView: () => () => {},
    async connect(_handle, onBatch) {
      const onUpdate = (update: AcpUpdate) => onBatch({ updates: [update] });
      push = onUpdate;
      for (const update of [
        ...base,
        ...(approval === null ? [] : [approval]),
        ...STREAMING,
        ...extra,
      ])
        onUpdate(update);
      return { harness, cwd: CWD };
    },
    disconnect: async () => {},
    async input(_handle, input) {
      if (input.type === "open_session") {
        // 같은 탭에서 CLI session을 바꾼다: 상태가 비고 그 session의 대화가 다시 온다.
        const target = CLI_SESSIONS.find((one) => one.id === input.cli_session);
        if (target === undefined) return false;
        push({ type: "session_reset" });
        push({
          type: "session_changed",
          session: { cli_session: target.id, title: target.title },
        });
        push(message("msg-o1", seq + 1, 0, "user", target.question));
        push(message("msg-o2", seq + 2, 1, "agent", target.answer));
        seq += 2;
      }
      if (input.type === "run_shell") {
        seq += 1;
        push({
          type: "tool_started",
          item: {
            kind: "tool",
            id: `shl-${seq}`,
            seq,
            at: at(30),
            by: "user",
            turn: null,
            tool: "shell",
            category: "command",
            title: input.command,
            state: "ok",
            duration_ms: 240,
            detail: { kind: "generic" },
            body: { input: input.command, output: LS_OUTPUT, truncated: false },
          },
        });
      }
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
    current: async () => null,
    sessions: async () =>
      CLI_SESSIONS.map(({ id, title, updated_at }) => ({
        id,
        title,
        updated_at,
      })),
    rewindPreview: async () => ({
      files: [
        { path: "src/upload.ts", change: "update" },
        { path: "src/upload.test.ts", change: "create" },
      ],
    }),
    uploadImage: async () => null,
  };
}

const NO_UPDATES: readonly AcpUpdate[] = [];

// role은 omp만 가진다. omp session 기능으로 바꿔 보낸다.
const OMP_META: readonly AcpUpdate[] = [
  { type: "session_changed", session: fakeHarnessMeta("omp") },
];
const CODEX_META: readonly AcpUpdate[] = [
  { type: "session_changed", session: fakeHarnessMeta("codex") },
];

function TerminalTabGui({
  steps = [],
  approval = SHELL_APPROVAL,
  extra = NO_UPDATES,
  harness = "claude",
  base = BASE,
}: {
  steps?: readonly Step[];
  /** null이면 승인 카드 없이 dock과 composer만 보인다. */
  approval?: AcpUpdate | null;
  /** 갈무리 뒤에 더 보내는 갱신. */
  extra?: readonly AcpUpdate[];
  harness?: "claude" | "omp" | "codex";
  /** 대화의 바탕 갱신. 기본은 일하는 중인 turn이다. */
  base?: readonly AcpUpdate[];
}) {
  useDrive(() => runSteps(steps));
  const api = useMemo(
    () => fakeApi(approval, extra, harness, base),
    [approval, extra, harness, base],
  );
  return (
    <HeadCard>
      <GalleryKeys>
        <TerminalGui
          api={api}
          gui={{ handle: "win_gallery", harness, handoff: "restart" }}
          terminalRef="trm_gallery"
          now={() => NOW}
        />
      </GalleryKeys>
    </HeadCard>
  );
}

// 성능 측정용 긴 대화: 끝난 turn 40개(markdown, code block, 표, tool 줄)와 도는 turn 하나(subagent 둘, shell task).
// 스트림은 page가 `globalThis.__perf.push`로 받아 `feed.apply`와 같은 통로로 보낸다.
const PERF_TURNS = 40;
const perfReply = (index: number) =>
  [
    `## Step ${index}`,
    "",
    "I read `src/upload.ts` and wrapped the request in a retry. The **backoff** doubles each time and gives up after three tries.",
    "",
    "- the first try goes out at once",
    "- a second try waits 200 ms",
    "- a 4xx response fails immediately",
    "",
    "```ts",
    "export async function upload(file: Blob) {",
    "  for (const delay of [0, 200, 400]) {",
    "    await sleep(delay);",
    "    const response = await fetch(UPLOAD_URL, { method: 'POST', body: file });",
    "    if (response.ok) return response.json();",
    "  }",
    "  throw new Error('upload failed');",
    "}",
    "```",
    "",
    "| Case | Result |",
    "| --- | --- |",
    "| first try | ok |",
    "| flaky network | retried |",
  ].join("\n");

// 긴 대화 page의 turn 수. 화면 근처 행만 그리는지(virtualization) 본다.
const LONG_TURNS = 200;

const perfThread = (turns: number): readonly AcpUpdate[] => [
  { type: "session_changed", session: fakeHarnessMeta() },
  ...Array.from({ length: turns }, (_, index): AcpUpdate[] => {
    const turn = `trn-p${index}`;
    const seq = index * 6;
    return [
      message(
        `pu${index}`,
        seq + 1,
        0,
        "user",
        `Step ${index}: change the helper.`,
        turn,
      ),
      { type: "turn_started", turn, at: at(0) },
      message(`pa${index}`, seq + 2, 1, "agent", perfReply(index), turn),
      tool(
        `pt${index}`,
        seq + 3,
        2,
        "Read",
        "read",
        "Read src/upload.ts",
        READ_BODY,
        { kind: "generic" },
        turn,
      ),
      done(`pt${index}`, 3, READ_BODY),
      message(`pb${index}`, seq + 4, 4, "agent", perfReply(index + 100), turn),
      {
        type: "turn_ended",
        turn,
        at: at(5),
        outcome: "completed",
        active_ms: 5000,
        error: null,
        messages: [
          { message: `pa${index}`, seq: seq + 2 },
          { message: `pb${index}`, seq: seq + 4 },
        ],
        seq: seq + 5,
      },
    ];
  }).flat(),
  message(
    "pu-live",
    9000,
    0,
    "user",
    "Now explain the whole design in detail.",
    "trn-live",
  ),
  { type: "turn_started", turn: "trn-live", at: at(0) },
  tool(
    "pt-live",
    9001,
    1,
    "Bash",
    "command",
    "Run npm test",
    null,
    { kind: "generic" },
    "trn-live",
  ),
  ...DOCK.slice(1, 8),
  tool(
    "tcl-5",
    9002,
    8,
    "Task",
    "other",
    "Check callers",
    null,
    {
      kind: "subagent",
      agent: "Explore",
      description: "Check callers",
      child: "chd-2",
      state: "running",
      model: "Haiku 5.5",
      last: "Reading src/cli.ts",
    },
    "trn-live",
  ),
];

function perfApi(turns: number): HarnessGuiTabApi {
  return {
    ...fakeApi(null, [], "claude", NO_UPDATES),
    async connect(_handle, onBatch) {
      onBatch({ updates: [...perfThread(turns)] });
      (globalThis as { __perf?: unknown }).__perf = {
        push: (updates: AcpUpdate[]) => onBatch({ updates }),
      };
      return { harness: "claude", cwd: CWD };
    },
  };
}

function PerfGui({
  turns = PERF_TURNS,
  steps = [],
}: {
  turns?: number;
  steps?: readonly Step[];
}) {
  useDrive(() => runSteps(steps));
  const api = useMemo(() => perfApi(turns), [turns]);
  // 실제 시계: live 글의 throttle과 도는 줄의 경과 시간이 시계를 읽는다.
  const origin = useMemo(() => Date.now(), []);
  const now = useMemo(() => () => NOW + (Date.now() - origin), [origin]);
  return (
    <HeadCard>
      <Profiler
        id="gui"
        onRender={(_id, phase, actual) => {
          const bag = ((
            globalThis as { __perfCommits?: unknown }
          ).__perfCommits ??= { count: 0, actual: 0, updates: 0 }) as {
            count: number;
            actual: number;
            updates: number;
          };
          bag.count += 1;
          bag.actual += actual;
          if (phase === "update") bag.updates += 1;
        }}
      >
        <GalleryKeys>
          <TerminalGui
            api={api}
            gui={{ handle: "win_perf", harness: "claude", handoff: "restart" }}
            terminalRef="trm_perf"
            now={now}
          />
        </GalleryKeys>
      </Profiler>
    </HeadCard>
  );
}

/** 사람이 위로 올려 중간쯤 읽는 것처럼 대화를 올린다(wheel이 맨 아래 따라가기를 끈다). */
async function scrollThreadTo(share: number): Promise<void> {
  const list = await find("[data-thread]");
  list.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -1 }));
  list.scrollTop = list.scrollHeight * share;
  await wait(400);
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

// 터미널 탭에서 Claude Code TUI가 foreground로 돌고 hook이 session을 알린 상태.
const CLAUDE_TUI: TerminalAgent = {
  harness: "claude",
  state: "idle",
  unseen: false,
  hooked: true,
  foreground: true,
  session: "9f2c7d1e-5b1a-4c58-8a3e-0d6b7f2a41c9",
  title: "Add a retry to the upload helper",
};

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
      id: "harness-gui-perf",
      title: "Harness GUI · perf probe",
      description:
        "긴 대화(40 turn)와 도는 turn 하나. 스트림 길이를 재는 측정용 page다(`globalThis.__perf.push`).",
      render: () => <PerfGui />,
    },
    {
      id: "harness-gui-long-thread",
      title: "Harness GUI · long thread",
      description:
        "200 turn짜리 긴 대화의 맨 아래다. 화면 근처 행만 DOM에 있고(virtualization) 나머지는 빈 칸이라, 길어도 그리는 값은 같다. 쓰는 중에도 맨 아래에 붙어 있다.",
      render: () => <PerfGui turns={LONG_TURNS} />,
    },
    {
      id: "harness-gui-long-thread-middle",
      title: "Harness GUI · long thread, middle",
      description:
        "같은 긴 대화를 중간까지 올려 읽는 모습이다. 위쪽에 안 그린 행이 있어도 읽는 글은 제자리에 있고, 새 글이 와도 밀리지 않는다.",
      render: () => (
        <PerfGui turns={LONG_TURNS} steps={[() => scrollThreadTo(0.5)]} />
      ),
    },
    {
      id: "harness-gui-long-thread-jump",
      title: "Harness GUI · long thread, index jump",
      description:
        "긴 대화에서 thread index의 맨 위 눈금을 눌러 첫 메시지로 간 모습이다. 안 그린 행에도 쌓아 둔 높이로 계산한 자리로 바로 가고, 거기서 그리면서 그 메시지를 맨 위에 둔다.",
      render: () => (
        <PerfGui
          turns={LONG_TURNS}
          steps={[() => click("[data-thread-index] button", undefined, 0)]}
        />
      ),
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
        "composer 위 dock이 접힌 모습이다. 승인·질문 카드 아래, composer 위에 Goal → Todo → Running → Queue 순서로 card가 한 줄씩 선다. Todo는 지금 하는 항목과 2/5, Running은 도는 일의 수, Queue는 줄 선 메시지 수를 요약한다. 내용이 없는 card는 없고 하나도 없으면 dock도 없다. composer 입력칸 안에는 Plan mode chip이 mode 옆에 있다(Fast는 model의 축이라 chip이 아니다).",
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
        "대화 안 subagent 줄(Explore · 설명 · 경과, 아래에 마지막 말이 흐리게)을 눌러 연 자식 대화다. 자식 보기에는 머리 줄이 따로 없다: 탭 머리의 ←가 켜져 있고(누르면 이 session의 대화로 돌아간다) 제목이 `Claude Code › Explore · subagent`로 바뀌며 상태 점 · model · 경과가 제목 옆에 작은 글로 붙는다. 본문은 읽기만 하는 자식 대화이고 아래 줄에서 방향을 주거나(Send) 멈춘다(Stop). 자식 상태가 갱신되면 같이 바뀐다.",
      render: () => (
        <TerminalTabGui
          approval={null}
          steps={[() => click("[data-subagent=tcl-4]")]}
        />
      ),
    },
    {
      id: "harness-gui-subagent-forward",
      title: "Harness GUI · subagent, back and forward",
      description:
        "자식 대화를 연 뒤 머리 ←로 나온 모습이다. 대화는 이 session으로 돌아왔고 머리 →가 켜져 있어 누르면 방금 본 자식 대화를 다시 연다(브라우저의 앞으로 가기와 같다). 새 자식을 열거나 다른 층(rewind, status)을 열면 →는 꺼진다. 자식 대화가 닫혀 있는 동안 ← →는 창 기록이다.",
      render: () => (
        <TerminalTabGui
          approval={null}
          steps={[
            () => click("[data-subagent=tcl-4]"),
            () => click("button[aria-label=Back]"),
          ]}
        />
      ),
    },
    {
      id: "harness-gui-resume",
      title: "Harness GUI · resume menu",
      description:
        "머리 제목(Claude Code · session 제목 ▾)을 눌러 연 session menu다. harness는 lophn session 목록이 없어 그 CLI가 이 폴더에 가진 지난 session을 보인다: 검색칸, Today와 Earlier 묶음, 지금 열린 session에 ✓, 아래 New session. 이름 바꾸기·archive·delete·메시지 찾기는 없다(lophn session의 것이다). 줄을 누르면 같은 탭에서 그 session으로 바뀌고(`open_session`) 바꾸는 동안 제목 자리에 Opening session이 선다. composer에 /resume을 쳐도 같은 menu가 열린다.",
      render: () => (
        <TerminalTabGui
          approval={null}
          steps={[() => press("button[aria-label$=' sessions']")]}
        />
      ),
    },
    {
      id: "harness-gui-resume-switched",
      title: "Harness GUI · resumed session",
      description:
        "menu에서 Fix the flaky upload test를 고른 뒤다. 상태가 비워지고(`session_reset`) 그 session의 대화가 다시 그려진다. 머리 제목이 그 session의 것으로 바뀌고 쓰던 Todo·Running·Queue card와 승인 카드는 사라진다(Goal은 session 기능이라 남는다).",
      render: () => (
        <TerminalTabGui
          approval={null}
          steps={[
            () => press("button[aria-label$=' sessions']"),
            () =>
              click("[data-session='3b7e41aa-6c20-47d8-9d15-71e0a3c58f02']"),
          ]}
        />
      ),
    },
    {
      id: "harness-gui-resume-slash",
      title: "Harness GUI · /resume",
      description:
        "composer에 /resume을 치고 그 명령을 고른 모습이다. 명령 메뉴가 닫히고 머리 session menu가 열린다. 명령은 `opens: resume`이라 화면이 이름을 해석하지 않는다.",
      render: () => (
        <TerminalTabGui
          approval={null}
          steps={[
            () => type("[data-composer-input]", "/resume"),
            () => click("[role=option]", "resume"),
          ]}
        />
      ),
    },
    {
      id: "harness-gui-roles",
      title: "Harness GUI · roles",
      description:
        "omp session에서 model picker를 연 모습이다(role은 omp만 가진다). Roles 절이 목록 맨 위에 있어 chat 묶음과 model 묶음이 먼저 보이고, 줄마다 role 이름과 지금 model(vendor 아이콘, 배정이 없으면 —)이 있다. 줄을 누르면 이 session만 그 role의 model로 바뀐다. role 배정을 바꾸는 칸은 없다. 아래 검색칸과 provider 묶음은 harness-gui-picker에서 본다.",
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
      id: "harness-gui-picker",
      title: "Harness GUI · model picker, collapsed groups",
      description:
        "omp의 model picker다. 위에서부터 Roles, 검색칸, provider 묶음, 고른 model의 option 축 순서이고 Manage models 줄은 없다. 묶음 머리는 chevron · vendor 아이콘 · 이름 · model 수의 단추이고 기본으로 지금 model의 묶음(Anthropic)만 펼쳐 있다. 머리를 누르거나 Enter·Space, →(펼침)·←(접음)으로 접고 편다. ↑/↓는 검색칸, 머리, 보이는 줄 사이를 옮긴다. 검색어를 치면 접힘을 무시하고 맞는 묶음을 펼치며, 검색을 비우면 접힌 상태로 돌아간다. 접고 편 상태는 picker를 닫았다 열어도 남는다.",
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
      id: "harness-gui-picker-search",
      title: "Harness GUI · model picker, searching",
      description:
        "omp의 picker에 gpt를 친 모습이다. 접힌 OpenAI 묶음이 접힘을 무시하고 펼쳐져 맞는 model(GPT-6.1 Sol, GPT-6.1 Mini)만 보이고 맞지 않는 묶음은 사라진다.",
      render: () => (
        <TerminalTabGui
          approval={null}
          harness="omp"
          extra={OMP_META}
          steps={[
            () => press("[data-model-button]"),
            () => type("[data-model-picker] input", "gpt"),
          ]}
        />
      ),
    },
    {
      id: "harness-gui-picker-switch",
      title: "Harness GUI · model picker, switch axes",
      description:
        "Claude의 model picker다. fast와 thinking은 composer chip이 아니라 그 model의 축이다. 고른 Sonnet 5.5 아래에 Effort(High를 고른 segmented 단추)와, 켜고 끄는 두 축 Fast와 Thinking이 이름과 switch 한 줄씩 있다. 지원하는 model에만 축이 있다(Haiku 5.5에는 Fast가 없다). model 단추에는 켠 것만 이름으로 붙는다: Sonnet 5.5 · High · Fast · Thinking. 묶음이 하나뿐이라 접힘 없이 펼쳐 있다.",
      render: () => (
        <TerminalTabGui
          approval={null}
          steps={[() => press("[data-model-button]")]}
        />
      ),
    },
    {
      id: "harness-gui-picker-switch-codex",
      title: "Harness GUI · model picker, Codex speed",
      description:
        "Codex의 picker다. GPT-6.1 Sol의 service tier는 Fast switch 하나로 effort 아래에 선다. 켜면 단추에 Fast가 붙는다. 다른 model(Mini)에는 이 축이 없다.",
      render: () => (
        <TerminalTabGui
          approval={null}
          harness="codex"
          extra={CODEX_META}
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
      id: "harness-gui-thread-index",
      title: "Harness GUI · thread index",
      description:
        "대화 왼쪽 가장자리의 turn 눈금이다. 사람 메시지가 4개 이상일 때만 나오고 눈금 하나가 사람 메시지 하나다. 평소에는 짧은 선이고, 화면에 보이는 turn은 글자색(진하게), 나머지는 흐리다. 두 번째 turn은 bookmark되어 끝에 점이 붙고 가장 진하다. 대화 기둥 왼쪽 여백이 좁으면 눈금이 글 위에 겹치므로 숨는다.",
      render: () => {
        installFakeBookmarks(["origin-1"]);
        return <TerminalTabGui approval={null} base={INDEX_SCRIPT} />;
      },
    },
    {
      id: "harness-gui-thread-index-card",
      title: "Harness GUI · thread index card",
      description:
        "눈금에 pointer를 올리면 뜨는 card다. 첫 줄은 그 사람 메시지의 첫 줄과 bookmark 단추(Bookmark turn, 켜져 있으면 Remove bookmark), 아래는 그 turn의 마지막 답 미리보기 2줄이다. hover한 눈금이 가장 길고 이웃이 dock처럼 차례로 짧아진다. 눈금 사이로 pointer를 옮기면 card가 끊기지 않고 따라간다.",
      render: () => {
        installFakeBookmarks(["origin-1"]);
        return (
          <TerminalTabGui
            approval={null}
            base={INDEX_SCRIPT}
            steps={[
              () => hover("[data-thread-index] button", 4),
              () => hover("[data-thread-index] button", 2),
            ]}
          />
        );
      },
    },
    {
      id: "harness-gui-slash-scroll",
      title: "Harness GUI · commands scrolled",
      description:
        "composer에 /를 치고 ↓를 12번 누른 메뉴다. 10줄 밖으로 내려가도 고른 줄이 보이도록 목록이 따라 scroll하고 가로 scroll은 없다.",
      render: () => (
        <TerminalTabGui
          approval={null}
          steps={[
            () => type("[data-composer-input]", "/"),
            () => arrowDown(12),
          ]}
        />
      ),
    },
    {
      id: "harness-gui-slash-long",
      title: "Harness GUI · long command name",
      description:
        "composer에 /plugin-name을 친 메뉴다. 긴 plugin 명령(/plugin-name:a-very-long-command-name)이 가로 scroll 없이 한 줄에 들어간다. 이름은 줄 폭의 절반까지만 쓰고 넘으면 말줄임하며(전체 이름은 hover의 tooltip), 설명과 출처 배지는 그 옆에 남는다.",
      render: () => (
        <TerminalTabGui
          approval={null}
          steps={[() => type("[data-composer-input]", "/plugin-name")]}
        />
      ),
    },
    {
      id: "harness-gui-shell-mode",
      title: "Harness GUI · shell mode",
      description:
        "composer에 !ls -la를 친 모습이다. 글이 !로 시작하고 session이 shell 기능을 가지면 shell mode다: 입력 글이 mono 글꼴, 입력칸 테두리가 경고색, 입력칸 안 왼쪽에 Shell chip, 아래에 hint 줄(Runs in your shell · Esc to leave)이 선다. /로 여는 명령 메뉴와 첨부는 이 mode에서 꺼진다. 빈 shell mode(!만)에서 Esc나 Backspace는 mode를 끈다.",
      render: () => (
        <TerminalTabGui
          approval={null}
          steps={[() => type("[data-composer-input]", "!ls -la")]}
        />
      ),
    },
    {
      id: "harness-gui-shell-run",
      title: "Harness GUI · shell run",
      description:
        "shell mode에서 보낸 명령(!ls -la)이 대화에 남은 모습이다. agent 덩어리가 아니라 사람 줄 자리(오른쪽)에 서고, 작은 You ran 아래에 mono $ 명령 머리와 출력 블록이 펼쳐져 있다(20줄이 넘으면 접힌다). agent 이름도 Worked for 줄도 붙지 않는다. 출력의 복사 단추는 블록 오른쪽 위에 흐리게 겹쳐 있고 마우스를 올리면 또렷하다.",
      render: () => (
        <TerminalTabGui
          approval={null}
          steps={[
            () => type("[data-composer-input]", "!ls -la"),
            () => click("[data-composer-action=send]"),
          ]}
        />
      ),
    },
    {
      id: "harness-gui-shell-run-long",
      title: "Harness GUI · shell run (long command)",
      description:
        "긴 !명령이 대화에 남은 모습이다. 명령은 가로 scroll 없이 줄바꿈되고(긴 경로는 중간에서 끊긴다), 3줄을 넘으면 끝이 흐려지며 접힌다. 명령을 누르거나 [Show more]를 누르면 펼쳐진다.",
      render: () => (
        <TerminalTabGui
          approval={null}
          steps={[
            () =>
              type(
                "[data-composer-input]",
                "!find /home/dev/projects/upload-service/src/queue/workers/very/deeply/nested/directory/structure -type f -name '*.test.ts' -newer /home/dev/projects/upload-service/package.json -not -path '*/node_modules/*' -exec grep -l 'retry' {} + | sort | head -n 50 | xargs -I{} wc -l {} && echo done-with-the-whole-pipeline",
              ),
            () => click("[data-composer-action=send]"),
          ]}
        />
      ),
    },
    {
      id: "harness-gui-code-block-shell",
      title: "Harness GUI · code block shell button",
      description:
        "대화의 코드 블록이다. 긴 줄은 가로 scroll 없이 줄바꿈된다. 첫 글자가 !인 블록(fence 언어는 무관)에는 복사 단추 왼쪽에 shell 단추가 서고, 누르면 그 글이 composer에 shell mode로 채워진다(보내지는 않는다). !로 시작하지 않는 블록에는 단추가 없다.",
      render: () => <TerminalTabGui approval={null} base={CODE_BLOCKS} />,
    },
    {
      id: "harness-gui-code-block-shell-filled",
      title: "Harness GUI · code block shell button (pressed)",
      description:
        "위 블록의 shell 단추를 누른 뒤다. composer가 shell mode(Shell chip, 경고색 테두리, hint)로 열리고 글이 채워지며 커서는 끝에 있다.",
      render: () => (
        <TerminalTabGui
          approval={null}
          base={CODE_BLOCKS}
          steps={[() => click("[data-fill-shell]")]}
        />
      ),
    },
    {
      id: "harness-gui-rewind",
      title: "Harness GUI · rewind",
      description:
        "내 메시지의 Rewind to here를 눌러 연 rewind panel이다. harness(Claude)는 adapter가 알려 준 되돌아갈 파일(src/upload.ts, src/upload.test.ts)을 미리 보이고, 기본으로 함께 되돌린다. harness에는 앱 write가 없어 앱 절은 비어 있다. 바뀐 파일이 없는 시점은 No files were changed 한 줄이다.",
      render: () => (
        <TerminalTabGui
          approval={null}
          steps={[() => click("button", /^Rewind to here$/)]}
        />
      ),
    },
    {
      id: "harness-gui-fork-info",
      title: "Harness GUI · forked session",
      description:
        "fork로 갈라진 session이다. adapter가 turn 밖의 한 줄 알림(Forked from …)을 맨 위에 내고, 머리의 제목은 session_changed의 title로 바뀐다. 알림은 다른 한 줄 알림과 같은 회색 한 줄이다.",
      render: () => <TerminalTabGui approval={null} base={FORKED} />,
    },
    {
      id: "harness-gui-open-terminal",
      title: "Harness GUI · open in terminal",
      description:
        "채팅이 열린 터미널 탭의 ⋯ 메뉴다. 채팅 머리의 항목(있을 때) 아래에 Open in terminal이 있고 머리 단추 Terminal과 같은 일을 한다(restart하는 harness는 먼저 묻는다).",
      render: () => (
        <TerminalTabGui
          approval={null}
          steps={[() => press("[data-card-more]")]}
        />
      ),
    },
    {
      id: "terminal-open-chat",
      title: "Terminal tab · open as chat",
      description:
        "Claude Code가 foreground에서 도는 터미널 탭이다. 머리의 Open as chat 단추와 ⋯ 메뉴의 Open as chat 항목이 같은 일을 한다(modal로 확인한 뒤 같은 session을 채팅으로 연다). hook이 session을 알린 탭이라 둘 다 쓸 수 있다.",
      render: () => (
        <TerminalAgentBody
          agent={CLAUDE_TUI}
          steps={[() => press("[data-card-more]")]}
        />
      ),
    },
    {
      id: "terminal-open-chat-disabled",
      title: "Terminal tab · open as chat disabled",
      description:
        "CLI가 아직 session을 알리지 않은 탭이다(첫 메시지 전이고 hook도 없음). 머리 단추와 ⋯ 메뉴 항목이 disabled이고 이유가 붙는다: 메뉴 항목 옆에 짧은 이유(No session yet), 마우스를 올리면 전체 문장. 누른 뒤에 실패하지 않게 미리 막는다. foreground가 그 CLI가 아닌 탭도 같은 모양에 이유만 다르다.",
      render: () => (
        <TerminalAgentBody
          agent={{ ...CLAUDE_TUI, session: undefined, title: undefined }}
          steps={[() => press("[data-card-more]")]}
        />
      ),
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
