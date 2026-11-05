// omp adapter. 사람 PATH의 `omp --mode rpc-ui`를 stdio로 띄워 RPC 줄(JSON 한 줄씩, JSON-RPC가 아니다)을 ACP 갱신으로,
// 창의 ACP 입력을 RPC 명령으로 옮긴다. 승인 mode는 사람 설정이라 시작할 때 넘기지 않는다(설정이 없으면 yolo라 승인 카드가
// 뜨지 않는다). 이 run에서 `set_mode`로 바꾼 뒤에만 `--approval-mode`를 싣고 같은 session을 다시 띄운다.
// 판은 사람 기계의 18.8.7에 맞춘다: plan mode와 승인 mode를 바꾸는 RPC, 승인의 "이 session 동안" 선택지가 없다.
// `~/.omp` 설정(role, 승인 mode)은 읽기만 한다.
import { open, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { parse } from "yaml";
import type { Clock } from "../../../../../base/clock.ts";
import { formatAt } from "../../../../../base/clock.ts";
import type { IdSource } from "../../../../../base/id.ts";
import type { AcpInput } from "../../../../../protocol/acp/input.ts";
import {
  ACP_TOOL_BODY_LIMIT,
  type AcpEntry,
  type AcpHiddenItem,
  type AcpNoticeItem,
  type AcpToolDetail,
  type AcpToolItem,
} from "../../../../../protocol/acp/items.ts";
import {
  EMPTY_ACP_STATE,
  reduceAcp,
} from "../../../../../protocol/acp/reduce.ts";
import type {
  AcpCommand,
  AcpGoal,
  AcpRole,
  AcpSessionMeta,
  AcpUsage,
} from "../../../../../protocol/acp/session.ts";
import type {
  AcpChildUpdate,
  AcpState,
  AcpTask,
  AcpUpdate,
} from "../../../../../protocol/acp/state.ts";
import type { AcpCliSession } from "../../../../../protocol/extensions/mod.ts";
import type { ContentBlock } from "../../../../../protocol/lophn-agent/content-block.ts";
import type { HarnessGuiAdapter, HarnessGuiRun } from "./adapter.ts";

type Start = HarnessGuiAdapter["start"];

/** adapter가 파일 시스템에 닿는 길. 이미지 첨부, omp 설정(role, 승인 mode), 지난 session 목록을 읽는다. 쓰는 길은 없다. test가 바꾼다. */
export type OmpIo = {
  /** 사람의 home. `<home>/.omp/agent/config.yml`을 읽는다. */
  home: string;
  readFile(path: string): Promise<Uint8Array>;
  /** 폴더의 file 이름들. */
  readDir(path: string): Promise<string[]>;
  /** file의 앞 `bytes`만 글로 읽는다(session file은 크다). */
  readHead(path: string, bytes: number): Promise<string>;
};

// 읽는 칸만 적은 wire 모양이다. 줄은 JSON.parse한 값을 그대로 이 type으로 본다.
type Block = {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
};
type Msg = {
  role: string;
  content?: string | Block[];
  stopReason?: string;
  errorMessage?: string;
  synthetic?: boolean;
  attribution?: string;
  steering?: boolean;
  toolCallId?: string;
  isError?: boolean;
  // bashExecution
  command?: string;
  output?: string;
  exitCode?: number;
  cancelled?: boolean;
};
type Model = {
  id: string;
  provider: string;
  name?: string;
  reasoning?: boolean;
};
type Todo = { name: string; tasks: { content: string; status: string }[] };
type Goal = {
  objective: string;
  status: string;
  tokensUsed?: number;
  tokenBudget?: number;
};
type UsageLimit = {
  stage: string;
  resetsAtSec?: number;
  allowanceLeftPercent?: number;
};
type State = {
  sessionId: string;
  /** 저장되기 전(model turn 전)에는 없다. */
  sessionFile?: string;
  sessionName?: string;
  model?: Model;
  thinkingLevel?: string;
  todoPhases?: Todo[];
  contextUsage?: { tokens?: number | null; contextWindow?: number | null };
  goal?: { goal?: Goal } | null;
  usageLimit?: UsageLimit | null;
  fastModeEnabled?: boolean;
  slowModeSupported?: boolean;
  slowModeEnabled?: boolean;
  slowModeScope?: string | null;
};
type Stats = {
  assistantMessages?: number;
  tokens?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  cost?: number;
};
type BashResult = { output?: string; exitCode?: number; cancelled?: boolean };
type Command = {
  name: string;
  description?: string;
  input?: { hint?: string };
  source?: string;
  aliases?: string[];
};
type AskQuestion = {
  id: string;
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multi?: boolean;
  recommended?: number;
};
type Progress = {
  id?: string;
  currentToolIntent?: string;
  recentOutput?: string[];
  recentTools?: { intent?: string }[];
  resolvedModel?: string;
};
type Payload = {
  id?: string;
  agent?: string;
  description?: string;
  status?: string;
  index?: number;
  parentToolCallId?: string;
  detached?: boolean;
  /** `subagent_event`의 자식 event. */
  event?: Frame;
  /** `subagent_progress`. */
  progress?: Progress;
};
type Frame = {
  type: string;
  id?: string;
  command?: string;
  success?: boolean;
  data?: unknown;
  error?: string | { message?: string };
  code?: string;
  messageId?: string;
  message?: Msg | string;
  messages?: Msg[];
  assistantMessageEvent?: unknown;
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  intent?: string;
  result?: { content?: Block[] };
  isError?: boolean;
  yielded?: boolean;
  isTerminal?: boolean;
  status?: string;
  agentInvoked?: boolean;
  level?: string;
  notifyType?: string;
  text?: string;
  attempt?: number;
  maxAttempts?: number;
  errorMessage?: string;
  finalError?: string;
  from?: string;
  to?: string;
  aborted?: boolean;
  skipped?: boolean;
  goal?: Goal | null;
  payload?: Payload;
  commands?: Command[];
  method?: string;
  title?: string;
  options?: string[];
  questions?: AskQuestion[];
  targetId?: string;
  url?: string;
  chunkId?: string;
  index?: number;
  count?: number;
  byteLength?: number;
};

type Reply<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string };

const DENIED = "Tool call denied by user:";
const APPROVAL = "Allow tool: ";
const EDIT_TOOLS = ["edit", "write"];
const CATEGORIES: Record<string, AcpToolItem["category"]> = {
  read: "read",
  glob: "list",
  find: "list",
  grep: "search",
  ast_grep: "search",
  bash: "command",
  eval: "command",
  fetch: "web",
  web_search: "web",
};
// 끝낼 때 omp가 session을 닫는 시간. 넘으면 SIGTERM이다.
const EXIT_WAIT_MS = 5000;

// omp는 handle이 없는 `/이름`을 model에게 글로 보낸다. 18.8.7에서 TUI 전용인 이름(그 별칭 포함)은 보내지 않고 막는다.
// adapter가 RPC로 하는 `new`, `clear`, `fork`, `branch`, `tree`, `goal`은 여기에 없다.
const TUI_ONLY = new Set(
  (
    "settings setup providers plan plan-review vibe guided-goal loop queue collab join leave copy open " +
    "hotkeys extensions status agents git hub login logout delete btw tan omfg cleanse debug exit restart " +
    "live record pause quit q skills"
  ).split(" "),
);

const COMMAND_SOURCES: Record<string, AcpCommand["source"]> = {
  builtin: "harness",
  skill: "skill",
  extension: "plugin",
  mcp_prompt: "mcp",
  custom: "custom_user",
  file: "custom_user",
};
const COMMAND_OPENS: Record<string, AcpCommand["opens"]> = {
  model: "model",
  effort: "effort",
  compact: "compact",
  rename: "rename",
};
// omp RPC 목록에는 없지만 adapter가 RPC로 하는 TUI 이름.
const ADAPTER_COMMANDS: AcpCommand[] = [
  {
    name: "new",
    aliases: ["clear"],
    description: "Start a new session in this tab",
    argument_hint: null,
    source: "harness",
    opens: null,
  },
  {
    name: "fork",
    aliases: [],
    description: "Fork the session",
    argument_hint: null,
    source: "harness",
    opens: "fork",
  },
  {
    name: "branch",
    aliases: ["tree"],
    description: "Rewind to an earlier message",
    argument_hint: null,
    source: "harness",
    opens: "rewind",
  },
  {
    name: "goal",
    aliases: [],
    description: "Set a persistent goal for this session",
    argument_hint: "<objective|pause|resume|drop>",
    source: "harness",
    opens: null,
  },
  {
    name: "resume",
    aliases: [],
    description: "Open an earlier session in this folder",
    argument_hint: null,
    source: "harness",
    opens: "resume",
  },
];

const MODES = [
  {
    id: "always-ask",
    label: "Always ask",
    description: "Auto-approve read-only tools; ask for write and exec tools.",
  },
  {
    id: "write",
    label: "Write",
    description: "Auto-approve read and workspace-write tools; ask for exec.",
  },
  { id: "yolo", label: "Allow all", description: "Auto-approve every tool." },
];
// 이 role들은 대화 model이 아니다(이미지, web 등 일감별 model).
const MODEL_ROLES = new Set(["image", "web", "speech", "dictation", "judge"]);
const SLASH = /^\/(\S+)(?:\s+([\s\S]*))?$/;

// biome-ignore lint/suspicious/noControlCharactersInRegex: 터미널 색 escape를 지운다.
const ANSI = /\u001b\[[0-9;]*m/g;
const plain = (text: string) => text.replace(ANSI, "");
// omp의 `command_output`에는 format이 없다. 색 escape가 없고 markdown 줄 머리가 둘 이상(또는 ```로 시작)이면 markdown이다.
// `/context`의 막대처럼 escape가 든 출력은 preformatted다.
const MD_LINE = /^(#{1,6} |[-*] |\||\d+\. )/;
const looksMarkdown = (raw: string) =>
  plain(raw).trimStart().startsWith("```") ||
  (plain(raw) === raw &&
    raw.split("\n").filter((line) => MD_LINE.test(line)).length >= 2);
const oneLine = (text: string, max: number) =>
  text
    .replace(/\s*\n\s*/g, " ")
    .trim()
    .slice(0, max);
const str = (value: unknown) => (typeof value === "string" ? value : "");
const lines = (text: unknown) =>
  typeof text === "string" && text !== "" ? text.split("\n").length : 0;
const relative = (cwd: string, path: string) =>
  path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;
const errorText = (frame: Frame) =>
  typeof frame.error === "string"
    ? frame.error
    : (frame.error?.message ?? "omp failed");
const cut = (text: string | null) =>
  text !== null && text.length > ACP_TOOL_BODY_LIMIT
    ? text.slice(0, ACP_TOOL_BODY_LIMIT)
    : text;
const bodyOf = (input: string | null, output: string | null) => ({
  input: cut(input),
  output: cut(output),
  truncated:
    (input?.length ?? 0) > ACP_TOOL_BODY_LIMIT ||
    (output?.length ?? 0) > ACP_TOOL_BODY_LIMIT,
});

/** 같은 종류 block의 글을 이어 붙인다. 스트림 snapshot은 앞 글에 덧붙기만 한다. */
const joined = (content: Msg["content"], kind: "text" | "thinking") =>
  typeof content === "string"
    ? kind === "text"
      ? content
      : ""
    : (content ?? [])
        .flatMap((block) => {
          const text = block.type === kind ? block[kind] : undefined;
          return text ? [text] : [];
        })
        .join("\n");

const resultText = (content: Block[] | undefined) =>
  (content ?? []).map((block) => block.text ?? "").join("");

/** 창이 보낸 content를 omp에 줄 글로 만든다. 앱 context와 이미지가 아닌 file도 글이다. */
const textOf = (content: ContentBlock[]) =>
  content
    .flatMap((block) =>
      block.type === "text" || block.type === "resource"
        ? [block.text]
        : block.type === "resource_link" &&
            !block.mimeType?.startsWith("image/")
          ? [block.uri.replace(/^file:\/\//, "")]
          : [],
    )
    .join("\n");

type Call = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  /** body.input에 싣는 args JSON. */
  input: string;
  done: boolean;
  /** `task` tool이 띄운 subagent가 이 줄에 붙었다. */
  spawned?: boolean;
  /** `ask`이면 묶음 id와 질문, 받은 답. */
  question?: { group: string; asked: AskQuestion[]; answers: string[][] };
};
type Queued = {
  id: string;
  content: ContentBlock[];
  text: string;
  kind: "steer" | "followUp";
};
// 사람 응답을 기다리는 omp 창 하나. 한 번에 하나만 카드로 연다(composer 위 자리가 하나다).
type Dialog =
  | {
      kind: "approval";
      ui: string;
      request: string;
      tool: string;
      /** "이 session 동안" 선택지(18.14.2부터). 없으면 그 범위를 내놓지 않는다. */
      sessionOption: string | undefined;
      call: Call | undefined;
    }
  | {
      kind: "question";
      ui: string;
      group: string;
      toolCall: string;
      method: string;
      asked: AskQuestion[];
    };

const toAcpQuestions = (asked: AskQuestion[]) =>
  asked.map((one) => ({
    question: one.question,
    header: one.header ?? oneLine(one.question, 24),
    options: one.options.map((option) => ({
      label: option.label,
      description: option.description ?? option.label,
    })),
    multiSelect: one.multi === true,
  }));

type Sub = {
  id: string;
  agent: string;
  description: string;
  state: "running" | "done" | "failed" | "cancelled";
  model: string | null;
  last: string | null;
  detached: boolean;
  /** 이 subagent를 보이는 tool 줄이 든 대화와 그 줄. */
  line: { thread: Thread; call: Call };
  child: Thread;
  /** 마지막으로 낸 detail. 같으면 다시 내지 않는다. */
  shown: string;
};

const taskDetail = (
  args: Record<string, unknown>,
  state: "running" | "failed" | "cancelled",
): AcpToolDetail => {
  const first = (Array.isArray(args.tasks) ? args.tasks[0] : undefined) as
    | { agent?: string; task?: string; name?: string }
    | undefined;
  return {
    kind: "subagent",
    agent: str(first?.agent) || "task",
    description: oneLine(str(first?.task) || str(first?.name), 120),
    child: null,
    state,
    model: null,
    last: null,
  };
};

type Hooks = {
  /** 사람 message가 왔다(`message_end`의 user). */
  user(msg: Msg): void;
  /** turn이 끝나는 자리(열린 승인 카드를 닫는다). */
  ending?(): void;
  /** tool call의 첫 값을 바꾼다(`ask`가 질문을 먼저 받았다). */
  preset?(name: string): Partial<Call> | undefined;
  /** tool 줄이 열렸다(`task` tool 줄에 subagent를 붙이려고 기억한다). */
  started?(self: Thread, ompId: string, call: Call): void;
};

/**
 * 대화 하나(부모 또는 subagent 자식)가 쓰는 상태와 omp event → ACP 갱신 옮기기. 순번, turn, 흘러나온 글, tool call을
 * 대화마다 따로 든다. `emit`이 부모는 그대로 publish하고 자식은 `child_update`로 싼다.
 */
function thread(
  emit: (update: AcpChildUpdate) => void,
  ids: IdSource,
  clock: Clock,
  cwd: string,
  hooks: Hooks,
) {
  let seq = 0;
  let turn: string | null = null;
  let lastTurn: string | null = null;
  const streams = new Map<
    string,
    { call: string; text: number; thinking: number }
  >();
  const calls = new Map<string, Call>();
  const now = () => clock.now();

  function startTurn(): string {
    const id = ids.newId("trn");
    turn = id;
    lastTurn = id;
    emit({ type: "turn_started", turn: id, at: now() });
    return id;
  }
  const ensureTurn = () => turn ?? startTurn();

  /** `outside`는 도는 turn의 일부가 아닌 알림이다(명령 출력). */
  function notice(body: AcpNoticeItem["notice"], outside = false) {
    emit({
      type: "notice_added",
      item: {
        kind: "notice",
        id: ids.newId("msg"),
        seq: ++seq,
        at: now(),
        turn: outside ? null : turn,
        notice: body,
      },
    });
  }

  function message(
    id: string,
    content: ContentBlock[],
    extra: {
      origin: string | null;
      actor?: "user" | "received";
      delivery?: "next_turn" | "steer";
    },
  ): string {
    const mine = ensureTurn();
    emit({
      type: "message_added",
      item: {
        kind: "message",
        id,
        seq: ++seq,
        at: now(),
        actor: extra.actor ?? "user",
        sender:
          extra.actor === "received"
            ? { kind: "agent", agent: null, name: null }
            : null,
        call: null,
        reply_to: null,
        delivery: extra.delivery ?? "next_turn",
        turn: mine,
        origin: extra.origin,
        content,
        reasoning: null,
        cards: [],
        complete: true,
      },
    });
    return mine;
  }

  function recordAssistant(msg: Msg, modelCall: string | null) {
    const text = joined(msg.content, "text");
    const thinking = joined(msg.content, "thinking");
    if (text === "" && thinking === "") return;
    emit({
      type: "message_recorded",
      turn: ensureTurn(),
      message: ids.newId("msg"),
      model_call: modelCall,
      seq: ++seq,
      at: now(),
      body: {
        content: text === "" ? [] : [{ type: "text", text }],
        reasoning:
          thinking === "" ? null : { text: thinking, duration_ms: null },
        cards: [],
      },
    });
  }

  function toolStart(
    id: string,
    name: string,
    args: Record<string, unknown>,
    extra?: {
      title?: string;
      detail?: AcpToolDetail;
      turn?: string;
      /** 사람이 `!`로 돌린 명령. turn이 없으면 turn 밖 줄이다. */
      user?: string;
    },
  ): Call {
    const known = calls.get(id);
    if (known !== undefined) return known;
    const call: Call = {
      id: ids.newId("tcl"),
      name,
      args,
      input:
        extra?.user === undefined ? JSON.stringify(args, null, 2) : extra.user,
      done: false,
      ...hooks.preset?.(name),
    };
    calls.set(id, call);
    const path = str(args.path);
    let summary = "";
    for (const key of ["path", "command", "pattern", "url", "query"]) {
      const value = str(args[key]);
      if (value !== "") {
        summary = oneLine(key === "path" ? relative(cwd, value) : value, 120);
        break;
      }
    }
    emit({
      type: "tool_started",
      item: {
        kind: "tool",
        id: call.id,
        seq: ++seq,
        at: now(),
        by: extra?.user === undefined ? "agent" : "user",
        turn: extra?.user === undefined ? (extra?.turn ?? ensureTurn()) : turn,
        tool: extra?.user === undefined ? name : "shell",
        category:
          extra?.user === undefined ? (CATEGORIES[name] ?? "other") : "command",
        title:
          extra?.user !== undefined
            ? oneLine(extra.user.split("\n")[0] ?? "", 120) || "shell"
            : (extra?.title ?? (summary === "" ? name : `${name} ${summary}`)),
        state: "running",
        duration_ms: null,
        detail:
          extra?.detail ??
          (name === "ask"
            ? {
                kind: "question",
                group: call.question?.group ?? null,
                outcome: null,
                lines: [],
              }
            : name === "task"
              ? taskDetail(args, "running")
              : EDIT_TOOLS.includes(name) && path !== ""
                ? {
                    kind: "edit",
                    document: path,
                    path: relative(cwd, path),
                    added: lines(args.content),
                    removed: 0,
                  }
                : { kind: "generic" }),
        body: bodyOf(call.input, null),
      },
    });
    hooks.started?.(self, id, call);
    return call;
  }

  function toolEnd(
    call: Call,
    state: "ok" | "error" | "denied" | "cancelled",
    output: string | null,
    detail?: AcpToolDetail,
  ) {
    call.done = true;
    const asked = call.question;
    emit({
      type: "tool_ended",
      tool_call: call.id,
      state,
      at: now(),
      detail:
        detail ??
        (asked !== undefined
          ? {
              kind: "question",
              group: asked.group,
              outcome: state === "ok" ? "submitted" : "cancelled",
              lines: asked.asked.map((one, index) => ({
                header: one.header ?? oneLine(one.question, 24),
                answer: asked.answers[index]?.join(", ") ?? null,
              })),
            }
          : call.name === "task" && state !== "ok" && call.spawned !== true
            ? taskDetail(
                call.args,
                state === "cancelled" ? "cancelled" : "failed",
              )
            : null),
      body: bodyOf(call.input, output),
    });
  }

  function onToolEnd(frame: Frame): Call | undefined {
    const call = calls.get(frame.toolCallId ?? "");
    if (call === undefined || call.done) return undefined;
    const text = resultText(frame.result?.content);
    toolEnd(
      call,
      frame.isError !== true
        ? "ok"
        : text.startsWith(DENIED)
          ? "denied"
          : "error",
      text,
    );
    return call;
  }

  function endTurn(
    outcome: "completed" | "stopped" | "failed",
    error?: { code: string; message: string },
  ) {
    if (turn === null) return;
    const id = turn;
    turn = null;
    hooks.ending?.();
    for (const call of calls.values()) {
      if (!call.done) toolEnd(call, "cancelled", null);
    }
    calls.clear();
    streams.clear();
    emit({
      type: "turn_ended",
      turn: id,
      at: now(),
      outcome,
      active_ms: null,
      error: error ?? null,
      messages: [],
      seq: ++seq,
    });
  }

  function onUpdate(frame: Frame) {
    const msg = frame.message;
    if (typeof msg !== "object" || msg.role !== "assistant") return;
    const key = frame.messageId ?? "";
    const stream = streams.get(key) ?? {
      call: ids.newId("mcl"),
      text: 0,
      thinking: 0,
    };
    streams.set(key, stream);
    for (const [kind, name] of [
      ["text", "text"],
      ["thinking", "reasoning"],
    ] as const) {
      const full = joined(msg.content, kind);
      if (full.length <= stream[kind]) continue;
      emit({
        type: "writing_streamed",
        turn: ensureTurn(),
        model_call: stream.call,
        kind: name,
        offset: stream[kind],
        text: full.slice(stream[kind]),
        at: now(),
      });
      stream[kind] = full.length;
    }
  }

  /** 부모와 자식이 같이 쓰는 대화 event. 다룬 것이면 true. */
  function frame(f: Frame): boolean {
    switch (f.type) {
      case "agent_start":
        ensureTurn();
        return true;
      case "agent_end": {
        // 이어질 때(재시도, compaction 뒤)는 turn이 끝난 것이 아니다.
        if (f.yielded === false || f.isTerminal === false) return true;
        const last = [...(f.messages ?? [])]
          .reverse()
          .find((one) => one.role === "assistant");
        if (last?.stopReason === "aborted") endTurn("stopped");
        else if (last?.stopReason === "error") {
          endTurn("failed", {
            code: "internal",
            message: last.errorMessage ?? "omp failed",
          });
        } else endTurn("completed");
        return true;
      }
      case "message_start": {
        const msg = f.message;
        if (typeof msg === "object" && msg.role === "assistant") {
          streams.set(f.messageId ?? "", {
            call: ids.newId("mcl"),
            text: 0,
            thinking: 0,
          });
        }
        return true;
      }
      case "message_update":
        onUpdate(f);
        return true;
      case "message_end": {
        const msg = f.message;
        if (typeof msg !== "object") return true;
        if (msg.role === "user") hooks.user(msg);
        else if (msg.role === "assistant") {
          const stream = streams.get(f.messageId ?? "");
          streams.delete(f.messageId ?? "");
          recordAssistant(msg, stream?.call ?? null);
        }
        return true;
      }
      case "tool_execution_start":
        toolStart(f.toolCallId ?? "", f.toolName ?? "", f.args ?? {});
        return true;
      case "tool_execution_end":
        onToolEnd(f);
        return true;
      default:
        return false;
    }
  }

  /** 저장된 대화를 그린다. 사람 message는 `addUser`가 거르고 그린다. */
  function replay(messages: Msg[], addUser: (msg: Msg) => void) {
    const results = new Map<string, { error: boolean; text: string }>();
    for (const msg of messages) {
      if (msg.role === "toolResult" && msg.toolCallId) {
        results.set(msg.toolCallId, {
          error: msg.isError === true,
          text: joined(msg.content, "text"),
        });
      }
    }
    let bashes = 0;
    for (const msg of messages) {
      if (msg.role === "user") addUser(msg);
      else if (msg.role === "assistant") {
        recordAssistant(msg, null);
        for (const block of Array.isArray(msg.content) ? msg.content : []) {
          if (block.type !== "toolCall" || !block.id) continue;
          const call = toolStart(
            block.id,
            block.name ?? "",
            block.arguments ?? {},
          );
          const result = results.get(block.id);
          toolEnd(
            call,
            result === undefined ? "cancelled" : result.error ? "error" : "ok",
            result?.text ?? null,
          );
        }
      } else if (msg.role === "bashExecution") {
        const call = toolStart(
          `replay-bash-${++bashes}`,
          "bash",
          { command: msg.command ?? "" },
          { user: msg.command ?? "" },
        );
        toolEnd(
          call,
          msg.cancelled === true
            ? "cancelled"
            : msg.exitCode !== undefined && msg.exitCode !== 0
              ? "error"
              : "ok",
          msg.output ?? null,
        );
      }
    }
    endTurn("completed");
  }

  const self = {
    get turn() {
      return turn;
    },
    get lastTurn() {
      return lastTurn;
    },
    calls,
    nextSeq: () => ++seq,
    startTurn,
    ensureTurn,
    notice,
    message,
    toolStart,
    toolEnd,
    onToolEnd,
    endTurn,
    frame,
    replay,
    emit,
  };
  return self;
}
type Thread = ReturnType<typeof thread>;

const SUB_STATES: Record<string, Sub["state"]> = {
  started: "running",
  completed: "done",
  failed: "failed",
  aborted: "cancelled",
};
const TASK_STATES: Record<Sub["state"], AcpTask["state"]> = {
  running: "running",
  done: "done",
  failed: "failed",
  cancelled: "stopped",
};
const noticeLevel = (level: string | undefined) =>
  level === "warning" || level === "error" ? "warning" : "info";

const start: (io: OmpIo) => Start =
  (io) =>
  async ({ cwd, resume, session, spawn, clock, ids }) => {
    let closed = false;
    let exited = false;
    let stopping = false;
    let restarting: Promise<void> | null = null;
    let stderrTail = "";
    const now = () => clock.now();
    // hidden(rewind)이 숨길 항목을 알아야 해서 낸 갱신을 접어 둔다.
    let acp: AcpState = EMPTY_ACP_STATE;
    const publish = (update: AcpUpdate) => {
      if (closed) return;
      acp = reduceAcp(acp, update);
      session.publish(update);
    };

    // --- 요청과 답 ---
    let counter = 0;
    const waiting = new Map<string, (reply: Reply<unknown>) => void>();
    let proc!: ReturnType<typeof spawn>;
    const write = (body: Record<string, unknown>) =>
      proc.write(`${JSON.stringify(body)}\n`);
    function request<T = unknown>(
      type: string,
      params: Record<string, unknown> = {},
      id = `lpn-${++counter}`,
    ): Promise<Reply<T>> {
      if (exited) {
        return Promise.resolve({ ok: false, error: "omp exited" });
      }
      return new Promise((resolve) => {
        waiting.set(id, resolve as (reply: Reply<unknown>) => void);
        write({ id, type, ...params });
      });
    }

    // --- 상태 ---
    // prompt id → 그 prompt를 보낸 turn. 늦게 온 prompt_result가 다음 turn을 끝내지 않게 한다. 명령용 prompt는 묶지 않는다.
    const promptTurn = new Map<string, string>();
    const turnText = new Map<string, string>();
    const queue: Queued[] = [];
    // 창이 낸 사람 메시지가 omp에서 되돌아오는 글. 겹쳐 내지 않으려고 거른다.
    let pendingEcho: string[] = [];
    // ACP 사람 메시지 id, 대화 순서대로. rewind·fork가 omp entry와 같은 자리로 짝짓는다. 번호가 message의 origin이다.
    let userIds: string[] = [];
    // omp는 `ask`의 질문(`extension_ui_request`)을 그 tool의 `tool_execution_start`보다 먼저 보낸다(녹화로 확인했다).
    // tool 줄이 아직 없으면 질문이 쓴 id를 기억했다가 그 줄을 같은 id로 연다.
    let askAhead: { id: string; group: string; asked: AskQuestion[] } | null =
      null;
    let dialogs: Dialog[] = [];
    let open: Dialog | null = null;
    let cliSession: string | null = null;
    let st: State | null = null;
    let stats: Stats | null = null;
    let goal: Goal | null = null;
    let models: Model[] = [];
    let levels: string[] = [];
    let commands: Command[] = [];
    let roles: AcpRole[] = [];
    let configMode: string | null = null;
    // 이 run에서 `set_mode`로 바꾼 승인 mode. 없으면 사람 설정을 따른다.
    let approvalMode: string | null = null;
    let todoJson = "";
    // 마지막으로 보낸 명령 이름. omp의 `command_output` frame에는 이름이 없다.
    let lastCommand: string | null = null;
    let bashJobs = 0;
    // model turn이 한 번이라도 끝났나. 없으면 omp가 session file을 쓰지 않아 `--resume`으로 못 연다.
    let hadModelTurn = false;

    const taskLines = new Map<string, { thread: Thread; call: Call }>();
    const registerLine = (self: Thread, ompId: string, call: Call) => {
      if (call.name === "task") taskLines.set(ompId, { thread: self, call });
    };
    const main: Thread = thread(publish, ids, clock, cwd, {
      user: onUserMessage,
      ending() {
        dialogs = [];
        if (open !== null) {
          closeDialog(
            open,
            open.kind === "approval"
              ? { approval: "cancelled" }
              : { question: "cancelled" },
          );
        }
        pendingEcho = [];
      },
      preset(name) {
        if (name !== "ask" || askAhead === null) return undefined;
        const ahead = askAhead;
        askAhead = null;
        return {
          id: ahead.id,
          question: { group: ahead.group, asked: ahead.asked, answers: [] },
        };
      },
      started: registerLine,
    });

    // 명령 출력은 터미널 색 escape를 달고 오고 길 수 있다. turn이 없으면 turn 밖 알림이다.
    function info(raw: string, level: "info" | "warning" = "info") {
      main.notice({ type: "info", text: plain(raw), level });
    }
    function commandOutput(raw: string) {
      const text = plain(raw);
      main.notice(
        {
          type: "command_output",
          command: lastCommand ?? "omp",
          text,
          format: looksMarkdown(raw) ? "markdown" : "preformatted",
        },
        true,
      );
    }

    function addUser(id: string, content: ContentBlock[]) {
      const origin = `user:${userIds.length}`;
      userIds.push(id);
      const mine = main.message(id, content, { origin });
      turnText.set(mine, textOf(content));
    }

    // --- 연결 ---
    let gone: Promise<void> = Promise.resolve();
    let started = false;
    let onFrame: (frame: Frame) => void = () => {};

    /** omp를 띄우고 `ready`(또는 끝남)까지 기다릴 Promise를 돌려준다. spawn과 handler 등록은 바로 한다. */
    function connect(args: string[]): Promise<"ready" | "exit"> {
      const mine = spawn("omp", args, { cwd });
      proc = mine;
      exited = false;
      stderrTail = "";
      let buffer = "";
      const chunks = new Map<string, Buffer[]>();
      let settle: (value: "ready" | "exit") => void = () => {};
      const first = new Promise<"ready" | "exit">((resolve) => {
        settle = resolve;
      });
      let done: () => void = () => {};
      gone = new Promise<void>((resolve) => {
        done = resolve;
      });
      function onLine(line: string) {
        if (line.trim() === "") return;
        let frame: Frame;
        try {
          frame = JSON.parse(line) as Frame;
        } catch {
          return;
        }
        if (frame.type === "ready") {
          settle("ready");
        } else if (frame.type === "rpc_chunk") {
          // v2의 큰 frame. 같은 chunkId의 조각을 순서대로 모아 한 줄로 되돌린다.
          const parts = chunks.get(frame.chunkId ?? "") ?? [];
          parts[frame.index ?? 0] = Buffer.from(
            String(frame.data ?? ""),
            "base64",
          );
          chunks.set(frame.chunkId ?? "", parts);
          if (parts.filter(Boolean).length === frame.count) {
            chunks.delete(frame.chunkId ?? "");
            onLine(Buffer.concat(parts).toString("utf8"));
          }
        } else {
          onFrame(frame);
        }
      }
      mine.onStderr((text) => {
        stderrTail = (stderrTail + text).slice(-500);
      });
      mine.onStdout((text) => {
        buffer += text;
        for (
          let at = buffer.indexOf("\n");
          at >= 0;
          at = buffer.indexOf("\n")
        ) {
          const line = buffer.slice(0, at);
          buffer = buffer.slice(at + 1);
          onLine(line);
        }
      });
      mine.onExit((code) => {
        exited = true;
        settle("exit");
        for (const reply of waiting.values()) {
          reply({ ok: false, error: "omp exited" });
        }
        waiting.clear();
        done();
        if (!started || closed || stopping || restarting !== null) return;
        main.ensureTurn();
        main.endTurn("failed", {
          code: "unavailable",
          message: `omp exited${code === null ? "" : ` (code ${code})`}.${stderrTail === "" ? "" : `\n${stderrTail.trim()}`}`,
        });
      });
      return first;
    }

    const argsFor = (resumeId: string | null, mode: string | null) => [
      "--mode",
      "rpc-ui",
      `--cwd=${cwd}`,
      ...(resumeId === null ? [] : [`--resume=${resumeId}`]),
      ...(mode === null ? [] : [`--approval-mode=${mode}`]),
    ];

    // v2로 올려 큰 frame을 chunk로 받고, `ask`의 질문 묶음과 message 전체 snapshot을 켠다(18.8.7의 delta는 믿을 수 없다).
    // subagent는 `events`까지 받는다(lifecycle, progress, 자식 event).
    async function handshake(): Promise<string | null> {
      const negotiated = await request("negotiate_protocol", {
        protocolVersion: 2,
      });
      if (!negotiated.ok) return negotiated.error;
      void request("set_ask_dialog", { enabled: true });
      void request("set_event_filter", { events: null });
      void request("set_subagent_subscription", { level: "events" });
      return null;
    }

    // --- 세션 정보 ---
    const currentMode = () => approvalMode ?? configMode ?? "yolo";
    // 전역 범위 slow(Anthropic)는 omp가 사람의 설정 file에 쓰므로 내지도 보내지도 않는다.
    const slowAvailable = () =>
      st?.slowModeSupported === true && st.slowModeScope === "session";
    const speedAxis = () => ({
      id: "speed",
      label: "Speed",
      kind: "choice" as const,
      values: [
        { value: "standard", label: "Standard" },
        { value: "fast", label: "Fast" },
        ...(slowAvailable() ? [{ value: "slow", label: "Slow" }] : []),
      ],
    });
    const speedNow = () =>
      st?.slowModeEnabled === true
        ? "slow"
        : st?.fastModeEnabled === true
          ? "fast"
          : "standard";

    const usageOf = (): AcpUsage | null => {
      const used = st?.contextUsage;
      const tokens = used?.tokens;
      const limit = used?.contextWindow;
      const limited = st?.usageLimit;
      if (
        stats === null &&
        !(typeof tokens === "number" && typeof limit === "number")
      ) {
        return null;
      }
      const left = limited?.allowanceLeftPercent;
      return {
        // 분해(`parts`)는 `/context` 명령 출력에 있다.
        context:
          typeof tokens === "number" && typeof limit === "number"
            ? { tokens, limit, parts: [] }
            : null,
        limits:
          limited === null || limited === undefined
            ? []
            : [
                {
                  id: limited.stage,
                  label: limited.stage,
                  used_percent: left === undefined ? null : 100 - left,
                  left: left === undefined ? null : `${left}% left`,
                  resets_at:
                    limited.resetsAtSec === undefined
                      ? null
                      : formatAt(limited.resetsAtSec * 1000),
                },
              ],
        input_tokens: stats?.tokens?.input ?? null,
        output_tokens: stats?.tokens?.output ?? null,
        cache_read_tokens: stats?.tokens?.cacheRead ?? null,
        cache_write_tokens: stats?.tokens?.cacheWrite ?? null,
        turns: stats?.assistantMessages ?? null,
        costs:
          stats?.cost === undefined
            ? []
            : [
                {
                  kind: "reported",
                  currency: "USD",
                  amount: String(stats.cost),
                },
              ],
        provider: null,
      };
    };

    const goalOf = (): AcpGoal | null => {
      if (goal === null) return null;
      const used = goal.tokensUsed ?? 0;
      return {
        objective: goal.objective,
        status:
          goal.status === "paused"
            ? "paused"
            : goal.status === "budget-limited"
              ? "blocked"
              : goal.status === "complete"
                ? "done"
                : "active",
        detail:
          goal.tokenBudget === undefined
            ? `${used} tokens used`
            : `${used} of ${goal.tokenBudget} tokens used`,
      };
    };

    const commandList = (): AcpCommand[] => [
      ...commands.map((one) => ({
        name: one.name,
        aliases: one.aliases ?? [],
        description: one.description ?? "",
        argument_hint: one.input?.hint ?? null,
        source: COMMAND_SOURCES[one.source ?? "builtin"] ?? "harness",
        opens: COMMAND_OPENS[one.name] ?? null,
      })),
      ...ADAPTER_COMMANDS,
    ];
    const isCommand = (name: string) =>
      TUI_ONLY.has(name) ||
      commandList().some(
        (one) => one.name === name || one.aliases.includes(name),
      );

    function meta(): AcpSessionMeta {
      const axis = {
        id: "effort",
        label: "Thinking",
        kind: "choice" as const,
        values: levels.map((value) => ({ value, label: value })),
      };
      const groups = new Map<string, Model[]>();
      for (const model of models) {
        groups.set(model.provider, [
          ...(groups.get(model.provider) ?? []),
          model,
        ]);
      }
      const current = st?.model;
      const currentId =
        current === undefined ? null : `${current.provider}/${current.id}`;
      return {
        title: st?.sessionName ?? null,
        cli_session: cliSession,
        capabilities: {
          model: true,
          effort: true,
          mode: true,
          commands: true,
          rewind: true,
          rewind_files: false,
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
          steer_child: true,
          tasks: true,
          toggles: false,
          goal: true,
          roles: true,
          shell: true,
          resume: true,
        },
        models: [...groups].map(([provider, list]) => ({
          id: provider,
          label: provider,
          models: list.map((model) => ({
            id: `${model.provider}/${model.id}`,
            label: model.name ?? model.id,
            // 단계 목록은 지금 model의 것이다. 다른 model이 같은 단계를 갖는지는 골라 봐야 안다.
            // Speed는 ModelInfo에 tier 정보가 없어 지금 model에만 둔다.
            axes: [
              ...(model.reasoning === false || levels.length === 0
                ? []
                : [axis]),
              ...(`${model.provider}/${model.id}` === currentId
                ? [speedAxis()]
                : []),
            ],
          })),
        })),
        model:
          current === undefined
            ? null
            : {
                model: `${current.provider}/${current.id}`,
                label: current.name ?? current.id,
                options: {
                  ...(st?.thinkingLevel === undefined
                    ? {}
                    : { effort: st.thinkingLevel }),
                  speed: speedNow(),
                },
                layer: null,
              },
        modes: MODES,
        mode: currentMode(),
        commands: commandList(),
        usage: st === null ? null : usageOf(),
        toggles: [],
        goal: goalOf(),
        roles,
        harness: "omp",
      };
    }

    const publishMeta = () =>
      publish({ type: "session_changed", session: meta() });

    async function readState() {
      const reply = await request<State>("get_state");
      if (!reply.ok) return;
      st = reply.data;
      cliSession = st.sessionId;
      goal = st.goal?.goal ?? null;
      const phases = st.todoPhases ?? [];
      const json = JSON.stringify(phases);
      if (json !== todoJson) {
        todoJson = json;
        publish({
          type: "plan_changed",
          entries: phases.flatMap((phase) =>
            phase.tasks.map((task) => ({
              text: task.content,
              status:
                task.status === "in_progress"
                  ? ("in_progress" as const)
                  : task.status === "completed"
                    ? ("completed" as const)
                    : task.status === "abandoned"
                      ? ("cancelled" as const)
                      : ("pending" as const),
            })),
          ),
        });
      }
    }
    async function readLevels() {
      const reply = await request<{ levels: string[] }>(
        "get_available_thinking_levels",
      );
      // 추론하지 않는 model은 ["off"]만 준다. 그 model에서 목록을 비우면 다시 고를 단계를 잃는다.
      if (reply.ok && reply.data.levels.length > 1) levels = reply.data.levels;
    }
    async function readStats() {
      const reply = await request<Stats>("get_session_stats");
      if (reply.ok) stats = reply.data;
    }
    async function refresh() {
      await Promise.all([readState(), readLevels(), readStats()]);
      publishMeta();
    }

    // omp 설정은 읽기만 한다. 없거나 못 읽으면 비어 있는 것으로 본다.
    async function readConfig() {
      const read = async (path: string) => {
        try {
          const text = Buffer.from(await io.readFile(path)).toString("utf8");
          return (parse(text) ?? {}) as {
            modelRoles?: Record<string, unknown>;
            tools?: { approvalMode?: unknown };
          };
        } catch {
          return {};
        }
      };
      const [global, project] = await Promise.all([
        read(join(io.home, ".omp", "agent", "config.yml")),
        read(join(cwd, ".omp", "config.yml")),
      ]);
      const assigned = { ...global.modelRoles, ...project.modelRoles };
      roles = Object.entries(assigned).flatMap(([id, model]) =>
        typeof model === "string"
          ? [
              {
                id,
                label: id,
                kind: MODEL_ROLES.has(id)
                  ? ("model" as const)
                  : ("chat" as const),
                model,
              },
            ]
          : [],
      );
      const mode = project.tools?.approvalMode ?? global.tools?.approvalMode;
      configMode = MODES.some((one) => one.id === mode)
        ? (mode as string)
        : null;
    }

    // --- subagent ---
    const subs = new Map<string, Sub>();
    let tasks: AcpTask[] = [];

    function childUser(child: Thread, msg: Msg) {
      child.message(
        ids.newId("msg"),
        [{ type: "text", text: joined(msg.content, "text") }],
        msg.attribution === "agent"
          ? { origin: null, actor: "received" }
          : { origin: null, delivery: msg.steering ? "steer" : "next_turn" },
      );
    }
    function makeChild(id: string): Thread {
      const child: Thread = thread(
        (update) => publish({ type: "child_update", child: id, update }),
        ids,
        clock,
        cwd,
        { user: (msg) => childUser(child, msg), started: registerLine },
      );
      return child;
    }

    const detailOf = (sub: {
      id: string;
      agent: string;
      description: string;
      state: Sub["state"];
      model: string | null;
      last: string | null;
    }): AcpToolDetail => ({
      kind: "subagent",
      agent: sub.agent,
      description: sub.description,
      child: sub.id,
      state: sub.state,
      model: sub.model,
      last: sub.last,
    });
    function showSub(sub: Sub) {
      const detail = detailOf(sub);
      const key = JSON.stringify(detail);
      if (key === sub.shown) return;
      sub.shown = key;
      sub.line.thread.emit({
        type: "tool_detail_changed",
        tool_call: sub.line.call.id,
        detail,
      });
    }
    function showTask(sub: Sub) {
      const before = tasks.find((one) => one.id === sub.id);
      const task: AcpTask = {
        id: sub.id,
        kind: "agent",
        description: sub.description,
        state: TASK_STATES[sub.state],
        started_at: before?.started_at ?? now(),
        output: null,
      };
      tasks = before
        ? tasks.map((one) => (one.id === sub.id ? task : one))
        : [...tasks, task];
      publish({ type: "tasks_changed", tasks });
    }

    // lifecycle은 task tool이 끝난 뒤에 올 수 있다(background로 돈다). 부모 tool 줄은 그때 detail만 바뀐다.
    function onLifecycle(payload: Payload) {
      const id = payload.id ?? "";
      if (id === "") return;
      const state = SUB_STATES[payload.status ?? ""] ?? "running";
      const known = subs.get(id);
      if (known !== undefined) {
        known.state = state;
        showSub(known);
        if (known.detached) showTask(known);
        return;
      }
      const parent =
        payload.parentToolCallId === undefined
          ? undefined
          : taskLines.get(payload.parentToolCallId);
      // task 하나가 여러 subagent를 띄울 수 있다. 줄에는 첫 것만 붙고 나머지는 따로 줄을 연다.
      const attach = parent !== undefined && parent.call.spawned !== true;
      const given = attach ? parent.call.args.tasks : undefined;
      const entry = (
        Array.isArray(given) ? given[payload.index ?? 0] : undefined
      ) as { task?: string } | undefined;
      const agent = payload.agent ?? "task";
      const description =
        oneLine(payload.description ?? str(entry?.task), 120) || id;
      const fields = {
        id,
        agent,
        description,
        state,
        model: null,
        last: null,
      };
      let line: Sub["line"];
      let shown = "";
      if (attach) {
        parent.call.spawned = true;
        line = parent;
      } else {
        const detail = detailOf(fields);
        shown = JSON.stringify(detail);
        const call = main.toolStart(
          `sub:${id}`,
          "subagent",
          {},
          {
            title: oneLine(`${agent}: ${description}`, 120),
            detail,
            turn: main.turn ?? main.lastTurn ?? ids.newId("trn"),
          },
        );
        // 줄은 바로 끝난다. subagent의 상태는 detail이 말한다.
        main.toolEnd(call, "ok", null);
        line = { thread: main, call };
      }
      const sub: Sub = {
        ...fields,
        detached: payload.detached === true,
        line,
        child: makeChild(id),
        shown,
      };
      subs.set(id, sub);
      showSub(sub);
      if (sub.detached) showTask(sub);
    }

    function onProgress(payload: Payload) {
      const progress = payload.progress;
      const sub = subs.get(progress?.id ?? "");
      if (sub === undefined || progress === undefined) return;
      sub.model = progress.resolvedModel ?? sub.model;
      sub.last =
        oneLine(
          progress.currentToolIntent ??
            progress.recentOutput?.at(-1) ??
            progress.recentTools?.at(-1)?.intent ??
            sub.last ??
            "",
          120,
        ) || null;
      showSub(sub);
    }

    // 다시 열었거나 늦게 붙었을 때 이미 도는 subagent의 줄과 대화를 읽어 온다.
    async function attachRunning() {
      const list = await request<{
        subagents?: {
          id: string;
          agent?: string;
          status?: string;
          index?: number;
          parentToolCallId?: string;
        }[];
      }>("get_subagents");
      if (!list.ok) return;
      for (const one of list.data.subagents ?? []) {
        if (one.status !== "running") continue;
        onLifecycle({ ...one, status: "started", detached: true });
        const child = subs.get(one.id)?.child;
        const page = await request<{ messages?: Msg[] }>(
          "get_subagent_messages",
          { subagentId: one.id },
        );
        if (child !== undefined && page.ok) {
          child.replay(page.data.messages ?? [], (msg) => {
            child.endTurn("completed");
            childUser(child, msg);
          });
        }
      }
    }

    // --- 사람이 답할 것(승인과 질문) ---
    function pump() {
      if (open !== null) return;
      const next = dialogs.shift();
      if (next === undefined) return;
      open = next;
      if (next.kind === "approval") {
        const { call, tool } = next;
        const command = str(call?.args.command);
        const path = str(call?.args.path);
        const category = CATEGORIES[tool];
        publish({
          type: "approval_opened",
          approval: {
            id: next.request,
            subject:
              tool === "bash" && command !== ""
                ? { kind: "shell", command }
                : EDIT_TOOLS.includes(tool) && path !== ""
                  ? {
                      kind: "file_change",
                      changes: [
                        {
                          path: relative(cwd, path),
                          change: tool === "write" ? "create" : "update",
                          added: null,
                          removed: null,
                        },
                      ],
                    }
                  : {
                      kind: "mcp_tool",
                      server: "omp",
                      tool,
                      effect: EDIT_TOOLS.includes(tool)
                        ? "write"
                        : category === "read" ||
                            category === "list" ||
                            category === "search"
                          ? "read"
                          : "external",
                    },
            choices:
              next.sessionOption === undefined
                ? ["once", "reject"]
                : ["once", "session", "reject"],
            always_patterns: [],
          },
        });
      } else {
        publish({
          type: "question_asked",
          group: next.group,
          tool_call: next.toolCall,
          questions: toAcpQuestions(next.asked),
        });
      }
    }

    function closeDialog(
      dialog: Dialog,
      how:
        | {
            approval: "allowed" | "denied" | "cancelled";
            choice?: "once" | "session";
            reason?: string;
          }
        | { question: "submitted" | "cancelled" },
    ) {
      // 아직 카드로 열지 않은 것은 알린 적이 없으니 말없이 뺀다.
      if (open !== dialog) {
        dialogs = dialogs.filter((one) => one !== dialog);
        return;
      }
      open = null;
      if (dialog.kind === "approval" && "approval" in how) {
        publish({
          type: "approval_closed",
          request: dialog.request,
          outcome: how.approval,
          choice: how.choice ?? null,
          reason: how.reason ?? null,
          mode: null,
          seq: main.nextSeq(),
          at: now(),
        });
      } else if (dialog.kind === "question" && "question" in how) {
        publish({
          type: "question_resolved",
          group: dialog.group,
          outcome: how.question,
        });
      }
      pump();
    }

    function onUiRequest(frame: Frame) {
      const ui = frame.id ?? "";
      const note = typeof frame.message === "string" ? frame.message : "";
      switch (frame.method) {
        case "cancel": {
          const target = [open, ...dialogs].find(
            (one) => one?.ui === frame.targetId,
          );
          if (target) {
            closeDialog(
              target,
              target.kind === "approval"
                ? { approval: "cancelled" }
                : { question: "cancelled" },
            );
          }
          return;
        }
        case "notify":
          info(note, noticeLevel(frame.notifyType));
          return;
        case "open_url":
          info(`Open ${frame.url ?? ""}`);
          return;
        case "select":
        case "confirm":
        case "input":
        case "editor":
        case "ask":
          break;
        default:
          return;
      }
      const title = frame.title ?? "";
      const tool = title.split("\n", 1)[0]?.startsWith(APPROVAL)
        ? title.split("\n", 1)[0]!.slice(APPROVAL.length)
        : null;
      if (frame.method === "select" && tool !== null) {
        // select에는 toolCallId가 없다. 그 이름으로 가장 최근에 도는 tool에 붙인다.
        const call = [...main.calls.values()]
          .reverse()
          .find((one) => one.name === tool && !one.done);
        dialogs.push({
          kind: "approval",
          ui,
          request: ids.newId("apr"),
          tool,
          sessionOption: (frame.options ?? []).find(
            (option) =>
              option.startsWith("Approve ") &&
              option.endsWith("for this session"),
          ),
          call,
        });
        pump();
        return;
      }
      const asked: AskQuestion[] =
        frame.method === "ask"
          ? (frame.questions ?? [])
          : [
              {
                id: "answer",
                question:
                  frame.method === "confirm"
                    ? `${title}\n${note}`.trim()
                    : title,
                header: "omp",
                options:
                  frame.method === "select"
                    ? (frame.options ?? []).map((label) => ({ label }))
                    : frame.method === "confirm"
                      ? [{ label: "Yes" }, { label: "No" }]
                      : [],
              },
            ];
      const group = ids.newId("qgr");
      const call =
        frame.method === "ask"
          ? [...main.calls.values()]
              .reverse()
              .find((one) => one.name === "ask" && !one.done)
          : undefined;
      if (call !== undefined) call.question = { group, asked, answers: [] };
      const toolCall = call?.id ?? ids.newId("tcl");
      if (frame.method === "ask" && call === undefined) {
        askAhead = { id: toolCall, group, asked };
      }
      dialogs.push({
        kind: "question",
        ui,
        group,
        toolCall,
        method: frame.method ?? "select",
        asked,
      });
      pump();
    }

    function decide(message: Extract<AcpInput, { type: "decide" }>) {
      const dialog = open;
      if (dialog?.kind !== "approval" || dialog.request !== message.request) {
        return;
      }
      const kind = message.choice.kind;
      if (kind === "mode") return;
      // 영구 규칙(`always`)은 어느 판에서도 답하지 않는다. 한 번 허락으로 줄인다.
      const picked = kind === "session" ? dialog.sessionOption : undefined;
      write({
        type: "extension_ui_response",
        id: dialog.ui,
        value: kind === "reject" ? "Deny" : (picked ?? "Approve"),
      });
      closeDialog(
        dialog,
        kind === "reject"
          ? {
              approval: "denied",
              ...(message.choice.kind === "reject" && message.choice.reason
                ? { reason: message.choice.reason }
                : {}),
            }
          : {
              approval: "allowed",
              choice: picked === undefined ? "once" : "session",
            },
      );
    }

    function answer(message: Extract<AcpInput, { type: "answer" }>) {
      const dialog = open;
      if (dialog?.kind !== "question") return;
      const given = message.answers.map((one) =>
        one.status === "answered" ? one.answer : [],
      );
      const call = [...main.calls.values()].find(
        (one) => one.question?.group === dialog.group,
      );
      if (call?.question) call.question.answers = given;
      if (dialog.method === "ask") {
        write({
          type: "extension_ui_response",
          id: dialog.ui,
          answers: dialog.asked.map((one, index) => {
            const labels = one.options.map((option) => option.label);
            const reply = given[index] ?? [];
            const picked = reply.filter((label) => labels.includes(label));
            const custom = reply
              .filter((label) => !labels.includes(label))
              .join(", ");
            const fallback = labels[one.recommended ?? 0];
            return {
              id: one.id,
              selectedOptions:
                custom !== ""
                  ? []
                  : one.multi
                    ? picked
                    : picked.slice(0, 1).length > 0 || fallback === undefined
                      ? picked.slice(0, 1)
                      : [fallback],
              ...(custom === "" ? {} : { customInput: custom }),
            };
          }),
        });
      } else {
        const text = (given[0] ?? []).join("\n");
        write({
          type: "extension_ui_response",
          id: dialog.ui,
          ...(text === ""
            ? { cancelled: true }
            : dialog.method === "confirm"
              ? { confirmed: text === "Yes" }
              : { value: text }),
        });
      }
      closeDialog(dialog, { question: "submitted" });
    }

    // --- turn ---
    function onUserMessage(msg: Msg) {
      if (msg.synthetic || msg.attribution === "agent") return;
      const text = joined(msg.content, "text");
      const echo = pendingEcho.indexOf(text);
      if (echo >= 0) {
        pendingEcho.splice(echo, 1);
        return;
      }
      const index = queue.findIndex((one) => one.text === text);
      const one = queue[index];
      if (one === undefined) {
        addUser(ids.newId("msg"), [{ type: "text", text }]);
        return;
      }
      queue.splice(index, 1);
      const origin = `user:${userIds.length}`;
      userIds.push(one.id);
      // follow-up은 앞 응답이 끝난 뒤 들어가는 다음 turn이고 steer는 도는 turn에 끼는 것이다.
      if (one.kind === "followUp") main.endTurn("completed");
      const mine = main.ensureTurn();
      turnText.set(mine, text);
      publish({
        type: "message_taken",
        message: one.id,
        seq: main.nextSeq(),
        delivery: one.kind === "steer" ? "steer" : "next_turn",
        turn: one.kind === "steer" ? null : mine,
      });
      publish({ type: "origin_set", message: one.id, origin });
    }

    onFrame = (frame: Frame) => {
      switch (frame.type) {
        case "response": {
          const done = waiting.get(frame.id ?? "");
          if (done === undefined) return;
          waiting.delete(frame.id ?? "");
          done(
            frame.success === true
              ? { ok: true, data: frame.data }
              : {
                  ok: false,
                  error: errorText(frame),
                  ...(frame.code === undefined ? {} : { code: frame.code }),
                },
          );
          return;
        }
        case "agent_start":
          main.frame(frame);
          return;
        case "agent_end":
          main.frame(frame);
          if (frame.yielded !== false && frame.isTerminal !== false) {
            hadModelTurn = true;
            void refresh();
          }
          return;
        case "prompt_result": {
          if (promptTurn.get(frame.id ?? "") !== main.turn) return;
          const failure = frame.error as { message?: string } | undefined;
          if (frame.status === "error") {
            main.endTurn("failed", {
              code: "internal",
              message: failure?.message ?? "omp failed",
            });
          } else if (frame.status === "aborted") main.endTurn("stopped");
          else if (frame.agentInvoked === false) main.endTurn("completed");
          return;
        }
        case "session_settled":
          for (const one of queue.splice(0)) {
            publish({ type: "message_removed", message: one.id });
          }
          return;
        case "tool_execution_end":
          if (main.onToolEnd(frame)?.name === "todo") void readState();
          return;
        case "extension_ui_request":
          onUiRequest(frame);
          return;
        case "available_commands_update":
          commands = frame.commands ?? [];
          publishMeta();
          return;
        case "model_changed":
        case "thinking_level_changed":
          void refresh();
          return;
        case "goal_updated":
          goal =
            frame.goal === null ||
            frame.goal === undefined ||
            frame.goal.status === "dropped"
              ? null
              : frame.goal;
          publishMeta();
          return;
        case "subagent_lifecycle":
          if (frame.payload) onLifecycle(frame.payload);
          return;
        case "subagent_progress":
          if (frame.payload) onProgress(frame.payload);
          return;
        case "subagent_event": {
          const sub = subs.get(frame.payload?.id ?? "");
          if (sub !== undefined && frame.payload?.event) {
            sub.child.frame(frame.payload.event);
          }
          return;
        }
        case "command_output":
          commandOutput(frame.text ?? "");
          return;
        case "notice":
          info(
            typeof frame.message === "string" ? frame.message : "",
            noticeLevel(frame.level),
          );
          return;
        case "auto_retry_start":
          info(
            `Retrying (${frame.attempt}/${frame.maxAttempts}): ${frame.errorMessage ?? ""}`,
            "warning",
          );
          return;
        case "auto_retry_end":
          if (frame.success === false) {
            info(`Retry failed: ${frame.finalError ?? ""}`, "warning");
          }
          return;
        case "manual_compaction_start":
        case "auto_compaction_start":
          info("Compacting the conversation…");
          return;
        case "manual_compaction_end":
        case "auto_compaction_end": {
          const failed = frame.aborted || frame.errorMessage;
          info(
            failed
              ? `Compaction ${frame.skipped ? "skipped" : "failed"}: ${frame.errorMessage ?? "aborted"}`
              : "Compacted the conversation.",
            failed ? "warning" : "info",
          );
          void refresh();
          return;
        }
        case "retry_fallback_applied":
          info(
            `Switched model: ${frame.from ?? ""} → ${frame.to ?? ""}`,
            "warning",
          );
          return;
        default:
          main.frame(frame);
          return;
      }
    };

    // 정의를 다 마친 뒤에 띄운다: ready 앞뒤로 온 frame이 아래 정의를 쓴다.
    const launched = await connect(argsFor(resume ?? null, null));
    if (launched === "exit") {
      closed = true;
      return {
        ok: false,
        error: {
          code: "unavailable",
          message: `\`omp\` did not start.${stderrTail === "" ? "" : `\n${stderrTail.trim()}`}`,
        },
      };
    }
    const negotiated = await handshake();
    if (negotiated !== null) {
      closed = true;
      proc.kill();
      return {
        ok: false,
        error: {
          code: "unavailable",
          message: `omp rejected the RPC protocol: ${negotiated}`,
        },
      };
    }
    started = true;

    // --- 시작 상태와 앞 대화 ---
    // 저장된 대화를 처음부터 그린다. assistant가 있으면 model turn이 끝난 적이 있는 session이다.
    async function replayHistory() {
      for (let cursor: string | undefined; ; ) {
        const page = await request<{
          messages: Msg[];
          nextCursor?: string;
        }>("get_messages_page", {
          limit: 256,
          ...(cursor ? { cursor } : {}),
        });
        if (!page.ok) {
          info(
            `Could not read the earlier conversation: ${page.error}`,
            "warning",
          );
          return;
        }
        if (page.data.messages.some((msg) => msg.role === "assistant")) {
          hadModelTurn = true;
        }
        main.replay(page.data.messages, (msg) => {
          if (msg.synthetic || msg.attribution === "agent") return;
          main.endTurn("completed");
          addUser(ids.newId("msg"), [
            { type: "text", text: joined(msg.content, "text") },
          ]);
        });
        cursor = page.data.nextCursor;
        if (cursor === undefined) return;
      }
    }

    const ready = (async () => {
      const [, , , available, commandsReply] = await Promise.all([
        readState(),
        readLevels(),
        readStats(),
        request<{ models: Model[] }>("get_available_models"),
        request<{ commands: Command[] }>("get_available_commands"),
        readConfig(),
      ]);
      models = available.ok ? available.data.models : [];
      commands = commandsReply.ok ? commandsReply.data.commands : [];
      publishMeta();
      if (resume !== undefined) await replayHistory();
      await attachRunning();
    })();

    // --- 입력 ---
    async function imagesOf(content: ContentBlock[]) {
      const images: { type: "image"; data: string; mimeType: string }[] = [];
      for (const block of content) {
        if (
          block.type !== "resource_link" ||
          !block.mimeType?.startsWith("image/")
        ) {
          continue;
        }
        try {
          const bytes = await io.readFile(block.uri.replace(/^file:\/\//, ""));
          images.push({
            type: "image",
            data: Buffer.from(bytes).toString("base64"),
            mimeType: block.mimeType,
          });
        } catch {
          info(`Could not read the image ${block.name}.`, "warning");
        }
      }
      return images.length === 0 ? {} : { images };
    }

    async function prompt(text: string, extra: Record<string, unknown>) {
      const id = `lpn-${++counter}`;
      promptTurn.set(id, main.ensureTurn());
      const reply = await request<{ agentInvoked?: boolean }>(
        "prompt",
        { message: text, ...extra },
        id,
      );
      if (!reply.ok)
        main.endTurn("failed", { code: "internal", message: reply.error });
      else if (reply.data?.agentInvoked === false) main.endTurn("completed");
    }

    // 명령은 turn을 열지 않는다. omp는 도는 중에도 `prompt "/name"`의 builtin과 skill을 먼저 처리해서, 로컬 명령은 바로
    // 답하고 prompt로 펼쳐지는 것은 다음 turn에 선다. 그 `prompt_result`가 도는 turn을 끝내지 않게 promptTurn에 묶지 않는다.
    async function sendCommand(text: string) {
      const reply = await request("prompt", {
        message: text,
        ...(main.turn === null ? {} : { streamingBehavior: "followUp" }),
      });
      if (!reply.ok) info(`omp did not run ${text}: ${reply.error}`, "warning");
    }

    const queueName = (one: Queued) =>
      one.kind === "steer" ? "steering" : "followUp";
    const queueAdd = (one: Queued) =>
      one.kind === "steer"
        ? request("prompt", { message: one.text, streamingBehavior: "steer" })
        : request("follow_up", { message: one.text });
    function resendQueue() {
      for (const one of queue) {
        publish({ type: "message_removed", message: one.id });
      }
      for (const one of queue) {
        publish({
          type: "message_queued",
          queued: { id: one.id, at: now(), content: one.content },
        });
      }
    }
    // omp 줄은 순서를 바꾸는 명령이 없어, 바뀌는 자리부터 지우고 새 순서로 다시 넣는다.
    async function requeue(from: number) {
      const tail = queue.slice(from);
      for (const one of tail) {
        await request("remove_queued_message", {
          message: one.text,
          queue: queueName(one),
        });
      }
      for (const one of queue.slice(from)) await queueAdd(one);
    }

    // 도는 중에는 omp가 branch·fork·new_session을 거절한다(`session_busy`).
    function idleOnly(what: string): boolean {
      if (main.turn === null) return true;
      info(`Stop the running turn before ${what}.`, "warning");
      return false;
    }

    // RPC `prompt`는 `!`을 해석하지 않아 model에게 글로 간다. `bash`로 보내고 사람이 돌린 tool 줄 하나로 그린다.
    // 사람 말풍선은 만들지 않는다. 도는 turn이 없으면 turn도 열지 않아 끝 줄(turn_end)이 생기지 않는다.
    async function bashCommand(command: string) {
      bashJobs += 1;
      const call = main.toolStart(
        `bash-${++counter}`,
        "bash",
        { command },
        { user: command },
      );
      const reply = await request<BashResult>("bash", { command });
      bashJobs -= 1;
      main.toolEnd(
        call,
        !reply.ok
          ? "error"
          : reply.data.cancelled === true
            ? "cancelled"
            : reply.data.exitCode !== undefined && reply.data.exitCode !== 0
              ? "error"
              : "ok",
        reply.ok ? (reply.data.output ?? "") : reply.error,
      );
    }

    // fast와 slow는 서로 배타다: 가는 쪽을 켜기 전에 켜진 반대쪽을 끈다. 오류면 알리고, 뒤의 `refresh()`가 축 값을 되돌린다.
    async function setSpeed(speed: string) {
      if (
        speed === "slow"
          ? !slowAvailable()
          : speed !== "fast" && speed !== "standard"
      ) {
        return;
      }
      const steps: [string, boolean][] = [];
      if (speed !== "fast" && st?.fastModeEnabled === true) {
        steps.push(["set_fast_mode", false]);
      }
      if (speed !== "slow" && st?.slowModeEnabled === true) {
        steps.push(["set_slow_mode", false]);
      }
      if (speed === "fast") steps.push(["set_fast_mode", true]);
      if (speed === "slow") steps.push(["set_slow_mode", true]);
      for (const [type, enabled] of steps) {
        const reply = await request(type, { enabled });
        if (!reply.ok) {
          return void info(
            `Could not change the speed: ${reply.error}`,
            "warning",
          );
        }
      }
    }

    // 지금 session file의 폴더가 이 cwd의 session 폴더다(폴더 이름은 omp의 규칙이라 만들지 않는다). file마다 앞 두 줄
    // (`title`, `session`)만 읽는다. 아직 저장 전이라 `sessionFile`이 없으면 폴더를 몰라 빈 목록이다.
    async function sessionFiles(): Promise<
      (AcpCliSession & { path: string })[]
    > {
      const file = st?.sessionFile;
      if (file === undefined) return [];
      const dir = dirname(file);
      let names: string[];
      try {
        names = await io.readDir(dir);
      } catch {
        return [];
      }
      const found = await Promise.all(
        names
          .filter((name) => name.endsWith(".jsonl"))
          .map(async (name) => {
            const path = join(dir, name);
            let titled: { title?: string; updatedAt?: string } = {};
            let header: { id?: string; timestamp?: string } = {};
            try {
              const head = await io.readHead(path, 4096);
              for (const line of head.split("\n").slice(0, 2)) {
                try {
                  const one = JSON.parse(line) as {
                    type?: string;
                    title?: string;
                    updatedAt?: string;
                    id?: string;
                    timestamp?: string;
                  };
                  if (one.type === "title") titled = one;
                  else if (one.type === "session") header = one;
                } catch {}
              }
            } catch {
              return [];
            }
            if (header.id === undefined) return [];
            return [
              {
                id: header.id,
                title: titled.title || "(untitled)",
                updated_at: titled.updatedAt ?? header.timestamp ?? null,
                path,
              },
            ];
          }),
      );
      return found
        .flat()
        .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""))
        .slice(0, 30);
    }

    // process를 다시 띄우지 않고 omp의 session을 바꾼다. 앞 대화는 새 session에 없어 상태를 비우고 다시 그린다.
    async function openSession(id: string) {
      if (!idleOnly("opening another session")) return;
      const target = (await sessionFiles()).find((one) => one.id === id);
      if (target === undefined) {
        return void info(
          "That session is no longer in this folder.",
          "warning",
        );
      }
      // omp는 없는 file로 바꾸라 해도 성공으로 답하고 빈 새 session을 연다(녹화 switch로 확인했다). 먼저 file이 있는지 보고,
      // 바꾼 뒤에는 session id가 고른 것인지 본다.
      const previous = st?.sessionFile;
      try {
        await io.readHead(target.path, 1);
      } catch {
        return void info("That session file is gone.", "warning");
      }
      const reply = await request<{ cancelled: boolean }>("switch_session", {
        sessionPath: target.path,
      });
      if (!reply.ok || reply.data.cancelled) {
        return void info(
          reply.ok
            ? "omp cancelled opening the session."
            : `Could not open the session: ${reply.error}`,
          "warning",
        );
      }
      await readState();
      if (cliSession !== id) {
        // 빈 session에 남기지 않고 앞 session으로 돌아온다. 대화 상태는 아직 지우지 않았다.
        if (previous !== undefined) {
          await request("switch_session", { sessionPath: previous });
        }
        await refresh();
        return void info(
          "omp did not open that session, so the earlier one is still open.",
          "warning",
        );
      }
      userIds = [];
      turnText.clear();
      promptTurn.clear();
      queue.length = 0;
      pendingEcho = [];
      subs.clear();
      taskLines.clear();
      tasks = [];
      todoJson = "";
      hadModelTurn = false;
      publish({ type: "session_reset" });
      await refresh();
      await replayHistory();
      await attachRunning();
    }

    async function newSession() {
      if (!idleOnly("starting a new session")) return;
      const reply = await request<{ cancelled: boolean }>("new_session");
      if (!reply.ok || reply.data.cancelled) {
        return void info(
          reply.ok
            ? "omp cancelled the new session."
            : `Could not start a new session: ${reply.error}`,
          "warning",
        );
      }
      // 앞 대화는 새 session에 없다.
      const top = acp.items[0];
      if (top !== undefined) hideFrom(top.id, top.id);
      userIds = [];
      await refresh();
    }

    // ACP 사람 메시지 id가 omp의 몇 번째 사람 entry인지 센다. 합성·agent가 낸 user entry는 세지 않는다.
    async function entryOf(message: string): Promise<string | null> {
      const index = userIds.indexOf(message);
      const reply = await request<{
        entries: { id: string; type: string; message?: Msg }[];
      }>("get_entries");
      if (index < 0 || !reply.ok) return null;
      const users = reply.data.entries.filter(
        (entry) =>
          entry.type === "message" &&
          entry.message?.role === "user" &&
          !entry.message.synthetic &&
          entry.message.attribution !== "agent",
      );
      return users[index]?.id ?? null;
    }

    // session이 옮겨 간 뒤 `from`부터의 항목을 숨긴다.
    function hideFrom(checkpoint: string, from: string) {
      const flat = (
        list: readonly AcpEntry[] | AcpState["items"],
      ): AcpEntry[] =>
        list.flatMap((item) =>
          item.kind === "hidden" ? flat(item.items) : [item],
        );
      const startAt = acp.items.findIndex((item) => item.id === from);
      if (startAt < 0) return;
      const items = flat(acp.items.slice(startAt));
      const head = acp.items[startAt];
      if (head === undefined || items.length === 0) return;
      const hidden: AcpHiddenItem = {
        kind: "hidden",
        id: ids.newId("rwd"),
        seq: head.seq,
        at: now(),
        checkpoint,
        choice: "messages_only",
        count: items.length,
        restored: 0,
        left: [],
        items,
      };
      publish({ type: "hidden_added", item: hidden });
    }

    async function rewindTo(target: string) {
      if (!idleOnly("rewinding")) return;
      const entry = await entryOf(target);
      if (entry === null)
        return void info("This message cannot be rewound.", "warning");
      const reply = await request<{ cancelled: boolean }>("branch", {
        entryId: entry,
      });
      if (!reply.ok || reply.data.cancelled) {
        return void info(
          reply.ok
            ? "omp cancelled the rewind."
            : `Rewind failed: ${reply.error}`,
          "warning",
        );
      }
      // branch는 새 session file이라 id가 바뀐다. 그 message부터 대화가 지워졌다.
      hideFrom(target, target);
      userIds = userIds.slice(0, userIds.indexOf(target));
      await refresh();
    }

    async function forkAt(target: string | null) {
      if (!idleOnly("forking")) return;
      const entry = target === null ? undefined : await entryOf(target);
      if (entry === null)
        return void info("This message cannot be forked.", "warning");
      const reply = await request<{ cancelled: boolean }>(
        "fork",
        entry === undefined ? {} : { entryId: entry },
      );
      if (!reply.ok || reply.data.cancelled) {
        return void info(
          reply.ok ? "omp cancelled the fork." : `Fork failed: ${reply.error}`,
          "warning",
        );
      }
      // 이 process가 새 file로 옮겨 갔다. 그 message 뒤는 새 session에 없다.
      if (target !== null) {
        const at = acp.items.findIndex((item) => item.id === target);
        const next = acp.items[at + 1];
        if (next !== undefined) hideFrom(target, next.id);
        userIds = userIds.slice(0, userIds.indexOf(target) + 1);
      }
      const from = st?.sessionName;
      await refresh();
      info(
        `Forked from “${from || "(untitled)"}”. The original session is unchanged.`,
      );
    }

    // --- goal ---
    async function setGoal(objective: string | null, paused: boolean) {
      const call = async (body: Record<string, unknown>) => {
        const reply = await request("goal", body);
        if (!reply.ok) info(`Goal: ${reply.error}`, "warning");
        return reply.ok;
      };
      if (objective === null) {
        if (goal !== null) await call({ op: "drop" });
      } else if (goal === null || goal.objective !== objective) {
        if (goal !== null && !(await call({ op: "drop" }))) return;
        await call({ op: "create", objective });
      } else await call({ op: paused ? "pause" : "resume" });
    }

    async function runCommand(name: string, argument: string) {
      lastCommand = name;
      if (TUI_ONLY.has(name)) {
        return void info(`/${name} works only in the omp TUI.`, "warning");
      }
      switch (name) {
        case "new":
        case "clear":
          return newSession();
        case "fork":
          return forkAt(null);
        case "branch":
        case "tree":
          return void info("Use rewind on a message to go back.");
        case "goal": {
          const word = argument.trim();
          if (word === "") {
            return void info(
              goal === null
                ? "No goal is set."
                : `Goal (${goal.status}): ${goal.objective}`,
            );
          }
          if (word === "drop") return setGoal(null, false);
          if (word === "pause" || word === "resume") {
            return goal === null
              ? void info("No goal is set.")
              : setGoal(goal.objective, word === "pause");
          }
          return setGoal(word, false);
        }
        default:
          await sendCommand(`/${name}${argument === "" ? "" : ` ${argument}`}`);
          await refresh();
      }
    }

    // 승인 mode는 시작 flag로만 정해진다. 같은 session을 새 mode로 다시 띄우고 ACP 상태는 그대로 둔다.
    // 안 만들어진 session(첫 메시지 전)은 `--resume`이 못 찾으니 새 session으로 띄운다.
    function restart(mode: string): Promise<void> {
      const run = (async () => {
        try {
          proc.end();
          const timer = setTimeout(() => proc.kill(), EXIT_WAIT_MS);
          await gone;
          clearTimeout(timer);
          approvalMode = mode;
          let launched = await connect(argsFor(cliSession, mode));
          if (launched === "exit" && cliSession !== null) {
            launched = await connect(argsFor(null, mode));
          }
          const failed =
            launched === "exit"
              ? "omp did not restart."
              : ((await handshake()) ?? "");
          if (failed !== "") {
            main.ensureTurn();
            main.endTurn("failed", {
              code: "unavailable",
              message: `${failed}${stderrTail === "" ? "" : `\n${stderrTail.trim()}`}`,
            });
            return;
          }
          await refresh();
        } finally {
          restarting = null;
        }
      })();
      restarting = run;
      return run;
    }

    async function handle(message: AcpInput) {
      switch (message.type) {
        case "send": {
          const text = textOf(message.content);
          if (text.startsWith("!") && text.slice(1).trim() !== "") {
            await bashCommand(text.slice(1).trim());
            return;
          }
          const slash = SLASH.exec(text.trim());
          if (slash?.[1] !== undefined && isCommand(slash[1])) {
            await runCommand(slash[1], slash[2]?.trim() ?? "");
            return;
          }
          const extra = await imagesOf(message.content);
          if (main.turn !== null) {
            const one: Queued = {
              id: message.id,
              content: message.content,
              text,
              kind: message.delivery === "steer" ? "steer" : "followUp",
            };
            queue.push(one);
            publish({
              type: "message_queued",
              queued: { id: one.id, at: now(), content: one.content },
            });
            const reply =
              one.kind === "steer"
                ? await request("prompt", {
                    message: text,
                    streamingBehavior: "steer",
                    ...extra,
                  })
                : await request("follow_up", { message: text, ...extra });
            if (!reply.ok) {
              queue.splice(queue.indexOf(one), 1);
              publish({ type: "message_removed", message: one.id });
              info(`omp did not take the message: ${reply.error}`, "warning");
            }
            return;
          }
          addUser(message.id, message.content);
          pendingEcho.push(text);
          await prompt(text, extra);
          return;
        }
        case "run_shell": {
          const command = message.command.trim();
          if (command !== "") await bashCommand(command);
          return;
        }
        case "open_session":
          return openSession(message.cli_session);
        case "stop":
          if (bashJobs > 0) void request("abort_bash");
          if (main.turn !== null) void request("abort");
          return;
        case "retry": {
          const text = turnText.get(message.turn);
          if (text === undefined || main.turn !== null) return;
          addUser(ids.newId("msg"), [{ type: "text", text }]);
          pendingEcho.push(text);
          await prompt(text, {});
          return;
        }
        case "decide":
          decide(message);
          return;
        case "answer":
          answer(message);
          return;
        case "send_queued": {
          const one = queue.find((entry) => entry.id === message.message);
          if (one === undefined || one.kind === "steer") return;
          const reply = await request<{ promoted: boolean }>(
            "promote_queued_message",
            { message: one.text },
          );
          if (reply.ok && reply.data.promoted) one.kind = "steer";
          return;
        }
        case "remove_queued": {
          const index = queue.findIndex((one) => one.id === message.message);
          const one = queue[index];
          if (one === undefined) return;
          const reply = await request<{ removed: boolean }>(
            "remove_queued_message",
            { message: one.text, queue: queueName(one) },
          );
          if (reply.ok && reply.data.removed) {
            queue.splice(queue.indexOf(one), 1);
            publish({ type: "message_removed", message: one.id });
          }
          return;
        }
        case "edit_queued": {
          const index = queue.findIndex((one) => one.id === message.message);
          const one = queue[index];
          if (one === undefined) return;
          // 줄 끝으로 간다(지우고 다시 넣는다).
          await requeue(index);
          queue.splice(index, 1);
          one.content = message.content;
          one.text = textOf(message.content);
          queue.push(one);
          await queueAdd(one);
          resendQueue();
          return;
        }
        case "move_queued": {
          const index = queue.findIndex((one) => one.id === message.message);
          const target = index + (message.direction === "up" ? -1 : 1);
          const moved = queue[index];
          const other = queue[target];
          if (moved === undefined || other === undefined) return;
          queue[index] = other;
          queue[target] = moved;
          await requeue(Math.min(index, target));
          resendQueue();
          return;
        }
        case "set_model": {
          const slash = message.model.indexOf("/");
          const current = st?.model;
          if (
            current === undefined ||
            `${current.provider}/${current.id}` !== message.model
          ) {
            const reply = await request("set_model", {
              provider: message.model.slice(0, slash),
              modelId: message.model.slice(slash + 1),
            });
            if (!reply.ok)
              return void info(
                `Could not switch the model: ${reply.error}`,
                "warning",
              );
            await readLevels();
          }
          const effort = message.options.effort;
          if (effort !== undefined && levels.includes(effort)) {
            await request("set_thinking_level", { level: effort });
          }
          const speed = message.options.speed;
          if (speed !== undefined && speed !== speedNow()) {
            await setSpeed(speed);
          }
          await refresh();
          return;
        }
        case "run_command":
          await runCommand(message.name, message.argument);
          return;
        case "compact": {
          if (main.turn !== null) return;
          main.ensureTurn();
          const reply = await request("compact");
          // 작은 session은 "Nothing to compact"로 거절한다(녹화로 확인했다). 실패한 turn이 아니라 알림이다.
          if (!reply.ok) info(`Compact: ${reply.error}`, "warning");
          main.endTurn("completed");
          await refresh();
          return;
        }
        case "rename": {
          const reply = await request("set_session_name", {
            name: message.title,
          });
          if (reply.ok) await refresh();
          else info(`Could not rename the session: ${reply.error}`, "warning");
          return;
        }
        case "rewind":
          return rewindTo(message.message);
        case "fork":
          return forkAt(message.message);
        case "set_mode": {
          if (
            !MODES.some((one) => one.id === message.mode) ||
            message.mode === currentMode() ||
            !idleOnly("changing the approval mode")
          ) {
            return;
          }
          await restart(message.mode);
          return;
        }
        case "stop_child":
        case "stop_task": {
          const reply = await request("cancel_subagent", {
            subagentId:
              message.type === "stop_child" ? message.child : message.task,
          });
          if (!reply.ok) info(`Could not stop it: ${reply.error}`, "warning");
          return;
        }
        case "steer_child": {
          const reply = await request("steer_subagent", {
            subagentId: message.child,
            message: message.text,
          });
          if (!reply.ok) info(`Could not steer it: ${reply.error}`, "warning");
          return;
        }
        case "set_goal":
          await setGoal(message.objective, message.paused);
          return;
        case "use_role": {
          const role = roles.find((one) => one.id === message.role);
          // `kind: "model"` role은 대화 model이 아니다. 설정 file에 쓰는 길은 두지 않는다.
          if (role === undefined || role.kind === "model") return;
          if (!idleOnly("switching roles")) return;
          lastCommand = "switch";
          await sendCommand(`/switch @${role.id}`);
          await refresh();
          return;
        }
      }
    }
    session.onInput(
      (message) =>
        void ready.then(async () => {
          while (restarting !== null) await restarting;
          await handle(message);
        }),
    );

    let stopped: Promise<void> | null = null;
    const run: HarnessGuiRun = {
      stop() {
        stopped ??= (async () => {
          await ready;
          while (restarting !== null) await restarting;
          if (exited) return;
          stopping = true;
          if (main.turn !== null) await request("abort");
          // toggle이 이 id로 TUI를 잇는다. branch·fork·`/new` 뒤에는 시작 때와 다르다.
          await readState();
          closed = true;
          // stdin을 닫으면 omp가 session을 닫고(lease를 놓는다) 끝난다. 안 끝나면 SIGTERM이다.
          proc.end();
          const timer = setTimeout(() => proc.kill(), EXIT_WAIT_MS);
          await gone;
          clearTimeout(timer);
        })();
        return stopped;
      },
      tuiCommand() {
        if (!hadModelTurn) {
          info(
            "omp has not saved this session yet (no model turn), so the terminal view starts a new session.",
          );
        }
        return `omp${cliSession === null || !hadModelTurn ? "" : ` --resume=${cliSession}`}${approvalMode === null ? "" : ` --approval-mode=${approvalMode}`}`;
      },
      async sessions() {
        return (await sessionFiles()).map(({ path: _, ...one }) => one);
      },
      sessionId: () => cliSession,
      running: () => ({
        turn: main.turn !== null,
        tasks: tasks.filter((one) => one.state === "running").length,
      }),
    };
    return { ok: true, value: run };
  };

export function createOmpAdapter(io: OmpIo): HarnessGuiAdapter {
  return {
    handoff: "restart",
    start: start(io),
    // TUI의 omp를 SIGTERM으로 끈다. Ctrl+D는 입력창이 비었을 때만 끝나고 사람이 바꿀 수 있다. SIGTERM은 TUI가 Ctrl+D와
    // 같은 정리(draft 저장, session 닫기)로 받는다. foreground가 끝난 뒤에야 resolve해서 한 session을 두 process가 같이 쥐지 않는다.
    exitTui(terminal) {
      return new Promise((resolve) => {
        if (terminal.state() === "shell")
          return resolve({ ok: true, value: undefined });
        const off = terminal.onForegroundExit(() => {
          off();
          resolve({ ok: true, value: undefined });
        });
        terminal.signal("SIGTERM");
      });
    },
  };
}

export const ompAdapter = createOmpAdapter({
  home: homedir(),
  readFile,
  readDir: readdir,
  async readHead(path, bytes) {
    const file = await open(path, "r");
    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await file.read(buffer, 0, bytes, 0);
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await file.close();
    }
  },
});
