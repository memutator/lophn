// omp adapter. 사람 PATH의 `omp --mode rpc-ui`를 stdio로 띄워 RPC 줄(JSON 한 줄씩, JSON-RPC가 아니다)을 ACP 갱신으로,
// 창의 ACP 입력을 RPC 명령으로 옮긴다. 승인 mode는 넘기지 않는다(사람 설정. 설정이 없으면 yolo라 승인 카드가 뜨지 않는다).
// 판은 사람 기계의 18.8.7에 맞춘다: plan mode와 승인 mode를 바꾸는 RPC, 승인의 "이 session 동안" 선택지가 없다.
import { readFile } from "node:fs/promises";
import type { AcpInput } from "../../../../../protocol/acp/input.ts";
import type {
  AcpEntry,
  AcpHiddenItem,
  AcpToolItem,
} from "../../../../../protocol/acp/items.ts";
import {
  EMPTY_ACP_STATE,
  reduceAcp,
} from "../../../../../protocol/acp/reduce.ts";
import type {
  AcpSessionMeta,
  AcpUsage,
} from "../../../../../protocol/acp/session.ts";
import type { AcpState, AcpUpdate } from "../../../../../protocol/acp/state.ts";
import type { ContentBlock } from "../../../../../protocol/lophn-agent/content-block.ts";
import type { HarnessGuiAdapter, HarnessGuiRun } from "./adapter.ts";

type Start = HarnessGuiAdapter["start"];

/** adapter가 파일 시스템에 닿는 길(이미지 첨부를 읽는다). test가 바꾼다. */
export type OmpIo = { readFile(path: string): Promise<Uint8Array> };

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
  toolCallId?: string;
  isError?: boolean;
};
type Model = {
  id: string;
  provider: string;
  name?: string;
  reasoning?: boolean;
};
type Todo = { name: string; tasks: { content: string; status: string }[] };
type State = {
  sessionId: string;
  sessionName?: string;
  model?: Model;
  thinkingLevel?: string;
  todoPhases?: Todo[];
  contextUsage?: { tokens?: number | null; contextWindow?: number | null };
};
type Command = {
  name: string;
  description?: string;
  input?: { hint?: string };
};
type AskQuestion = {
  id: string;
  question: string;
  header?: string;
  options: { label: string; description?: string }[];
  multi?: boolean;
  recommended?: number;
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
  text?: string;
  attempt?: number;
  maxAttempts?: number;
  errorMessage?: string;
  finalError?: string;
  from?: string;
  to?: string;
  aborted?: boolean;
  skipped?: boolean;
  payload?: {
    id: string;
    agent: string;
    description?: string;
    status: string;
  };
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

// biome-ignore lint/suspicious/noControlCharactersInRegex: 터미널 색 escape를 지운다.
const ANSI = /\u001b\[[0-9;]*m/g;
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
  done: boolean;
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

const start: (io: OmpIo) => Start =
  (io) =>
  async ({ cwd, resume, session, spawn, clock, ids }) => {
    let seq = 0;
    let closed = false;
    let exited = false;
    let stopping = false;
    let stderrTail = "";
    const now = () => clock.now();
    // hidden(rewind)이 숨길 항목을 알아야 해서 낸 갱신을 접어 둔다.
    let acp: AcpState = EMPTY_ACP_STATE;
    const publish = (update: AcpUpdate) => {
      if (closed) return;
      acp = reduceAcp(acp, update);
      session.publish(update);
    };

    const proc = spawn(
      "omp",
      [
        "--mode",
        "rpc-ui",
        `--cwd=${cwd}`,
        ...(resume === undefined ? [] : [`--resume=${resume}`]),
      ],
      { cwd },
    );
    proc.onStderr((text) => {
      stderrTail = (stderrTail + text).slice(-500);
    });
    const write = (body: Record<string, unknown>) =>
      proc.write(`${JSON.stringify(body)}\n`);

    // --- 요청과 답 ---
    let counter = 0;
    const waiting = new Map<string, (reply: Reply<unknown>) => void>();
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
    let turn: string | null = null;
    let lastTurn: string | null = null;
    const turnText = new Map<string, string>();
    // prompt id → 그 prompt를 보낸 turn. 늦게 온 prompt_result가 다음 turn을 끝내지 않게 한다.
    const promptTurn = new Map<string, string>();
    const streams = new Map<
      string,
      { call: string; text: number; thinking: number }
    >();
    const calls = new Map<string, Call>();
    const subagents = new Map<string, { call: string; done: boolean }>();
    const queue: Queued[] = [];
    // 창이 낸 사람 메시지가 omp에서 되돌아오는 글. 겹쳐 내지 않으려고 거른다.
    let pendingEcho: string[] = [];
    // ACP 사람 메시지 id, 대화 순서대로. rewind·fork가 omp entry와 같은 자리로 짝짓는다.
    let userIds: string[] = [];
    // omp는 `ask`의 질문(`extension_ui_request`)을 그 tool의 `tool_execution_start`보다 먼저 보낸다(녹화로 확인했다).
    // tool 줄이 아직 없으면 질문이 쓴 id를 기억했다가 그 줄을 같은 id로 연다.
    let askAhead: { id: string; group: string; asked: AskQuestion[] } | null =
      null;
    let dialogs: Dialog[] = [];
    let open: Dialog | null = null;
    let cliSession: string | null = null;
    let st: State | null = null;
    let models: Model[] = [];
    let levels: string[] = [];
    let commands: Command[] = [];
    let todoJson = "";

    function startTurn(): string {
      const id = ids.newId("trn");
      turn = id;
      lastTurn = id;
      publish({ type: "turn_started", turn: id, at: now() });
      return id;
    }
    const ensureTurn = () => turn ?? startTurn();

    // 명령 출력은 터미널 색 escape를 달고 오고 길 수 있다.
    function info(raw: string) {
      const text = raw.replace(ANSI, "").slice(0, 4000);
      publish({
        type: "notice_added",
        item: {
          kind: "notice",
          id: ids.newId("msg"),
          seq: ++seq,
          at: now(),
          turn: turn ?? lastTurn ?? ids.newId("trn"),
          notice: { type: "info", text },
        },
      });
    }

    function addUser(id: string, content: ContentBlock[]) {
      userIds.push(id);
      const text = textOf(content);
      const mine = ensureTurn();
      turnText.set(mine, text);
      publish({
        type: "message_added",
        item: {
          kind: "message",
          id,
          seq: ++seq,
          at: now(),
          actor: "user",
          sender: null,
          call: null,
          reply_to: null,
          delivery: "next_turn",
          turn: mine,
          content,
          reasoning: null,
          cards: [],
          complete: true,
        },
      });
    }

    function recordAssistant(msg: Msg, modelCall: string | null) {
      const text = joined(msg.content, "text");
      const thinking = joined(msg.content, "thinking");
      if (text === "" && thinking === "") return;
      publish({
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

    // --- 세션 정보 ---
    const usageOf = (state: State): AcpUsage | null => {
      const usage = state.contextUsage;
      const tokens = usage?.tokens;
      const limit = usage?.contextWindow;
      return typeof tokens === "number" && typeof limit === "number"
        ? {
            context: { tokens, limit },
            input_tokens: null,
            output_tokens: null,
            cache_read_tokens: null,
            cache_write_tokens: null,
            turns: null,
            costs: [],
            provider: null,
          }
        : null;
    };

    function meta(): AcpSessionMeta {
      const axis = {
        id: "effort",
        label: "Thinking",
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
      return {
        title: st?.sessionName ?? null,
        cli_session: cliSession,
        capabilities: {
          model: true,
          effort: true,
          mode: false,
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
        },
        models: [...groups].map(([provider, list]) => ({
          id: provider,
          label: provider,
          models: list.map((model) => ({
            id: `${model.provider}/${model.id}`,
            label: model.name ?? model.id,
            // 단계 목록은 지금 model의 것이다. 다른 model이 같은 단계를 갖는지는 골라 봐야 안다.
            axes:
              model.reasoning === false || levels.length === 0 ? [] : [axis],
          })),
        })),
        model:
          current === undefined
            ? null
            : {
                model: `${current.provider}/${current.id}`,
                label: current.name ?? current.id,
                options:
                  st?.thinkingLevel === undefined
                    ? {}
                    : { effort: st.thinkingLevel },
                layer: null,
              },
        modes: [],
        mode: null,
        commands: commands.map((one) => ({
          name: one.name,
          description: one.description ?? "",
          argument_hint: one.input?.hint ?? null,
          source: "cli" as const,
        })),
        usage: st === null ? null : usageOf(st),
      };
    }

    const publishMeta = () =>
      publish({ type: "session_changed", session: meta() });

    async function readState() {
      const reply = await request<State>("get_state");
      if (!reply.ok) return;
      st = reply.data;
      cliSession = st.sessionId;
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
                  : task.status === "completed" || task.status === "abandoned"
                    ? ("completed" as const)
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
    async function refresh() {
      await Promise.all([readState(), readLevels()]);
      publishMeta();
    }

    // --- tool ---
    function toolStart(
      id: string,
      name: string,
      args: Record<string, unknown>,
    ) {
      const known = calls.get(id);
      if (known !== undefined) return known;
      const call: Call = { id: ids.newId("tcl"), name, args, done: false };
      if (name === "ask" && askAhead !== null) {
        call.id = askAhead.id;
        call.question = {
          group: askAhead.group,
          asked: askAhead.asked,
          answers: [],
        };
        askAhead = null;
      }
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
          detail:
            name === "ask"
              ? {
                  kind: "question",
                  group: call.question?.group ?? null,
                  outcome: null,
                  lines: [],
                }
              : EDIT_TOOLS.includes(name) && path !== ""
                ? {
                    kind: "edit",
                    document: path,
                    path: relative(cwd, path),
                    added: lines(args.content),
                    removed: 0,
                  }
                : { kind: "generic" },
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
                lines: asked.asked.map((one, index) => ({
                  header: one.header ?? oneLine(one.question, 24),
                  answer: asked.answers[index]?.join(", ") ?? null,
                })),
              },
      });
    }

    function onToolEnd(frame: Frame) {
      const call = calls.get(frame.toolCallId ?? "");
      if (call === undefined || call.done) return;
      const text = (frame.result?.content ?? [])
        .map((block) => block.text ?? "")
        .join("");
      toolEnd(
        call,
        frame.isError !== true
          ? "ok"
          : text.startsWith(DENIED)
            ? "denied"
            : "error",
      );
      if (call.name === "todo") void readState();
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
          seq: ++seq,
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
          info(note);
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
        const call = [...calls.values()]
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
          ? [...calls.values()]
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
      // 영구 규칙(`always`)은 어느 판에서도 답하지 않는다. 한 번 허락으로 줄인다.
      const session = kind === "session" ? dialog.sessionOption : undefined;
      write({
        type: "extension_ui_response",
        id: dialog.ui,
        value: kind === "reject" ? "Deny" : (session ?? "Approve"),
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
              choice: session === undefined ? "once" : "session",
            },
      );
    }

    function answer(message: Extract<AcpInput, { type: "answer" }>) {
      const dialog = open;
      if (dialog?.kind !== "question") return;
      const given = message.answers.map((one) =>
        one.status === "answered" ? one.answer : [],
      );
      const call = [...calls.values()].find(
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
    function endTurn(
      outcome: "completed" | "stopped" | "failed",
      error?: { code: string; message: string },
    ) {
      if (turn === null) return;
      const id = turn;
      turn = null;
      dialogs = [];
      if (open !== null) {
        closeDialog(
          open,
          open.kind === "approval"
            ? { approval: "cancelled" }
            : { question: "cancelled" },
        );
      }
      for (const call of calls.values()) {
        if (!call.done) toolEnd(call, "cancelled");
      }
      calls.clear();
      streams.clear();
      pendingEcho = [];
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
    }

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
      userIds.push(one.id);
      // follow-up은 앞 응답이 끝난 뒤 들어가는 다음 turn이고 steer는 도는 turn에 끼는 것이다.
      if (one.kind === "followUp") endTurn("completed");
      const mine = ensureTurn();
      turnText.set(mine, text);
      publish({
        type: "message_taken",
        message: one.id,
        seq: ++seq,
        delivery: one.kind === "steer" ? "steer" : "next_turn",
        turn: one.kind === "steer" ? null : mine,
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
        publish({
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

    function onSubagent(payload: NonNullable<Frame["payload"]>) {
      const known = subagents.get(payload.id);
      const detail = (state: "accepted" | "done" | "failed" | "cancelled") =>
        ({
          kind: "call",
          call: null,
          to: payload.agent,
          task: payload.description ?? "",
          reply: "result",
          state,
          fail_reason: null,
          session: null,
        }) as const;
      if (payload.status === "started" && known === undefined) {
        const entry = { call: ids.newId("tcl"), done: false };
        subagents.set(payload.id, entry);
        publish({
          type: "tool_started",
          item: {
            kind: "tool",
            id: entry.call,
            seq: ++seq,
            at: now(),
            turn: turn ?? lastTurn ?? ids.newId("trn"),
            tool: "subagent",
            category: "other",
            // lifecycle에는 description이 없을 수 있다(녹화). id가 task의 이름이다.
            title: oneLine(
              `${payload.agent}: ${payload.description ?? payload.id}`,
              120,
            ),
            state: "running",
            duration_ms: null,
            detail: detail("accepted"),
          },
        });
      } else if (
        known !== undefined &&
        !known.done &&
        payload.status !== "started"
      ) {
        known.done = true;
        const done = payload.status === "completed";
        publish({
          type: "tool_ended",
          tool_call: known.call,
          state: done
            ? "ok"
            : payload.status === "aborted"
              ? "cancelled"
              : "error",
          at: now(),
          detail: detail(
            done
              ? "done"
              : payload.status === "aborted"
                ? "cancelled"
                : "failed",
          ),
        });
      }
    }

    function onFrame(frame: Frame) {
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
          ensureTurn();
          return;
        case "agent_end": {
          // 이어질 때(재시도, compaction 뒤)는 turn이 끝난 것이 아니다.
          if (frame.yielded === false || frame.isTerminal === false) return;
          const last = [...(frame.messages ?? [])]
            .reverse()
            .find((one) => one.role === "assistant");
          if (last?.stopReason === "aborted") endTurn("stopped");
          else if (last?.stopReason === "error") {
            endTurn("failed", {
              code: "internal",
              message: last.errorMessage ?? "omp failed",
            });
          } else endTurn("completed");
          void refresh();
          return;
        }
        case "prompt_result": {
          if (promptTurn.get(frame.id ?? "") !== turn) return;
          const failure = frame.error as { message?: string } | undefined;
          if (frame.status === "error") {
            endTurn("failed", {
              code: "internal",
              message: failure?.message ?? "omp failed",
            });
          } else if (frame.status === "aborted") endTurn("stopped");
          else if (frame.agentInvoked === false) endTurn("completed");
          return;
        }
        case "session_settled":
          for (const one of queue.splice(0)) {
            publish({ type: "message_removed", message: one.id });
          }
          return;
        case "message_start": {
          const msg = frame.message;
          if (typeof msg === "object" && msg.role === "assistant") {
            streams.set(frame.messageId ?? "", {
              call: ids.newId("mcl"),
              text: 0,
              thinking: 0,
            });
          }
          return;
        }
        case "message_update":
          onUpdate(frame);
          return;
        case "message_end": {
          const msg = frame.message;
          if (typeof msg !== "object") return;
          if (msg.role === "user") onUserMessage(msg);
          else if (msg.role === "assistant") {
            const stream = streams.get(frame.messageId ?? "");
            streams.delete(frame.messageId ?? "");
            recordAssistant(msg, stream?.call ?? null);
          }
          return;
        }
        case "tool_execution_start":
          toolStart(
            frame.toolCallId ?? "",
            frame.toolName ?? "",
            frame.args ?? {},
          );
          return;
        case "tool_execution_end":
          onToolEnd(frame);
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
        case "subagent_lifecycle":
          if (frame.payload) onSubagent(frame.payload);
          return;
        case "command_output":
          info(frame.text ?? "");
          return;
        case "notice":
          info(
            `${frame.level === "info" ? "" : `${frame.level}: `}${typeof frame.message === "string" ? frame.message : ""}`,
          );
          return;
        case "auto_retry_start":
          info(
            `Retrying (${frame.attempt}/${frame.maxAttempts}): ${frame.errorMessage ?? ""}`,
          );
          return;
        case "auto_retry_end":
          if (frame.success === false) {
            info(`Retry failed: ${frame.finalError ?? ""}`);
          }
          return;
        case "manual_compaction_start":
        case "auto_compaction_start":
          info("Compacting the conversation…");
          return;
        case "manual_compaction_end":
        case "auto_compaction_end":
          info(
            frame.aborted || frame.errorMessage
              ? `Compaction ${frame.skipped ? "skipped" : "failed"}: ${frame.errorMessage ?? "aborted"}`
              : "Compacted the conversation.",
          );
          void refresh();
          return;
        case "retry_fallback_applied":
          info(`Switched model: ${frame.from ?? ""} → ${frame.to ?? ""}`);
          return;
        default:
          return;
      }
    }

    // --- stdout ---
    let buffer = "";
    const chunks = new Map<string, Buffer[]>();
    let onReady: ((value: "ready" | "exit") => void) | null = null;
    function onLine(line: string) {
      if (line.trim() === "") return;
      let frame: Frame;
      try {
        frame = JSON.parse(line) as Frame;
      } catch {
        return;
      }
      if (frame.type === "ready") {
        onReady?.("ready");
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
    proc.onStdout((text) => {
      buffer += text;
      for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 1);
        onLine(line);
      }
    });

    let started = false;
    let exitWait: (() => void) | null = null;
    const exitedP = new Promise<void>((resolve) => {
      exitWait = resolve;
    });
    proc.onExit((code) => {
      exited = true;
      onReady?.("exit");
      for (const done of waiting.values()) {
        done({ ok: false, error: "omp exited" });
      }
      waiting.clear();
      exitWait?.();
      if (!started || closed || stopping) return;
      ensureTurn();
      endTurn("failed", {
        code: "unavailable",
        message: `omp exited${code === null ? "" : ` (code ${code})`}.${stderrTail === "" ? "" : `\n${stderrTail.trim()}`}`,
      });
    });

    const first = await new Promise<"ready" | "exit">((resolve) => {
      onReady = resolve;
      if (exited) resolve("exit");
    });
    if (first === "exit") {
      closed = true;
      return {
        ok: false,
        error: {
          code: "unavailable",
          message: `\`omp\` did not start.${stderrTail === "" ? "" : `\n${stderrTail.trim()}`}`,
        },
      };
    }
    // v2로 올려 큰 frame을 chunk로 받고, `ask`의 질문 묶음과 message 전체 snapshot을 켠다(18.8.7의 delta는 믿을 수 없다).
    const negotiated = await request("negotiate_protocol", {
      protocolVersion: 2,
    });
    if (!negotiated.ok) {
      closed = true;
      proc.kill();
      return {
        ok: false,
        error: {
          code: "unavailable",
          message: `omp rejected the RPC protocol: ${negotiated.error}`,
        },
      };
    }
    void request("set_ask_dialog", { enabled: true });
    void request("set_event_filter", { events: null });
    void request("set_subagent_subscription", { level: "progress" });

    started = true;

    // --- 시작 상태와 앞 대화 ---
    function replay(messages: Msg[]) {
      const results = new Map<string, boolean>();
      for (const msg of messages) {
        if (msg.role === "toolResult" && msg.toolCallId) {
          results.set(msg.toolCallId, msg.isError === true);
        }
      }
      for (const msg of messages) {
        if (msg.role === "user") {
          if (msg.synthetic || msg.attribution === "agent") continue;
          endTurn("completed");
          addUser(ids.newId("msg"), [
            { type: "text", text: joined(msg.content, "text") },
          ]);
        } else if (msg.role === "assistant") {
          recordAssistant(msg, null);
          for (const block of Array.isArray(msg.content) ? msg.content : []) {
            if (block.type !== "toolCall" || !block.id) continue;
            const call = toolStart(
              block.id,
              block.name ?? "",
              block.arguments ?? {},
            );
            const failed = results.get(block.id);
            toolEnd(
              call,
              failed === undefined ? "cancelled" : failed ? "error" : "ok",
            );
          }
        }
      }
      endTurn("completed");
    }

    const ready = (async () => {
      const [, , available, commandList] = await Promise.all([
        readState(),
        readLevels(),
        request<{ models: Model[] }>("get_available_models"),
        request<{ commands: Command[] }>("get_available_commands"),
      ]);
      models = available.ok ? available.data.models : [];
      commands = commandList.ok ? commandList.data.commands : [];
      publishMeta();
      if (resume === undefined) return;
      for (let cursor: string | undefined; ; ) {
        const page = await request<{
          messages: Msg[];
          nextCursor?: string;
        }>("get_messages_page", { limit: 256, ...(cursor ? { cursor } : {}) });
        if (!page.ok) {
          info(`Could not read the earlier conversation: ${page.error}`);
          return;
        }
        replay(page.data.messages);
        cursor = page.data.nextCursor;
        if (cursor === undefined) return;
      }
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
          info(`Could not read the image ${block.name}.`);
        }
      }
      return images.length === 0 ? {} : { images };
    }

    async function prompt(text: string, extra: Record<string, unknown>) {
      const id = `lpn-${++counter}`;
      promptTurn.set(id, ensureTurn());
      const reply = await request<{ agentInvoked?: boolean }>(
        "prompt",
        { message: text, ...extra },
        id,
      );
      if (!reply.ok)
        endTurn("failed", { code: "internal", message: reply.error });
      else if (reply.data?.agentInvoked === false) endTurn("completed");
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

    // 도는 중에는 omp가 branch·fork를 거절한다(`session_busy`).
    function idleOnly(what: string): boolean {
      if (turn === null) return true;
      info(`Stop the running turn before ${what}.`);
      return false;
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
      const start = acp.items.findIndex((item) => item.id === from);
      if (start < 0) return;
      const items = flat(acp.items.slice(start));
      const first = acp.items[start];
      if (first === undefined || items.length === 0) return;
      const hidden: AcpHiddenItem = {
        kind: "hidden",
        id: ids.newId("rwd"),
        seq: first.seq,
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

    async function handle(message: AcpInput) {
      switch (message.type) {
        case "send": {
          const extra = await imagesOf(message.content);
          const text = textOf(message.content);
          if (turn !== null) {
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
              info(`omp did not take the message: ${reply.error}`);
            }
            return;
          }
          addUser(message.id, message.content);
          pendingEcho.push(text);
          await prompt(text, extra);
          return;
        }
        case "stop":
          if (turn !== null) void request("abort");
          return;
        case "retry": {
          const text = turnText.get(message.turn);
          if (text === undefined || turn !== null) return;
          const id = ids.newId("msg");
          addUser(id, [{ type: "text", text }]);
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
              return void info(`Could not switch the model: ${reply.error}`);
            await readLevels();
          }
          const effort = message.options.effort;
          if (effort !== undefined && levels.includes(effort)) {
            await request("set_thinking_level", { level: effort });
          }
          await refresh();
          return;
        }
        case "run_command": {
          if (turn !== null) return;
          ensureTurn();
          await prompt(
            `/${message.name}${message.argument === "" ? "" : ` ${message.argument}`}`,
            {},
          );
          await refresh();
          return;
        }
        case "compact": {
          if (turn !== null) return;
          ensureTurn();
          const reply = await request("compact");
          // 작은 session은 "Nothing to compact"로 거절한다(녹화로 확인했다). 실패한 turn이 아니라 알림이다.
          if (!reply.ok) info(`Compact: ${reply.error}`);
          endTurn("completed");
          await refresh();
          return;
        }
        case "rename": {
          const reply = await request("set_session_name", {
            name: message.title,
          });
          if (reply.ok) await refresh();
          else info(`Could not rename the session: ${reply.error}`);
          return;
        }
        case "rewind": {
          if (!idleOnly("rewinding")) return;
          const entry = await entryOf(message.message);
          if (entry === null)
            return void info("This message cannot be rewound.");
          const reply = await request<{ cancelled: boolean }>("branch", {
            entryId: entry,
          });
          if (!reply.ok || reply.data.cancelled) {
            return void info(
              reply.ok
                ? "omp cancelled the rewind."
                : `Rewind failed: ${reply.error}`,
            );
          }
          // branch는 새 session file이라 id가 바뀐다. 그 message부터 대화가 지워졌다.
          hideFrom(message.message, message.message);
          userIds = userIds.slice(0, userIds.indexOf(message.message));
          await refresh();
          return;
        }
        case "fork": {
          if (!idleOnly("forking")) return;
          const entry =
            message.message === null
              ? undefined
              : await entryOf(message.message);
          if (entry === null)
            return void info("This message cannot be forked.");
          const reply = await request<{ cancelled: boolean }>(
            "fork",
            entry === undefined ? {} : { entryId: entry },
          );
          if (!reply.ok || reply.data.cancelled) {
            return void info(
              reply.ok
                ? "omp cancelled the fork."
                : `Fork failed: ${reply.error}`,
            );
          }
          // 이 process가 새 file로 옮겨 갔다. 그 message 뒤는 새 session에 없다.
          if (message.message !== null) {
            const at = acp.items.findIndex(
              (item) => item.id === message.message,
            );
            const next = acp.items[at + 1];
            if (next !== undefined) hideFrom(message.message, next.id);
            userIds = userIds.slice(0, userIds.indexOf(message.message) + 1);
          }
          await refresh();
          return;
        }
        // omp 18.8.7에는 plan mode와 승인 mode를 바꾸는 RPC가 없다.
        case "set_mode":
          return;
      }
    }
    session.onInput((message) => void ready.then(() => handle(message)));

    let stopped: Promise<void> | null = null;
    const run: HarnessGuiRun = {
      stop() {
        stopped ??= (async () => {
          if (exited) return;
          stopping = true;
          await ready;
          if (turn !== null) await request("abort");
          // toggle이 이 id로 TUI를 잇는다. branch·fork·`/new` 뒤에는 시작 때와 다르다.
          await readState();
          closed = true;
          // stdin을 닫으면 omp가 session을 닫고(lease를 놓는다) 끝난다. 안 끝나면 SIGTERM이다.
          proc.end();
          const timer = setTimeout(() => proc.kill(), EXIT_WAIT_MS);
          await exitedP;
          clearTimeout(timer);
        })();
        return stopped;
      },
      tuiCommand: () =>
        cliSession === null ? "omp" : `omp --resume=${cliSession}`,
      sessionId: () => cliSession,
      running: () => ({
        turn: turn !== null,
        tasks: [...subagents.values()].filter((one) => !one.done).length,
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

export const ompAdapter = createOmpAdapter({ readFile });
