// Codex adapter. 탭 전용 `codex app-server`를 unix socket으로 띄우고(GUI는 그 위 WebSocket client, TUI는 `codex resume --remote`로
// 같은 server에 붙는다) app-server 이벤트를 ACP 갱신으로, 창의 ACP 입력을 JSON-RPC(`jsonrpc` 칸 없음)로 옮긴다.
// 설정과 login은 사람의 것을 쓴다. 사람 설정이 never·danger-full-access일 때만 on-request·workspace-write로 바꾼다.
// 대화 하나의 도는 상태는 `Lane`이다: root가 탭의 thread이고 subagent thread는 자식 lane이라 그 갱신은 `child_update`로 싸서 낸다.
// 흐름과 이유는 architecture/harness-gui.md의 Codex adapter 절이다.
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { WebSocket } from "ws";
import type { Result } from "../../../../../base/result.ts";
import { redactCredentials } from "../../../../../base/telemetry/log.ts";
import type { AcpInput } from "../../../../../protocol/acp/input.ts";
import type {
  AcpApprovalItem,
  AcpEntry,
  AcpToolBody,
  AcpToolItem,
} from "../../../../../protocol/acp/items.ts";
import {
  EMPTY_ACP_STATE,
  reduceAcp,
} from "../../../../../protocol/acp/reduce.ts";
import type {
  AcpCapabilities,
  AcpCommand,
  AcpGoal,
  AcpModelGroup,
  AcpSessionMeta,
  AcpUsage,
  AcpUsageLimit,
} from "../../../../../protocol/acp/session.ts";
import type {
  AcpChildUpdate,
  AcpState,
  AcpTask,
  AcpUpdate,
} from "../../../../../protocol/acp/state.ts";
import type { AcpTerminal } from "../../../../../protocol/extensions/mod.ts";
import type { ContentBlock } from "../../../../../protocol/lophn-agent/content-block.ts";
import type { HarnessGuiAdapter, HarnessGuiRun } from "./adapter.ts";
import { resendQueue, swapQueued } from "./queue.ts";
import { classifyBlocks, type ReceivedText } from "./received.ts";

// app-server 메시지에서 읽는 칸만 읽는다. 모양은 `codex app-server generate-ts --experimental`이 정한다.
// biome-ignore lint/suspicious/noExplicitAny: wire JSON을 칸마다 타입으로 옮기지 않는다.
type J = any;
type Json = Record<string, J>;

/** app-server와 말하는 길과 file system. 기본은 실제 socket이고 test는 녹화를 재생하는 가짜를 넣는다. */
export type CodexLink = {
  send(text: string): void;
  onMessage(listener: (text: string) => void): void;
  onClose(listener: () => void): void;
  close(): void;
};
export type CodexIo = {
  /** socket을 둘 폴더. 사람 소유이고 group·other가 쓸 수 없어야 한다(app-server가 검사한다). */
  makeDir(): string;
  removeDir(dir: string): void;
  /** socket이 생길 때까지 기다려 붙는다. `alive()`가 false가 되면 포기한다. */
  connect(socket: string, alive: () => boolean): Promise<CodexLink>;
};

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

// app-server가 답하지 않는 요청을 끊는 기한. 일이 끝난 뒤에야 답할 수 있는 요청은 뺀다: turn/start·thread/shellCommand는 일이
// 시작되자마자 답하는 것을 녹화로 봤고, review/start·thread/compact/start는 녹화가 없어 모르므로 뺐다(느린 호출을 끊는 쪽이 더 나쁘다).
const REQUEST_WAIT_MS = 30_000;
const NO_DEADLINE = new Set([
  "turn/start",
  "thread/shellCommand",
  "review/start",
  "thread/compact/start",
]);

const realIo: CodexIo = {
  // unix socket 경로는 108자를 넘으면 안 되어 짧은 tmp 폴더에 둔다. mkdtemp는 0700이다.
  makeDir: () => mkdtempSync(join(tmpdir(), "lophn-codex-")),
  removeDir: (dir) => rmSync(dir, { recursive: true, force: true }),
  async connect(socket, alive) {
    for (let attempt = 0; alive() && attempt < 100; attempt += 1) {
      try {
        const ws = await new Promise<WebSocket>((resolve, reject) => {
          const one = new WebSocket("ws://localhost/rpc", {
            createConnection: () => net.connect(socket),
            perMessageDeflate: false,
          });
          one.once("open", () => resolve(one));
          one.once("error", reject);
        });
        ws.on("error", () => {});
        return {
          send: (text) => ws.send(text),
          onMessage: (listener) =>
            void ws.on("message", (raw) => listener(String(raw))),
          onClose: (listener) => void ws.on("close", listener),
          close: () => ws.close(),
        };
      } catch {
        await sleep(100);
      }
    }
    throw new Error("The Codex app-server did not open its socket.");
  },
};

// 그리지 않는 알림. 이 connection에서만 끈다(TUI는 자기 것을 받는다).
const OPT_OUT = [
  "thread/started",
  "thread/status/changed",
  "thread/readState/changed",
  "thread/compacted",
  "thread/archived",
  "thread/unarchived",
  "thread/closed",
  "thread/queue/changed",
  "turn/diff/updated",
  "turn/moderationMetadata",
  "item/plan/delta",
  "item/commandExecution/outputDelta",
  "item/commandExecution/terminalInteraction",
  "item/fileChange/outputDelta",
  "item/fileChange/patchUpdated",
  "item/mcpToolCall/progress",
  "item/autoApprovalReview/started",
  "item/autoApprovalReview/completed",
  "hook/started",
  "hook/completed",
  "rawResponseItem/completed",
  "mcpServer/startupStatus/updated",
  "account/updated",
  "remoteControl/status/changed",
  "app/list/updated",
  "skills/changed",
  "fs/changed",
  "deprecationNotice",
  "guardianWarning",
  "model/verification",
];

// 늦은 JSON-RPC 오류 code. 이 창이 옮기지 못하는 server 요청에 쓴다.
const UNSUPPORTED = -32000;
const OK = (): Result<void> => ({ ok: true, value: undefined });

type Item = {
  type: string;
  id: string;
  text?: string;
  clientId?: string | null;
  content?: J[];
  summary?: string[];
  command?: string;
  commandActions?: { type: string; command: string }[];
  /** commandExecution: `"userShell"`이면 사람이 `!`로 돌린 것이다. */
  source?: string;
  status?: string;
  changes?: { path: string; kind: { type: string }; diff: string }[];
  server?: string;
  tool?: string;
  namespace?: string | null;
  query?: string;
  path?: string;
  success?: boolean | null;
  prompt?: string | null;
  kind?: string;
  review?: string;
  aggregatedOutput?: string | null;
  arguments?: J;
  result?: J;
  error?: J;
  contentItems?: J[] | null;
  senderThreadId?: string;
  receiverThreadIds?: string[];
  agentsStates?: Record<string, { status: string; message: string | null }>;
  agentThreadId?: string;
  agentPath?: string;
  model?: string | null;
  revisedPrompt?: string | null;
  savedPath?: string;
  /** agentMessage: `request_user_input_async` tool이 붙인 질문. */
  questions?: { title: string; options: string[] | null }[] | null;
};
type WireTurn = {
  id: string;
  status: string;
  items?: Item[];
  error?: { message: string } | null;
};

const oneLine = (text: string, max: number) =>
  text
    .replace(/\s*\n\s*/g, " ")
    .trim()
    .slice(0, max);
const lineCount = (text: string) =>
  text === "" ? 0 : text.replace(/\n$/, "").split("\n").length;
const relative = (cwd: string, path: string) =>
  path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;

function changeCounts(change: NonNullable<Item["changes"]>[number]) {
  if (change.kind.type === "add")
    return { added: lineCount(change.diff), removed: 0 };
  if (change.kind.type === "delete")
    return { added: 0, removed: lineCount(change.diff) };
  let added = 0;
  let removed = 0;
  for (const line of change.diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}

// 사람 메시지 → UserInput. file chip(`file://` resource_link)은 mention이고 앱 context(`resource`)는 글이다.
// 이미지는 blob hash뿐이라 넘기지 못한다.
function inputOf(content: ContentBlock[]): J[] {
  const text = content
    .flatMap((block) =>
      block.type === "text" || block.type === "resource" ? [block.text] : [],
    )
    .join("\n");
  const mentions = content.flatMap((block) =>
    block.type === "resource_link" && block.uri.startsWith("file://")
      ? [
          {
            type: "mention",
            name: block.name,
            path: decodeURIComponent(block.uri.slice("file://".length)),
          },
        ]
      : [],
  );
  return [
    ...(text === "" && mentions.length > 0
      ? []
      : [{ type: "text", text, text_elements: [] }]),
    ...mentions,
  ];
}

// 다른 client가 보낸 UserInput → 사람 메시지 content.
function contentOf(input: J[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const one of input) {
    if (one.type === "text" && one.text) {
      blocks.push({ type: "text", text: one.text });
    } else if (one.type === "mention") {
      blocks.push({
        type: "resource_link",
        uri: `file://${one.path}`,
        name: one.name || basename(one.path),
      });
    } else if (one.type === "skill") {
      blocks.push({ type: "text", text: `$${one.name}` });
    } else if (one.type === "image" || one.type === "localImage") {
      blocks.push({ type: "text", text: "[image]" });
    }
  }
  return blocks;
}

function toolState(item: Item): "ok" | "error" | "denied" | "cancelled" {
  if (item.success === false) return "error";
  switch (item.status) {
    case undefined:
    case "completed":
      return "ok";
    case "failed":
      return "error";
    case "declined":
      return "denied";
    default:
      return "cancelled";
  }
}

// 명령 하나가 읽기·목록·검색뿐이면 그 종류로, 아니면 command다.
function commandCategory(item: Item): AcpToolItem["category"] {
  const actions = item.commandActions ?? [];
  const only = actions.length === 1 ? actions[0]?.type : undefined;
  return only === "read"
    ? "read"
    : only === "listFiles"
      ? "list"
      : only === "search"
        ? "search"
        : "command";
}

// 권한 mode. 데스크톱의 agent mode 표와 같다(`permissions`는 profile id).
const MODES = {
  "read-only": {
    permissions: ":read-only",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
  },
  auto: {
    permissions: ":workspace",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
  },
  guardian: {
    permissions: ":workspace",
    approvalPolicy: "on-request",
    approvalsReviewer: "guardian_subagent",
  },
  "full-access": {
    permissions: ":danger-full-access",
    approvalPolicy: "never",
    approvalsReviewer: "user",
  },
} as const;
const MODE_CHOICES = {
  "read-only": [
    "Read-only",
    "Codex reads files and asks before editing or running commands.",
  ],
  auto: [
    "Auto",
    "Codex edits files in the workspace and asks before anything else.",
  ],
  guardian: [
    "Guardian approvals",
    "A reviewer agent approves requests for you.",
  ],
  "full-access": [
    "Full access",
    "Codex runs anything without asking, with no sandbox.",
  ],
  granular: ["Granular", "Approval rules from your Codex config."],
} as const;

type Settings = {
  model: string;
  effort: string | null;
  /** thread의 service tier(`priority`=Fast). null이면 model의 기본이다. */
  serviceTier: string | null;
  approvalPolicy: J;
  approvalsReviewer: string;
  sandbox: string;
  plan: boolean;
};

function modeOf(settings: Settings): string | null {
  if (
    settings.approvalsReviewer === "guardian_subagent" ||
    settings.approvalsReviewer === "auto_review"
  )
    return "guardian";
  if (typeof settings.approvalPolicy === "object") return "granular";
  return settings.sandbox === "dangerFullAccess"
    ? "full-access"
    : settings.sandbox === "readOnly"
      ? "read-only"
      : settings.sandbox === "workspaceWrite"
        ? "auto"
        : null;
}

// thread/start·resume·fork 응답과 thread/settings/updated의 알림은 칸 이름이 조금 다르다.
function settingsOf(wire: J): Settings {
  const sandbox = wire.sandboxPolicy ?? wire.sandbox;
  return {
    model: wire.model,
    effort: wire.effort ?? wire.reasoningEffort ?? null,
    serviceTier: wire.serviceTier ?? null,
    approvalPolicy: wire.approvalPolicy,
    approvalsReviewer: wire.approvalsReviewer,
    sandbox: typeof sandbox === "string" ? sandbox : (sandbox?.type ?? ""),
    plan: wire.collaborationMode?.mode === "plan",
  };
}

const CAPABILITIES: AcpCapabilities = {
  model: true,
  effort: true,
  mode: true,
  commands: true,
  rewind: true,
  rewind_files: false, // thread/revert는 file을 되돌리지 않는다.
  fork: true,
  compact: true,
  rename: true,
  usage: true,
  steer: true,
  // Codex CLI에는 도는 tool을 background로 보내는 key가 없다.
  background: false,
  queue_edit: true,
  images: false, // 입력의 image는 blob hash뿐이라 localImage 경로를 만들 수 없다.
  retry: true,
  sessions: false,
  stop_child: true,
  steer_child: true,
  tasks: true,
  toggles: true,
  goal: true,
  roles: false,
  shell: true,
  resume: true,
};

// TUI 전용 명령과 `/copy`, `/side`, `/mention`, `/auto-review`는 창에 의미가 없어 넣지 않는다.
const BASE_COMMANDS: readonly {
  name: string;
  description: string;
  hint: string | null;
  opens: AcpCommand["opens"];
  aliases?: string[];
}[] = [
  {
    name: "model",
    description: "Choose the model and reasoning effort",
    hint: null,
    opens: "model",
  },
  {
    name: "permissions",
    description: "Choose what Codex can do without asking",
    hint: null,
    opens: "mode",
  },
  {
    name: "status",
    description: "Show model, permissions and context use",
    hint: null,
    opens: "status",
  },
  {
    name: "usage",
    description: "Show usage limits",
    hint: null,
    opens: "usage",
  },
  {
    name: "rename",
    description: "Rename this conversation",
    hint: "<name>",
    opens: "rename",
  },
  {
    name: "fork",
    description: "Fork this conversation",
    hint: null,
    opens: "fork",
  },
  {
    name: "resume",
    description: "Open an earlier conversation in this folder",
    hint: null,
    opens: "resume",
  },
  {
    name: "agents",
    description: "Show subagents",
    hint: null,
    opens: "subagents",
  },
  {
    name: "compact",
    description: "Compact the conversation context",
    hint: null,
    opens: null,
  },
  {
    name: "review",
    description: "Review uncommitted changes",
    hint: "[instructions]",
    opens: null,
  },
  {
    name: "goal",
    description: "Show or set the goal",
    hint: "[objective]",
    opens: null,
  },
  {
    name: "new",
    description: "Start a new conversation in this tab",
    hint: null,
    opens: null,
    aliases: ["clear"],
  },
  {
    name: "init",
    description: "Create an AGENTS.md for this repository",
    hint: null,
    opens: null,
  },
  {
    name: "mcp",
    description: "List MCP servers and their tools",
    hint: null,
    opens: null,
  },
  {
    name: "diff",
    description: "Show the git diff, including untracked files",
    hint: null,
    opens: null,
  },
  {
    name: "ps",
    description: "List background terminals",
    hint: null,
    opens: null,
  },
  {
    name: "stop",
    description: "Stop all background terminals",
    hint: null,
    opens: null,
  },
];

// TUI의 `/init`이 보내는 글(codex-rs/tui/assets/prompt_for_init_command.md, codex-cli 0.166.0). TUI처럼 사람 메시지 turn으로 보낸다.
const INIT_PROMPT = `Generate a file named AGENTS.md that serves as a contributor guide for this repository.
Before writing, check whether AGENTS.md already exists in the current working directory. If it does, do not overwrite or modify it.
Your goal is to produce a clear, concise, and well-structured document with descriptive headings and actionable explanations for each section.
Follow the outline below, but adapt as needed — add sections if relevant, and omit those that do not apply to this project.

Document Requirements

- Title the document "Repository Guidelines".
- Use Markdown headings (#, ##, etc.) for structure.
- Keep the document concise. 200-400 words is optimal.
- Keep explanations short, direct, and specific to this repository.
- Provide examples where helpful (commands, directory paths, naming patterns).
- Maintain a professional, instructional tone.

Recommended Sections

Project Structure & Module Organization

- Outline the project structure, including where the source code, tests, and assets are located.

Build, Test, and Development Commands

- List key commands for building, testing, and running locally (e.g., npm test, make build).
- Briefly explain what each command does.

Coding Style & Naming Conventions

- Specify indentation rules, language-specific style preferences, and naming patterns.
- Include any formatting or linting tools used.

Testing Guidelines

- Identify testing frameworks and coverage requirements.
- State test naming conventions and how to run tests.

Commit & Pull Request Guidelines

- Summarize commit message conventions found in the project’s Git history.
- Outline pull request requirements (descriptions, linked issues, screenshots, etc.).

(Optional) Add other sections if relevant, such as Security & Configuration Tips, Architecture Overview, or Agent-Specific Instructions.
`;

// TUI가 plan을 승인하면 보내는 글(tui/src/chatwidget/plan_implementation.rs `PLAN_IMPLEMENTATION_CODING_MESSAGE`).
const IMPLEMENT_PLAN = "Implement the plan.";

type Call = {
  id: string;
  done: boolean;
  /** 사람이 `!`로 친 글(`thread/shellCommand`로 보낸 그대로). item의 `command`는 `/bin/bash -lc …` 껍데기다. */
  typed?: string;
  changes: AcpApprovalFiles;
  lane: Lane;
};
type AcpApprovalFiles = {
  path: string;
  change: "create" | "update" | "delete";
  added: number;
  removed: number;
}[];

// 대화 하나가 도는 상태. root가 이 탭의 thread이고 자식은 subagent thread다(app-server가 자식 thread의 이벤트도 같은 연결로 준다).
// 자식의 갱신은 `child_update`로 싸서 낸다.
type Lane = {
  /** ACP `children`의 key(자식 thread id). root는 null. */
  child: string | null;
  thread: string;
  /** 도는 turn의 ACP id와 app-server id(steer와 interrupt가 쓴다). */
  turn: string | null;
  codexTurn: string | null;
  seq: number;
  modelCall: string | null;
  streamed: { text: number; reasoning: number };
  reasoning: string;
  summarized: Set<string>;
  calls: Map<string, Call>;
  /** turn이 끝나며 취소로 닫은 tool의 item id. 뒤늦은 `item/completed`가 새 줄을 만들지 않게 한다. */
  closed: Set<string>;
  /** 이 turn에 사람 메시지가 이미 있다(다음 메시지는 steer다). */
  hasUser: boolean;
  /** 마지막 agent message. subagent의 마지막 말이다. */
  last: string | null;
};
const newLane = (child: string | null, thread: string): Lane => ({
  child,
  thread,
  turn: null,
  codexTurn: null,
  seq: 0,
  modelCall: null,
  streamed: { text: 0, reasoning: 0 },
  reasoning: "",
  summarized: new Set(),
  calls: new Map(),
  closed: new Set(),
  hasUser: false,
  last: null,
});

type SubDetail = Extract<AcpToolItem["detail"], { kind: "subagent" }>;
/** spawn한 subagent. detail은 spawn tool 줄이 지금 보이는 값이다. */
const EARLY_PER_THREAD = 50;
const EARLY_TOTAL = 200;

type Sub = { call: Call; detail: SubDetail; started: string };

type ApprovalWait = {
  /** app-server가 요청에 붙인 id. 답에 그대로 쓴다. adapter 자신의 카드(plan)는 null이다. */
  rpc: number | string | null;
  lane: Lane;
  kind: "exec" | "permissions" | "plan";
  /** 서버가 허락한 결정. 없는 것은 보내지 않는다. */
  session: boolean;
  /** 영구 규칙이 되는 결정(서버가 낸 그대로). 없으면 영구 선택지가 없다. */
  always: J | null;
  /** permissions: 요청한 권한. 한 번·session 허락에 그대로 돌려준다. */
  requested: J | null;
};
type AskWait = {
  /** null이면 async 질문이다: 대기 중인 요청이 없고, 답은 사람 메시지로 보낸다. */
  rpc: number | string | null;
  group: string;
  call: Call;
  ids: string[];
  /** async 질문은 turn이 끝나도 남는다. turn_ended가 카드를 지우므로 그 뒤에 다시 낸다. */
  asked: AcpUpdate;
};

// tool 본문 한 쪽의 글자 수 상한. 이를 넘으면 자르고 truncated를 세운다(ACP_TOOL_BODY_LIMIT과 같은 값.
// 그 file은 zod 사슬을 끌어와 shell main tsc에 들이지 않는다).
const BODY_LIMIT = 65_536;
function bodyOf(input: string | null, output: string | null): AcpToolBody {
  const clip = (text: string | null) =>
    text === null ? null : text.slice(0, BODY_LIMIT);
  return {
    input: clip(input),
    output: clip(output),
    truncated:
      (input?.length ?? 0) > BODY_LIMIT || (output?.length ?? 0) > BODY_LIMIT,
  };
}
const jsonText = (value: J) =>
  value === undefined || value === null ? null : JSON.stringify(value, null, 2);

// CollabAgentStatus → subagent state.
function subState(status: string): SubDetail["state"] {
  switch (status) {
    case "completed":
      return "done";
    case "errored":
    case "notFound":
      return "failed";
    case "interrupted":
    case "shutdown":
      return "cancelled";
    default:
      return "running";
  }
}
const taskState = (state: SubDetail["state"]): AcpTask["state"] =>
  state === "cancelled" ? "stopped" : state;

function windowLabel(mins: number | null): string {
  if (mins === null) return "limit";
  if (mins === 10080) return "weekly";
  if (mins % 1440 === 0) return `${mins / 1440}d`;
  if (mins % 60 === 0) return `${mins / 60}h`;
  return `${mins}m`;
}

function goalOf(goal: J | null): AcpGoal | null {
  if (goal === null || goal === undefined) return null;
  const limited: Record<string, string> = {
    usageLimited: "Usage limit reached",
    budgetLimited: "Token budget reached",
  };
  const usage = `${goal.tokensUsed}${goal.tokenBudget == null ? "" : `/${goal.tokenBudget}`} tokens · ${goal.timeUsedSeconds}s`;
  return {
    objective: goal.objective,
    status:
      goal.status === "complete"
        ? "done"
        : limited[goal.status] !== undefined
          ? "blocked"
          : goal.status,
    detail: limited[goal.status] ? `${limited[goal.status]} · ${usage}` : usage,
  };
}

export function createCodexAdapter(io: CodexIo): HarnessGuiAdapter {
  return {
    handoff: "shared",

    // TUI는 빈 composer에서 Ctrl+C로 바로 끝난다(`DOUBLE_PRESS_QUIT_SHORTCUT_ENABLED = false`, tui/src/chatwidget/interaction.rs
    // `on_ctrl_c`). composer에 글이 있으면 먼저 지우고 일하는 중이면 먼저 멈추므로 끝날 때까지 몇 번 더 누른다.
    exitTui(terminal: AcpTerminal) {
      return new Promise<Result<void>>((resolve) => {
        let presses = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const off = terminal.onForegroundExit(() => finish(OK()));
        function finish(result: Result<void>) {
          clearTimeout(timer);
          off();
          resolve(result);
        }
        function press() {
          if (terminal.state() === "shell") return finish(OK());
          if (presses >= 4)
            return finish({
              ok: false,
              error: {
                code: "unavailable",
                message: "Codex did not exit after Ctrl+C.",
              },
            });
          presses += 1;
          terminal.type("\x03");
          timer = setTimeout(press, 700);
        }
        press();
      });
    },

    async start({ cwd, resume, session, spawn, clock, ids }) {
      let closed = false;
      let dead: { code: string; message: string } | null = null;
      let stderrTail = "";
      const now = () => clock.now();
      // 숨기기(rewind·fork·new)가 항목을 알아야 해서 낸 갱신을 그대로 접어 둔다.
      let mirror: AcpState = EMPTY_ACP_STATE;
      const publish = (update: AcpUpdate) => {
        if (closed) return;
        mirror = reduceAcp(mirror, update);
        session.publish(update);
      };
      const emit = (lane: Lane, update: AcpChildUpdate) =>
        publish(
          lane.child === null
            ? update
            : { type: "child_update", child: lane.child, update },
        );

      const dir = io.makeDir();
      const socket = join(dir, "codex.sock");
      const proc = spawn(
        "codex",
        ["app-server", "--listen", `unix://${socket}`],
        {
          cwd,
        },
      );
      if (proc.pid === undefined) {
        io.removeDir(dir);
        return {
          ok: false,
          error: {
            code: "unavailable",
            message: "`codex` was not found on PATH.",
          },
        };
      }
      let exited = false;
      const exit = new Promise<void>((done) =>
        proc.onExit(() => {
          exited = true;
          done();
        }),
      );
      proc.onStdout(() => {});
      proc.onStderr((text) => {
        stderrTail = (stderrTail + text).slice(-500);
      });

      // --- JSON-RPC
      let link: CodexLink | null = null;
      let nextRequest = 0;
      const pending = new Map<
        number,
        { resolve(value: Json): void; reject(cause: Error): void }
      >();
      // 요청 id → 기한 timer. cleanup이 닫힌 session에 남은 것을 지운다.
      const deadlines = new Map<number, ReturnType<typeof setTimeout>>();
      const write = (message: Json) => link?.send(JSON.stringify(message));
      const request = (method: string, params: Json) =>
        new Promise<Json>((resolve, reject) => {
          if (dead !== null) {
            reject(new Error(dead.message));
            return;
          }
          const id = ++nextRequest;
          const settle = () => {
            clearTimeout(deadlines.get(id));
            deadlines.delete(id);
          };
          if (!NO_DEADLINE.has(method))
            deadlines.set(
              id,
              setTimeout(() => {
                pending.delete(id);
                settle();
                reject(
                  new Error(
                    `Codex did not answer ${method} in ${REQUEST_WAIT_MS / 1000} seconds.`,
                  ),
                );
              }, REQUEST_WAIT_MS).unref(),
            );
          pending.set(id, {
            resolve: (value) => {
              settle();
              resolve(value);
            },
            reject: (cause) => {
              settle();
              reject(cause);
            },
          });
          write({ id, method, params });
        });
      // 실패해도 대화를 멈추지 않는 호출. 오류는 한 줄 알림으로 보인다.
      const attempt = async (what: string, call: () => Promise<unknown>) => {
        try {
          await call();
        } catch (cause) {
          info(
            `${what} failed: ${redactCredentials((cause as Error).message)}`,
          );
        }
      };

      let threadId = "";
      // 이 thread에 대화가 한 번이라도 있었나(rollout이 있나). 없으면 TUI가 resume으로 붙지 못한다.
      let materialized = false;
      let policy: Json = {};
      let settings: Settings | null = null;
      let models: J[] = [];
      let skills = new Map<string, string>();
      let canPlan = false;
      const root = newLane(null, "");
      // thread id → 대화. root와 아는 자식(collab·subAgentActivity item이 알려 준 thread)이다. 모르는 thread(fork로 떠난
      // 옛 thread)의 이벤트는 `early`에 잠깐 쌓였다 버려진다.
      const lanes = new Map<string, Lane>();
      // lane이 열리기 전(spawn item보다 먼저)에 온 자식 thread 이벤트. spawn item이 thread id를 알리면 lane에 붓고,
      // root turn이 끝날 때까지 lane이 안 열린 thread의 것은 버린다. thread마다·전체가 작게 묶여 있고 넘치면 오래된 것부터 버린다.
      const early = new Map<string, { method: string; params: Json }[]>();
      let earlyCount = 0;
      let stopPending = false;
      let reverting = false;
      let tokenUsage: J = null;
      // limitId → 마지막 RateLimitSnapshot.
      const snapshots = new Map<string, J>();
      let limits: AcpUsageLimit[] = [];
      // plan mode에서 끝난 plan item의 글. turn이 끝나면 "구현할까" 카드가 된다.
      let planText: string | null = null;
      // 자식 thread → spawn한 subagent. background shell은 processId → task.
      const subs = new Map<string, Sub>();
      const shells = new Map<string, AcpTask>();
      let shownTasks = "[]";
      const approvals = new Map<string, ApprovalWait>();
      const asks = new Map<string, AskWait>();
      const queue: { id: string; at: string; content: ContentBlock[] }[] = [];
      // retry가 다시 보낼 사람 메시지. turn마다 첫 메시지다.
      const userOf = new Map<string, ContentBlock[]>();
      // ACP turn → app-server turn. rewind·fork가 어느 turn인지 안다.
      const wireOf = new Map<string, string>();
      // `thread/shellCommand`로 보낸 글. userShell item이 오면 순서대로 짝짓는다.
      const shellSent: string[] = [];
      // 우리가 clientUserMessageId로 보낸 메시지. 그 echo는 다시 그리지 않는다.
      const sent = new Set<string>();

      // --- session meta
      const meta: AcpSessionMeta = {
        title: null,
        cli_session: null,
        capabilities: CAPABILITIES,
        models: [],
        model: null,
        modes: [],
        mode: null,
        commands: [],
        usage: null,
        toggles: [],
        goal: null,
        roles: null,
        harness: "codex",
      };
      let metaSent = false;
      function change(partial: Partial<AcpSessionMeta>) {
        Object.assign(meta, partial);
        if (metaSent) publish({ type: "session_changed", session: partial });
      }
      function modelMeta(): Partial<AcpSessionMeta> {
        const groups: AcpModelGroup[] = [
          {
            id: "codex",
            label: "Codex",
            models: models.map((one) => ({
              id: one.model,
              label: one.displayName || one.model,
              axes: [
                {
                  id: "effort",
                  label: "Effort",
                  kind: "choice" as const,
                  values: (one.supportedReasoningEfforts ?? []).map(
                    (effort: J) => ({
                      value: effort.reasoningEffort,
                      label: effort.reasoningEffort,
                    }),
                  ),
                },
                // tier가 하나뿐이어도 choice다: model마다 tier 수가 달라 switch로 줄이면 ultrafast가 있는 model과 모양이 갈린다.
                ...((one.serviceTiers ?? []).length === 0
                  ? []
                  : [
                      {
                        id: "speed",
                        label: "Speed",
                        kind: "choice" as const,
                        values: [
                          { value: "default", label: "Standard" },
                          ...(one.serviceTiers as J[]).map((tier) => ({
                            value: tier.id as string,
                            label: tier.name as string,
                          })),
                        ],
                      },
                    ]),
              ],
            })),
          },
        ];
        const current = settings;
        const known = models.find((one) => one.model === current?.model);
        return {
          models: groups,
          model:
            current === null
              ? null
              : {
                  model: current.model,
                  label: known?.displayName || current.model,
                  options: {
                    ...(current.effort ? { effort: current.effort } : {}),
                    ...((known?.serviceTiers ?? []).length === 0
                      ? {}
                      : {
                          speed:
                            current.serviceTier ??
                            known?.defaultServiceTier ??
                            "default",
                        }),
                  },
                  layer: null,
                },
        };
      }
      function modesMeta(): Partial<AcpSessionMeta> {
        const mode = settings === null ? null : modeOf(settings);
        const ids: string[] = ["read-only", "auto", "full-access"];
        if (mode === "guardian" || mode === "granular") ids.push(mode);
        return {
          mode,
          modes: ids.map((id) => {
            const [label, description] =
              MODE_CHOICES[id as keyof typeof MODE_CHOICES];
            return { id, label, description };
          }),
        };
      }
      function applySettings(wire: J) {
        settings = settingsOf(wire);
        change({ ...modelMeta(), ...modesMeta(), ...togglesMeta() });
      }
      function togglesMeta(): Partial<AcpSessionMeta> {
        return {
          toggles: canPlan
            ? [
                {
                  id: "plan",
                  label: "Plan mode",
                  description:
                    "Codex plans first and asks before implementing.",
                  on: settings?.plan ?? false,
                },
              ]
            : [],
        };
      }
      function commandsMeta(): Partial<AcpSessionMeta> {
        const harness = (
          name: string,
          description: string,
          hint: string | null,
          opens: AcpCommand["opens"],
          aliases: string[] = [],
        ): AcpCommand => ({
          name,
          aliases,
          description,
          argument_hint: hint,
          source: "harness",
          opens,
        });
        return {
          commands: [
            ...BASE_COMMANDS.map((one) =>
              harness(
                one.name,
                one.description,
                one.hint,
                one.opens,
                one.aliases,
              ),
            ),
            ...(canPlan
              ? [harness("plan", "Turn plan mode on or off", null, null)]
              : []),
            ...[...skills.keys()].map(
              (name): AcpCommand => ({
                name,
                aliases: [],
                description: `Run the ${name} skill`,
                argument_hint: "[request]",
                source: "skill",
                opens: null,
              }),
            ),
          ],
        };
      }

      // --- ACP 항목
      // turn 밖이면 turn이 null인 알림이다.
      function info(text: string, level: "info" | "warning" = "info") {
        publish({
          type: "notice_added",
          item: {
            kind: "notice",
            id: ids.newId("not"),
            seq: ++root.seq,
            at: now(),
            turn: root.turn,
            notice: { type: "info", text, level },
          },
        });
      }

      function output(
        command: string,
        text: string,
        format: "markdown" | "preformatted" = "markdown",
      ) {
        publish({
          type: "notice_added",
          item: {
            kind: "notice",
            id: ids.newId("not"),
            seq: ++root.seq,
            at: now(),
            turn: root.turn,
            notice: { type: "command_output", command, text, format },
          },
        });
      }

      function startTurn(lane: Lane): string {
        const id = ids.newId("trn");
        lane.turn = id;
        if (lane === root && lane.codexTurn !== null)
          wireOf.set(id, lane.codexTurn);
        // 새 turn이 열리면 답하지 않은 "구현할까" 카드는 지난 일이다.
        if (lane === root)
          for (const [request, wait] of [...approvals])
            if (wait.kind === "plan") closeApproval(request, "cancelled");
        emit(lane, { type: "turn_started", turn: id, at: now() });
        return id;
      }
      const ensureTurn = (lane: Lane) => lane.turn ?? startTurn(lane);

      function addUser(
        lane: Lane,
        id: string,
        content: ContentBlock[],
        delivery: "next_turn" | "steer",
        origin: string,
        // 다른 agent가 넣은 글이다. 사람 메시지가 아니라 rewind 글도 bookmark(origin)도 아니다.
        received: ReceivedText | null = null,
      ) {
        const owner = delivery === "steer" ? lane.turn : ensureTurn(lane);
        if (received === null && owner !== null && !lane.hasUser) {
          lane.hasUser = true;
          if (lane === root) userOf.set(owner, content);
        }
        emit(lane, {
          type: "message_added",
          item: {
            kind: "message",
            id,
            seq: ++lane.seq,
            at: now(),
            actor: received === null ? "user" : "received",
            sender: received?.sender ?? null,
            call: received?.call ?? null,
            reply_to: received?.reply_to ?? null,
            delivery,
            turn: owner,
            origin: received === null ? origin : null,
            content:
              received === null
                ? content
                : [{ type: "text", text: received.text }],
            reasoning: null,
            cards: [],
            complete: true,
          },
        });
      }

      function subDetail(item: Item): SubDetail {
        const child = item.receiverThreadIds?.[0] ?? null;
        const known = child === null ? undefined : item.agentsStates?.[child];
        return {
          kind: "subagent",
          agent: "agent",
          description: oneLine(item.prompt ?? "", 200),
          child,
          state:
            item.status === "failed"
              ? "failed"
              : known === undefined
                ? "running"
                : subState(known.status),
          model: item.model || null,
          last: known?.message ?? null,
        };
      }

      function describe(item: Item, call: Call) {
        let tool: string;
        let category: AcpToolItem["category"] = "other";
        let title: string;
        let detail: AcpToolItem["detail"] = { kind: "generic" };
        let body: AcpToolBody | null = null;
        let by: AcpToolItem["by"] = "agent";
        switch (item.type) {
          case "commandExecution": {
            const actions = (item.commandActions ?? []).map(
              (one) => one.command,
            );
            const shown =
              actions.length > 0 ? actions.join(" && ") : (item.command ?? "");
            tool = "shell";
            category = commandCategory(item);
            if (item.source === "userShell") {
              by = "user";
              category = "command";
              const typed = call.typed ?? shown;
              title = oneLine(typed.split("\n")[0] ?? "", 120);
              body = bodyOf(typed, item.aggregatedOutput ?? null);
              break;
            }
            title = `shell ${oneLine(shown, 120)}`;
            body = bodyOf(item.command ?? null, item.aggregatedOutput ?? null);
            break;
          }
          case "fileChange": {
            const changes = item.changes ?? [];
            call.changes = changes.map((one) => ({
              path: relative(cwd, one.path),
              change:
                one.kind.type === "add"
                  ? "create"
                  : one.kind.type === "delete"
                    ? "delete"
                    : "update",
              ...changeCounts(one),
            }));
            const paths = call.changes.map((one) => one.path);
            const first = paths[0] ?? "";
            tool = "apply_patch";
            title = `apply_patch ${oneLine(first, 100)}${paths.length > 1 ? ` (+${paths.length - 1} files)` : ""}`;
            detail = {
              kind: "edit",
              document: changes[0]?.path ?? first,
              path: first,
              added: call.changes.reduce((sum, one) => sum + one.added, 0),
              removed: call.changes.reduce((sum, one) => sum + one.removed, 0),
            };
            body = bodyOf(
              paths.join("\n"),
              changes.map((one) => `${one.path}\n${one.diff}`).join("\n\n"),
            );
            break;
          }
          case "webSearch":
            tool = "web_search";
            category = "web";
            title = `web_search ${oneLine(item.query ?? "", 100)}`;
            body = bodyOf(item.query ?? null, null);
            break;
          case "imageView":
            tool = "view_image";
            category = "read";
            title = `view_image ${basename(item.path ?? "")}`;
            break;
          case "imageGeneration":
            tool = "image_generation";
            title = `image_generation ${oneLine(item.revisedPrompt ?? "", 100)}`;
            body = bodyOf(item.revisedPrompt ?? null, item.savedPath ?? null);
            break;
          case "collabAgentToolCall":
            tool = `agent.${item.tool ?? "call"}`;
            title = `${tool} ${oneLine(item.prompt ?? "", 80)}`;
            if (item.tool === "spawnAgent") detail = subDetail(item);
            body = bodyOf(item.prompt ?? null, null);
            break;
          case "subAgentActivity":
            tool = "agent.activity";
            title = `subagent ${item.kind ?? "activity"}`;
            break;
          case "dynamicToolCall":
            tool = `${item.namespace ? `${item.namespace}.` : ""}${item.tool ?? "tool"}`;
            title = tool;
            body = bodyOf(
              jsonText(item.arguments),
              jsonText(item.contentItems),
            );
            break;
          default:
            tool = `${item.server ?? "mcp"}.${item.tool ?? "tool"}`;
            title = tool;
            body = bodyOf(
              jsonText(item.arguments),
              jsonText(item.result ?? item.error),
            );
        }
        return { by, tool, category, title: title.trim(), detail, body };
      }

      const TOOL_ITEMS = new Set([
        "commandExecution",
        "fileChange",
        "mcpToolCall",
        "dynamicToolCall",
        "webSearch",
        "imageView",
        "imageGeneration",
        "collabAgentToolCall",
        "subAgentActivity",
      ]);

      function toolStart(lane: Lane, item: Item): Call {
        const known = lane.calls.get(item.id);
        if (known !== undefined) return known;
        const call: Call = {
          id: ids.newId("tcl"),
          done: false,
          changes: [],
          lane,
          ...(item.source === "userShell" && shellSent.length > 0
            ? { typed: shellSent.shift() }
            : {}),
        };
        lane.calls.set(item.id, call);
        lane.modelCall = null;
        const shown = describe(item, call);
        emit(lane, {
          type: "tool_started",
          item: {
            kind: "tool",
            id: call.id,
            seq: ++lane.seq,
            at: now(),
            by: shown.by,
            // 사람이 돌린 명령이 turn 밖(app-server가 연 shell turn, 다시 그린 옛 turn)이면 turn이 없다.
            turn:
              shown.by === "user" && lane.turn === null
                ? null
                : ensureTurn(lane),
            tool: shown.tool,
            category: shown.category,
            title: shown.title,
            state: "running",
            duration_ms: null,
            detail: shown.detail,
            body: shown.body,
          },
        });
        return call;
      }

      function toolEnd(
        call: Call,
        state: ReturnType<typeof toolState>,
        shown?: ReturnType<typeof describe>,
      ) {
        call.done = true;
        emit(call.lane, {
          type: "tool_ended",
          tool_call: call.id,
          state,
          at: now(),
          detail: shown?.detail ?? null,
          body: shown?.body ?? null,
        });
      }

      // --- subagent. spawn tool 줄의 detail을 이후의 wait·closeAgent·자식 turn 끝이 바꾼다.
      function openLane(thread: string) {
        if (!lanes.has(thread)) lanes.set(thread, newLane(thread, thread));
      }

      function holdEarly(thread: string, method: string, params: Json) {
        const held = early.get(thread) ?? [];
        early.set(thread, held);
        held.push({ method, params });
        earlyCount += 1;
        if (held.length > EARLY_PER_THREAD) {
          held.shift();
          earlyCount -= 1;
        }
        while (earlyCount > EARLY_TOTAL) {
          const [oldest, list] = early.entries().next().value as [
            string,
            { method: string; params: Json }[],
          ];
          list.shift();
          earlyCount -= 1;
          if (list.length === 0) early.delete(oldest);
        }
      }

      function dropEarly() {
        early.clear();
        earlyCount = 0;
      }

      function flushEarly(thread: string) {
        const held = early.get(thread);
        if (held === undefined) return;
        early.delete(thread);
        earlyCount -= held.length;
        for (const one of held) onNotification(one.method, one.params);
      }

      function updateSub(child: string, patch: Partial<SubDetail>) {
        const sub = subs.get(child);
        if (sub === undefined) return;
        const next = { ...sub.detail, ...patch };
        if (JSON.stringify(next) === JSON.stringify(sub.detail)) return;
        sub.detail = next;
        emit(sub.call.lane, {
          type: "tool_detail_changed",
          tool_call: sub.call.id,
          detail: next,
        });
      }

      function childEnded(lane: Lane, status: string) {
        updateSub(lane.thread, {
          state:
            status === "completed"
              ? "done"
              : status === "interrupted"
                ? "cancelled"
                : "failed",
          ...(lane.last === null ? {} : { last: lane.last }),
        });
        publishTasks();
      }

      function trackAgents(item: Item, call: Call) {
        for (const thread of [
          ...(item.receiverThreadIds ?? []),
          ...(item.agentThreadId ? [item.agentThreadId] : []),
        ])
          openLane(thread);
        if (item.type === "subAgentActivity") {
          if (item.agentThreadId)
            updateSub(item.agentThreadId, {
              ...(item.agentPath ? { agent: item.agentPath } : {}),
              ...(item.model ? { model: item.model } : {}),
            });
        } else {
          const detail = subDetail(item);
          if (item.tool === "spawnAgent" && detail.child !== null)
            subs.set(detail.child, { call, detail, started: now() });
          for (const [child, state] of Object.entries(item.agentsStates ?? {}))
            updateSub(child, {
              state: subState(state.status),
              ...(state.message === null ? {} : { last: state.message }),
            });
        }
        publishTasks();
        // sub를 등록한 뒤에 붓는다: 쌓인 turn/started·turn/completed가 그 sub의 detail을 바꾼다.
        for (const thread of [
          ...(item.receiverThreadIds ?? []),
          ...(item.agentThreadId ? [item.agentThreadId] : []),
        ])
          flushEarly(thread);
      }

      // --- background task: shell(thread/backgroundTerminals)과 subagent
      function publishTasks() {
        const tasks: AcpTask[] = [
          ...shells.values(),
          ...[...subs].map(
            ([child, sub]): AcpTask => ({
              id: child,
              kind: "agent",
              description: sub.detail.description,
              state: taskState(sub.detail.state),
              started_at: sub.started,
              output: sub.detail.last?.slice(-BODY_LIMIT) ?? null,
            }),
          ),
        ];
        const text = JSON.stringify(tasks);
        if (text === shownTasks) return;
        shownTasks = text;
        publish({ type: "tasks_changed", tasks });
      }

      async function readShells() {
        const listed = await request("thread/backgroundTerminals/list", {
          threadId,
        }).catch(() => null);
        if (listed === null) return;
        const live = new Set<string>();
        for (const one of listed.data ?? []) {
          live.add(one.processId);
          if (!shells.has(one.processId))
            shells.set(one.processId, {
              id: one.processId,
              kind: "shell",
              description: one.command,
              state: "running",
              started_at: now(),
              output: null,
            });
        }
        for (const [id, task] of shells)
          if (!live.has(id) && task.state === "running")
            shells.set(id, { ...task, state: "done" });
        publishTasks();
      }

      function runningTasks(): number {
        return (
          [...shells.values()].filter((one) => one.state === "running").length +
          [...subs.values()].filter((one) => one.detail.state === "running")
            .length
        );
      }

      // origin은 그 CLI 자신의 message id다. message_recorded에는 칸이 없어 따로 낸다.
      function record(lane: Lane, text: string, origin: string) {
        const message = ids.newId("msg");
        emit(lane, {
          type: "message_recorded",
          turn: ensureTurn(lane),
          message,
          model_call: lane.modelCall,
          seq: ++lane.seq,
          at: now(),
          body: {
            content: [{ type: "text", text }],
            reasoning:
              lane.reasoning === ""
                ? null
                : { text: lane.reasoning, duration_ms: null },
            cards: [],
          },
        });
        emit(lane, { type: "origin_set", message, origin });
        lane.reasoning = "";
        lane.modelCall = null;
        lane.streamed.text = 0;
        lane.streamed.reasoning = 0;
        lane.last = text;
      }

      function itemDone(lane: Lane, item: Item) {
        if (item.type === "agentMessage" || item.type === "plan") {
          if (item.text) record(lane, item.text, item.id);
          if (item.type === "plan" && lane === root && settings?.plan === true)
            planText = item.text ?? null;
        } else if (item.type === "reasoning") {
          const parts =
            (item.summary ?? []).length > 0 ? item.summary : item.content;
          const text = (parts ?? [])
            .filter((one) => typeof one === "string")
            .join("\n\n");
          if (text !== "")
            lane.reasoning =
              lane.reasoning === "" ? text : `${lane.reasoning}\n\n${text}`;
        } else if (TOOL_ITEMS.has(item.type)) {
          if (lane.closed.has(item.id)) return;
          const call = toolStart(lane, item);
          if (!call.done) {
            toolEnd(call, toolState(item), describe(item, call));
            if (
              item.type === "collabAgentToolCall" ||
              item.type === "subAgentActivity"
            )
              trackAgents(item, call);
          }
        } else if (lane === root && item.type === "contextCompaction") {
          info("Context compacted.");
        } else if (lane === root && item.type === "enteredReviewMode") {
          info(`Review started: ${oneLine(item.review ?? "", 120)}`);
        }
        // exitedReviewMode는 그리지 않는다: 같은 글이 바로 뒤의 agentMessage로 오고 그쪽이 대화에 든다(녹화 review).
      }

      function stream(lane: Lane, kind: "text" | "reasoning", text: string) {
        if (text === "") return;
        lane.modelCall ??= ids.newId("mcl");
        emit(lane, {
          type: "writing_streamed",
          turn: ensureTurn(lane),
          model_call: lane.modelCall,
          kind,
          offset: lane.streamed[kind],
          text,
          at: now(),
        });
        lane.streamed[kind] += text.length;
      }

      // --- 숨기기(rewind, fork, new): 낸 항목 중 `fromSeq` 뒤를 hidden 하나로 묶는다.
      function hideFrom(fromSeq: number, checkpoint: string) {
        const entries: AcpEntry[] = mirror.items
          .filter((one) => one.seq >= fromSeq)
          .flatMap((one) => (one.kind === "hidden" ? one.items : [one]));
        if (entries.length === 0) return;
        publish({
          type: "hidden_added",
          item: {
            kind: "hidden",
            id: ids.newId("hid"),
            seq: Math.min(...entries.map((one) => one.seq)),
            at: now(),
            checkpoint,
            choice: "messages_only",
            count: entries.length,
            restored: 0,
            left: [],
            items: entries,
          },
        });
      }
      const messageItem = (id: string) =>
        mirror.items
          .flatMap((one) => (one.kind === "hidden" ? one.items : [one]))
          .find((one) => one.kind === "message" && one.id === id);

      // --- approvals
      function openApproval(
        lane: Lane,
        rpc: number | string,
        method: string,
        params: Json,
      ) {
        const isCommand = method === "item/commandExecution/requestApproval";
        const call = lane.calls.get(String(params.itemId));
        const decisions: J[] | null = isCommand
          ? (params.availableDecisions ?? null)
          : null;
        // 서버가 낸 결정만 쓴다. patch 요청은 목록이 없고 accept·acceptForSession·decline·cancel이 정해져 있다.
        const session = isCommand
          ? decisions?.includes("acceptForSession") === true
          : true;
        const permanent: J[] = (decisions ?? []).filter(
          (one) => typeof one === "object",
        );
        const always =
          permanent.find(
            (one) =>
              one.applyNetworkPolicyAmendment?.network_policy_amendment
                ?.action === "allow",
          ) ??
          permanent.find((one) => one.acceptWithExecpolicyAmendment) ??
          permanent[0] ??
          null;
        const actions: string[] = (params.commandActions ?? []).map(
          (one: J) => one.command,
        );
        const command = String(
          actions.length > 0
            ? actions.join(" && ")
            : (params.command ??
                (params.networkApprovalContext
                  ? `network access to ${params.networkApprovalContext.host}`
                  : (params.reason ?? "command"))),
        );
        const subject: AcpApprovalItem["subject"] = isCommand
          ? { kind: "shell", command }
          : {
              kind: "file_change",
              changes: (call?.changes ?? []).map((one) => ({
                path: one.path,
                change: one.change,
                added: one.added,
                removed: one.removed,
              })),
            };
        // file_change subject에는 이유와 grantRoot를 실을 칸이 없다.
        if (!isCommand && (params.reason || params.grantRoot))
          info(
            `Codex asks to edit files${params.grantRoot ? ` under ${params.grantRoot}` : ""}${params.reason ? `: ${oneLine(params.reason, 200)}` : ""}`,
          );
        const permanence = always?.applyNetworkPolicyAmendment
          ? `allow ${always.applyNetworkPolicyAmendment.network_policy_amendment.host}`
          : command;
        const request = ids.newId("apr");
        approvals.set(request, {
          rpc,
          lane,
          kind: "exec",
          session,
          always,
          requested: null,
        });
        publish({
          type: "approval_opened",
          approval: {
            id: request,
            subject,
            choices: [
              "once",
              ...(session ? (["session"] as const) : []),
              ...(always === null ? [] : (["always"] as const)),
              "reject",
            ],
            always_patterns:
              always === null
                ? []
                : [
                    oneLine(
                      `${permanence} (permanent: saved to ~/.codex/rules)`,
                      500,
                    ),
                  ],
          },
        });
      }

      // 추가 권한(request_permissions tool). 답이 한 번(turn)·session이고 영구 범위는 없다.
      function openPermissions(lane: Lane, rpc: number | string, params: Json) {
        const asked = params.permissions ?? {};
        const parts: string[] = [];
        const files = asked.fileSystem;
        if (files?.write?.length) parts.push(`write ${files.write.join(", ")}`);
        if (files?.read?.length) parts.push(`read ${files.read.join(", ")}`);
        if (asked.network) parts.push("network access");
        if (params.reason)
          info(
            `Codex asks for extra permissions: ${oneLine(params.reason, 200)}`,
          );
        const request = ids.newId("apr");
        approvals.set(request, {
          rpc,
          lane,
          kind: "permissions",
          session: true,
          always: null,
          requested: {
            ...(asked.network ? { network: asked.network } : {}),
            ...(asked.fileSystem ? { fileSystem: asked.fileSystem } : {}),
          },
        });
        publish({
          type: "approval_opened",
          approval: {
            id: request,
            subject: {
              kind: "mcp_tool",
              server: "codex",
              tool: oneLine(`extra permissions: ${parts.join("; ")}`, 300),
              effect: "external",
            },
            choices: ["once", "session", "reject"],
            always_patterns: [],
          },
        });
      }

      // plan mode의 plan이 끝나면 TUI의 "Implement this plan?"을 대신하는 adapter의 카드다. 답할 rpc가 없다.
      function openPlanCard(plan: string) {
        const request = ids.newId("apr");
        approvals.set(request, {
          rpc: null,
          lane: root,
          kind: "plan",
          session: false,
          always: null,
          requested: null,
        });
        publish({
          type: "approval_opened",
          approval: {
            id: request,
            subject: {
              kind: "plan",
              plan,
              modes: [{ id: "default", label: "Implement" }],
            },
            choices: ["reject"],
            always_patterns: [],
          },
        });
      }

      // answer가 false면 이미 server가 푼 요청이라 답하지 않는다. `mode`는 plan 카드를 승인하는 결정이다.
      function closeApproval(
        id: string,
        decision:
          | "once"
          | "session"
          | "always"
          | "reject"
          | "cancelled"
          | "mode",
        reason?: string,
        answer = true,
      ) {
        const wait = approvals.get(id);
        if (wait === undefined) return;
        // plan 카드는 mode 결정으로만 승인하고, mode 결정은 plan 카드에만 쓴다.
        if (
          wait.kind === "plan"
            ? decision === "once" ||
              decision === "session" ||
              decision === "always"
            : decision === "mode"
        )
          return;
        approvals.delete(id);
        // 서버가 내지 않은 범위는 한 번 허락으로 줄인다. 영구 규칙은 영구 선택지에서만 나간다.
        const granted =
          decision === "session" && wait.session
            ? "session"
            : decision === "always" && wait.always !== null
              ? "always"
              : decision === "once" ||
                  decision === "session" ||
                  decision === "always" ||
                  decision === "mode"
                ? "once"
                : null;
        if (answer && wait.rpc !== null) {
          if (wait.kind === "permissions")
            write({
              id: wait.rpc,
              result: {
                permissions: granted === null ? {} : wait.requested,
                scope: granted === "session" ? "session" : "turn",
              },
            });
          else
            write({
              id: wait.rpc,
              result: {
                decision:
                  granted === "always"
                    ? wait.always
                    : granted === "session"
                      ? "acceptForSession"
                      : granted === "once"
                        ? "accept"
                        : decision === "reject"
                          ? "decline"
                          : "cancel",
              },
            });
        }
        publish({
          type: "approval_closed",
          request: id,
          outcome:
            granted !== null
              ? "allowed"
              : decision === "reject"
                ? "denied"
                : "cancelled",
          choice: granted === "once" && wait.kind === "plan" ? null : granted,
          reason: reason ?? null,
          mode: decision === "mode" ? "default" : null,
          seq: ++root.seq,
          at: now(),
        });
        if (wait.kind === "plan" && decision === "mode")
          void attempt("Plan", implementPlan);
      }

      // --- 질문
      function openQuestion(
        lane: Lane,
        rpc: number | string | null,
        asked: {
          id: string;
          header: string;
          question: string;
          options: { label: string; description: string }[];
        }[],
      ) {
        const group = ids.newId("grp");
        const call: Call = {
          id: ids.newId("tcl"),
          done: false,
          changes: [],
          lane,
        };
        // async 질문의 글은 그 agentMessage가 이미 대화에 그린다.
        if (rpc !== null)
          emit(lane, {
            type: "tool_started",
            item: {
              kind: "tool",
              id: call.id,
              seq: ++lane.seq,
              at: now(),
              by: "agent",
              turn: ensureTurn(lane),
              tool: "request_user_input",
              category: "other",
              title: "Question",
              state: "running",
              duration_ms: null,
              detail: {
                kind: "question",
                group: null,
                outcome: null,
                lines: [],
              },
              body: null,
            },
          });
        const update: AcpUpdate = {
          type: "question_asked",
          group,
          tool_call: call.id,
          // ACP 질문은 선택지 2~4개가 필요하다. 글로만 답하는 질문에는 안내 선택지를 채운다.
          questions: asked.map((one) => {
            const options = one.options.slice(0, 4);
            while (options.length < 2)
              options.push(
                options.length === 0
                  ? {
                      label: "Answer",
                      description: "Type the answer under Other",
                    }
                  : { label: "Skip", description: "No answer" },
              );
            return {
              question: one.question,
              header: oneLine(one.header || one.question, 24),
              options,
              multiSelect: false,
            };
          }),
        };
        asks.set(call.id, {
          rpc,
          group,
          call,
          ids: asked.map((one) => one.id),
          asked: update,
        });
        publish(update);
      }

      // turn 안에서 server가 답을 기다리는 질문(request_user_input).
      function openBlockingQuestion(
        lane: Lane,
        rpc: number | string,
        params: Json,
      ) {
        const asked: J[] = (params.questions ?? []).slice(0, 4);
        openQuestion(
          lane,
          rpc,
          asked.map((one) => ({
            id: one.id,
            header: one.header,
            question: one.question,
            options: (one.options ?? []).map((option: J) => ({
              label: option.label,
              description: option.description || option.label,
            })),
          })),
        );
      }

      // 기다리는 요청이 없는 질문(request_user_input_async): model은 질문을 낸 채 일을 이어 가고 답은 새 사람 메시지로 온다.
      function openAsyncQuestion(
        lane: Lane,
        questions: NonNullable<Item["questions"]>,
      ) {
        openQuestion(
          lane,
          null,
          questions.slice(0, 4).map((one, index) => ({
            id: String(index),
            header: one.title,
            question: one.title,
            options: (one.options ?? []).map((label) => ({
              label,
              description: label,
            })),
          })),
        );
      }

      function closeQuestion(
        callId: string,
        outcome: "submitted" | "cancelled",
        answers?: Json,
      ) {
        const wait = asks.get(callId);
        if (wait === undefined) return;
        asks.delete(callId);
        if (wait.rpc !== null && answers !== undefined)
          write({ id: wait.rpc, result: { answers } });
        publish({ type: "question_resolved", group: wait.group, outcome });
        if (wait.rpc !== null)
          toolEnd(wait.call, outcome === "submitted" ? "ok" : "cancelled");
      }

      // --- turns
      function startNext() {
        const next = queue.shift();
        if (next === undefined) return;
        const id = startTurn(root);
        userOf.set(id, next.content);
        root.hasUser = true;
        publish({
          type: "message_taken",
          message: next.id,
          seq: ++root.seq,
          delivery: "next_turn",
          turn: id,
        });
        begin(next.id, inputOf(next.content));
      }

      function endTurn(
        lane: Lane,
        outcome: "completed" | "stopped" | "failed",
        error?: { code: string; message: string },
      ) {
        const id = lane.turn ?? ids.newId("trn");
        // server가 turn을 끝내며 이미 푼 요청이다. 답은 보내지 않고 카드만 닫는다(plan 카드는 turn이 끝난 뒤에 뜬다).
        for (const [request, wait] of [...approvals])
          if (wait.lane === lane && wait.kind !== "plan")
            closeApproval(request, "cancelled", undefined, false);
        for (const [call, wait] of [...asks])
          if (wait.call.lane === lane && wait.rpc !== null)
            closeQuestion(call, "cancelled");
        for (const [itemId, call] of lane.calls)
          if (!call.done) {
            toolEnd(call, "cancelled");
            lane.closed.add(itemId);
          }
        lane.calls.clear();
        lane.reasoning = "";
        lane.modelCall = null;
        lane.streamed.text = 0;
        lane.streamed.reasoning = 0;
        lane.summarized.clear();
        lane.hasUser = false;
        emit(lane, {
          type: "turn_ended",
          turn: id,
          at: now(),
          outcome,
          active_ms: null,
          error: error ?? null,
          messages: [],
          seq: ++lane.seq,
        });
        lane.turn = null;
        lane.codexTurn = null;
        if (lane !== root) return;
        for (const wait of asks.values())
          if (wait.rpc === null) publish(wait.asked);
        stopPending = false;
        if (dead === null) startNext();
      }

      const interrupt = (lane: Lane) =>
        void request("turn/interrupt", {
          threadId: lane.thread,
          turnId: lane.codexTurn,
        }).catch(() => {});

      // ACP turn은 이미 시작했다. app-server에 새 turn을 연다.
      function begin(messageId: string, input: J[]) {
        sent.add(messageId);
        request("turn/start", {
          threadId,
          clientUserMessageId: messageId,
          input,
        }).then(
          (result) => {
            if (root.turn === null) return;
            root.codexTurn = (result.turn as { id: string }).id;
            wireOf.set(root.turn, root.codexTurn);
            if (stopPending) interrupt(root);
          },
          (cause: Error) =>
            endTurn(root, "failed", {
              code: "internal",
              message: cause.message,
            }),
        );
      }

      function sendNow(id: string, content: ContentBlock[]) {
        addUser(root, id, content, "next_turn", id);
        if (dead === null) begin(id, inputOf(content));
        else endTurn(root, "failed", dead);
      }

      // 도는 turn에 끼워 넣는다. 못 하면(turn이 막 끝남 등) 줄을 서거나 새 turn이 된다.
      async function steer(
        id: string,
        content: ContentBlock[],
        accepted: () => void,
        refused: () => void,
      ) {
        sent.add(id);
        try {
          await request("turn/steer", {
            threadId,
            expectedTurnId: root.codexTurn,
            clientUserMessageId: id,
            input: inputOf(content),
          });
        } catch {
          refused();
          return;
        }
        accepted();
      }

      function enqueue(id: string, content: ContentBlock[]) {
        const queued = { id, at: now(), content };
        queue.push(queued);
        publish({ type: "message_queued", queued });
      }

      // --- subagent 조작: 자식 thread의 도는 turn을 멈추거나 방향을 준다. 도는 turn이 없으면 새 turn이다.
      function stopChild(child: string) {
        const lane = lanes.get(child);
        if (lane !== undefined && lane.codexTurn !== null) interrupt(lane);
      }

      async function steerChild(child: string, text: string) {
        const lane = lanes.get(child);
        if (lane === undefined || lane === root) return;
        const content: ContentBlock[] = [{ type: "text", text }];
        const id = ids.newId("msg");
        sent.add(id);
        const running = lane.turn !== null && lane.codexTurn !== null;
        await attempt("Subagent message", async () => {
          if (running) {
            await request("turn/steer", {
              threadId: child,
              expectedTurnId: lane.codexTurn,
              clientUserMessageId: id,
              input: inputOf(content),
            });
            addUser(lane, id, content, "steer", id);
            return;
          }
          addUser(lane, id, content, "next_turn", id);
          try {
            const started = await request("turn/start", {
              threadId: child,
              clientUserMessageId: id,
              input: inputOf(content),
            });
            lane.codexTurn = (started.turn as { id: string }).id;
          } catch (cause) {
            endTurn(lane, "failed", {
              code: "internal",
              message: (cause as Error).message,
            });
            throw cause;
          }
        });
      }

      async function stopTask(task: string) {
        if (subs.has(task)) return stopChild(task);
        const shell = shells.get(task);
        if (shell === undefined) return;
        await attempt("Stop terminal", async () => {
          await request("thread/backgroundTerminals/terminate", {
            threadId,
            processId: task,
          });
          shells.set(task, { ...shell, state: "stopped" });
        });
        await readShells();
      }

      // --- 설정: plan mode와 goal
      async function setPlan(on: boolean) {
        const current = settings;
        if (current === null) return;
        await attempt("Plan mode", () =>
          request("thread/settings/update", {
            threadId,
            collaborationMode: {
              mode: on ? "plan" : "default",
              settings: {
                model: current.model,
                reasoning_effort: current.effort,
                developer_instructions: null,
              },
            },
          }),
        );
      }

      // "Implement this plan?"에 승인했다: default mode로 돌리고 TUI와 같은 글로 구현을 시킨다.
      async function implementPlan() {
        await setPlan(false);
        const id = ids.newId("msg");
        sendNow(id, [{ type: "text", text: IMPLEMENT_PLAN }]);
      }

      async function setGoal(objective: string | null, paused: boolean) {
        await attempt("Goal", async () => {
          if (objective === null) {
            await request("thread/goal/clear", { threadId, origin: "user" });
            return;
          }
          const reply = await request("thread/goal/set", {
            threadId,
            origin: "user",
            ...(paused
              ? { status: "paused" }
              : { objective, status: "active" }),
          });
          change({ goal: goalOf(reply.goal) });
        });
      }

      // --- notifications
      function onUserMessage(lane: Lane, item: Item) {
        // 우리가 보낸 메시지의 echo다.
        if (item.clientId && sent.has(item.clientId)) return;
        // TUI 같은 다른 client가 보낸 메시지다.
        const content = contentOf(item.content ?? []);
        if (content.length === 0) return;
        addUser(
          lane,
          ids.newId("msg"),
          content,
          lane.turn !== null && lane.hasUser ? "steer" : "next_turn",
          item.clientId ?? item.id,
          classifyBlocks(content),
        );
      }

      function applyLimits() {
        limits = [...snapshots].flatMap(([limitId, snapshot]) =>
          (["primary", "secondary"] as const).flatMap((slot) => {
            const window = snapshot?.[slot];
            return window == null
              ? []
              : [
                  {
                    id: `${limitId}.${slot}`,
                    label: windowLabel(window.windowDurationMins),
                    used_percent: Math.min(100, window.usedPercent),
                    left: null,
                    // resetsAt은 초 단위 epoch다(녹화 rate_limits).
                    resets_at:
                      window.resetsAt == null
                        ? null
                        : new Date(window.resetsAt * 1000).toISOString(),
                  },
                ];
          }),
        );
        change({ usage: usageNow() });
      }

      function onNotification(method: string, params: Json) {
        // thread 없는 알림(warning 일부, 사용 한도)은 root의 것이다. 같은 server의 모르는 thread(fork로 열린 옛 thread)는 버린다.
        const lane =
          params.threadId == null ? root : lanes.get(String(params.threadId));
        if (lane === undefined) {
          // spawn item이 이 thread를 알리기 전에 온 자식의 이벤트일 수 있어 잠깐 쌓는다.
          holdEarly(String(params.threadId), method, params);
          return;
        }
        const item = params.item as Item | undefined;
        switch (method) {
          case "turn/started": {
            // ACP turn은 첫 항목이 열린다: 사람의 shell만 도는 turn(app-server가 연다)에는 사람 메시지도 "Worked for"도 없다.
            lane.codexTurn = (params.turn as { id: string }).id;
            if (lane.turn !== null && lane === root)
              wireOf.set(lane.turn, lane.codexTurn);
            if (lane === root) {
              materialized = true;
            } else {
              updateSub(lane.thread, { state: "running" });
              publishTasks();
            }
            return;
          }
          case "turn/completed": {
            const wire = params.turn as WireTurn;
            const plan = lane === root ? planText : null;
            if (lane === root) {
              planText = null;
              dropEarly();
            }
            if (lane.turn === null && wire.status !== "failed") {
              // ACP turn이 열리지 않은 turn(shell만 돌았다). 꼬리 없이 닫는다.
              for (const [itemId, call] of lane.calls)
                if (!call.done) {
                  toolEnd(call, "cancelled");
                  lane.closed.add(itemId);
                }
              lane.calls.clear();
              lane.codexTurn = null;
              if (lane === root) {
                stopPending = false;
                if (dead === null) startNext();
              }
            } else
              endTurn(
                lane,
                wire.status === "completed"
                  ? "completed"
                  : wire.status === "interrupted"
                    ? "stopped"
                    : "failed",
                wire.status === "failed"
                  ? {
                      code: "internal",
                      message: redactCredentials(
                        wire.error?.message ?? "codex turn failed",
                      ),
                    }
                  : undefined,
              );
            if (lane !== root) {
              childEnded(lane, wire.status);
              return;
            }
            void attempt("Terminal list", readShells);
            if (
              plan !== null &&
              root.turn === null &&
              wire.status === "completed"
            )
              openPlanCard(plan);
            return;
          }
          case "item/started":
            if (item === undefined) return;
            if (item.type === "userMessage") onUserMessage(lane, item);
            else if (TOOL_ITEMS.has(item.type)) toolStart(lane, item);
            return;
          case "item/completed":
            if (item === undefined || item.type === "userMessage") return;
            itemDone(lane, item);
            // 옛 turn을 다시 그릴 때(replay)는 itemDone만 쓰니 질문이 다시 뜨지 않는다.
            if (
              lane === root &&
              item.type === "agentMessage" &&
              (item.questions?.length ?? 0) > 0
            )
              openAsyncQuestion(lane, item.questions ?? []);
            return;
          case "item/agentMessage/delta":
            stream(lane, "text", String(params.delta ?? ""));
            return;
          case "item/reasoning/summaryPartAdded":
            lane.summarized.add(String(params.itemId));
            if (lane.streamed.reasoning > 0) stream(lane, "reasoning", "\n\n");
            return;
          case "item/reasoning/summaryTextDelta":
            lane.summarized.add(String(params.itemId));
            stream(lane, "reasoning", String(params.delta ?? ""));
            return;
          case "item/reasoning/textDelta":
            // summary와 raw가 같이 오면 summary 하나만 쓴다.
            if (!lane.summarized.has(String(params.itemId)))
              stream(lane, "reasoning", String(params.delta ?? ""));
            return;
          case "serverRequest/resolved":
            // 다른 client가 먼저 답했거나 server가 스스로 푼 요청이다. 답은 보내지 않는다.
            for (const [id, wait] of approvals)
              if (wait.rpc === params.requestId)
                closeApproval(
                  id,
                  "cancelled",
                  "Answered from another client",
                  false,
                );
            for (const [id, wait] of asks)
              if (wait.rpc === params.requestId) closeQuestion(id, "cancelled");
            return;
        }
        if (lane !== root) return;
        switch (method) {
          case "turn/plan/updated":
            publish({
              type: "plan_changed",
              entries: (params.plan ?? []).map((one: J) => ({
                text: one.step,
                status:
                  one.status === "inProgress" ? "in_progress" : one.status,
              })),
            });
            return;
          case "thread/name/updated":
            change({ title: params.threadName ?? null });
            return;
          case "thread/settings/updated":
            applySettings(params.threadSettings);
            return;
          case "thread/tokenUsage/updated":
            tokenUsage = params.tokenUsage;
            change({ usage: usageNow() });
            return;
          case "account/rateLimits/updated":
            snapshots.set(
              params.rateLimits.limitId ?? "codex",
              params.rateLimits,
            );
            applyLimits();
            return;
          case "thread/reverted":
            if (!reverting)
              info(
                "The history was rewound from another client; reopen the tab to redraw it.",
              );
            return;
          case "thread/goal/updated":
            change({ goal: goalOf(params.goal) });
            return;
          case "thread/goal/cleared":
            change({ goal: null });
            return;
          case "warning":
            info(String(params.message), "warning");
            return;
          case "configWarning":
            info(
              oneLine(
                `${params.summary}${params.details ? `: ${params.details}` : ""}`,
                300,
              ),
              "warning",
            );
            return;
          case "model/rerouted":
            info(
              `Model rerouted from ${params.fromModel} to ${params.toModel} (${params.reason}).`,
              "warning",
            );
            return;
          case "error":
            // 재연결·재시도 알림이다. 끝내 실패하면 turn/completed가 오류를 싣는다.
            if (params.willRetry)
              info(
                oneLine(
                  redactCredentials(params.error?.message ?? "Retrying…"),
                  200,
                ),
              );
            return;
        }
      }

      function onRequest(rpc: number | string, method: string, params: Json) {
        const lane = lanes.get(String(params.threadId)) ?? root;
        switch (method) {
          case "item/commandExecution/requestApproval":
          case "item/fileChange/requestApproval":
            openApproval(lane, rpc, method, params);
            return;
          case "item/permissions/requestApproval":
            openPermissions(lane, rpc, params);
            return;
          case "item/tool/requestUserInput":
            openBlockingQuestion(lane, rpc, params);
            return;
          case "mcpServer/elicitation/request":
            write({
              id: rpc,
              result: { action: "decline", content: null, _meta: null },
            });
            info(
              oneLine(
                `MCP server ${params.serverName ?? ""} asked for input${params.message ? `: ${params.message}` : ""}. The lophn window declined it.`,
                300,
              ),
              "warning",
            );
            return;
          default:
            write({
              id: rpc,
              error: {
                code: UNSUPPORTED,
                message: `${method} is not supported by the lophn window`,
              },
            });
        }
      }

      function onLine(line: string) {
        const message = JSON.parse(line) as {
          id?: number | string;
          method?: string;
          params?: Json;
          result?: Json;
          error?: { message: string };
        };
        if (message.method !== undefined) {
          if (message.id === undefined)
            onNotification(message.method, message.params ?? {});
          else onRequest(message.id, message.method, message.params ?? {});
          return;
        }
        const wait = pending.get(Number(message.id));
        if (wait === undefined) return;
        pending.delete(Number(message.id));
        if (message.error !== undefined)
          wait.reject(new Error(redactCredentials(message.error.message)));
        else wait.resolve(message.result ?? {});
      }

      // token 수는 첫 thread/tokenUsage/updated가 와야 안다. 사용 한도는 그 전에도 읽는다.
      const usageNow = () =>
        tokenUsage === null && limits.length === 0 ? null : usageOf(tokenUsage);
      function usageOf(usage: J): AcpUsage {
        return {
          context:
            usage?.modelContextWindow == null
              ? null
              : {
                  tokens: usage.last.totalTokens,
                  limit: usage.modelContextWindow,
                  parts: [],
                },
          limits,
          input_tokens: usage?.total.inputTokens ?? null,
          output_tokens: usage?.total.outputTokens ?? null,
          cache_read_tokens: usage?.total.cachedInputTokens ?? null,
          cache_write_tokens: usage?.total.cacheWriteInputTokens ?? null,
          turns: null,
          costs: [],
          provider: null,
        };
      }

      const failure = (reason: string) => {
        if (dead !== null || closed) return;
        dead = {
          code: "unavailable",
          message: redactCredentials(
            stderrTail === "" ? reason : `${reason}\n${stderrTail.trim()}`,
          ),
        };
        for (const wait of pending.values()) wait.reject(new Error(reason));
        pending.clear();
        endTurn(root, "failed", dead);
        for (const lane of lanes.values())
          if (lane !== root && lane.turn !== null)
            endTurn(lane, "failed", dead);
        // ws가 닫혔는데 app-server가 살아 있으면 탭을 닫을 때까지 남는다. 이미 끝난 process에는 kill을 보내지 않는다.
        if (!exited) {
          link?.close();
          proc.kill();
        }
      };
      proc.onExit(() => failure("codex exited."));

      // 앞 대화를 같은 길로 그린다. 사람 메시지마다 turn 하나다. 돌고 있는 turn은 열어 둔다.
      function replay(lane: Lane, turns: WireTurn[]) {
        for (const wire of turns) {
          if (lane === root) materialized = true;
          for (const item of wire.items ?? []) {
            if (item.type === "userMessage") {
              const content = contentOf(item.content ?? []);
              if (content.length > 0)
                addUser(
                  lane,
                  ids.newId("msg"),
                  content,
                  "next_turn",
                  item.clientId ?? item.id,
                  classifyBlocks(content),
                );
              if (lane === root && lane.turn !== null)
                wireOf.set(lane.turn, wire.id);
            } else itemDone(lane, item);
          }
          if (wire.status === "inProgress") {
            lane.codexTurn = wire.id;
            continue;
          }
          if (lane.turn !== null) {
            endTurn(
              lane,
              wire.status === "failed"
                ? "failed"
                : wire.status === "completed"
                  ? "completed"
                  : "stopped",
              wire.status === "failed"
                ? {
                    code: "internal",
                    message: redactCredentials(
                      wire.error?.message ?? "codex turn failed",
                    ),
                  }
                : undefined,
            );
            if (lane !== root) childEnded(lane, wire.status);
          }
        }
      }

      async function replayThread(lane: Lane) {
        let cursor: string | null = null;
        do {
          const page: Json = await request("thread/turns/list", {
            threadId: lane.thread,
            sortDirection: "asc",
            itemsView: "full",
            limit: 50,
            ...(cursor === null ? {} : { cursor }),
          });
          replay(lane, page.data ?? []);
          cursor = page.nextCursor ?? null;
        } while (cursor !== null);
      }

      // 앞 대화에서 spawn한 subagent의 대화도 그린다(replay가 자식 thread를 알려 주므로 새로 알린 것까지 돈다).
      async function replayChildren() {
        const done = new Set<string>();
        for (;;) {
          const next = [...lanes.values()].find(
            (one) => one !== root && !done.has(one.thread),
          );
          if (next === undefined) return;
          done.add(next.thread);
          await replayThread(next).catch(() => {});
        }
      }

      // 다시 연 뒤에도 도는 자식은 thread/resume으로 구독해야 이벤트가 다시 흘러온다.
      async function resumeChildren() {
        for (const [child, sub] of subs)
          if (sub.detail.state === "running")
            await request("thread/resume", {
              threadId: child,
              excludeTurns: true,
            }).catch(() => {});
      }

      // 사람의 실제 설정이 never이거나 danger-full-access일 때만 느슨하지 않은 값으로 바꾼다.
      // read-only나 untrusted를 고른 사람을 느슨하게 하지 않으려고 그 밖에는 아무것도 넘기지 않는다.
      async function readPolicy(): Promise<Json> {
        const loaded = await request("config/read", { cwd });
        const config = loaded.config ?? {};
        return config.approval_policy === "never" ||
          config.sandbox_mode === "danger-full-access"
          ? { approvalPolicy: "on-request", sandbox: "workspace-write" }
          : {};
      }

      async function readGoal() {
        const read = await request("thread/goal/get", { threadId }).catch(
          () => null,
        );
        change({ goal: goalOf(read?.goal) });
      }

      function useThread(opened: Json) {
        threadId = opened.thread.id;
        root.thread = threadId;
        lanes.clear();
        dropEarly();
        lanes.set(threadId, root);
        applySettings({
          ...opened,
          collaborationMode: opened.collaborationMode ?? undefined,
        });
        change({ cli_session: threadId, title: opened.thread.name ?? null });
      }

      const ready = (async () => {
        const connected = await io.connect(
          socket,
          () => !exited && dead === null,
        );
        link = connected;
        // 틀린 줄 하나가 ws listener에서 던지면 uncaught exception으로 앱이 꺼진다. 그 줄만 버리고 session은 살린다.
        let unreadable = false;
        connected.onMessage((text) => {
          if (closed) return;
          try {
            onLine(text);
          } catch (cause) {
            if (unreadable) return;
            unreadable = true;
            info(
              `Codex sent a message lophn could not read: ${redactCredentials((cause as Error).message)}`,
              "warning",
            );
          }
        });
        connected.onClose(() =>
          failure("The Codex app-server closed the connection."),
        );
        await request("initialize", {
          clientInfo: { name: "lophn", title: "lophn", version: "0" },
          capabilities: {
            experimentalApi: true,
            optOutNotificationMethods: OPT_OUT,
          },
        });
        write({ method: "initialized" });
        policy = await readPolicy();
        // 첫 메시지 전의 TUI thread는 rollout이 없어 resume이 "no rollout found"로 실패한다. 조용히 새 thread를 연다.
        const resumed =
          resume === undefined
            ? null
            : await request("thread/resume", {
                threadId: resume,
                cwd,
                excludeTurns: true,
                ...policy,
              }).catch((cause: Error) => {
                if (!/no rollout found/.test(cause.message)) throw cause;
                return null;
              });
        if (resumed === null) {
          useThread(await request("thread/start", { cwd, ...policy }));
        } else {
          useThread(resumed);
          await replayThread(root);
          await replayChildren();
          await resumeChildren();
        }
        // 서로 기다릴 이유가 없는 읽기다. 사용 한도는 server가 원격에서 가져와 1초 가까이 걸려(측정), 기다리지 않고 도착하면 낸다.
        const reads = Promise.all([
          request("model/list", {}).catch(() => ({ data: [] })),
          request("collaborationMode/list", {}).catch(() => ({ data: [] })),
          request("skills/list", { cwds: [cwd] }).catch(() => ({ data: [] })),
          attempt("Goal", readGoal),
        ]);
        void request("account/rateLimits/read", {}).then(
          (rates) => {
            for (const [limitId, snapshot] of Object.entries(
              rates?.rateLimitsByLimitId ??
                (rates?.rateLimits ? { codex: rates.rateLimits } : {}),
            ))
              snapshots.set(limitId, snapshot);
            applyLimits();
          },
          () => {},
        );
        const [modelList, modeList, listed] = await reads;
        models = (modelList.data ?? []).filter((one: J) => !one.hidden);
        canPlan = (modeList.data ?? []).some((one: J) => one.mode === "plan");
        skills = new Map(
          (listed.data ?? []).flatMap((entry: J) =>
            (entry.skills ?? [])
              .filter((one: J) => one.enabled)
              .map((one: J) => [one.name, one.path] as const),
          ),
        );
        change({
          ...modelMeta(),
          ...modesMeta(),
          ...commandsMeta(),
          ...togglesMeta(),
        });
        publish({ type: "session_changed", session: meta });
        metaSent = true;
      })();

      // 입력은 준비된 뒤에만 처리한다.
      session.onInput(
        (message) =>
          void ready
            .then(() => handle(message))
            .catch((cause: Error) =>
              info(`Request failed: ${redactCredentials(cause.message)}`),
            ),
      );

      function cleanup() {
        closed = true;
        for (const timer of deadlines.values()) clearTimeout(timer);
        link?.close();
        proc.kill();
        return Promise.race([exit, sleep(5000)]).then(() => io.removeDir(dir));
      }

      try {
        await ready;
      } catch (cause) {
        const message = redactCredentials(
          stderrTail === ""
            ? (cause as Error).message
            : `${(cause as Error).message}\n${stderrTail.trim()}`,
        );
        await cleanup();
        return { ok: false, error: { code: "unavailable", message } };
      }

      // --- 입력
      function switchThread(opened: Json, hideAll: boolean) {
        if (hideAll) {
          const first = mirror.items[0];
          if (first !== undefined) hideFrom(first.seq, first.id);
        }
        for (const wait of [...approvals.keys()])
          closeApproval(wait, "cancelled", undefined, false);
        useThread(opened);
        queue.length = 0;
        userOf.clear();
        wireOf.clear();
        sent.clear();
        // 새 thread에는 이전 thread의 계획·goal·background task·subagent가 없다.
        subs.clear();
        shells.clear();
        planText = null;
        tokenUsage = null;
        publishTasks();
        publish({ type: "plan_changed", entries: [] });
        change({ usage: usageNow() });
        void attempt("Goal", readGoal);
      }

      // git 명령의 출력. git 폴더가 아니면 code가 0이 아니다.
      function git(args: string[]) {
        return new Promise<{ code: number | null; out: string }>((resolve) => {
          const proc = spawn("git", args, { cwd });
          let out = "";
          proc.onStdout((text) => {
            out += text;
          });
          proc.onExit((code) => resolve({ code, out }));
        });
      }

      async function showDiff() {
        const diff = await git(["diff"]);
        if (diff.code !== 0)
          return output("diff", "`/diff` — _not inside a git repository_");
        const untracked = await git([
          "status",
          "--porcelain",
          "--untracked-files=all",
        ]);
        const names = untracked.out
          .split("\n")
          .filter((line) => line.startsWith("?? "))
          .map((line) => `new file: ${line.slice(3)}`);
        const text = [diff.out.trimEnd(), ...names].filter(Boolean).join("\n");
        output("diff", text === "" ? "No changes." : text, "preformatted");
      }

      async function showMcp() {
        const listed = await request("mcpServerStatus/list", {
          threadId,
          detail: "toolsAndAuthOnly",
        }).catch((cause: Error) => cause);
        if (listed instanceof Error)
          return info(`MCP status failed: ${listed.message}`, "warning");
        const servers: J[] = listed.data ?? [];
        output(
          "mcp",
          servers.length === 0
            ? "No MCP servers."
            : servers
                .map(
                  (one) =>
                    `- **${one.name}** — ${one.runtimeStatus ?? "unknown"}, ${Object.keys(one.tools ?? {}).length} tools`,
                )
                .join("\n"),
        );
      }

      async function showTerminals() {
        await readShells();
        const running = [...shells.values()].filter(
          (one) => one.state === "running",
        );
        output(
          "ps",
          running.length === 0
            ? "No background terminals."
            : running
                .map((one) => `- \`${one.description}\` (pid ${one.id})`)
                .join("\n"),
        );
      }

      async function runCommand(name: string, argument: string) {
        const arg = argument.trim();
        switch (name) {
          case "compact":
            return void (await attempt("Compact", () =>
              request("thread/compact/start", { threadId }),
            ));
          case "review":
            return void (await attempt("Review", () =>
              request("review/start", {
                threadId,
                target:
                  arg === ""
                    ? { type: "uncommittedChanges" }
                    : { type: "custom", instructions: arg },
                delivery: "inline",
              }),
            ));
          case "plan":
            if (settings !== null) await setPlan(!settings.plan);
            return;
          case "goal": {
            if (arg !== "") return await setGoal(arg, false);
            const goal = meta.goal;
            return output(
              "goal",
              goal === null
                ? "No goal. Use `/goal <objective>`."
                : `Goal (${goal.status}): ${goal.objective}${goal.detail ? ` — ${goal.detail}` : ""}`,
            );
          }
          case "new":
            return void (await attempt("New conversation", async () => {
              const opened = await request("thread/start", { cwd, ...policy });
              switchThread(opened, true);
              materialized = false;
            }));
          case "init":
            if (root.turn !== null)
              return info("Wait for the current turn before running /init.");
            return sendNow(ids.newId("msg"), [
              { type: "text", text: INIT_PROMPT },
            ]);
          case "mcp":
            return await showMcp();
          case "diff":
            return await showDiff();
          case "ps":
            return await showTerminals();
          case "stop":
            return void (await attempt("Stop terminals", async () => {
              await request("thread/backgroundTerminals/clean", { threadId });
              output("stop", "Stopped all background terminals.");
              await readShells();
            }));
        }
        const path = skills.get(name);
        if (path === undefined) return info(`Unknown command: ${name}`);
        // skill는 UserInput skill로 새 turn을 연다.
        if (root.turn !== null)
          return info("Wait for the current turn before running a skill.");
        const content: ContentBlock[] = [
          { type: "text", text: `$${name}${arg === "" ? "" : ` ${arg}`}` },
        ];
        const id = ids.newId("msg");
        addUser(root, id, content, "next_turn", id);
        begin(id, [
          { type: "skill", name, path },
          ...(arg === ""
            ? []
            : [{ type: "text", text: arg, text_elements: [] }]),
        ]);
      }

      // handle이 준비 전에 불려도 되도록 함수 선언이다.
      async function rename(title: string) {
        await attempt("Rename", async () => {
          await request("thread/name/set", { threadId, name: title });
          change({ title });
        });
      }

      // 마지막 사람 메시지만, turn이 돌지 않을 때만이다(데스크톱과 같다). 다른 메시지나 도는 중이면 invalid_input이다.
      async function rewind(messageId: string) {
        const last = mirror.items
          .flatMap((one) => (one.kind === "hidden" ? [] : [one]))
          .filter((one) => one.kind === "message" && one.actor === "user")
          .at(-1);
        const found = messageItem(messageId);
        if (
          root.turn !== null ||
          found === undefined ||
          found.kind !== "message" ||
          last?.id !== messageId
        )
          return info(
            "Only the last message can be edited, and not while Codex is working.",
          );
        const wire = found.turn === null ? undefined : wireOf.get(found.turn);
        if (wire === undefined) return info("This message cannot be rewound.");
        reverting = true;
        try {
          await request("thread/revert", { threadId, beforeTurnId: wire });
          hideFrom(found.seq, messageId);
        } catch (cause) {
          info(`Rewind failed: ${(cause as Error).message}`);
        } finally {
          reverting = false;
        }
      }

      // 새 thread를 같은 탭에서 연다. fork 응답이 이 connection을 새 thread에 구독시킨다.
      async function fork(messageId: string | null) {
        if (root.turn !== null)
          return info("Wait for the current turn before forking.");
        if (!materialized) return info("There is nothing to fork yet.");
        const found = messageId === null ? undefined : messageItem(messageId);
        const wire =
          found?.kind === "message" && found.turn !== null
            ? wireOf.get(found.turn)
            : undefined;
        await attempt("Fork", async () => {
          const opened = await request("thread/fork", {
            threadId,
            excludeTurns: true,
            ...(wire === undefined ? {} : { lastTurnId: wire }),
            ...policy,
          });
          // 고른 메시지 뒤의 대화는 새 thread에 없으므로 화면에서 숨긴다.
          const later =
            wire === undefined
              ? undefined
              : mirror.items.find(
                  (one) =>
                    one.kind === "message" &&
                    one.actor === "user" &&
                    one.seq > (found?.seq ?? 0),
                );
          const first = mirror.items.find(
            (one) => one.kind === "message" && one.actor === "user",
          );
          const from =
            meta.title ??
            (oneLine(
              first?.kind === "message"
                ? first.content
                    .flatMap((one) => (one.type === "text" ? [one.text] : []))
                    .join(" ")
                : "",
              40,
            ) ||
              "Untitled");
          switchThread(opened, false);
          if (later !== undefined) hideFrom(later.seq, later.id);
          change({ title: opened.thread.name ?? `${from} (fork)` });
          info(
            `Forked from “${from}”. The original conversation is unchanged.`,
          );
        });
      }

      // 도는 turn이 있어도 보낸다: app-server가 그 turn에 붙이거나 제 turn을 연다. 그 줄은 commandExecution(userShell) item이 그린다.
      function runShell(command: string) {
        const text = command.trim();
        if (text === "") return;
        shellSent.push(text);
        void attempt("Shell command", () =>
          request("thread/shellCommand", { threadId, command: text }).catch(
            (cause: Error) => {
              shellSent.splice(shellSent.indexOf(text), 1);
              throw cause;
            },
          ),
        );
      }

      // app-server에 명령만 멈추는 요청이 없어 그 명령이 속한 turn을 interrupt한다(`turn/interrupt`). shell만 있는 turn이면 명령만 멈추고,
      // 도는 agent turn에 붙은 명령이면 그 turn이 같이 멈춘다(`ActiveTurnAuxiliary`가 turn의 취소 토큰을 쓴다).
      function stopShell(item: string) {
        for (const lane of lanes.values())
          for (const call of lane.calls.values())
            if (call.id === item && !call.done && lane.codexTurn !== null)
              return interrupt(lane);
      }

      // 지난 대화를 같은 탭에서 연다. TUI는 옛 thread에 남고 다음 toggle 때 새 id로 붙는다.
      async function openSession(target: string) {
        if (root.turn !== null || root.codexTurn !== null)
          return info(
            "Stop the running turn before opening another conversation.",
          );
        await attempt("Open conversation", async () => {
          const opened = await request("thread/resume", {
            threadId: target,
            cwd,
            excludeTurns: true,
            ...policy,
          });
          switchThread(opened, false);
          // 항목 순번은 이어 센다(비운 화면에 빈 곳이 gap으로 읽히지 않는다). 제목·cli_session은 session meta라 남는다.
          publish({ type: "session_reset" });
          materialized = false;
          await replayThread(root);
          await replayChildren();
          await resumeChildren();
        });
      }

      function handle(message: AcpInput) {
        switch (message.type) {
          case "send": {
            // 보낸 말이 async 질문의 답을 대신한다(Claude의 human_message와 같다).
            for (const [call, wait] of [...asks])
              if (wait.rpc === null) closeQuestion(call, "cancelled");
            const first = message.content[0];
            // TUI처럼 친 글이 `!`로 시작해 와도 model로 보내지 않는다.
            if (
              first?.type === "text" &&
              first.text.startsWith("!") &&
              first.text.trim().length > 1
            ) {
              runShell(first.text.slice(1));
              return;
            }
            if (root.turn === null) {
              sendNow(message.id, message.content);
              return;
            }
            if (message.delivery === "steer" && root.codexTurn !== null) {
              void steer(
                message.id,
                message.content,
                () =>
                  addUser(
                    root,
                    message.id,
                    message.content,
                    "steer",
                    message.id,
                  ),
                () =>
                  root.turn === null
                    ? sendNow(message.id, message.content)
                    : enqueue(message.id, message.content),
              );
              return;
            }
            enqueue(message.id, message.content);
            return;
          }
          case "send_queued": {
            const queued = queue.find((one) => one.id === message.message);
            if (
              queued === undefined ||
              root.turn === null ||
              root.codexTurn === null
            )
              return;
            void steer(
              queued.id,
              queued.content,
              () => {
                const index = queue.indexOf(queued);
                if (index < 0) return;
                queue.splice(index, 1);
                publish({
                  type: "message_taken",
                  message: queued.id,
                  seq: ++root.seq,
                  delivery: "steer",
                  turn: null,
                });
              },
              () => {},
            );
            return;
          }
          case "stop":
            if (root.turn === null) return;
            // 사람이 멈춘다. 아직 열려 있는(server가 풀지 않은) 승인에만 cancel을 보낸다.
            for (const request of [...approvals.keys()])
              closeApproval(request, "cancelled");
            if (root.codexTurn === null) stopPending = true;
            else interrupt(root);
            return;
          case "retry": {
            const content =
              root.turn === null ? userOf.get(message.turn) : undefined;
            if (content !== undefined) sendNow(ids.newId("msg"), content);
            return;
          }
          case "decide":
            closeApproval(
              message.request,
              message.choice.kind,
              message.choice.kind === "reject"
                ? message.choice.reason
                : undefined,
            );
            return;
          case "answer": {
            const wait = asks.get(message.tool_call);
            if (wait === undefined) return;
            if (wait.rpc === null) {
              // 질문 자체는 turn이 끝났을 수 있어, 답은 TUI처럼 새 사람 메시지로 보낸다.
              closeQuestion(message.tool_call, "submitted");
              const text = message.answers
                .map(
                  (one) =>
                    `> ${one.question.replace(/\s*\n\s*/g, " ")}\n\n${one.answer.join(", ")}`,
                )
                .join("\n\n");
              handle({
                type: "send",
                session: message.session,
                id: ids.newId("msg"),
                key: ids.newId("msg"),
                content: [{ type: "text", text }],
                delivery: "steer",
              });
              return;
            }
            closeQuestion(
              message.tool_call,
              "submitted",
              Object.fromEntries(
                wait.ids.map((id, index) => [
                  id,
                  { answers: message.answers[index]?.answer ?? [] },
                ]),
              ),
            );
            return;
          }
          case "remove_queued": {
            const index = queue.findIndex((one) => one.id === message.message);
            if (index < 0) return;
            queue.splice(index, 1);
            publish({ type: "message_removed", message: message.message });
            return;
          }
          case "edit_queued": {
            const queued = queue.find((one) => one.id === message.message);
            if (queued === undefined) return;
            queued.content = message.content;
            resendQueue(queue, publish, now());
            return;
          }
          case "move_queued": {
            if (swapQueued(queue, message.message, message.direction) === null)
              return;
            resendQueue(queue, publish, now());
            return;
          }
          case "set_model":
            void attempt("Model change", () =>
              request("thread/settings/update", {
                threadId,
                model: message.model,
                effort: message.options.effort ?? null,
                // 고른 model에 Speed 축이 없으면 options.speed도 없어 null이다(thread의 tier를 지운다).
                serviceTier: message.options.speed ?? null,
              }),
            );
            return;
          case "set_mode": {
            const mode = MODES[message.mode as keyof typeof MODES];
            if (mode === undefined) return;
            void attempt("Permission change", () =>
              request("thread/settings/update", { threadId, ...mode }),
            );
            return;
          }
          case "run_command":
            void attempt("Request", () =>
              runCommand(message.name, message.argument),
            );
            return;
          case "rewind":
            void attempt("Request", () => rewind(message.message));
            return;
          case "fork":
            void attempt("Request", () => fork(message.message));
            return;
          case "compact":
            void attempt("Request", () => runCommand("compact", ""));
            return;
          case "rename":
            void attempt("Request", () => rename(message.title));
            return;
          case "stop_child":
            stopChild(message.child);
            return;
          case "steer_child":
            void attempt("Request", () =>
              steerChild(message.child, message.text),
            );
            return;
          case "stop_task":
            void attempt("Request", () => stopTask(message.task));
            return;
          case "set_toggle":
            if (message.id === "plan")
              void attempt("Request", () => setPlan(message.on));
            return;
          case "set_goal":
            void attempt("Request", () =>
              setGoal(message.objective, message.paused),
            );
            return;
          case "run_shell":
            runShell(message.command);
            return;
          case "stop_shell":
            stopShell(message.item);
            return;
          case "open_session":
            void attempt("Request", () => openSession(message.cli_session));
            return;
        }
      }

      let told = false;
      const run: HarnessGuiRun = {
        async stop() {
          if (closed) return;
          await cleanup();
        },
        // 같은 server에 붙는 client다. remote workspace mode라 `--cd`가 꼭 있고 `--worktree`·`--add-dir`은 안 된다.
        // 대화가 아직 없으면 rollout이 없어 resume이 실패한다(no rollout found).
        tuiCommand() {
          if (!told) {
            told = true;
            info(
              "The terminal view joins this tab's Codex server (remote workspace mode): --worktree and --add-dir are not available there.",
            );
          }
          if (!materialized)
            info(
              "Send a first message before switching to the terminal view; Codex cannot resume an empty conversation.",
            );
          return `codex resume ${threadId} --remote 'unix://${socket}' --cd "$PWD"`;
        },
        sessionId: () => (threadId === "" ? null : threadId),
        running: () => ({ turn: root.turn !== null, tasks: runningTasks() }),
        // 기본 sourceKinds를 그대로 둔다: GUI thread의 source는 vscode라 TUI thread와 같이 나온다.
        async sessions() {
          const listed = await request("thread/list", {
            cwd,
            sortKey: "updated_at",
            limit: 30,
          });
          return ((listed.data ?? []) as J[]).map((one) => ({
            id: one.id as string,
            title: (one.name || one.preview || null) as string | null,
            updated_at:
              typeof one.updatedAt === "number"
                ? new Date(one.updatedAt * 1000).toISOString()
                : null,
          }));
        },
      };
      return { ok: true, value: run };
    },
  };
}

export const codexAdapter = createCodexAdapter(realIo);
