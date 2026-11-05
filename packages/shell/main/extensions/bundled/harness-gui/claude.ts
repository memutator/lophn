// Claude Code adapter. Agent SDK `query()`(streaming input)로 사람의 `claude`를 띄우고, SDK 메시지를 ACP 갱신으로,
// 창의 ACP 입력을 SDK 호출로 옮긴다. 권한은 사람의 설정(`settingSources`)을 따르고 mode는 넘기지 않는다.
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import {
  getSessionMessages,
  query,
  type CanUseTool,
  type PermissionResult,
  type PermissionUpdate,
  type SDKUserMessage,
  type SpawnedProcess,
  type SpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";
import type { Result } from "../../../../../base/result.ts";
import type { AcpInput } from "../../../../../protocol/acp/input.ts";
import type {
  AcpApprovalItem,
  AcpToolItem,
} from "../../../../../protocol/acp/items.ts";
import type { AcpUpdate } from "../../../../../protocol/acp/state.ts";
import type { ContentBlock } from "../../../../../protocol/lophn-agent/content-block.ts";
import type { ExtensionProcess } from "../../../../../protocol/extensions/mod.ts";
import type { HarnessGuiAdapter } from "./adapter.ts";

export type ClaudeSdk = {
  query: typeof query;
  getSessionMessages: typeof getSessionMessages;
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
  parent_tool_use_id?: string | null;
  event?: {
    type: string;
    delta?: { type: string; text?: string; thinking?: string };
  };
  message?: { content?: string | Block[] };
  subtype?: string;
  is_error?: boolean;
  terminal_reason?: string;
  result?: string;
  errors?: string[];
};
type Question = {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
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

const oneLine = (text: string, max: number) =>
  text
    .replace(/\s*\n\s*/g, " ")
    .trim()
    .slice(0, max);
const lines = (text: unknown) =>
  typeof text === "string" && text !== "" ? text.split("\n").length : 0;
const str = (value: unknown) => (typeof value === "string" ? value : "");

const userMessage = (text: string): SDKUserMessage => ({
  type: "user",
  message: { role: "user", content: text },
  parent_tool_use_id: null,
});

// 앱 context(`resource` block)도 글로 넘긴다. 이미지는 blob hash뿐이라 넘기지 못한다.
const textOf = (content: ContentBlock[]) =>
  content
    .flatMap((block) =>
      block.type === "text" || block.type === "resource" ? [block.text] : [],
    )
    .join("\n");

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

// 이 session 동안 허락은 사람의 설정 file에 남기지 않는다(Bash 제안은 `localSettings`로 온다).
const sessionOnly = (suggestions: PermissionUpdate[] | undefined) =>
  (suggestions ?? []).map(
    (one): PermissionUpdate => ({ ...one, destination: "session" }),
  );

// 카드가 "이 session 동안"에서 무엇을 허락하는지 보이는 글이다.
function patternsOf(suggestions: PermissionUpdate[]): string[] {
  return suggestions
    .flatMap((one) =>
      one.type === "addRules"
        ? one.rules.map((rule) =>
            rule.ruleContent === undefined
              ? rule.toolName
              : `${rule.toolName}(${rule.ruleContent})`,
          )
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
  suggestions: PermissionUpdate[];
  call: Call;
  resolve(result: PermissionResult): void;
};
type QuestionWait = {
  input: Record<string, unknown>;
  call: Call;
  resolve(result: PermissionResult): void;
};

const start: (sdk: ClaudeSdk) => Start =
  (sdk) =>
  async ({ cwd, resume, session, spawn, clock, ids }) => {
    let seq = 0;
    let closed = false;
    let dead: { code: string; message: string } | null = null;
    let stderrTail = "";
    let spawnFailed = false;
    const now = () => clock.now();
    const publish = (update: AcpUpdate) => {
      if (!closed) session.publish(update);
    };

    const input = inputQueue();
    // turn: 도는 turn의 id. SDK는 turn 경계를 `result`로만 알린다.
    let turn: string | null = null;
    let modelCall: string | null = null;
    const streamed = { text: 0, reasoning: 0 };
    let reasoning = "";
    const calls = new Map<string, Call>();
    const queue: { id: string; at: string; content: ContentBlock[] }[] = [];
    const approvals = new Map<string, ApprovalWait>();
    const questions = new Map<string, QuestionWait>();

    function startTurn(): string {
      turn = ids.newId("trn");
      publish({ type: "turn_started", turn, at: now() });
      return turn;
    }
    const ensureTurn = () => turn ?? startTurn();

    function addUser(id: string, content: ContentBlock[], at: string) {
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
          turn: ensureTurn(),
          content,
          reasoning: null,
          cards: [],
          complete: true,
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

    function closeApproval(
      id: string,
      decision: "once" | "always" | "reject" | "cancelled",
      reason?: string,
    ) {
      const wait = approvals.get(id);
      if (wait === undefined) return;
      approvals.delete(id);
      const allowed = decision === "once" || decision === "always";
      if (allowed) {
        wait.resolve({
          behavior: "allow",
          updatedInput: wait.input,
          ...(decision === "always" && wait.suggestions.length > 0
            ? { updatedPermissions: wait.suggestions }
            : {}),
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
        const suggestions = sessionOnly(options.suggestions);
        approvals.set(request, {
          input: toolInput,
          suggestions,
          call,
          resolve,
        });
        options.signal.addEventListener(
          "abort",
          () => closeApproval(request, "cancelled"),
          { once: true },
        );
        publish({
          type: "approval_opened",
          approval: {
            id: request,
            subject: subjectOf(name, toolInput, options.description),
            choices:
              patternsOf(suggestions).length === 0
                ? ["once", "reject"]
                : ["once", "always", "reject"],
            always_patterns: patternsOf(suggestions),
          },
        });
      });

    function startNext() {
      const next = queue.shift();
      if (next === undefined) return;
      const id = startTurn();
      publish({
        type: "message_taken",
        message: next.id,
        seq: ++seq,
        delivery: "next_turn",
        turn: id,
      });
      input.push(userMessage(textOf(next.content)));
    }

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
      if (dead === null) startNext();
    }

    function onAssistant(content: Block[]) {
      for (const block of content) {
        if (block.type === "thinking") {
          reasoning += block.thinking ?? "";
        } else if (block.type === "text" && block.text) {
          publish({
            type: "message_recorded",
            turn: ensureTurn(),
            message: ids.newId("msg"),
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

    function onMessage(message: SdkMessage) {
      // subagent의 대화는 부모의 tool 줄(`Agent`) 하나로만 보인다.
      if (message.parent_tool_use_id) return;
      const content = message.message?.content;
      if (message.type === "stream_event" && message.event !== undefined) {
        onStream(message.event);
      } else if (message.type === "assistant" && Array.isArray(content)) {
        onAssistant(content);
      } else if (message.type === "user" && Array.isArray(content)) {
        onToolResults(content);
      } else if (message.type === "result" && turn !== null) {
        const ok = message.subtype === "success" && message.is_error !== true;
        const stopped = message.terminal_reason === "aborted_streaming";
        endTurn(
          ok ? "completed" : stopped ? "stopped" : "failed",
          ok || stopped
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
            onAssistant(blocks);
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
          addUser(ids.newId("msg"), [{ type: "text", text }], now());
        }
        if (turn !== null) endTurn("completed");
      } catch (cause) {
        endTurn("failed", {
          code: "internal",
          message: `Could not read the earlier conversation: ${cause instanceof Error ? cause.message : String(cause)}`,
        });
      }
    }

    const q = sdk.query({
      prompt: input,
      options: {
        cwd,
        // 사람 PATH의 `claude`. 번들 사본은 받지 않는다(root overrides).
        pathToClaudeCodeExecutable: "claude",
        settingSources: ["user", "project", "local"],
        systemPrompt: { type: "preset", preset: "claude_code" },
        includePartialMessages: true,
        canUseTool,
        ...(resume === undefined ? {} : { resume }),
        spawnClaudeCodeProcess(options: SpawnOptions) {
          const proc = spawn(options.command, options.args, {
            ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
            env: Object.fromEntries(
              Object.entries(options.env).flatMap(([key, value]) =>
                value === undefined ? [] : [[key, value]],
              ),
            ),
          });
          proc.onStderr((text) => {
            stderrTail = (stderrTail + text).slice(-500);
          });
          spawnFailed = proc.pid === undefined;
          return spawned(proc);
        },
      },
    });
    // SDK가 query() 안에서 바로 process를 띄운다.
    if (spawnFailed) {
      q.close();
      return {
        ok: false,
        error: {
          code: "unavailable",
          message: "`claude` was not found on PATH.",
        },
      } satisfies Result<never>;
    }

    const failure = (reason: string) => {
      dead = {
        code: "unavailable",
        message: stderrTail === "" ? reason : `${reason}\n${stderrTail.trim()}`,
      };
      endTurn("failed", dead);
    };
    void (async () => {
      try {
        for await (const message of q) {
          if (!closed) onMessage(message as unknown as SdkMessage);
        }
        if (!closed) failure("claude exited.");
      } catch (cause) {
        if (!closed)
          failure(cause instanceof Error ? cause.message : String(cause));
      }
    })();

    const ready = resume === undefined ? Promise.resolve() : replay(resume);

    function resendQueue() {
      for (const one of queue)
        publish({ type: "message_removed", message: one.id });
      for (const one of queue) publish({ type: "message_queued", queued: one });
    }

    function handle(message: AcpInput) {
      switch (message.type) {
        case "send": {
          if (turn !== null) {
            const queued = {
              id: message.id,
              at: now(),
              content: message.content,
            };
            queue.push(queued);
            publish({ type: "message_queued", queued });
            return;
          }
          addUser(message.id, message.content, now());
          if (dead === null) input.push(userMessage(textOf(message.content)));
          else endTurn("failed", dead);
          return;
        }
        case "stop":
          if (turn !== null) void q.interrupt().catch(() => {});
          return;
        case "decide":
          closeApproval(
            message.request,
            // 아직 session 범위를 따로 내지 않는다. 이 CLI의 always가 그 session 동안이다.
            message.choice.kind === "session" ? "always" : message.choice.kind,
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
          resendQueue();
          return;
        }
        // retry와 send_queued(실행 중인 turn에 끼워 넣기)는 SDK에 같은 동작이 없다.
        default:
          return;
      }
    }
    session.onInput((message) => void ready.then(() => handle(message)));

    return {
      ok: true,
      value: {
        async stop() {
          closed = true;
          for (const wait of approvals.values())
            wait.resolve({ behavior: "deny", message: DENIED });
          for (const wait of questions.values())
            wait.resolve({ behavior: "deny", message: DENIED });
          input.end();
          q.close();
        },
        // 아래 셋은 계약 stub이다. 실제 값은 handoff 길이 채운다.
        tuiCommand: () => "claude",
        sessionId: () => null,
        running: () => ({ turn: false, tasks: 0 }),
      },
    };
  };

export function createClaudeAdapter(sdk: ClaudeSdk): HarnessGuiAdapter {
  return {
    handoff: "restart",
    start: start(sdk),
    exitTui: () =>
      Promise.resolve({
        ok: false,
        error: {
          code: "unavailable",
          message: "exitTui is not implemented yet",
        },
      }),
  };
}

export const claudeAdapter = createClaudeAdapter({ query, getSessionMessages });
