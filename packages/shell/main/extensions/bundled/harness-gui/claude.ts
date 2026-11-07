// Claude Code adapter. Agent SDK `query()`(streaming input)로 사람의 `claude`를 띄우고, SDK 메시지를 ACP 갱신으로,
// 창의 ACP 입력을 SDK 호출로 옮긴다. 권한은 사람의 설정(`settingSources`)을 따르고 처음 띄울 때 mode는 넘기지 않는다.
// 사람 메시지마다 uuid를 붙여 CLI의 `command_lifecycle`(queued·started·completed·cancelled)과 짝짓는다: 줄(queue)은
// CLI가 쥐고 adapter는 어느 메시지가 줄에 있는지만 안다. rewind·fork로 query를 다시 열 때는 `carry`(model, effort, mode,
// 이 session 동안의 허락, fast·thinking)를 옵션으로 다시 넣는다. subagent의 대화는 `parent_tool_use_id`로 줄기(Lane)를 나눠
// `child_update`로 내고, `/clear`는 CLI에 보내지 않고 같은 탭에서 resume 없는 새 query를 연다. `!` 명령은 model에 보내지 않고 adapter가 돌린 뒤
// 결과를 `shouldQuery: false` 사람 메시지로 transcript에만 붙인다(model은 다음 turn에 본다).
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { PassThrough, Writable } from "node:stream";
import {
  forkSession,
  getSessionInfo,
  getSessionMessages,
  getSubagentMessages,
  listSessions,
  query,
  renameSession,
  type CanUseTool,
  type ModelInfo,
  type Options,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKUserMessage,
  type SlashCommand,
  type SpawnedProcess,
  type SpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";
import type { IdSource } from "../../../../../base/id.ts";
import type { Result } from "../../../../../base/result.ts";
import type { AcpInput } from "../../../../../protocol/acp/input.ts";
import {
  ACP_TOOL_BODY_LIMIT,
  type AcpApprovalItem,
  type AcpEntry,
  type AcpNoticeItem,
  type AcpToolBody,
  type AcpToolItem,
} from "../../../../../protocol/acp/items.ts";
import {
  EMPTY_ACP_STATE,
  reduceAcp,
} from "../../../../../protocol/acp/reduce.ts";
import type {
  AcpCapabilities,
  AcpCommand,
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
import type { ContentBlock } from "../../../../../protocol/lophn-agent/content-block.ts";
import type {
  AcpCliSession,
  AcpRewindPreview,
  AcpTerminal,
  ExtensionProcess,
} from "../../../../../protocol/extensions/mod.ts";
import type { HarnessGuiAdapter } from "./adapter.ts";

/** adapter가 밖에 기대는 것. test가 가짜로 바꾼다. */
export type ClaudeSdk = {
  query: typeof query;
  getSessionMessages: typeof getSessionMessages;
  getSubagentMessages: typeof getSubagentMessages;
  getSessionInfo: typeof getSessionInfo;
  forkSession: typeof forkSession;
  listSessions: typeof listSessions;
  renameSession: typeof renameSession;
  readFile: (path: string) => Promise<Uint8Array>;
};

type Start = HarnessGuiAdapter["start"];

// SDK 메시지에서 읽는 칸만 적은 모양이다. SDK의 type은 Beta API type을 끌고 와 좁히기가 무겁다.
type Block = {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean;
  content?: string | Block[];
};
type SdkMessage = {
  type: string;
  subtype?: string;
  uuid?: string;
  session_id?: string;
  parent_tool_use_id?: string | null;
  event?: {
    type: string;
    delta?: { type: string; text?: string; thinking?: string };
  };
  message?: { content?: string | Block[] };
  isReplay?: boolean;
  local_command_run?: { command: string };
  // active_goal
  value?: {
    condition: string;
    iterations: number;
    last_reason?: string;
  } | null;
  // result
  is_error?: boolean;
  terminal_reason?: string;
  result?: string;
  errors?: string[];
  user_message_uuid?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  // command_lifecycle
  command_uuid?: string;
  state?: string;
  // system
  model?: string;
  permissionMode?: string;
  terminal_slash_commands?: string[];
  skills?: string[];
  plugins?: { name: string }[];
  fast_mode_state?: string;
  status?: string | null;
  compact_result?: string;
  compact_error?: string;
  compact_metadata?: { pre_tokens: number; post_tokens?: number };
  content?: string;
  commands?: SlashCommand[];
  tasks?: { task_id: string; task_type?: string; description?: string }[];
  task_id?: string;
  prompt?: string;
  task_type?: string;
  tool_use_id?: string;
  last_tool_name?: string;
  patch?: { status?: string };
  level?: string;
  text?: string;
  outcome?: string;
  hook_name?: string;
  stderr?: string;
  output?: string;
  original_model?: string;
  fallback_model?: string;
  description?: string;
  summary?: string;
  attempt?: number;
  max_retries?: number;
  tool_name?: string;
  rate_limit_info?: {
    status: string;
    rateLimitType?: string;
    utilization?: number;
    resetsAt?: number;
    // 타입에는 없지만 CLI가 창마다 실어 보낸다(녹화).
    unifiedWindows?: Record<
      string,
      { utilization?: number; resetsAt?: number }
    >;
  };
};
type Question = {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
};
type Cancelable = Query & {
  cancelAsyncMessage(uuid: string): Promise<boolean>;
};

const DENIED = "The user denied this tool use.";
const EDIT_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit"];
const TODO_TOOL = "TodoWrite";
// CLI의 todo tool(TUI와 같다). 목록은 이 tool들의 결과를 이어 붙여 만든다.
const TASK_TOOLS = ["TaskCreate", "TaskUpdate"];
const AGENT_TOOLS = ["Agent", "Task"];
// 화면 동작이 대신하는 CLI 줄과, 화면에 내지 않는 CLI 줄(TUI 전용·원격·폐기).
const SCREEN_COMMANDS = new Set([
  "model",
  "effort",
  "fast",
  "rename",
  "context",
  "usage",
  "cost",
  "stats",
  "clear",
  "resume",
]);
const HIDDEN_COMMANDS = new Set([
  "__remote-workflow",
  "workflow-launch-exec",
  "heapdump",
  "design-consent",
  "design-revoke",
  "agents",
  "ultrareview",
  "login",
]);
const LIMIT_LABELS: Record<string, string> = {
  five_hour: "5h",
  seven_day: "7d",
  seven_day_opus: "7d Opus",
  seven_day_sonnet: "7d Sonnet",
  seven_day_overage_included: "7d",
  overage: "Overage",
};
const CATEGORIES: Record<string, AcpToolItem["category"]> = {
  Read: "read",
  Glob: "list",
  LS: "list",
  Grep: "search",
  Bash: "command",
  WebFetch: "web",
  WebSearch: "web",
};
const MODES = [
  ["default", "Ask before edits"],
  ["acceptEdits", "Accept edits"],
  ["plan", "Plan"],
  ["auto", "Auto"],
] as const;
// plan 승인 뒤에 이어 갈 mode. plan 자신은 뺀다.
const PLAN_MODES = MODES.filter(([id]) => id !== "plan");
// bypassPermissions는 어떤 길로도 쓰지 않는다. 그 밖의 mode(dontAsk 등)는 다시 열 때 넘기지 않는다.
const PASSABLE_MODES: ReadonlySet<string> = new Set(MODES.map(([id]) => id));
// 사람이 TUI에서 쓰는 것과 같은 capability다. `sessions`는 lophn session 목록이라 harness는 꺼 둔다.
// fast·thinking은 toggle이 아니라 model 축이라 `toggles`도 끈다.
const CAPABILITIES: AcpCapabilities = {
  model: true,
  effort: true,
  mode: true,
  commands: true,
  rewind: true,
  rewind_files: true,
  fork: true,
  compact: true,
  rename: true,
  usage: true,
  steer: true,
  queue_edit: true,
  images: true,
  retry: true,
  sessions: false,
  stop_child: true,
  steer_child: false,
  tasks: true,
  toggles: false,
  goal: true,
  roles: false,
  shell: true,
  resume: true,
};

const oneLine = (text: string, max: number) => {
  const line = text.replace(/\s*\n\s*/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};
const lines = (text: unknown) =>
  typeof text === "string" && text !== "" ? text.split("\n").length : 0;
const str = (value: unknown) => (typeof value === "string" ? value : "");
// 한 쪽 본문은 상한까지만 싣는다.
function toolBody(input: string | null, output: string | null): AcpToolBody {
  const cut = (text: string | null) =>
    text === null ? null : text.slice(0, ACP_TOOL_BODY_LIMIT);
  return {
    input: cut(input),
    output: cut(output),
    truncated:
      (input?.length ?? 0) > ACP_TOOL_BODY_LIMIT ||
      (output?.length ?? 0) > ACP_TOOL_BODY_LIMIT,
  };
}
const shellQuote = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;

// ids의 ULID(128bit 남짓)를 UUID v4 꼴로 바꾼다. CLI가 session id와 메시지 uuid를 UUID로만 받는다.
function uuidOf(ids: IdSource): string {
  const ulid = ids.newId("uid").slice(4);
  const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
  let value = 0n;
  for (const char of ulid)
    value = (value << 5n) + BigInt(alphabet.indexOf(char));
  const hex = (value & ((1n << 128n) - 1n)).toString(16).padStart(32, "0");
  const variant = "89ab"[Number.parseInt(hex[16] ?? "0", 16) & 3];
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function sniffImage(bytes: Uint8Array): string | null {
  const at = (...head: number[]) => head.every((b, i) => bytes[i] === b);
  if (at(0x89, 0x50, 0x4e, 0x47)) return "image/png";
  if (at(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  if (at(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57) return "image/webp";
  return null;
}

// 사람 메시지를 SDK content로. 이미지는 탭의 임시 file 링크라 bytes를 읽어 base64로 넣는다(MIME은 bytes로 본다).
async function contentOf(
  sdk: ClaudeSdk,
  blocks: ContentBlock[],
): Promise<string | unknown[]> {
  const images: unknown[] = [];
  const texts: string[] = [];
  for (const block of blocks) {
    if (block.type === "text" || block.type === "resource") {
      texts.push(block.text);
    } else if (block.type === "resource_link") {
      const bytes = block.uri.startsWith("file://")
        ? await sdk
            .readFile(block.uri.slice("file://".length))
            .catch(() => null)
        : null;
      const type = bytes === null ? null : sniffImage(bytes);
      if (bytes !== null && type !== null) {
        images.push({
          type: "image",
          source: {
            type: "base64",
            media_type: type,
            data: Buffer.from(bytes).toString("base64"),
          },
        });
      } else {
        texts.push(block.uri);
      }
    }
  }
  const text = texts.join("\n");
  return images.length === 0 ? text : [...images, { type: "text", text }];
}

// `ExtensionProcess`를 SDK의 `SpawnedProcess`로 맞춘다.
function spawned(proc: ExtensionProcess): SpawnedProcess {
  const events = new EventEmitter();
  const stdout = new PassThrough();
  const stdin = new Writable({
    write(chunk: Buffer, _encoding, done) {
      proc.write(chunk.toString());
      done();
    },
    final(done) {
      proc.end();
      done();
    },
  });
  let killed = false;
  let exitCode: number | null = null;
  proc.onStdout((text) => stdout.write(text));
  proc.onExit((code) => {
    exitCode = code;
    stdout.end();
    events.emit("exit", code, null);
  });
  return {
    stdin,
    stdout,
    get killed() {
      return killed;
    },
    get exitCode() {
      return exitCode;
    },
    kill() {
      killed = true;
      proc.kill();
      return true;
    },
    on: events.on.bind(events) as unknown as SpawnedProcess["on"],
    once: events.once.bind(events) as unknown as SpawnedProcess["once"],
    off: events.off.bind(events) as unknown as SpawnedProcess["off"],
  };
}

const relative = (cwd: string, path: string) =>
  path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;

function summaryOf(cwd: string, input: Record<string, unknown>): string {
  for (const key of [
    "file_path",
    "command",
    "pattern",
    "url",
    "query",
    "description",
  ]) {
    const value = str(input[key]);
    if (value !== "")
      return oneLine(key === "file_path" ? relative(cwd, value) : value, 120);
  }
  return "";
}

// 문서를 바꾸는 tool의 경로와 줄 수. 승인 카드와 tool 줄이 같은 셈을 쓴다.
function editOf(
  name: string,
  input: Record<string, unknown>,
): { path: string; added: number; removed: number } | null {
  const path = str(input.file_path) || str(input.notebook_path);
  if (!EDIT_TOOLS.includes(name) || path === "") return null;
  if (name === "Edit")
    return {
      path,
      added: lines(input.new_string),
      removed: lines(input.old_string),
    };
  if (name === "MultiEdit") {
    const edits = Array.isArray(input.edits)
      ? (input.edits as Record<string, unknown>[])
      : [];
    return {
      path,
      added: edits.reduce((sum, one) => sum + lines(one.new_string), 0),
      removed: edits.reduce((sum, one) => sum + lines(one.old_string), 0),
    };
  }
  return {
    path,
    added: lines(name === "NotebookEdit" ? input.new_source : input.content),
    removed: 0,
  };
}

type SubagentDetail = Extract<
  NonNullable<AcpToolItem["detail"]>,
  { kind: "subagent" }
>;

function detailOf(
  cwd: string,
  name: string,
  input: Record<string, unknown>,
  child: string | null,
): AcpToolItem["detail"] {
  if (name === "AskUserQuestion") {
    return { kind: "question", group: null, outcome: null, lines: [] };
  }
  if (AGENT_TOOLS.includes(name)) {
    return {
      kind: "subagent",
      agent: str(input.subagent_type) || "general-purpose",
      description: str(input.description),
      child,
      state: "running",
      model: str(input.model) || null,
      last: null,
    };
  }
  const edit = editOf(name, input);
  if (edit === null) return { kind: "generic" };
  return {
    kind: "edit",
    document: edit.path,
    path: relative(cwd, edit.path),
    added: edit.added,
    removed: edit.removed,
  };
}

// "이 session 동안" 허락은 사람의 설정 file에 남기지 않는다(Bash 제안은 `localSettings`로 온다).
const sessionOnly = (suggestions: PermissionUpdate[]) =>
  suggestions.map(
    (one): PermissionUpdate => ({
      ...one,
      destination: "session",
    }),
  );

const ruleText = (rule: { toolName: string; ruleContent?: string }) =>
  rule.ruleContent === undefined
    ? rule.toolName
    : `${rule.toolName}(${rule.ruleContent})`;

// 카드가 허락에서 무엇을 여는지 보이는 글이다.
function patternsOf(suggestions: PermissionUpdate[]): string[] {
  return suggestions
    .flatMap((one) =>
      one.type === "addRules"
        ? one.rules.map(ruleText)
        : one.type === "setMode"
          ? [`mode ${one.mode}`]
          : one.type === "addDirectories"
            ? one.directories.map((dir) => `dir ${dir}`)
            : [],
    )
    .map((pattern) => oneLine(pattern, 500));
}

function subjectOf(
  cwd: string,
  name: string,
  input: Record<string, unknown>,
  description: string | undefined,
): AcpApprovalItem["subject"] {
  const command = str(input.command);
  if (name === "Bash" && command !== "") return { kind: "shell", command };
  if (name === "ExitPlanMode") {
    return {
      kind: "plan",
      plan: str(input.plan),
      modes: PLAN_MODES.map(([id, label]) => ({ id, label })),
    };
  }
  const edit = editOf(name, input);
  if (edit !== null) {
    return {
      kind: "file_change",
      changes: [
        {
          path: relative(cwd, edit.path),
          change: name === "Write" ? "create" : "update",
          added: edit.added,
          removed: edit.removed,
        },
      ],
    };
  }
  const category = CATEGORIES[name];
  return {
    kind: "mcp_tool",
    server: "claude",
    tool:
      description === undefined
        ? name
        : `${name}: ${oneLine(description, 200)}`,
    effect:
      category === "read" || category === "list" || category === "search"
        ? "read"
        : "external",
  };
}

// SDK type에는 없지만 CLI가 model마다 싣는다(녹화 fast). Opus·Sonnet·Haiku 5.5는 thinking을 끌 수 없다.
const canThinkOff = (one: ModelInfo) =>
  (one as ModelInfo & { supportsThinkingOff?: boolean }).supportsThinkingOff ===
  true;

function modelGroups(models: ModelInfo[]): AcpModelGroup[] {
  const onOff = (id: string, label: string, off: string, on: string) => ({
    id,
    label,
    kind: "switch" as const,
    values: [
      { value: "off", label: off },
      { value: "on", label: on },
    ],
  });
  return [
    {
      id: "claude",
      label: "Claude",
      models: models.map((one) => ({
        id: one.value,
        label: one.displayName,
        axes: [
          ...(one.supportsEffort && one.supportedEffortLevels !== undefined
            ? [
                {
                  id: "effort",
                  label: "Effort",
                  kind: "choice" as const,
                  values: one.supportedEffortLevels.map((value) => ({
                    value,
                    label: value,
                  })),
                },
              ]
            : []),
          ...(one.supportsFastMode === true
            ? [onOff("fast", "Speed", "Standard", "Fast")]
            : []),
          ...(canThinkOff(one)
            ? [onOff("thinking", "Thinking", "Off", "On")]
            : []),
        ],
      })),
    },
  ];
}

/** 대화 한 줄기. root 대화와 subagent마다 하나씩이고, 자식의 갱신은 `child_update`로 싸서 낸다. */
type Lane = {
  /** `AcpState.children`의 key. root는 null. */
  child: string | null;
  seq: number;
  /** 도는 turn의 id. SDK는 turn 경계를 `result`로만 알린다. */
  turn: string | null;
  modelCall: string | null;
  streamed: { text: number; reasoning: number };
  reasoning: string;
  calls: Map<string, Call>;
  /** 이미 그린 SDK uuid. 끝난 뒤 transcript로 채울 때 건너뛴다. */
  seen: Set<string>;
  /** query가 바뀌어 버린 줄기. */
  dead: boolean;
  /** TaskCreate·TaskUpdate로 쌓은 todo 목록(task id 순서는 만든 순서). */
  todos: Map<
    string,
    {
      subject: string;
      activeForm: string;
      status: "pending" | "in_progress" | "completed";
    }
  >;
  /** subagent에게 맡긴 일(prompt). task_started가 알려 첫 줄로 그리고, 뒤에 오는 같은 글은 건너뛴다. */
  prompt: string | null;
  emit(update: AcpChildUpdate): void;
};
type Call = {
  id: string;
  done: boolean;
  denied: boolean;
  /** 본문(`body.input`)에 쓸 입력. */
  input: Record<string, unknown>;
  tool: string;
  /** TodoWrite·TaskCreate처럼 tool 줄을 내지 않는 호출. */
  hidden?: boolean;
  /** subagent(Agent tool) 호출이면 그 상태. */
  agent?: {
    detail: SubagentDetail;
    taskId: string | null;
    /** 자식 대화 줄기. */
    lane: Lane;
    /** 이 tool 줄이 선 줄기. */
    owner: Lane;
    background: boolean;
  };
  /** AskUserQuestion이면 묶음 id와 질문, 받은 답. */
  question?: {
    group: string;
    asked: Question[];
    answers: Record<string, string>;
  };
};
type ApprovalWait = {
  input: Record<string, unknown>;
  /** SDK 제안 그대로(영구 저장 위치를 포함한다). */
  suggestions: PermissionUpdate[];
  plan: boolean;
  call: Call;
  resolve(result: PermissionResult): void;
};
type QuestionWait = {
  input: Record<string, unknown>;
  call: Call;
  resolve(result: PermissionResult): void;
};
type Queued = { id: string; at: string; content: ContentBlock[] };
/** query 하나. rewind·fork가 query를 바꾸면 옛 것의 메시지는 버린다. */
type Live = {
  q: Cancelable;
  input: ReturnType<typeof inputQueue>;
  /** claude process가 끝나면 resolve. */
  exited: Promise<void>;
  /** rewind·fork가 이 query를 내보냈다. 남은 메시지는 버린다. */
  retired: boolean;
};

function inputQueue() {
  const items: SDKUserMessage[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  return {
    push(message: SDKUserMessage) {
      items.push(message);
      wake?.();
    },
    end() {
      ended = true;
      wake?.();
    },
    async *[Symbol.asyncIterator]() {
      for (;;) {
        const next = items.shift();
        if (next !== undefined) {
          yield next;
        } else if (ended) {
          return;
        } else {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      }
    },
  };
}

const start: (sdk: ClaudeSdk) => Start =
  (sdk) =>
  async ({ terminal, cwd, resume, session, spawn, clock, ids }) => {
    // 한 session을 두 process가 같이 쓰지 않는다. TUI가 foreground에 있으면 먼저 `exitTui`로 끝내야 한다.
    if (terminal !== null && terminal.state() !== "shell") {
      return {
        ok: false,
        error: {
          code: "conflict",
          message: "The terminal is still running Claude Code.",
        },
      } satisfies Result<never>;
    }
    let closed = false;
    let stopped = false;
    let finished = false;
    let dead: { code: string; message: string } | null = null;
    let stderrTail = "";
    let spawnFailed = false;
    const now = () => clock.now();
    // 숨긴 구간(rewind·fork)을 만들 항목은 reducer가 접은 사본에서 읽는다.
    let mirror: AcpState = EMPTY_ACP_STATE;
    const publish = (update: AcpUpdate) => {
      if (closed) return;
      mirror = reduceAcp(mirror, update);
      session.publish(update);
    };

    const newLane = (child: string | null): Lane => ({
      child,
      seq: 0,
      turn: null,
      modelCall: null,
      streamed: { text: 0, reasoning: 0 },
      reasoning: "",
      calls: new Map(),
      seen: new Set(),
      dead: false,
      prompt: null,
      todos: new Map(),
      emit: (update) =>
        publish(
          child === null ? update : { type: "child_update", child, update },
        ),
    });
    const root = newLane(null);
    // Agent tool_use id → 그 subagent의 줄기. 자식 메시지는 `parent_tool_use_id`로 찾는다.
    const lanes = new Map<string, Lane>();
    let stopping = false;
    let replaying = false;
    // Agent tool 줄 → 그 호출. background subagent는 turn이 끝난 뒤에 알림이 오므로 turn이 끝나도 남긴다.
    const agentCalls = new Map<string, Call>();
    const approvals = new Map<string, ApprovalWait>();
    const questions = new Map<string, QuestionWait>();
    // CLI 줄에 있는 사람 메시지(uuid → 메시지). Map의 순서가 줄 순서다.
    const queued = new Map<string, Queued>();
    // `/effort`처럼 사람에게 보이지 않는 명령의 uuid. 그 result는 turn을 닫지 않는다.
    const silent = new Set<string>();
    // ACP 메시지 id → SDK uuid(사람 메시지와 assistant 메시지). rewind·fork·retry가 쓴다.
    const uuidOfMessage = new Map<string, string>();
    const contentOfMessage = new Map<string, ContentBlock[]>();
    const userOfTurn = new Map<string, string>();
    // `!` 명령. 도는 process와, turn이 끝나기를 기다리는 결과(끝난 뒤 transcript에 붙인다).
    const shells = new Map<
      string,
      { proc: ExtensionProcess; killed: boolean }
    >();
    const shellOutbox: { command: string; out: string; err: string }[] = [];
    // transcript에만 붙인 shell 메시지의 uuid. 그 result(num_turns 0)는 turn이 아니다(녹화 shell_append).
    const shellUuids = new Set<string>();

    // query를 다시 열 때 넘기는 것과 TUI로 넘길 때의 flag.
    const carry: {
      model: string | null;
      effort: string | null;
      mode: string | null;
      /** null = 사람이 아직 안 건드렸다. */
      fast: boolean | null;
      thinking: boolean | null;
      rules: Set<string>;
      dirs: Set<string>;
    } = {
      model: null,
      effort: null,
      mode: null,
      fast: null,
      thinking: null,
      rules: new Set(),
      dirs: new Set(),
    };
    let cliSession = resume ?? uuidOf(ids);
    let models: ModelInfo[] = [];
    let modelId: string | null = null; // 지금 model의 resolved id
    let shownModel: string | null = null; // 사람이 고른 model row의 value
    let fastState = "off"; // init의 fast_mode_state
    let rawCommands: SlashCommand[] = [];
    let terminalCommands = new Set<string>();
    let skills: string[] = [];
    let plugins: string[] = [];
    // background task. 끝난 것은 알림으로 남기고, 목록에서 빠져도 끝난 채로 둔다.
    const taskList = new Map<string, AcpTask>();
    // 도는 background subagent의 task id. tool 줄(subagent detail)이 보이고 task 목록에는 올리지 않는다.
    const liveAgents = new Set<string>();
    const limits = new Map<string, AcpUsageLimit>();
    // 마지막으로 CLI에 보낸 명령의 이름. 이름 없이 오는 명령 출력이 쓴다.
    let lastCommand = "";
    // 이 CLI session에 메시지가 하나라도 갔나. 비었으면 TUI가 --resume으로 못 연다(`--session-id`로 연다).
    let empty = resume === undefined;
    const totals = { input: 0, output: 0, read: 0, write: 0, turns: 0 };
    let contextUsage: NonNullable<AcpUsage["context"]> | null = null;
    let cost = { base: 0, last: 0 };

    // --- ACP session meta ---------------------------------------------------------------------
    const changed = (meta: Partial<AcpSessionMeta>) =>
      publish({ type: "session_changed", session: meta });

    function currentRow(): ModelInfo | undefined {
      const rows = models.filter(
        (one) => one.value === shownModel || one.resolvedModel === modelId,
      );
      return (
        rows.find((one) => one.value === shownModel) ??
        (modelId === null ? undefined : rows[0])
      );
    }
    function currentModel(): AcpSessionMeta["model"] {
      const row = currentRow();
      if (row === undefined) return null;
      // 축이 있는 model에만 값을 싣는다. 값을 안 고른 switch는 CLI가 말해 주는 현재 값이다.
      const options: Record<string, string> = {};
      if (carry.effort !== null) options.effort = carry.effort;
      if (row.supportsFastMode === true)
        options.fast = (carry.fast ?? fastState === "on") ? "on" : "off";
      if (canThinkOff(row))
        options.thinking = carry.thinking === false ? "off" : "on";
      return { model: row.value, label: row.displayName, options, layer: null };
    }
    const publishModels = () =>
      changed({ models: modelGroups(models), model: currentModel() });
    // SDK는 명령의 출처를 주지 않아 init의 skills·plugins와 이름 꼴로 가른다. user·project 명령은 가를 단서가 없다.
    function sourceOf(one: SlashCommand): AcpCommand["source"] {
      if (one.builtin === true) return "harness";
      if (one.name.startsWith("mcp__")) return "mcp";
      if (skills.includes(one.name)) return "skill";
      const qualified = skills.some((name) => name.endsWith(`:${one.name}`));
      if (
        qualified ||
        one.name.includes(":") ||
        plugins.some((name) => one.name.startsWith(`${name}:`))
      )
        return "plugin";
      return "custom_user";
    }
    const own = (
      name: string,
      description: string,
      opens: AcpCommand["opens"],
      extra: Partial<AcpCommand> = {},
    ): AcpCommand => ({
      name,
      aliases: [],
      description,
      argument_hint: null,
      source: "harness",
      opens,
      ...extra,
    });
    // 화면 동작으로 내는 줄. SDK 목록에 없는 TUI 명령(permissions, plan, rewind, status)도 여기서 낸다.
    const ownCommands: AcpCommand[] = [
      own("model", "Set the AI model for Claude Code", "model"),
      own("effort", "Set effort level for model usage", "effort"),
      own("permissions", "Choose how Claude asks before acting", "mode"),
      own("plan", "Toggle plan mode", null),
      own("rename", "Rename the current conversation", "rename", {
        argument_hint: "[name]",
      }),
      own("rewind", "Rewind the conversation to an earlier message", "rewind"),
      own("fork", "Fork the conversation from here", "fork"),
      own("status", "Show the session status", "status"),
      own("usage", "Show session cost and plan usage", "usage", {
        aliases: ["cost", "stats"],
      }),
      own("context", "Show current context usage", "context"),
      own("resume", "Resume an earlier session", "resume"),
      own("clear", "Start a new session with empty context", null, {
        aliases: ["reset", "new"],
      }),
    ];
    function publishCommands() {
      changed({
        commands: [
          ...ownCommands,
          ...rawCommands
            .filter(
              (one) =>
                !terminalCommands.has(one.name) &&
                !HIDDEN_COMMANDS.has(one.name) &&
                !SCREEN_COMMANDS.has(one.name),
            )
            .map(
              (one): AcpCommand => ({
                name: one.name,
                aliases: one.aliases ?? [],
                description: one.description,
                argument_hint:
                  one.argumentHint === "" ? null : one.argumentHint,
                source: sourceOf(one),
                opens: one.name === "goal" ? "goal" : null,
              }),
            ),
        ],
      });
    }
    const runningTasks = () =>
      [...taskList.values()].filter((one) => one.state === "running").length +
      liveAgents.size;
    const publishTasks = () =>
      publish({ type: "tasks_changed", tasks: [...taskList.values()] });
    function usageNow(): AcpUsage {
      return {
        context: contextUsage,
        limits: [...limits.values()],
        input_tokens: totals.input,
        output_tokens: totals.output,
        cache_read_tokens: totals.read,
        cache_write_tokens: totals.write,
        turns: totals.turns,
        costs: [
          {
            kind: "estimated",
            currency: "USD",
            amount: (cost.base + cost.last).toFixed(4),
          },
        ],
        provider: null,
      };
    }
    async function refreshContext() {
      try {
        const usage = await live.q.getContextUsage({ detail: "full" });
        contextUsage = {
          tokens: usage.totalTokens,
          limit: usage.maxTokens,
          // 창에 든 행만이다. free·buffer·deferred는 창 밖(또는 남은 자리)이다. 행 이름이 아니라 kind로 가른다.
          parts: usage.categories
            .filter((one) => one.kind === "used")
            .map((one) => ({ label: one.name, tokens: one.tokens })),
        };
        modelId = usage.model;
      } catch {
        // 사용량을 못 읽어도 대화는 이어진다.
      }
      changed({ usage: usageNow(), model: currentModel() });
    }
    function setMode(mode: string) {
      if (carry.mode === mode) return;
      carry.mode = mode;
      changed({ mode });
    }

    // --- turn, 항목 -----------------------------------------------------------------------------
    function startTurn(lane: Lane): string {
      const turn = ids.newId("trn");
      lane.turn = turn;
      lane.emit({ type: "turn_started", turn, at: now() });
      return turn;
    }
    const ensureTurn = (lane: Lane) => lane.turn ?? startTurn(lane);

    // 사람 메시지의 origin은 SDK uuid다: 처음 보낼 때 단 uuid가 transcript에도 그대로 남아 resume해도 같다.
    function addUser(
      lane: Lane,
      id: string,
      content: ContentBlock[],
      at: string,
      uuid: string,
    ) {
      const turnId = ensureTurn(lane);
      if (uuid !== "") lane.seen.add(uuid);
      if (lane === root) {
        uuidOfMessage.set(id, uuid);
        contentOfMessage.set(id, content);
        userOfTurn.set(turnId, id);
      }
      lane.emit({
        type: "message_added",
        item: {
          kind: "message",
          id,
          seq: ++lane.seq,
          at,
          actor: "user",
          sender: null,
          call: null,
          reply_to: null,
          delivery: "next_turn",
          turn: turnId,
          origin: lane === root ? uuid : null,
          content,
          reasoning: null,
          cards: [],
          complete: true,
        },
      });
    }

    function notify(lane: Lane, body: AcpNoticeItem["notice"]) {
      lane.emit({
        type: "notice_added",
        item: {
          kind: "notice",
          id: ids.newId("not"),
          seq: ++lane.seq,
          at: now(),
          turn: lane.turn,
          notice: body,
        },
      });
    }
    // turn이 없어도 버리지 않는다(`turn: null`).
    function info(text: string, level: "info" | "warning" = "info") {
      const clean = text.trim().slice(0, 8000);
      if (clean !== "") notify(root, { type: "info", text: clean, level });
    }
    function commandOutput(command: string, text: string) {
      const clean = text.trim().slice(0, 64_000);
      if (clean === "") return;
      if (command === "") info(clean);
      else
        notify(root, {
          type: "command_output",
          command,
          text: clean,
          format: "markdown",
        });
    }

    // TodoWrite의 목록을 plan으로 낸다.
    function todoPlan(lane: Lane, toolInput: Record<string, unknown>) {
      const todos = Array.isArray(toolInput.todos)
        ? (toolInput.todos as Record<string, unknown>[])
        : [];
      lane.emit({
        type: "plan_changed",
        entries: todos.map((one) => {
          const status = str(one.status);
          return {
            text:
              status === "in_progress"
                ? str(one.activeForm) || str(one.content)
                : str(one.content),
            status:
              status === "in_progress" || status === "completed"
                ? status
                : "pending",
          };
        }),
      });
    }

    // TaskCreate는 결과 글의 `Task #<id>`로 id를 얻고, TaskUpdate는 입력 그대로 고친다. deleted는 CLI도 목록에서 지운다.
    function taskResult(lane: Lane, call: Call, output: string) {
      const input = call.input;
      if (call.tool === "TaskCreate") {
        const id = /Task #(\S+) created/.exec(output)?.[1];
        if (id === undefined) return;
        lane.todos.set(id, {
          subject: str(input.subject),
          activeForm: str(input.activeForm),
          status: "pending",
        });
      } else {
        const entry = lane.todos.get(str(input.taskId));
        if (entry === undefined) return;
        const status = str(input.status);
        if (status === "deleted") {
          lane.todos.delete(str(input.taskId));
        } else {
          if (str(input.subject) !== "") entry.subject = str(input.subject);
          if (str(input.activeForm) !== "")
            entry.activeForm = str(input.activeForm);
          if (
            status === "pending" ||
            status === "in_progress" ||
            status === "completed"
          )
            entry.status = status;
        }
      }
      lane.emit({
        type: "plan_changed",
        entries: [...lane.todos.values()].map((one) => ({
          text:
            one.status === "in_progress" && one.activeForm !== ""
              ? one.activeForm
              : one.subject,
          status: one.status,
        })),
      });
    }

    // 그 subagent tool 줄의 detail을 고친다(task 알림이 오거나 tool 줄이 끝날 때).
    function setAgent(call: Call, patch: Partial<SubagentDetail>) {
      const agent = call.agent;
      if (agent === undefined) return;
      agent.detail = { ...agent.detail, ...patch };
      agent.owner.emit({
        type: "tool_detail_changed",
        tool_call: call.id,
        detail: agent.detail,
      });
    }

    function toolStart(
      lane: Lane,
      useId: string,
      name: string,
      toolInput: Record<string, unknown>,
    ): Call {
      const known = lane.calls.get(useId);
      if (known !== undefined) return known;
      const call: Call = {
        id: ids.newId("tcl"),
        done: false,
        denied: false,
        input: toolInput,
        tool: name,
      };
      lane.calls.set(useId, call);
      if (TASK_TOOLS.includes(name)) {
        // 결과(task id)가 와야 목록에 든다.
        call.hidden = true;
        return call;
      }
      if (name === TODO_TOOL) {
        // todo는 dock이 그리고 tool 줄은 내지 않는다.
        call.hidden = true;
        call.done = true;
        todoPlan(lane, toolInput);
        return call;
      }
      const detail = detailOf(
        cwd,
        name,
        toolInput,
        AGENT_TOOLS.includes(name) && !replaying ? useId : null,
      );
      if (detail.kind === "subagent") {
        const child = newLane(useId);
        // replay는 자식 대화를 다시 그리지 않아 child가 null이다.
        if (!replaying) lanes.set(useId, child);
        call.agent = {
          detail,
          taskId: null,
          lane: child,
          owner: lane,
          background: toolInput.run_in_background === true,
        };
        agentCalls.set(useId, call);
      }
      const summary = summaryOf(cwd, toolInput);
      lane.emit({
        type: "tool_started",
        item: {
          kind: "tool",
          id: call.id,
          seq: ++lane.seq,
          at: now(),
          by: "agent",
          turn: ensureTurn(lane),
          tool: name,
          category: CATEGORIES[name] ?? "other",
          title: summary === "" ? name : `${name} ${summary}`,
          state: "running",
          duration_ms: null,
          detail,
          body: toolBody(JSON.stringify(toolInput, null, 2), null),
        },
      });
      return call;
    }

    function toolEnd(
      lane: Lane,
      call: Call,
      state: "ok" | "error" | "denied" | "cancelled",
      output: string | null = null,
    ) {
      call.done = true;
      const asked = call.question;
      lane.emit({
        type: "tool_ended",
        tool_call: call.id,
        state,
        at: now(),
        detail:
          asked === undefined
            ? null
            : {
                kind: "question",
                group: asked.group,
                outcome: state === "ok" ? "submitted" : "cancelled",
                lines: asked.asked.map((one) => ({
                  header: one.header,
                  answer: asked.answers[one.question] ?? null,
                })),
              },
        body: toolBody(JSON.stringify(call.input, null, 2), output),
      });
      // 앞에서 도는 subagent는 tool 줄이 끝나면 끝난 것이다. background는 task 알림이 끝낸다(replay에는 알림이 없다).
      const agent = call.agent;
      if (agent?.detail.state === "running" && (replaying || !agent.background))
        setAgent(call, {
          state:
            state === "ok"
              ? "done"
              : state === "error"
                ? "failed"
                : "cancelled",
        });
    }

    // --- 승인, 질문 ----------------------------------------------------------------------------
    // 허락 규칙은 query를 다시 열 때 `allowedTools`로 되살린다(session destination은 process와 함께 사라진다).
    function remember(updates: PermissionUpdate[]) {
      for (const one of updates) {
        if (one.type === "addRules" && one.behavior === "allow") {
          for (const rule of one.rules) carry.rules.add(ruleText(rule));
        } else if (one.type === "addDirectories") {
          for (const dir of one.directories) carry.dirs.add(dir);
        } else if (one.type === "setMode") {
          setMode(one.mode);
        }
      }
    }

    function closeApproval(
      id: string,
      decision: "once" | "session" | "always" | "mode" | "reject" | "cancelled",
      reason?: string,
      mode?: string,
    ) {
      const wait = approvals.get(id);
      if (wait === undefined) return;
      approvals.delete(id);
      const allowed = decision !== "reject" && decision !== "cancelled";
      if (allowed) {
        // ExitPlanMode는 고른 mode로 이어 간다. 어느 mode여도 허락 규칙은 이 session에만 건다(사람의 설정 file에 쓰지 않는다).
        const updates: PermissionUpdate[] = wait.plan
          ? [
              {
                type: "setMode",
                mode:
                  PLAN_MODES.find(([one]) => one === mode)?.[0] ?? "default",
                destination: "session",
              },
            ]
          : decision === "session"
            ? sessionOnly(wait.suggestions)
            : decision === "always"
              ? wait.suggestions
              : [];
        if (decision !== "always" || wait.plan) remember(updates);
        wait.resolve({
          behavior: "allow",
          updatedInput: wait.input,
          ...(updates.length > 0 ? { updatedPermissions: updates } : {}),
        });
      } else {
        wait.call.denied = decision === "reject";
        wait.resolve({ behavior: "deny", message: reason ?? DENIED });
      }
      publish({
        type: "approval_closed",
        request: id,
        outcome: allowed
          ? "allowed"
          : decision === "reject"
            ? "denied"
            : "cancelled",
        choice: allowed && decision !== "mode" ? decision : null,
        reason: reason ?? null,
        mode: decision === "mode" ? (mode ?? null) : null,
        seq: ++root.seq,
        at: now(),
      });
    }

    function closeQuestion(
      toolCall: string,
      answers: Record<string, string> | null,
    ) {
      const wait = questions.get(toolCall);
      const asked = wait?.call.question;
      if (wait === undefined || asked === undefined) return;
      questions.delete(toolCall);
      if (answers === null) {
        wait.resolve({
          behavior: "deny",
          message: "The user dismissed the question.",
        });
      } else {
        asked.answers = answers;
        wait.resolve({
          behavior: "allow",
          updatedInput: { ...wait.input, answers },
        });
      }
      publish({
        type: "question_resolved",
        group: asked.group,
        outcome: answers === null ? "cancelled" : "submitted",
      });
    }

    const canUseTool: CanUseTool = (name, toolInput, options) =>
      new Promise<PermissionResult>((resolve) => {
        // subagent가 묻는 승인·질문도 root에 카드로 낸다(사람이 답한다). tool 줄은 그 subagent 줄기에 이미 있다.
        const lane =
          [root, ...lanes.values()].find((one) =>
            one.calls.has(options.toolUseID),
          ) ?? root;
        const call = toolStart(lane, options.toolUseID, name, toolInput);
        if (name === "AskUserQuestion") {
          const asked = (
            (toolInput.questions as Question[] | undefined) ?? []
          ).map((one) => ({
            question: one.question,
            header: one.header,
            options: one.options.map((option) => ({
              label: option.label,
              description: option.description,
            })),
            multiSelect: one.multiSelect,
          }));
          const group = ids.newId("qgr");
          call.question = { group, asked, answers: {} };
          questions.set(call.id, { input: toolInput, call, resolve });
          options.signal.addEventListener(
            "abort",
            () => closeQuestion(call.id, null),
            { once: true },
          );
          publish({
            type: "question_asked",
            group,
            tool_call: call.id,
            questions: asked,
          });
          return;
        }
        const request = ids.newId("apr");
        const plan = name === "ExitPlanMode";
        const suggestions = plan ? [] : (options.suggestions ?? []);
        approvals.set(request, {
          input: toolInput,
          suggestions,
          plan,
          call,
          resolve,
        });
        options.signal.addEventListener(
          "abort",
          () => closeApproval(request, "cancelled"),
          { once: true },
        );
        const patterns = patternsOf(suggestions);
        // 영구로 남는 선택(always)은 SDK 제안이 session 밖(localSettings 등)을 가리킬 때만 따로 있다.
        const permanent = suggestions.some(
          (one) => one.destination !== "session",
        );
        publish({
          type: "approval_opened",
          approval: {
            id: request,
            subject: subjectOf(cwd, name, toolInput, options.description),
            choices: plan
              ? ["reject"]
              : patterns.length === 0
                ? ["once", "reject"]
                : permanent
                  ? ["once", "session", "always", "reject"]
                  : ["once", "session", "reject"],
            always_patterns: patterns,
          },
        });
      });

    // --- turn 끝, SDK 메시지 ------------------------------------------------------------------
    function closeLane(
      lane: Lane,
      outcome: "completed" | "stopped" | "failed",
      error?: { code: string; message: string },
    ) {
      const id = lane.turn ?? ids.newId("trn");
      for (const call of lane.calls.values())
        if (!call.done && call.hidden !== true)
          toolEnd(lane, call, "cancelled");
      lane.calls.clear();
      lane.reasoning = "";
      lane.emit({
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
    }

    function endTurn(
      outcome: "completed" | "stopped" | "failed",
      error?: { code: string; message: string },
    ) {
      for (const request of [...approvals.keys()])
        closeApproval(request, "cancelled");
      for (const toolCall of [...questions.keys()])
        closeQuestion(toolCall, null);
      // 앞에서 도는 subagent의 대화는 부모 turn과 함께 닫힌다. background는 task 알림이 닫는다.
      for (const call of agentCalls.values()) {
        const agent = call.agent;
        if (agent?.lane.turn != null && !agent.background)
          closeLane(
            agent.lane,
            outcome === "completed" ? "completed" : "stopped",
          );
      }
      closeLane(root, outcome, error);
      stopping = false;
      flushShell();
    }

    const textOf = (blocks: Block[]) =>
      blocks
        .flatMap((block) =>
          block.type === "text" && block.text ? [block.text] : [],
        )
        .join("\n");

    function onAssistant(lane: Lane, message: SdkMessage, content: Block[]) {
      if (message.uuid !== undefined) {
        if (lane.seen.has(message.uuid)) return;
        lane.seen.add(message.uuid);
      }
      if (message.local_command_run !== undefined) {
        // `/context` 같은 명령의 출력이다.
        lastCommand = message.local_command_run.command;
        commandOutput(lastCommand, textOf(content));
        return;
      }
      for (const block of content) {
        if (block.type === "thinking") {
          lane.reasoning += block.thinking ?? "";
        } else if (block.type === "text" && block.text) {
          const id = ids.newId("msg");
          if (lane === root && message.uuid !== undefined)
            uuidOfMessage.set(id, message.uuid);
          lane.emit({
            type: "message_recorded",
            turn: ensureTurn(lane),
            message: id,
            model_call: lane.modelCall,
            seq: ++lane.seq,
            at: now(),
            body: {
              content: [{ type: "text", text: block.text }],
              reasoning:
                lane.reasoning === ""
                  ? null
                  : { text: lane.reasoning, duration_ms: null },
              cards: [],
            },
          });
          lane.reasoning = "";
        } else if (block.type === "tool_use" && block.id && block.name) {
          toolStart(lane, block.id, block.name, block.input ?? {});
        }
      }
    }

    function onToolResults(lane: Lane, content: Block[]) {
      for (const block of content) {
        const call =
          block.type === "tool_result"
            ? lane.calls.get(block.tool_use_id ?? "")
            : undefined;
        if (call === undefined || call.done) continue;
        const output =
          typeof block.content === "string"
            ? block.content
            : textOf(block.content ?? []);
        if (call.hidden === true) {
          call.done = true;
          if (block.is_error !== true) taskResult(lane, call, output);
          continue;
        }
        toolEnd(
          lane,
          call,
          block.is_error !== true ? "ok" : call.denied ? "denied" : "error",
          output,
        );
      }
    }

    // 자식 줄기의 user 메시지: 글이면 맡긴 일(prompt)이고 tool_result면 tool의 결과다.
    function onUser(lane: Lane, message: SdkMessage, content: Block[]) {
      if (message.uuid !== undefined) {
        if (lane.seen.has(message.uuid)) return;
        lane.seen.add(message.uuid);
      }
      const text = textOf(content);
      if (lane !== root && text !== "" && text === lane.prompt) return;
      if (lane !== root && text !== "")
        addUser(
          lane,
          ids.newId("msg"),
          [{ type: "text", text }],
          now(),
          message.uuid ?? "",
        );
      else onToolResults(lane, content);
    }

    function onStream(lane: Lane, event: NonNullable<SdkMessage["event"]>) {
      if (event.type === "message_start") {
        lane.modelCall = ids.newId("mcl");
        lane.streamed.text = 0;
        lane.streamed.reasoning = 0;
        return;
      }
      const delta = event.delta;
      if (event.type !== "content_block_delta" || delta === undefined) return;
      const kind =
        delta.type === "text_delta"
          ? "text"
          : delta.type === "thinking_delta"
            ? "reasoning"
            : null;
      const text = kind === "text" ? delta.text : delta.thinking;
      if (kind === null || !text) return;
      lane.modelCall ??= ids.newId("mcl");
      lane.emit({
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

    // 줄에 있던 메시지를 CLI가 가져갔다: 쉬는 중이면 새 turn이고, 도는 turn이면 steer로 끼어든 것이다.
    function onStarted(uuid: string) {
      const message = queued.get(uuid);
      if (message === undefined) return;
      queued.delete(uuid);
      uuidOfMessage.set(message.id, uuid);
      contentOfMessage.set(message.id, message.content);
      const steer = root.turn !== null;
      const id = root.turn ?? startTurn(root);
      userOfTurn.set(id, message.id);
      publish({
        type: "message_taken",
        message: message.id,
        seq: ++root.seq,
        delivery: steer ? "steer" : "next_turn",
        turn: steer ? null : id,
      });
      publish({ type: "origin_set", message: message.id, origin: uuid });
    }

    let titled: string | null = null;
    async function refreshTitle() {
      try {
        const found = await sdk.getSessionInfo(cliSession, { dir: cwd });
        const title = found?.customTitle ?? found?.summary ?? null;
        if (title !== null && title !== titled) {
          titled = title;
          changed({ title });
        }
      } catch {
        // 제목을 못 읽어도 대화는 이어진다.
      }
    }

    function onResult(message: SdkMessage) {
      const user = message.user_message_uuid;
      if (user !== undefined && shellUuids.delete(user)) return;
      // 보이지 않는 명령(`/effort`)의 result는 turn을 닫지 않는다. 그 명령이 일을 시작해 turn이 열렸으면(`/goal`) 닫는다.
      if (user !== undefined && silent.delete(user) && root.turn === null)
        return;
      const usage = message.usage;
      totals.input += usage?.input_tokens ?? 0;
      totals.output += usage?.output_tokens ?? 0;
      totals.read += usage?.cache_read_input_tokens ?? 0;
      totals.write += usage?.cache_creation_input_tokens ?? 0;
      totals.turns += 1;
      cost.last = message.total_cost_usd ?? cost.last;
      if (root.turn !== null) {
        const ok =
          (message.subtype === "success" && message.is_error !== true) ||
          message.terminal_reason === "background_requested" ||
          message.terminal_reason === "max_turns";
        const stoppedByUser =
          stopping ||
          message.terminal_reason === "aborted_streaming" ||
          message.terminal_reason === "aborted_tools";
        endTurn(
          ok && !stopping ? "completed" : stoppedByUser ? "stopped" : "failed",
          ok || stoppedByUser
            ? undefined
            : {
                code: "internal",
                message:
                  message.result ??
                  message.errors?.join("; ") ??
                  message.subtype ??
                  "claude failed",
              },
        );
      }
      void refreshContext();
      void refreshTitle();
    }

    // --- subagent, background task ------------------------------------------------------------
    const AGENT_STATE = {
      completed: "done",
      failed: "failed",
      stopped: "cancelled",
      killed: "cancelled",
    } as const;
    const TASK_STATE = {
      completed: "done",
      failed: "failed",
      stopped: "stopped",
      killed: "stopped",
    } as const;

    // subagent가 끝난 뒤 흘러오지 않은 글(마지막 답 등)을 transcript로 채운다. 이미 그린 uuid는 건너뛴다.
    async function fillChild(call: Call, taskId: string) {
      const lane = call.agent?.lane;
      if (lane === undefined || lane.dead) return;
      try {
        for (const one of await sdk.getSubagentMessages(cliSession, taskId, {
          dir: cwd,
        })) {
          if (lane.dead) return;
          const raw =
            (one.message as { content?: string | Block[] }).content ?? [];
          const blocks: Block[] =
            typeof raw === "string" ? [{ type: "text", text: raw }] : raw;
          const made: SdkMessage = { type: one.type, uuid: one.uuid };
          if (one.type === "assistant") onAssistant(lane, made, blocks);
          else onUser(lane, made, blocks);
        }
      } catch {
        // transcript를 못 읽어도 흘러온 만큼은 남는다.
      }
    }

    function agentByTask(taskId: string | undefined) {
      return [...agentCalls.values()].find(
        (one) => one.agent?.taskId === taskId,
      );
    }

    // task가 끝났다(task_updated의 status나 task_notification).
    function taskEnded(
      taskId: string,
      toolUseId: string | undefined,
      status: string,
      summary: string | undefined,
    ) {
      const call = agentCalls.get(toolUseId ?? "") ?? agentByTask(taskId);
      if (call?.agent !== undefined) {
        const state = AGENT_STATE[status as keyof typeof AGENT_STATE];
        if (state === undefined) return;
        const agent = call.agent;
        agent.taskId = taskId;
        liveAgents.delete(taskId);
        // task_updated와 task_notification이 둘 다 온다. 두 번째는 요약만 더한다.
        if (agent.detail.state !== "running") {
          if (summary !== undefined) setAgent(call, { last: summary });
          return;
        }
        setAgent(call, {
          state,
          last: summary ?? agent.detail.last,
        });
        void fillChild(call, taskId).then(() => {
          if (agent.lane.turn !== null && !agent.lane.dead)
            closeLane(
              agent.lane,
              state === "done"
                ? "completed"
                : state === "failed"
                  ? "failed"
                  : "stopped",
              state === "failed"
                ? {
                    code: "internal",
                    message: summary ?? "The subagent failed.",
                  }
                : undefined,
            );
        });
        return;
      }
      const task = taskList.get(taskId);
      const state = TASK_STATE[status as keyof typeof TASK_STATE];
      if (task !== undefined && state !== undefined) {
        taskList.set(taskId, { ...task, state });
        publishTasks();
      }
    }

    function onTask(message: SdkMessage) {
      const taskId = message.task_id ?? "";
      const call = agentCalls.get(message.tool_use_id ?? "");
      switch (message.subtype) {
        case "task_started":
          if (call?.agent !== undefined) {
            call.agent.taskId = taskId;
            liveAgents.add(taskId);
            if (message.prompt) {
              call.agent.lane.prompt = message.prompt;
              addUser(
                call.agent.lane,
                ids.newId("msg"),
                [{ type: "text", text: message.prompt }],
                now(),
                "",
              );
            }
          } else {
            info(`Started: ${message.description ?? ""}`);
          }
          return;
        case "task_progress":
          if (call?.agent !== undefined)
            setAgent(call, {
              last:
                message.summary ??
                message.description ??
                message.last_tool_name ??
                call.agent.detail.last,
            });
          return;
        case "task_updated":
          if (message.patch?.status !== undefined)
            taskEnded(taskId, undefined, message.patch.status, undefined);
          return;
        case "task_notification":
          taskEnded(
            taskId,
            message.tool_use_id,
            message.status ?? "",
            message.summary,
          );
          // subagent는 tool 줄이 보인다. 그 밖의 task만 알린다.
          if (call?.agent === undefined && agentByTask(taskId) === undefined)
            info(
              `${message.summary ?? "A background task"} (${message.status ?? "done"})`,
            );
          return;
        default:
          return;
      }
    }

    function onTasksChanged(message: SdkMessage) {
      const present = new Set<string>();
      for (const one of message.tasks ?? []) {
        const type = one.task_type ?? "";
        // subagent는 tool 줄 하나로만 보인다(task로 또 올리지 않는다).
        if (type.endsWith("agent")) continue;
        present.add(one.task_id);
        if (!taskList.has(one.task_id))
          taskList.set(one.task_id, {
            id: one.task_id,
            kind:
              type.includes("bash") || type.includes("shell")
                ? "shell"
                : "other",
            description: one.description ?? "",
            state: "running",
            started_at: now(),
            output: null,
          });
      }
      // 알림 없이 목록에서 빠진 task는 끝난 것으로 둔다.
      for (const [id, one] of taskList)
        if (one.state === "running" && !present.has(id))
          taskList.set(id, { ...one, state: "done" });
      publishTasks();
    }

    function onRateLimit(message: SdkMessage) {
      const info_ = message.rate_limit_info;
      if (info_ === undefined) return;
      const set = (
        type: string,
        utilization: number | undefined,
        resetsAt: number | undefined,
      ) =>
        limits.set(type, {
          id: type,
          label: LIMIT_LABELS[type] ?? type,
          // utilization은 0-1, resetsAt은 초다(녹화).
          used_percent:
            utilization === undefined
              ? null
              : Math.min(100, Math.round(utilization * 1000) / 10),
          left: null,
          resets_at:
            resetsAt === undefined
              ? null
              : new Date(resetsAt * 1000).toISOString(),
        });
      const windows = Object.entries(info_.unifiedWindows ?? {});
      for (const [type, one] of windows)
        set(type, one.utilization, one.resetsAt);
      if (windows.length === 0)
        set(
          info_.rateLimitType ?? "default",
          info_.utilization,
          info_.resetsAt,
        );
      changed({ usage: usageNow() });
      if (info_.status !== "allowed")
        info(
          `Usage limit ${info_.status} (${info_.rateLimitType ?? "default"})`,
          "warning",
        );
    }

    function onSystem(message: SdkMessage) {
      switch (message.subtype) {
        case "init": {
          if (message.session_id && message.session_id !== cliSession) {
            cliSession = message.session_id;
            changed({ cli_session: cliSession });
          }
          if (message.skills !== undefined) skills = message.skills;
          if (message.plugins !== undefined)
            plugins = message.plugins.map((one) => one.name);
          if (message.fast_mode_state !== undefined)
            fastState = message.fast_mode_state;
          if (message.terminal_slash_commands !== undefined)
            terminalCommands = new Set(message.terminal_slash_commands);
          publishCommands();
          if (message.permissionMode) setMode(message.permissionMode);
          if (message.model && message.model !== modelId) {
            modelId = message.model;
            changed({ model: currentModel() });
          }
          return;
        }
        case "status":
          if (message.permissionMode) setMode(message.permissionMode);
          if (message.status === "compacting")
            info("Compacting the conversation…");
          else if (message.compact_result === "failed")
            info(
              `Compaction failed${message.compact_error ? `: ${message.compact_error}` : ""}`,
              "warning",
            );
          return;
        case "compact_boundary": {
          const meta = message.compact_metadata;
          if (meta !== undefined)
            info(
              `Compacted the conversation: ${meta.pre_tokens} → ${meta.post_tokens ?? "?"} tokens`,
            );
          return;
        }
        case "local_command_output":
          commandOutput(lastCommand, message.content ?? "");
          return;
        case "informational":
          info(
            message.content ?? "",
            message.level === "warning" ? "warning" : "info",
          );
          return;
        case "notification":
          info(message.text ?? "");
          return;
        case "model_refusal_fallback":
          info(
            `The model refused; falling back from ${message.original_model ?? "?"} to ${message.fallback_model ?? "?"}.`,
            "warning",
          );
          return;
        case "hook_response":
          // 실패한 hook만 알린다.
          if (message.outcome === "error")
            info(
              `Hook ${message.hook_name ?? ""} failed: ${message.stderr || message.output || ""}`,
              "warning",
            );
          return;
        case "commands_changed":
          rawCommands = message.commands ?? rawCommands;
          publishCommands();
          return;
        case "api_retry":
          info(
            `Retrying the request (${message.attempt ?? "?"}/${message.max_retries ?? "?"})`,
            "warning",
          );
          return;
        case "permission_denied":
          info(
            `Permission denied for ${message.tool_name ?? "a tool"}: ${(message as { message?: unknown }).message ?? ""}`,
            "warning",
          );
          return;
        case "background_tasks_changed":
          onTasksChanged(message);
          return;
        case "task_started":
        case "task_progress":
        case "task_updated":
        case "task_notification":
          onTask(message);
          return;
        default:
          return;
      }
    }

    function onMessage(message: SdkMessage) {
      // subagent의 메시지는 그 Agent tool 줄의 자식 대화로 간다. 버린 줄기의 늦은 메시지는 버린다.
      const parent = message.parent_tool_use_id;
      const lane = parent ? lanes.get(parent) : root;
      if (lane === undefined || lane.dead) return;
      const content = message.message?.content;
      switch (message.type) {
        case "stream_event":
          if (message.event !== undefined) onStream(lane, message.event);
          return;
        case "assistant":
          if (Array.isArray(content)) onAssistant(lane, message, content);
          return;
        case "user":
          if (Array.isArray(content)) {
            onUser(lane, message, content);
          } else if (message.isReplay && typeof content === "string") {
            // 명령이 되돌려 주는 `<local-command-stdout>`(오류는 stderr) 글이다. `/compact`는 compact_boundary가 따로 알린다.
            const out =
              /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/.exec(
                content,
              );
            const err =
              /<local-command-stderr>([\s\S]*?)<\/local-command-stderr>/.exec(
                content,
              );
            if (out !== null && !out[1]?.startsWith("Compacted"))
              commandOutput(lastCommand, out[1] ?? "");
            if (err !== null) info(err[1] ?? "", "warning");
          }
          return;
        case "result":
          onResult(message);
          return;
        case "rate_limit_event":
          onRateLimit(message);
          return;
        case "active_goal":
          changed({
            goal:
              message.value == null
                ? null
                : {
                    objective: message.value.condition,
                    status: "active",
                    detail: oneLine(
                      `${message.value.iterations} iterations${message.value.last_reason ? `: ${message.value.last_reason}` : ""}`,
                      500,
                    ),
                  },
          });
          return;
        case "command_lifecycle":
          if (message.state === "started" && message.command_uuid)
            onStarted(message.command_uuid);
          return;
        case "system":
          onSystem(message);
          return;
        default:
          return;
      }
    }

    // 앞 대화는 resume이 다시 흘리지 않아 transcript를 읽어 같은 길로 그린다. 사람 메시지마다 turn 하나다.
    // subagent의 대화는 다시 그리지 않는다(Agent tool 줄만 남고 `child`는 null이다).
    async function replay(id: string) {
      replaying = true;
      try {
        const list = await sdk.getSessionMessages(id, { dir: cwd });
        const blocksOf = (message: (typeof list)[number]): Block[] => {
          const raw =
            (message.message as { content?: string | Block[] }).content ?? [];
          return typeof raw === "string" ? [{ type: "text", text: raw }] : raw;
        };
        for (let at = 0; at < list.length; at++) {
          const message = list[at];
          if (message === undefined || message.parent_tool_use_id) continue;
          const blocks = blocksOf(message);
          if (message.type === "assistant") {
            onAssistant(
              root,
              { type: "assistant", uuid: message.uuid },
              blocks,
            );
            continue;
          }
          const text = textOf(blocks);
          if (text === "") {
            onToolResults(root, blocks);
            continue;
          }
          if (root.turn !== null) endTurn("completed");
          const bash = /^<bash-input>([\s\S]*?)<\/bash-input>/.exec(text);
          if (bash !== null) {
            // TUI의 `!`도 같은 꼴로 남는다: 바로 뒤 user entry가 출력이다.
            const next = list[at + 1];
            const after = next?.type === "user" ? textOf(blocksOf(next)) : "";
            const isOutput = /^<bash-std(out|err)>/.test(after);
            if (isOutput) at++;
            const part = (tag: string) =>
              new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(after)?.[1] ??
              "";
            const command = bash[1] ?? "";
            shellEnd(
              shellStart(command),
              command,
              part("bash-stdout") + part("bash-stderr"),
              "ok",
            );
            continue;
          }
          addUser(
            root,
            ids.newId("msg"),
            [{ type: "text", text }],
            now(),
            message.uuid,
          );
        }
        if (root.turn !== null) endTurn("completed");
      } catch (cause) {
        endTurn("failed", {
          code: "internal",
          message: `Could not read the earlier conversation: ${cause instanceof Error ? cause.message : String(cause)}`,
        });
      }
      replaying = false;
      void refreshTitle();
    }

    // --- query ------------------------------------------------------------------------------
    let live!: Live;

    function open(from: {
      resume?: string;
      sessionId?: string;
      resumeSessionAt?: string;
      fork?: boolean;
    }): Live {
      const input = inputQueue();
      let onExit: () => void = () => {};
      const exited = new Promise<void>((resolve) => {
        onExit = resolve;
      });
      const mode =
        carry.mode !== null && PASSABLE_MODES.has(carry.mode)
          ? carry.mode
          : null;
      const options: Options = {
        cwd,
        // 사람 PATH의 `claude`. 번들 사본은 받지 않는다(root overrides).
        pathToClaudeCodeExecutable: "claude",
        settingSources: ["user", "project", "local"],
        systemPrompt: { type: "preset", preset: "claude_code" },
        includePartialMessages: true,
        // interrupt가 background task를 죽이지 않게 한다. task는 따로 멈춘다.
        perTaskStopAffordance: true,
        enableFileCheckpointing: true,
        canUseTool,
        ...(from.resume === undefined ? {} : { resume: from.resume }),
        ...(from.sessionId === undefined ? {} : { sessionId: from.sessionId }),
        ...(from.resumeSessionAt === undefined
          ? {}
          : { resumeSessionAt: from.resumeSessionAt }),
        ...(from.fork === true ? { forkSession: true } : {}),
        ...(carry.model === null ? {} : { model: carry.model }),
        ...(carry.effort === null
          ? {}
          : { effort: carry.effort as NonNullable<Options["effort"]> }),
        ...(mode === null
          ? {}
          : { permissionMode: mode as NonNullable<Options["permissionMode"]> }),
        // flag 층의 설정이라 사람의 설정 file에는 쓰이지 않는다.
        ...(carry.fast === null ? {} : { settings: { fastMode: carry.fast } }),
        ...(carry.thinking === false ? { thinking: { type: "disabled" } } : {}),
        ...(carry.rules.size === 0 ? {} : { allowedTools: [...carry.rules] }),
        ...(carry.dirs.size === 0
          ? {}
          : { additionalDirectories: [...carry.dirs] }),
        spawnClaudeCodeProcess(spawnOptions: SpawnOptions) {
          // SDK는 shell main의 env 전체를 준다. 그대로 넘기면 탭 쪽 합치기가 login shell env를 덮으므로 다른 값만 넘긴다.
          const env: Record<string, string> = {};
          for (const [key, value] of Object.entries(spawnOptions.env)) {
            if (value !== undefined && process.env[key] !== value)
              env[key] = value;
          }
          // CLI는 SDK mode에서 todo tool(TaskCreate 등)을 이 flag가 있어야 내놓는다. TUI와 같은 tool을 쓴다.
          env.CLAUDE_CODE_ENABLE_TODO_TOOLS = "1";
          const proc = spawn(spawnOptions.command, spawnOptions.args, {
            ...(spawnOptions.cwd === undefined
              ? {}
              : { cwd: spawnOptions.cwd }),
            env,
          });
          proc.onStderr((text) => {
            stderrTail = (stderrTail + text).slice(-500);
          });
          proc.onExit(onExit);
          spawnFailed = proc.pid === undefined;
          if (spawnFailed) onExit();
          return spawned(proc);
        },
      };
      const q = sdk.query({ prompt: input, options }) as Cancelable;
      const me: Live = { q, input, exited, retired: false };
      void (async () => {
        try {
          for await (const message of q) {
            if (me.retired || closed) return;
            onMessage(message as unknown as SdkMessage);
          }
          if (!me.retired && !closed) failure("claude exited.");
        } catch (cause) {
          if (!me.retired && !closed)
            failure(cause instanceof Error ? cause.message : String(cause));
        }
      })();
      return me;
    }

    function failure(reason: string) {
      dead = {
        code: "unavailable",
        message: stderrTail === "" ? reason : `${reason}\n${stderrTail.trim()}`,
      };
      endTurn("failed", dead);
    }

    // rewind·fork: query를 바꾼다. 옛 query는 먼저 내보내(남은 메시지는 버린다) 도는 turn과 줄을 닫고, 끝난 뒤에 새 것을 연다.
    function retire(): Live {
      const old = live;
      old.retired = true;
      shellOutbox.length = 0;
      killShells();
      if (root.turn !== null) endTurn("stopped");
      // process가 끝나면 background subagent와 task도 끝난다.
      for (const call of agentCalls.values()) {
        if (call.agent?.detail.state === "running")
          setAgent(call, { state: "cancelled" });
        if (call.agent !== undefined) call.agent.lane.dead = true;
      }
      agentCalls.clear();
      lanes.clear();
      liveAgents.clear();
      let stoppedTask = false;
      for (const [id, one] of taskList) {
        if (one.state !== "running") continue;
        taskList.set(id, { ...one, state: "stopped" });
        stoppedTask = true;
      }
      if (stoppedTask) publishTasks();
      for (const [uuid, one] of queued) {
        queued.delete(uuid);
        publish({ type: "message_removed", message: one.id });
      }
      return old;
    }
    async function reopen(old: Live, from: Parameters<typeof open>[0]) {
      old.input.end();
      old.q.close();
      await old.exited;
      // 새 query가 죽은 CLI의 자리를 잇는다.
      dead = null;
      live = open(from);
      empty = from.resume === undefined;
      cliSession = from.sessionId ?? from.resume ?? cliSession;
      changed({ cli_session: cliSession });
      cost = { base: cost.base + cost.last, last: 0 };
    }

    live = open(resume === undefined ? { sessionId: cliSession } : { resume });
    // SDK가 query() 안에서 바로 process를 띄운다.
    if (spawnFailed) {
      live.q.close();
      return {
        ok: false,
        error: {
          code: "unavailable",
          message: "`claude` was not found on PATH.",
        },
      } satisfies Result<never>;
    }

    changed({
      title: null,
      cli_session: cliSession,
      capabilities: CAPABILITIES,
      models: [],
      model: null,
      modes: MODES.map(([id, label]) => ({ id, label, description: null })),
      mode: null,
      commands: [],
      usage: null,
      toggles: [],
      goal: null,
      roles: null,
      harness: "claude",
    });
    // 목록은 첫 메시지 전에도 읽힌다.
    void (async () => {
      try {
        models = await live.q.supportedModels();
        publishModels();
        rawCommands = await live.q.supportedCommands();
        publishCommands();
      } catch {
        // 목록을 못 읽어도 대화는 이어진다.
      }
      await refreshContext();
    })();

    const ready = resume === undefined ? Promise.resolve() : replay(resume);

    // --- 사람 입력 ------------------------------------------------------------------------------
    function userMessage(
      uuid: string,
      content: string | unknown[],
      priority?: "now" | "next" | "later",
      appendOnly = false,
    ): SDKUserMessage {
      return {
        type: "user",
        message: { role: "user", content },
        parent_tool_use_id: null,
        uuid: uuid as SDKUserMessage["uuid"],
        ...(priority === undefined ? {} : { priority }),
        // transcript에만 붙이고 turn을 열지 않는다. 글은 `@path`·slash 명령으로 읽지 않는다.
        ...(appendOnly ? { shouldQuery: false, client_composed: true } : {}),
      } as SDKUserMessage;
    }

    // --- `!` shell ------------------------------------------------------------------------------
    // 사람 쪽 tool 줄(`by: "user"`)이다. 도는 동안 출력은 adapter가 쌓았다가 끝날 때 body에 싣는다.
    function shellStart(command: string): string {
      const id = ids.newId("tcl");
      root.emit({
        type: "tool_started",
        item: {
          kind: "tool",
          id,
          seq: ++root.seq,
          at: now(),
          by: "user",
          turn: root.turn,
          tool: "shell",
          category: "command",
          title: oneLine(command.split("\n")[0] ?? "", 120),
          state: "running",
          duration_ms: null,
          detail: { kind: "generic" },
          body: toolBody(command, null),
        },
      });
      return id;
    }
    function shellEnd(
      id: string,
      command: string,
      output: string,
      state: "ok" | "error" | "cancelled",
    ) {
      root.emit({
        type: "tool_ended",
        tool_call: id,
        state,
        at: now(),
        detail: null,
        body: toolBody(command, output),
      });
    }
    // 끝난 결과를 model이 다음 turn에 보게 transcript에 붙인다. 도는 turn이 있으면 그 turn이 끝난 뒤에 넣는다.
    function flushShell() {
      if (root.turn !== null || dead !== null || closed) return;
      for (const one of shellOutbox.splice(0)) {
        const input = uuidOf(ids);
        const output = uuidOf(ids);
        shellUuids.add(input).add(output);
        empty = false;
        live.input.push(
          userMessage(
            input,
            `<bash-input>${one.command}</bash-input>`,
            undefined,
            true,
          ),
        );
        live.input.push(
          userMessage(
            output,
            `<bash-stdout>${one.out}</bash-stdout><bash-stderr>${one.err}</bash-stderr>`,
            undefined,
            true,
          ),
        );
      }
    }
    // 명령마다 새 shell이라 `cd`가 이어지지 않는다. 끝난 cwd를 stdout 끝에 표시해 읽고 다음 `!`가 거기서 돈다.
    let shellCwd = cwd;
    const CWD_MARK = "\n:lophn-cwd:";
    function runShell(command: string) {
      const id = shellStart(command);
      const key = ids.newId("shl");
      const script = `${command}\n__lophn_rc=$?; printf '${CWD_MARK}%s\\n' "$PWD"; exit $__lophn_rc`;
      const proc = spawn("/bin/sh", ["-c", script], { cwd: shellCwd });
      const entry = { proc, killed: false };
      shells.set(key, entry);
      const cap = ACP_TOOL_BODY_LIMIT * 2;
      let out = "";
      let err = "";
      // 출력이 cap을 넘으면 out에서 표시가 잘리므로 끝만 따로 둔다.
      let tail = "";
      proc.onStdout((text) => {
        out = (out + text).slice(0, cap);
        tail = (tail + text).slice(-8192);
      });
      proc.onStderr((text) => void (err = (err + text).slice(0, cap)));
      proc.onExit((code) => {
        shells.delete(key);
        const mark = tail.lastIndexOf(CWD_MARK);
        if (mark >= 0 && !entry.killed)
          shellCwd = tail.slice(mark + CWD_MARK.length).trim() || shellCwd;
        const cut = out.lastIndexOf(CWD_MARK);
        if (cut >= 0) out = out.slice(0, cut);
        shellEnd(
          id,
          command,
          err === "" ? out : out === "" ? err : `${out}\n${err}`,
          entry.killed ? "cancelled" : code === 0 ? "ok" : "error",
        );
        if (!entry.killed) {
          shellOutbox.push({ command, out, err });
          flushShell();
        }
      });
    }
    function killShells() {
      for (const one of shells.values()) {
        one.killed = true;
        one.proc.kill();
      }
    }

    async function sendText(
      id: string,
      content: ContentBlock[],
      delivery: "next_turn" | "steer" = "next_turn",
    ) {
      const uuid = uuidOf(ids);
      const body = await contentOf(sdk, content);
      if (dead !== null) {
        // CLI가 끝난 뒤 첫 메시지: 같은 session id로 query를 다시 연다. 못 열면 `failure`가 이 turn을 실패로 닫는다.
        const old = retire();
        addUser(root, id, content, now(), uuid);
        await revive(old);
        empty = false;
        live.input.push(userMessage(uuid, body));
        return;
      }
      empty = false;
      if (root.turn === null) {
        addUser(root, id, content, now(), uuid);
        live.input.push(userMessage(uuid, body));
        return;
      }
      const wait = { id, at: now(), content };
      queued.set(uuid, wait);
      publish({ type: "message_queued", queued: wait });
      live.input.push(
        userMessage(uuid, body, delivery === "steer" ? "next" : "later"),
      );
    }

    // CLI의 줄은 push한 순서다. 순서나 내용이 바뀌면 줄에 있는 것을 모두 빼고 새 순서로 다시 넣는다.
    async function requeue(next: Queued[]) {
      const before = [...queued.entries()];
      const taken = new Set<string>();
      for (const [uuid] of before) {
        if (!(await live.q.cancelAsyncMessage(uuid).catch(() => false)))
          taken.add(uuid);
      }
      for (const [uuid, one] of before) {
        queued.delete(uuid);
        if (!taken.has(uuid))
          publish({ type: "message_removed", message: one.id });
        else queued.set(uuid, one);
      }
      for (const one of next) {
        if ([...taken].some((uuid) => queued.get(uuid)?.id === one.id))
          continue;
        const uuid = uuidOf(ids);
        queued.set(uuid, one);
        publish({ type: "message_queued", queued: one });
        live.input.push(
          userMessage(uuid, await contentOf(sdk, one.content), "later"),
        );
      }
    }

    const queuedList = () => [...queued.values()];

    // 사람이 친 명령(`/compact`, `/context`)은 사람 메시지처럼 보인다.
    async function sendCommand(text: string) {
      lastCommand = text.slice(1).split(" ")[0] ?? "";
      const id = ids.newId("msg");
      await sendText(id, [{ type: "text", text }]);
    }

    // 사람 말풍선 없이 CLI에 보내는 명령.
    function sendSilent(text: string) {
      lastCommand = text.slice(1).split(" ")[0] ?? "";
      const uuid = uuidOf(ids);
      silent.add(uuid);
      empty = false;
      live.input.push(userMessage(uuid, text, "later"));
    }
    async function setEffort(level: string) {
      carry.effort = level;
      sendSilent(`/effort ${level}`);
    }

    async function setModel(model: string, options: Record<string, string>) {
      carry.model = model;
      try {
        await live.q.setModel(model);
        shownModel = model;
      } catch {
        // 지금 process가 거절했다. 다음에 띄울 때 쓰도록 기억만 해 두고 지금 값을 다시 보인다.
      }
      if (options.effort !== undefined && options.effort !== carry.effort)
        await setEffort(options.effort);
      // fast는 이 query의 flag 설정이고 thinking은 토큰 한도를 걷거나 0으로 막는다.
      if (options.fast !== undefined) {
        const on = options.fast === "on";
        if (on !== (carry.fast ?? fastState === "on")) {
          await live.q.applyFlagSettings({ fastMode: on });
          carry.fast = on;
        }
      }
      if (options.thinking !== undefined) {
        const on = options.thinking !== "off";
        if (on !== (carry.thinking ?? true)) {
          await live.q.setMaxThinkingTokens(on ? null : 0);
          carry.thinking = on;
        }
      }
      changed({ model: currentModel() });
    }

    // transcript에서 사람 메시지 `uuid`의 앞(또는 그 turn의 끝) assistant 메시지 uuid. 앞 assistant가 없으면(첫 메시지)
    // undefined이고, transcript에서 그 uuid를 못 찾으면 null이다.
    async function assistantAround(
      uuid: string,
      where: "before" | "turn_end",
    ): Promise<string | undefined | null> {
      const list = await sdk.getSessionMessages(cliSession, { dir: cwd });
      const at = list.findIndex((one) => one.uuid === uuid);
      if (at < 0) return null;
      const isUser = (index: number) => {
        const one = list[index];
        const content = (one?.message as { content?: unknown } | undefined)
          ?.content;
        return (
          one?.type === "user" &&
          (typeof content === "string" ||
            (Array.isArray(content) &&
              content.some((block: Block) => block.type === "text")))
        );
      };
      let end = list.length;
      if (where === "turn_end") {
        for (let i = at + 1; i < list.length; i++) {
          if (isUser(i)) {
            end = i;
            break;
          }
        }
      } else {
        end = at;
      }
      for (let i = end - 1; i >= 0; i--) {
        if (list[i]?.type === "assistant") return list[i]?.uuid;
      }
      return undefined;
    }

    // `from`(항목 id) 이후의 항목을 숨긴 구간으로 접는다.
    function hideFrom(
      fromId: string,
      choice: "restore_all" | "messages_only",
      restored: number,
    ) {
      const first = mirror.items.find((one) => one.id === fromId);
      if (first === undefined) return;
      const items = mirror.items
        .filter((one) => one.seq >= first.seq)
        .flatMap((one): AcpEntry[] =>
          one.kind === "hidden" ? one.items : [one],
        );
      if (items.length === 0) return;
      publish({
        type: "hidden_added",
        item: {
          kind: "hidden",
          id: ids.newId("hid"),
          seq: first.seq,
          at: now(),
          checkpoint: fromId,
          choice,
          count: items.length,
          restored,
          left: [],
          items,
        },
      });
    }

    const firstLine = (message: string) =>
      oneLine(
        (contentOfMessage.get(message) ?? [])
          .flatMap((block) => (block.type === "text" ? [block.text] : []))
          .join("\n")
          .trim()
          .split("\n")[0] ?? "",
        80,
      );
    const NOT_FOUND = "Could not find this message in the transcript.";

    async function rewindPreview(message: string): Promise<AcpRewindPreview> {
      const uuid = uuidOfMessage.get(message);
      if (uuid === undefined) return { files: [] };
      const preview = await live.q
        .rewindFiles(uuid, { dryRun: true })
        .catch(() => undefined);
      if (preview === undefined || !preview.canRewind) {
        info(preview?.error ?? "Could not preview the files.");
        return { files: [] };
      }
      // dry run은 file마다 종류를 주지 않는다.
      return {
        files: (preview.filesChanged ?? []).map((path) => ({
          path: relative(cwd, path),
          change: "update" as const,
        })),
      };
    }

    async function rewind(message: string, files: boolean) {
      const uuid = uuidOfMessage.get(message);
      if (uuid === undefined) return;
      // 못 찾으면 아무것도 건드리지 않는다(빈 새 session을 열면 대화를 잃은 것처럼 보인다).
      const before = await assistantAround(uuid, "before");
      if (before === null) {
        info(NOT_FOUND, "warning");
        return;
      }
      if (root.turn !== null) {
        stopping = true;
        await live.q.interrupt().catch(() => undefined);
      }
      let restored = 0;
      if (files) {
        // 화면이 확인을 받은 뒤라 미리 보기는 한 줄 알림으로 남기고 바로 되돌린다.
        const preview = await live.q.rewindFiles(uuid, { dryRun: true });
        if (!preview.canRewind) {
          info(preview.error ?? "Could not rewind the files.");
          return;
        }
        restored = preview.filesChanged?.length ?? 0;
        await live.q.rewindFiles(uuid);
      }
      const title = firstLine(message);
      const old = retire();
      hideFrom(message, files ? "restore_all" : "messages_only", restored);
      const fresh = uuidOf(ids);
      await reopen(
        old,
        before === undefined
          ? { sessionId: fresh }
          : {
              resume: cliSession,
              resumeSessionAt: before,
              fork: true,
              sessionId: fresh,
            },
      );
      info(
        `Rewound to “${title}”${files ? ` · ${restored} ${restored === 1 ? "file" : "files"} restored` : ""}`,
      );
      await refreshTitle();
    }

    async function fork(message: string | null) {
      const target = message === null ? undefined : uuidOfMessage.get(message);
      if (message !== null && target === undefined) return;
      const upTo =
        target === undefined
          ? undefined
          : await assistantAround(target, "turn_end");
      if (upTo === null) {
        info(NOT_FOUND, "warning");
        return;
      }
      const from = titled;
      const made = await sdk.forkSession(cliSession, {
        dir: cwd,
        ...(upTo === undefined ? {} : { upToMessageId: upTo }),
      });
      const old = retire();
      if (message !== null) {
        // 새 session에 없는 뒷부분을 숨긴다.
        const at = mirror.items.findIndex((one) => one.id === message);
        const next = mirror.items.find(
          (one, index) =>
            index > at && one.kind === "message" && one.actor === "user",
        );
        if (next !== undefined) hideFrom(next.id, "messages_only", 0);
      }
      await reopen(old, { resume: made.sessionId });
      info(
        from === null
          ? "Forked into a new session. The original session is unchanged."
          : `Forked from “${from}”. The original session is unchanged.`,
      );
      // SDK가 제목을 "… (fork)"로 짓는다.
      await refreshTitle();
    }

    async function revive(old: Live) {
      try {
        await reopen(
          old,
          empty ? { sessionId: cliSession } : { resume: cliSession },
        );
      } catch (cause) {
        failure(cause instanceof Error ? cause.message : String(cause));
        return;
      }
      if (spawnFailed) {
        live.q.close();
        failure("`claude` was not found on PATH.");
      }
    }

    // 합계·계획·goal·task를 비운다(`/clear`와 session 바꾸기).
    function resetStats() {
      totals.input = totals.output = totals.read = totals.write = 0;
      totals.turns = 0;
      cost = { base: 0, last: 0 };
      contextUsage = null;
      titled = null;
      taskList.clear();
      publishTasks();
      root.todos.clear();
      publish({ type: "plan_changed", entries: [] });
      changed({ title: null, goal: null, usage: usageNow() });
      void refreshContext();
    }

    // `/clear`: CLI에 보내지 않고 같은 탭에서 resume 없는 새 query를 연다. 합계·계획·goal·task도 비운다.
    async function clear() {
      const old = retire();
      const first = mirror.items[0];
      if (first !== undefined) hideFrom(first.id, "messages_only", 0);
      await reopen(old, { sessionId: uuidOf(ids) });
      resetStats();
    }

    // 같은 탭에서 이 폴더의 다른 CLI session으로 바꾼다. 옛 session의 transcript는 건드리지 않는다.
    async function openSession(target: string) {
      if (target === cliSession && dead === null) return;
      const old = retire();
      publish({ type: "session_reset" });
      uuidOfMessage.clear();
      contentOfMessage.clear();
      userOfTurn.clear();
      root.seen.clear();
      lastCommand = "";
      await reopen(old, { resume: target });
      resetStats();
      await replay(target);
      changed({ cli_session: cliSession, model: currentModel() });
    }

    async function sessions(): Promise<AcpCliSession[]> {
      // 다른 worktree의 session은 cwd가 달라 resume이 못 연다.
      const list = await sdk.listSessions({
        dir: cwd,
        limit: 30,
        includeWorktrees: false,
        // GUI session(entrypoint `sdk-cli`)도 보이게 한다(녹화 sessions).
        includeProgrammatic: true,
      });
      return list
        .sort((a, b) => b.lastModified - a.lastModified)
        .map((one) => ({
          id: one.sessionId,
          title: one.customTitle ?? one.summary,
          updated_at: new Date(one.lastModified).toISOString(),
        }));
    }

    // `!`로 시작하는 글은 model에 보내지 않는다. 앞 `!`를 떼고 명령으로 돌린다.
    function shellOf(content: ContentBlock[]): string | null {
      const first = content[0];
      if (first?.type !== "text") return null;
      const text = first.text.trimStart();
      return text.startsWith("!") ? text.slice(1).trim() : null;
    }

    async function handle(message: AcpInput) {
      switch (message.type) {
        case "send": {
          const command = shellOf(message.content);
          if (command === null)
            await sendText(message.id, message.content, message.delivery);
          else if (command !== "") runShell(command);
          return;
        }
        case "run_shell":
          runShell(message.command);
          return;
        case "open_session":
          await openSession(message.cli_session);
          return;
        case "stop":
          killShells();
          if (root.turn !== null) {
            stopping = true;
            void live.q.interrupt().catch(() => {});
          }
          return;
        case "retry": {
          const original = userOfTurn.get(message.turn);
          const content =
            original === undefined ? undefined : contentOfMessage.get(original);
          if (content !== undefined) await sendText(ids.newId("msg"), content);
          return;
        }
        case "decide":
          closeApproval(
            message.request,
            message.choice.kind,
            message.choice.kind === "reject"
              ? message.choice.reason
              : undefined,
            message.choice.kind === "mode" ? message.choice.mode : undefined,
          );
          return;
        case "answer":
          closeQuestion(
            message.tool_call,
            Object.fromEntries(
              message.answers
                .filter((one) => one.status === "answered")
                .map((one) => [one.question, one.answer.join(", ")]),
            ),
          );
          return;
        case "send_queued": {
          const entry = [...queued.entries()].find(
            ([, one]) => one.id === message.message,
          );
          if (entry === undefined) return;
          const [uuid, one] = entry;
          if (!(await live.q.cancelAsyncMessage(uuid).catch(() => false)))
            return;
          queued.delete(uuid);
          // 지금 보내기는 도는 turn을 끊고 이 메시지를 먼저 돌린다. 줄에서는 CLI가 가져갈 때 빠진다.
          const fresh = uuidOf(ids);
          queued.set(fresh, one);
          if (root.turn !== null) stopping = true;
          live.input.push(
            userMessage(fresh, await contentOf(sdk, one.content), "now"),
          );
          return;
        }
        case "remove_queued": {
          const entry = [...queued.entries()].find(
            ([, one]) => one.id === message.message,
          );
          if (entry === undefined) return;
          if (!(await live.q.cancelAsyncMessage(entry[0]).catch(() => false)))
            return;
          queued.delete(entry[0]);
          publish({ type: "message_removed", message: message.message });
          return;
        }
        case "edit_queued": {
          const next = queuedList().map((one) =>
            one.id === message.message
              ? { ...one, content: message.content }
              : one,
          );
          await requeue(next);
          return;
        }
        case "move_queued": {
          const list = queuedList();
          const index = list.findIndex((one) => one.id === message.message);
          const target = index + (message.direction === "up" ? -1 : 1);
          const moved = list[index];
          const other = list[target];
          if (moved === undefined || other === undefined) return;
          list[index] = other;
          list[target] = moved;
          await requeue(list);
          return;
        }
        case "set_model":
          await setModel(message.model, message.options);
          return;
        case "set_mode":
          await live.q.setPermissionMode(
            message.mode as Parameters<Query["setPermissionMode"]>[0],
          );
          setMode(message.mode);
          return;
        case "run_command":
          if (message.name === "clear") await clear();
          else if (message.name === "plan") {
            const next = carry.mode === "plan" ? "default" : "plan";
            await live.q.setPermissionMode(next);
            setMode(next);
          } else
            await sendCommand(
              `/${message.name}${message.argument === "" ? "" : ` ${message.argument}`}`,
            );
          return;
        case "stop_child": {
          const taskId = agentCalls.get(message.child)?.agent?.taskId;
          if (taskId != null) await live.q.stopTask(taskId);
          return;
        }
        case "stop_task":
          await live.q.stopTask(message.task);
          return;
        case "set_goal":
          if (message.objective !== null && !message.paused) {
            sendSilent(`/goal ${message.objective}`);
          } else if (message.objective === null) {
            sendSilent("/goal clear");
          } else {
            info("This CLI cannot pause a goal.", "warning");
          }
          return;
        case "set_toggle":
        case "steer_child":
        case "use_role":
          return;
        case "compact":
          await sendCommand("/compact");
          return;
        case "rewind":
          await rewind(message.message, message.files);
          return;
        case "fork":
          await fork(message.message);
          return;
        case "rename":
          await sdk.renameSession(cliSession, message.title, { dir: cwd });
          changed({ title: message.title });
          return;
      }
    }
    // 입력은 앞 입력이 끝난 뒤에 처리한다(rewind·fork가 query를 바꾸는 동안 다음 입력이 옛 query에 가지 않게).
    let chain: Promise<void> = ready;
    session.onInput((message) => {
      chain = chain.then(() => handle(message)).catch(() => undefined);
    });

    return {
      ok: true,
      value: {
        async stop() {
          if (!stopped) {
            stopped = true;
            killShells();
            if (root.turn !== null) {
              stopping = true;
              await live.q.interrupt().catch(() => undefined);
            }
            closed = true;
            for (const wait of approvals.values())
              wait.resolve({ behavior: "deny", message: DENIED });
            for (const wait of questions.values())
              wait.resolve({ behavior: "deny", message: DENIED });
            live.input.end();
            live.q.close();
          }
          await live.exited;
          finished = true;
        },
        // 사람이 TUI로 이을 명령. process가 끝나기 전에 내면 한 session을 두 process가 쥔다.
        tuiCommand() {
          if (!finished)
            throw new Error("tuiCommand() was called before stop() finished");
          const flags = [
            // 메시지가 없는 session은 --resume이 못 연다("No conversation found")(녹화 clear_resume).
            empty ? "--session-id" : "--resume",
            shellQuote(cliSession),
            ...(carry.mode !== null && PASSABLE_MODES.has(carry.mode)
              ? ["--permission-mode", shellQuote(carry.mode)]
              : []),
            ...(carry.model === null
              ? []
              : ["--model", shellQuote(carry.model)]),
            ...(carry.effort === null
              ? []
              : ["--effort", shellQuote(carry.effort)]),
            ...(carry.dirs.size === 0
              ? []
              : ["--add-dir", ...[...carry.dirs].map(shellQuote)]),
            ...(carry.rules.size === 0
              ? []
              : ["--allowedTools", ...[...carry.rules].map(shellQuote)]),
            // 고른 fast·thinking만 넘긴다. flag 층이라 사람의 설정 file에는 쓰이지 않는다.
            ...(carry.fast === null && carry.thinking === null
              ? []
              : [
                  "--settings",
                  shellQuote(
                    JSON.stringify({
                      ...(carry.fast === null ? {} : { fastMode: carry.fast }),
                      ...(carry.thinking === null
                        ? {}
                        : { alwaysThinkingEnabled: carry.thinking }),
                    }),
                  ),
                ]),
          ];
          return `claude ${flags.join(" ")}`;
        },
        sessionId: () => cliSession,
        running: () => ({ turn: root.turn !== null, tasks: runningTasks() }),
        sessions,
        rewindPreview,
      },
    };
  };

// TUI를 깔끔하게 끝낸다: Ctrl-C 두 번이 종료다(도는 turn이 있으면 첫 번이 그 turn을 멈춘다). foreground가 떠난 뒤에 resolve한다.
function exitTui(terminal: AcpTerminal): Promise<Result<void>> {
  return new Promise((resolve) => {
    if (terminal.state() === "shell")
      return resolve({ ok: true, value: undefined });
    const timers: ReturnType<typeof setTimeout>[] = [];
    const off = terminal.onForegroundExit(() => {
      for (const timer of timers) clearTimeout(timer);
      off();
      resolve({ ok: true, value: undefined });
    });
    terminal.signal("SIGINT");
    for (const delay of [300, 900])
      timers.push(setTimeout(() => terminal.signal("SIGINT"), delay));
  });
}

export function createClaudeAdapter(sdk: ClaudeSdk): HarnessGuiAdapter {
  return { handoff: "restart", start: start(sdk), exitTui };
}

export const claudeAdapter = createClaudeAdapter({
  query,
  getSessionMessages,
  getSubagentMessages,
  getSessionInfo,
  forkSession,
  listSessions,
  renameSession,
  readFile,
});
