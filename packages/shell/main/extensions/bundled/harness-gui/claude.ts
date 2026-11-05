// Claude Code adapter. Agent SDK `query()`(streaming input)로 사람의 `claude`를 띄우고, SDK 메시지를 ACP 갱신으로,
// 창의 ACP 입력을 SDK 호출로 옮긴다. 권한은 사람의 설정(`settingSources`)을 따르고 처음 띄울 때 mode는 넘기지 않는다.
// 사람 메시지마다 uuid를 붙여 CLI의 `command_lifecycle`(queued·started·completed·cancelled)과 짝짓는다: 줄(queue)은
// CLI가 쥐고 adapter는 어느 메시지가 줄에 있는지만 안다. rewind·fork로 query를 다시 열 때는 `carry`(model, effort, mode,
// 이 session 동안의 허락)를 옵션으로 다시 넣는다.
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { PassThrough, Writable } from "node:stream";
import {
  forkSession,
  getSessionMessages,
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
import type {
  AcpApprovalItem,
  AcpEntry,
  AcpToolItem,
} from "../../../../../protocol/acp/items.ts";
import {
  EMPTY_ACP_STATE,
  reduceAcp,
} from "../../../../../protocol/acp/reduce.ts";
import type {
  AcpCapabilities,
  AcpModelGroup,
  AcpSessionMeta,
  AcpUsage,
} from "../../../../../protocol/acp/session.ts";
import type { AcpState, AcpUpdate } from "../../../../../protocol/acp/state.ts";
import type { ContentBlock } from "../../../../../protocol/lophn-agent/content-block.ts";
import type {
  AcpTerminal,
  ExtensionProcess,
} from "../../../../../protocol/extensions/mod.ts";
import type { HarnessGuiAdapter } from "./adapter.ts";

/** adapter가 밖에 기대는 것. test가 가짜로 바꾼다. */
export type ClaudeSdk = {
  query: typeof query;
  getSessionMessages: typeof getSessionMessages;
  forkSession: typeof forkSession;
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
  status?: string | null;
  compact_result?: string;
  compact_error?: string;
  compact_metadata?: { pre_tokens: number; post_tokens?: number };
  content?: string;
  commands?: SlashCommand[];
  tasks?: { task_id: string }[];
  description?: string;
  summary?: string;
  attempt?: number;
  max_retries?: number;
  tool_name?: string;
  rate_limit_info?: { status: string; rateLimitType?: string };
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
const EDIT_TOOLS = ["Write", "Edit"];
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
// bypassPermissions는 어떤 길로도 쓰지 않는다. 그 밖의 mode(dontAsk 등)는 다시 열 때 넘기지 않는다.
const PASSABLE_MODES: ReadonlySet<string> = new Set(MODES.map(([id]) => id));
// 사람이 TUI에서 쓰는 것과 같은 capability다. `sessions`는 lophn session 목록이라 harness는 꺼 둔다.
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
};

const oneLine = (text: string, max: number) =>
  text
    .replace(/\s*\n\s*/g, " ")
    .trim()
    .slice(0, max);
const lines = (text: unknown) =>
  typeof text === "string" && text !== "" ? text.split("\n").length : 0;
const str = (value: unknown) => (typeof value === "string" ? value : "");
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

function detailOf(
  cwd: string,
  name: string,
  input: Record<string, unknown>,
): AcpToolItem["detail"] {
  if (name === "AskUserQuestion") {
    return { kind: "question", group: null, outcome: null, lines: [] };
  }
  const path = str(input.file_path);
  if (!EDIT_TOOLS.includes(name) || path === "") return { kind: "generic" };
  const edit = name === "Edit";
  return {
    kind: "edit",
    document: path,
    path: relative(cwd, path),
    added: lines(edit ? input.new_string : input.content),
    removed: edit ? lines(input.old_string) : 0,
  };
}

// "이 session 동안" 허락은 사람의 설정 file에 남기지 않는다(Bash 제안은 `localSettings`로 온다).
const sessionOnly = (suggestions: PermissionUpdate[]) =>
  suggestions.map(
    (one): PermissionUpdate => ({ ...one, destination: "session" }),
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
  name: string,
  input: Record<string, unknown>,
  description: string | undefined,
): AcpApprovalItem["subject"] {
  const command = str(input.command);
  if (name === "Bash" && command !== "") return { kind: "shell", command };
  if (name === "ExitPlanMode") {
    return {
      kind: "mcp_tool",
      server: "claude",
      tool: `ExitPlanMode: ${oneLine(str(input.plan), 200)}`,
      effect: "external",
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
    effect: EDIT_TOOLS.includes(name)
      ? "write"
      : category === "read" || category === "list" || category === "search"
        ? "read"
        : "external",
  };
}

function modelGroups(models: ModelInfo[]): AcpModelGroup[] {
  return [
    {
      id: "claude",
      label: "Claude",
      models: models.map((one) => ({
        id: one.value,
        label: one.displayName,
        axes:
          one.supportsEffort && one.supportedEffortLevels !== undefined
            ? [
                {
                  id: "effort",
                  label: "Effort",
                  values: one.supportedEffortLevels.map((value) => ({
                    value,
                    label: value,
                  })),
                },
              ]
            : [],
      })),
    },
  ];
}

type Call = {
  id: string;
  done: boolean;
  denied: boolean;
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
    let seq = 0;
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

    // turn: 도는 turn의 id. SDK는 turn 경계를 `result`로만 알린다.
    let turn: string | null = null;
    let modelCall: string | null = null;
    const streamed = { text: 0, reasoning: 0 };
    let reasoning = "";
    let stopping = false;
    const calls = new Map<string, Call>();
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

    // query를 다시 열 때 넘기는 것과 TUI로 넘길 때의 flag.
    const carry: {
      model: string | null;
      effort: string | null;
      mode: string | null;
      rules: Set<string>;
      dirs: Set<string>;
    } = {
      model: null,
      effort: null,
      mode: null,
      rules: new Set(),
      dirs: new Set(),
    };
    let cliSession = resume ?? uuidOf(ids);
    let models: ModelInfo[] = [];
    let modelId: string | null = null; // 지금 model의 resolved id
    let shownModel: string | null = null; // 사람이 고른 model row의 value
    let rawCommands: SlashCommand[] = [];
    let terminalCommands = new Set<string>();
    const tasks = new Set<string>();
    const totals = { input: 0, output: 0, read: 0, write: 0, turns: 0 };
    let contextUsage: { tokens: number; limit: number } | null = null;
    let cost = { base: 0, last: 0 };

    // --- ACP session meta ---------------------------------------------------------------------
    const changed = (meta: Partial<AcpSessionMeta>) =>
      publish({ type: "session_changed", session: meta });

    function currentModel(): AcpSessionMeta["model"] {
      const rows = models.filter(
        (one) => one.value === shownModel || one.resolvedModel === modelId,
      );
      const row =
        rows.find((one) => one.value === shownModel) ??
        (modelId === null ? undefined : rows[0]);
      if (row === undefined) return null;
      return {
        model: row.value,
        label: row.displayName,
        options: carry.effort === null ? {} : { effort: carry.effort },
        layer: null,
      };
    }
    const publishModels = () =>
      changed({ models: modelGroups(models), model: currentModel() });
    function publishCommands() {
      changed({
        commands: rawCommands
          .filter((one) => !terminalCommands.has(one.name))
          .map((one) => ({
            name: one.name,
            description: one.description,
            argument_hint: one.argumentHint === "" ? null : one.argumentHint,
            source: one.builtin === true ? "cli" : "skill",
          })),
      });
    }
    function usageNow(): AcpUsage {
      return {
        context: contextUsage,
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
        const usage = await live.q.getContextUsage({ detail: "summary" });
        contextUsage = { tokens: usage.totalTokens, limit: usage.maxTokens };
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
    function startTurn(): string {
      turn = ids.newId("trn");
      publish({ type: "turn_started", turn, at: now() });
      return turn;
    }
    const ensureTurn = () => turn ?? startTurn();

    function addUser(
      id: string,
      content: ContentBlock[],
      at: string,
      uuid: string,
    ) {
      const turnId = ensureTurn();
      uuidOfMessage.set(id, uuid);
      contentOfMessage.set(id, content);
      userOfTurn.set(turnId, id);
      publish({
        type: "message_added",
        item: {
          kind: "message",
          id,
          seq: ++seq,
          at,
          actor: "user",
          sender: null,
          call: null,
          reply_to: null,
          delivery: "next_turn",
          turn: turnId,
          content,
          reasoning: null,
          cards: [],
          complete: true,
        },
      });
    }

    function info(text: string) {
      if (turn === null) return;
      publish({
        type: "notice_added",
        item: {
          kind: "notice",
          id: ids.newId("not"),
          seq: ++seq,
          at: now(),
          turn,
          notice: { type: "info", text: text.trim().slice(0, 8000) },
        },
      });
    }

    function toolStart(
      useId: string,
      name: string,
      toolInput: Record<string, unknown>,
    ): Call {
      const known = calls.get(useId);
      if (known !== undefined) return known;
      const call: Call = { id: ids.newId("tcl"), done: false, denied: false };
      calls.set(useId, call);
      const summary = summaryOf(cwd, toolInput);
      publish({
        type: "tool_started",
        item: {
          kind: "tool",
          id: call.id,
          seq: ++seq,
          at: now(),
          turn: ensureTurn(),
          tool: name,
          category: CATEGORIES[name] ?? "other",
          title: summary === "" ? name : `${name} ${summary}`,
          state: "running",
          duration_ms: null,
          detail: detailOf(cwd, name, toolInput),
        },
      });
      return call;
    }

    function toolEnd(
      call: Call,
      state: "ok" | "error" | "denied" | "cancelled",
    ) {
      call.done = true;
      const asked = call.question;
      publish({
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
      decision: "once" | "session" | "always" | "reject" | "cancelled",
      reason?: string,
    ) {
      const wait = approvals.get(id);
      if (wait === undefined) return;
      approvals.delete(id);
      const allowed =
        decision === "once" || decision === "session" || decision === "always";
      if (allowed) {
        // ExitPlanMode는 고른 범위가 plan 뒤 mode다: 한 번은 편집을 묻고, 이 session 동안은 편집을 받는다.
        const updates: PermissionUpdate[] = wait.plan
          ? [
              {
                type: "setMode",
                mode: decision === "session" ? "acceptEdits" : "default",
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
        choice: allowed ? decision : null,
        reason: reason ?? null,
        seq: ++seq,
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
        const call = toolStart(options.toolUseID, name, toolInput);
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
            subject: subjectOf(name, toolInput, options.description),
            choices: plan
              ? ["once", "session", "reject"]
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
    function endTurn(
      outcome: "completed" | "stopped" | "failed",
      error?: { code: string; message: string },
    ) {
      const id = turn ?? ids.newId("trn");
      for (const request of [...approvals.keys()])
        closeApproval(request, "cancelled");
      for (const toolCall of [...questions.keys()])
        closeQuestion(toolCall, null);
      for (const call of calls.values())
        if (!call.done) toolEnd(call, "cancelled");
      calls.clear();
      reasoning = "";
      stopping = false;
      publish({
        type: "turn_ended",
        turn: id,
        at: now(),
        outcome,
        active_ms: null,
        error: error ?? null,
        messages: [],
        seq: ++seq,
      });
      turn = null;
    }

    function onAssistant(message: SdkMessage, content: Block[]) {
      if (message.local_command_run !== undefined) {
        // `/context` 같은 명령의 출력이다. 보이지 않는 명령이거나 turn이 없으면 버린다.
        info(content.map((block) => block.text ?? "").join("\n"));
        return;
      }
      for (const block of content) {
        if (block.type === "thinking") {
          reasoning += block.thinking ?? "";
        } else if (block.type === "text" && block.text) {
          const id = ids.newId("msg");
          if (message.uuid !== undefined) uuidOfMessage.set(id, message.uuid);
          publish({
            type: "message_recorded",
            turn: ensureTurn(),
            message: id,
            model_call: modelCall,
            seq: ++seq,
            at: now(),
            body: {
              content: [{ type: "text", text: block.text }],
              reasoning:
                reasoning === ""
                  ? null
                  : { text: reasoning, duration_ms: null },
              cards: [],
            },
          });
          reasoning = "";
        } else if (block.type === "tool_use" && block.id && block.name) {
          toolStart(block.id, block.name, block.input ?? {});
        }
      }
    }

    function onToolResults(content: Block[]) {
      for (const block of content) {
        const call =
          block.type === "tool_result"
            ? calls.get(block.tool_use_id ?? "")
            : undefined;
        if (call === undefined || call.done) continue;
        toolEnd(
          call,
          block.is_error !== true ? "ok" : call.denied ? "denied" : "error",
        );
      }
    }

    function onStream(event: NonNullable<SdkMessage["event"]>) {
      if (event.type === "message_start") {
        modelCall = ids.newId("mcl");
        streamed.text = 0;
        streamed.reasoning = 0;
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
      modelCall ??= ids.newId("mcl");
      publish({
        type: "writing_streamed",
        turn: ensureTurn(),
        model_call: modelCall,
        kind,
        offset: streamed[kind],
        text,
        at: now(),
      });
      streamed[kind] += text.length;
    }

    // 줄에 있던 메시지를 CLI가 가져갔다: 쉬는 중이면 새 turn이고, 도는 turn이면 steer로 끼어든 것이다.
    function onStarted(uuid: string) {
      const message = queued.get(uuid);
      if (message === undefined) return;
      queued.delete(uuid);
      uuidOfMessage.set(message.id, uuid);
      contentOfMessage.set(message.id, message.content);
      const steer = turn !== null;
      const id = turn ?? startTurn();
      userOfTurn.set(id, message.id);
      publish({
        type: "message_taken",
        message: message.id,
        seq: ++seq,
        delivery: steer ? "steer" : "next_turn",
        turn: steer ? null : id,
      });
    }

    function onResult(message: SdkMessage) {
      const user = message.user_message_uuid;
      if (user !== undefined && silent.delete(user)) return;
      const usage = message.usage;
      totals.input += usage?.input_tokens ?? 0;
      totals.output += usage?.output_tokens ?? 0;
      totals.read += usage?.cache_read_input_tokens ?? 0;
      totals.write += usage?.cache_creation_input_tokens ?? 0;
      totals.turns += 1;
      cost.last = message.total_cost_usd ?? cost.last;
      if (turn !== null) {
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
    }

    function onSystem(message: SdkMessage) {
      switch (message.subtype) {
        case "init": {
          if (message.session_id && message.session_id !== cliSession) {
            cliSession = message.session_id;
            changed({ cli_session: cliSession });
          }
          if (message.terminal_slash_commands !== undefined) {
            terminalCommands = new Set(message.terminal_slash_commands);
            publishCommands();
          }
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
          info(message.content ?? "");
          return;
        case "commands_changed":
          rawCommands = message.commands ?? rawCommands;
          publishCommands();
          return;
        case "api_retry":
          info(
            `Retrying the request (${message.attempt ?? "?"}/${message.max_retries ?? "?"})`,
          );
          return;
        case "permission_denied":
          info(
            `Permission denied for ${message.tool_name ?? "a tool"}: ${(message as { message?: unknown }).message ?? ""}`,
          );
          return;
        case "background_tasks_changed":
          tasks.clear();
          for (const one of message.tasks ?? []) tasks.add(one.task_id);
          return;
        case "task_started":
          info(`Started: ${message.description ?? ""}`);
          return;
        case "task_notification":
          info(
            `${message.summary ?? "A background task"} (${message.status ?? "done"})`,
          );
          return;
        default:
          return;
      }
    }

    function onMessage(message: SdkMessage) {
      // subagent의 대화는 부모의 tool 줄(`Agent`) 하나로만 보인다.
      if (message.parent_tool_use_id) return;
      const content = message.message?.content;
      switch (message.type) {
        case "stream_event":
          if (message.event !== undefined) onStream(message.event);
          return;
        case "assistant":
          if (Array.isArray(content)) onAssistant(message, content);
          return;
        case "user":
          if (Array.isArray(content)) {
            onToolResults(content);
          } else if (message.isReplay && typeof content === "string") {
            // 명령이 되돌려 주는 `<local-command-stdout>` 글이다. `/compact`는 compact_boundary가 따로 알린다.
            const text = content.replace(/<\/?local-command-stdout>/g, "");
            if (!text.startsWith("Compacted")) info(text);
          }
          return;
        case "result":
          onResult(message);
          return;
        case "rate_limit_event":
          if (message.rate_limit_info?.status !== "allowed")
            info(
              `Rate limit ${message.rate_limit_info?.status ?? ""} (${message.rate_limit_info?.rateLimitType ?? ""})`,
            );
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
    async function replay(id: string) {
      try {
        for (const message of await sdk.getSessionMessages(id, { dir: cwd })) {
          if (message.parent_tool_use_id) continue;
          const raw =
            (message.message as { content?: string | Block[] }).content ?? [];
          const blocks: Block[] =
            typeof raw === "string" ? [{ type: "text", text: raw }] : raw;
          if (message.type === "assistant") {
            onAssistant({ type: "assistant", uuid: message.uuid }, blocks);
            continue;
          }
          const text = blocks
            .flatMap((block) =>
              block.type === "text" && block.text ? [block.text] : [],
            )
            .join("\n");
          if (text === "") {
            onToolResults(blocks);
            continue;
          }
          if (turn !== null) endTurn("completed");
          addUser(
            ids.newId("msg"),
            [{ type: "text", text }],
            now(),
            message.uuid,
          );
        }
        if (turn !== null) endTurn("completed");
      } catch (cause) {
        endTurn("failed", {
          code: "internal",
          message: `Could not read the earlier conversation: ${cause instanceof Error ? cause.message : String(cause)}`,
        });
      }
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
      if (turn !== null) endTurn("stopped");
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
      live = open(from);
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
    ): SDKUserMessage {
      return {
        type: "user",
        message: { role: "user", content },
        parent_tool_use_id: null,
        uuid: uuid as SDKUserMessage["uuid"],
        ...(priority === undefined ? {} : { priority }),
      } as SDKUserMessage;
    }

    async function sendText(
      id: string,
      content: ContentBlock[],
      delivery: "next_turn" | "steer" = "next_turn",
    ) {
      if (dead !== null) {
        addUser(id, content, now(), uuidOf(ids));
        endTurn("failed", dead);
        return;
      }
      const uuid = uuidOf(ids);
      const body = await contentOf(sdk, content);
      if (turn === null) {
        addUser(id, content, now(), uuid);
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
      const id = ids.newId("msg");
      await sendText(id, [{ type: "text", text }]);
    }

    async function setEffort(level: string) {
      carry.effort = level;
      const uuid = uuidOf(ids);
      silent.add(uuid);
      live.input.push(userMessage(uuid, `/effort ${level}`, "later"));
    }

    async function setModel(model: string, effort: string | undefined) {
      carry.model = model;
      try {
        await live.q.setModel(model);
        shownModel = model;
      } catch {
        // 지금 process가 거절했다. 다음에 띄울 때 쓰도록 기억만 해 두고 지금 값을 다시 보인다.
      }
      if (effort !== undefined && effort !== carry.effort)
        await setEffort(effort);
      changed({ model: currentModel() });
    }

    // transcript에서 사람 메시지 `uuid`의 앞(또는 그 turn의 끝) assistant 메시지 uuid.
    async function assistantAround(
      uuid: string,
      where: "before" | "turn_end",
    ): Promise<string | undefined> {
      const list = await sdk.getSessionMessages(cliSession, { dir: cwd });
      const at = list.findIndex((one) => one.uuid === uuid);
      if (at < 0) return undefined;
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

    async function rewind(message: string, files: boolean) {
      const uuid = uuidOfMessage.get(message);
      if (uuid === undefined) return;
      if (turn !== null) {
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
      const before = await assistantAround(uuid, "before");
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
    }

    async function fork(message: string | null) {
      const target = message === null ? undefined : uuidOfMessage.get(message);
      if (message !== null && target === undefined) return;
      const upTo =
        target === undefined
          ? undefined
          : await assistantAround(target, "turn_end");
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
    }

    async function handle(message: AcpInput) {
      switch (message.type) {
        case "send":
          await sendText(message.id, message.content, message.delivery);
          return;
        case "stop":
          if (turn !== null) {
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
          if (turn !== null) stopping = true;
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
          await setModel(message.model, message.options.effort);
          return;
        case "set_mode":
          await live.q.setPermissionMode(
            message.mode as Parameters<Query["setPermissionMode"]>[0],
          );
          setMode(message.mode);
          return;
        case "run_command":
          await sendCommand(
            `/${message.name}${message.argument === "" ? "" : ` ${message.argument}`}`,
          );
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
            if (turn !== null) {
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
            "--resume",
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
          ];
          return `claude ${flags.join(" ")}`;
        },
        sessionId: () => cliSession,
        running: () => ({ turn: turn !== null, tasks: tasks.size }),
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
  forkSession,
  renameSession,
  readFile,
});
