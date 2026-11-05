// OpenCode adapter. `opencode acp`(표준 Agent Client Protocol, stdio JSON-RPC)를 띄워 `session/update`를 ACP 갱신으로,
// 창의 ACP 입력을 `session/prompt`·`session/cancel`·permission 답으로 옮긴다. 표준 protocol은 이 file 안에서만 쓴다.
// 권한은 사람의 OpenCode 설정을 따른다(ask를 걸지 않았으면 승인 카드는 뜨지 않는다).
import type { Result } from "../../../../../base/result.ts";
import type { AcpInput } from "../../../../../protocol/acp/input.ts";
import type {
  AcpApprovalItem,
  AcpToolItem,
} from "../../../../../protocol/acp/items.ts";
import type { AcpUpdate } from "../../../../../protocol/acp/state.ts";
import type { ContentBlock } from "../../../../../protocol/lophn-agent/content-block.ts";
import type { HarnessGuiAdapter } from "./adapter.ts";

type Json = Record<string, unknown>;
type Location = { path?: string };
// 표준 protocol의 tool call. 처음 `tool_call`과 뒤의 `tool_call_update`가 같은 칸을 나눠 채운다.
type ToolFields = {
  name?: string;
  title?: string;
  kind?: string;
  status?: string;
  locations?: Location[];
  rawInput?: Json;
};
type Update = ToolFields & {
  sessionUpdate: string;
  toolCallId?: string;
  messageId?: string;
  content?: { type?: string; text?: string };
};

const CATEGORIES: Record<string, AcpToolItem["category"]> = {
  read: "read",
  search: "search",
  execute: "command",
  fetch: "web",
};

const oneLine = (text: string, max: number) =>
  text
    .replace(/\s*\n\s*/g, " ")
    .trim()
    .slice(0, max);
const lines = (text: unknown) =>
  typeof text === "string" && text !== "" ? text.split("\n").length : 0;
const str = (value: unknown) => (typeof value === "string" ? value : "");
const relative = (cwd: string, path: string) =>
  path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;

// 앱 context(`resource` block)도 글로 넘긴다. 이미지는 blob hash뿐이라 넘기지 못한다.
const textOf = (content: ContentBlock[]) =>
  content
    .flatMap((block) =>
      block.type === "text" || block.type === "resource" ? [block.text] : [],
    )
    .join("\n");

type Call = {
  id: string;
  fields: ToolFields;
  started: boolean;
  done: boolean;
  /** 끝났을 때 `failed`를 어떻게 부를지. */
  hint?: "denied" | "cancelled";
};

const start: HarnessGuiAdapter["start"] = async ({
  cwd,
  resume,
  session,
  spawn,
  clock,
  ids,
}) => {
  const proc = spawn("opencode", ["acp"], { cwd });
  if (proc.pid === undefined) {
    return {
      ok: false,
      error: {
        code: "unavailable",
        message: "`opencode` was not found on PATH.",
      },
    } satisfies Result<never>;
  }

  let seq = 0;
  let closed = false;
  let dead: { code: string; message: string } | null = null;
  let stderrTail = "";
  const now = () => clock.now();
  const publish = (update: AcpUpdate) => {
    if (!closed) session.publish(update);
  };

  // turn: 도는 turn의 id. prompt 하나가 turn 하나다.
  let sessionId = resume ?? "";
  let turn: string | null = null;
  let stopping = false;
  let replaying = false;
  // 모델 호출 하나의 글. 글이 나온 뒤 새 message·tool이 오면 기록하고 닫는다.
  let writing: {
    call: string;
    messageId: string;
    text: string;
    reasoning: string;
  } | null = null;
  const calls = new Map<string, Call>();
  const queue: { id: string; at: string; content: ContentBlock[] }[] = [];
  // retry가 다시 보낼 turn의 사람 메시지.
  const userOf = new Map<string, ContentBlock[]>();
  const approvals = new Map<string, { rpc: unknown; call: Call }>();
  const waiting = new Map<number, (reply: Json | Error) => void>();

  function write(message: Json) {
    proc.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  }
  let rpcId = 0;
  function request(method: string, params: Json): Promise<Json> {
    const id = ++rpcId;
    return new Promise((resolve, reject) => {
      waiting.set(id, (reply) =>
        reply instanceof Error ? reject(reply) : resolve(reply),
      );
      write({ id, method, params });
    });
  }

  function startTurn(): string {
    turn = ids.newId("trn");
    publish({ type: "turn_started", turn, at: now() });
    return turn;
  }
  const ensureTurn = () => turn ?? startTurn();

  function addUser(id: string, content: ContentBlock[], at: string) {
    const current = ensureTurn();
    userOf.set(current, content);
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
        turn: current,
        content,
        reasoning: null,
        cards: [],
        complete: true,
      },
    });
  }

  function flushWriting() {
    if (writing === null || writing.text === "") return;
    publish({
      type: "message_recorded",
      turn: ensureTurn(),
      message: ids.newId("msg"),
      model_call: writing.call,
      seq: ++seq,
      at: now(),
      body: {
        content: [{ type: "text", text: writing.text }],
        reasoning:
          writing.reasoning === ""
            ? null
            : { text: writing.reasoning, duration_ms: null },
        cards: [],
      },
    });
    writing = null;
  }

  function stream(kind: "text" | "reasoning", messageId: string, text: string) {
    if (
      writing !== null &&
      writing.text !== "" &&
      (kind === "reasoning" || writing.messageId !== messageId)
    )
      flushWriting();
    writing ??= {
      call: ids.newId("mcl"),
      messageId,
      text: "",
      reasoning: "",
    };
    if (kind === "text") writing.messageId = messageId;
    publish({
      type: "writing_streamed",
      turn: ensureTurn(),
      model_call: writing.call,
      kind,
      offset: writing[kind].length,
      text,
      at: now(),
    });
    writing[kind] += text;
  }

  function summaryOf(fields: ToolFields): string {
    const input = fields.rawInput ?? {};
    for (const key of [
      "command",
      "path",
      "filePath",
      "pattern",
      "url",
      "query",
    ]) {
      const value = str(input[key]);
      if (value !== "") return oneLine(relative(cwd, value), 120);
    }
    const title = str(fields.title);
    return title === str(fields.name) ? "" : oneLine(title, 120);
  }

  function detailOf(fields: ToolFields): AcpToolItem["detail"] {
    const input = fields.rawInput ?? {};
    const path =
      str(input.path) ||
      str(input.filePath) ||
      str(fields.locations?.[0]?.path);
    if (fields.kind !== "edit" || path === "") return { kind: "generic" };
    const absolute = path.startsWith("/") ? path : `${cwd}/${path}`;
    return {
      kind: "edit",
      document: absolute,
      path: relative(cwd, absolute),
      added: lines(input.content ?? input.newString),
      removed: lines(input.oldString),
    };
  }

  function toolEnd(call: Call, state: "ok" | "error" | "denied" | "cancelled") {
    call.done = true;
    publish({
      type: "tool_ended",
      tool_call: call.id,
      state,
      at: now(),
      detail: null,
    });
  }

  // 처음 `tool_call`은 title·입력이 비어 있다. 채워진 `in_progress`나 승인 요청이 올 때 줄을 시작한다.
  function toolSeen(toolCallId: string, patch: ToolFields): Call {
    let call = calls.get(toolCallId);
    if (call === undefined) {
      call = { id: ids.newId("tcl"), fields: {}, started: false, done: false };
      calls.set(toolCallId, call);
    }
    call.fields = {
      ...call.fields,
      ...Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined),
      ),
    };
    return call;
  }

  function toolStart(call: Call) {
    if (call.started) return;
    call.started = true;
    flushWriting();
    const name = call.fields.name ?? call.fields.title ?? "tool";
    const summary = summaryOf(call.fields);
    publish({
      type: "tool_started",
      item: {
        kind: "tool",
        id: call.id,
        seq: ++seq,
        at: now(),
        turn: ensureTurn(),
        tool: name,
        category: CATEGORIES[call.fields.kind ?? ""] ?? "other",
        title: summary === "" ? name : `${name} ${summary}`,
        state: "running",
        duration_ms: null,
        detail: detailOf(call.fields),
      },
    });
  }

  function onTool(toolCallId: string, update: ToolFields) {
    const call = toolSeen(toolCallId, update);
    if (call.done || update.status === "pending") return;
    toolStart(call);
    if (update.status === "completed") toolEnd(call, "ok");
    else if (update.status === "failed")
      toolEnd(call, call.hint ?? (stopping ? "cancelled" : "error"));
  }

  function subjectOf(call: Call): AcpApprovalItem["subject"] {
    const command = str(call.fields.rawInput?.command);
    if (call.fields.kind === "execute" && command !== "")
      return { kind: "shell", command };
    const name = call.fields.name ?? "tool";
    const title = str(call.fields.title);
    return {
      kind: "mcp_tool",
      server: "opencode",
      tool: title === "" || title === name ? name : `${name}: ${title}`,
      effect:
        call.fields.kind === "edit" ||
        call.fields.kind === "delete" ||
        call.fields.kind === "move"
          ? "write"
          : call.fields.kind === "read" || call.fields.kind === "search"
            ? "read"
            : "external",
    };
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
    if (!allowed)
      wait.call.hint = decision === "reject" ? "denied" : "cancelled";
    write({
      id: wait.rpc,
      result: {
        outcome:
          decision === "cancelled"
            ? { outcome: "cancelled" }
            : {
                outcome: "selected",
                optionId: allowed ? "once" : "reject",
              },
      },
    });
    publish({
      type: "approval_closed",
      request: id,
      outcome: allowed
        ? "allowed"
        : decision === "reject"
          ? "denied"
          : "cancelled",
      choice: allowed ? "once" : null,
      reason: reason ?? null,
      seq: ++seq,
      at: now(),
    });
  }

  function askPermission(rpc: unknown, params: Json) {
    const tool = params.toolCall as ToolFields & { toolCallId: string };
    const call = toolSeen(tool.toolCallId, tool);
    toolStart(call);
    const id = ids.newId("apr");
    approvals.set(id, { rpc, call });
    // OpenCode의 `always`는 사람의 project에 규칙을 영구히 저장한다. 이 session 동안만이 아니라서 내놓지 않는다.
    publish({
      type: "approval_opened",
      approval: {
        id,
        subject: subjectOf(call),
        choices: ["once", "reject"],
        always_patterns: [],
      },
    });
  }

  function endTurn(
    outcome: "completed" | "stopped" | "failed",
    error?: { code: string; message: string },
  ) {
    const id = turn ?? ids.newId("trn");
    for (const request of [...approvals.keys()])
      closeApproval(request, "cancelled");
    flushWriting();
    writing = null;
    for (const call of calls.values())
      if (call.started && !call.done) toolEnd(call, "cancelled");
    calls.clear();
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
    stopping = false;
    if (dead === null) startNext();
  }

  function prompt(text: string) {
    request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }],
    }).then(
      (reply) => {
        const reason = str(reply.stopReason);
        if (reason === "end_turn") endTurn("completed");
        else if (reason === "cancelled") endTurn("stopped");
        else
          endTurn("failed", {
            code: "internal",
            message: `opencode stopped: ${reason}`,
          });
      },
      (cause: Error) => {
        // 프로세스가 죽어 보류 요청을 거절한 것은 `failure`가 이미 알렸다.
        if (dead === null)
          endTurn("failed", { code: "internal", message: cause.message });
      },
    );
  }

  function startNext() {
    const next = queue.shift();
    if (next === undefined) return;
    const id = startTurn();
    userOf.set(id, next.content);
    publish({
      type: "message_taken",
      message: next.id,
      seq: ++seq,
      delivery: "next_turn",
      turn: id,
    });
    prompt(textOf(next.content));
  }

  function onUpdate(update: Update) {
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
      case "agent_thought_chunk": {
        const text = update.content?.type === "text" ? update.content.text : "";
        if (text)
          stream(
            update.sessionUpdate === "agent_message_chunk"
              ? "text"
              : "reasoning",
            update.messageId ?? "",
            text,
          );
        return;
      }
      case "user_message_chunk": {
        // 앞 대화를 다시 흘릴 때만 온다. 사람 메시지마다 turn 하나다.
        const text = update.content?.type === "text" ? update.content.text : "";
        if (!replaying || !text) return;
        flushWriting();
        if (turn !== null) endTurn("completed");
        addUser(ids.newId("msg"), [{ type: "text", text }], now());
        return;
      }
      case "tool_call":
      case "tool_call_update":
        if (update.toolCallId !== undefined) onTool(update.toolCallId, update);
        return;
      default:
        return;
    }
  }

  function onLine(line: string) {
    let message: Json;
    try {
      message = JSON.parse(line) as Json;
    } catch {
      return;
    }
    const method = message.method;
    if (typeof method !== "string") {
      const done = waiting.get(message.id as number);
      waiting.delete(message.id as number);
      if (message.error !== undefined) {
        done?.(
          new Error(str((message.error as Json).message) || "opencode error"),
        );
      } else {
        done?.((message.result ?? {}) as Json);
      }
    } else if (message.id === undefined) {
      if (method === "session/update")
        onUpdate((message.params as { update: Update }).update);
    } else if (method === "session/request_permission") {
      askPermission(message.id, message.params as Json);
    } else {
      // fs와 terminal은 광고하지 않았다.
      write({
        id: message.id,
        error: { code: -32601, message: `${method} is not supported` },
      });
    }
  }

  let buffer = "";
  proc.onStdout((text) => {
    buffer += text;
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) if (part.trim() !== "" && !closed) onLine(part);
  });
  proc.onStderr((text) => {
    stderrTail = (stderrTail + text).slice(-500);
  });

  const failure = (reason: string) => {
    if (closed || dead !== null) return;
    dead = {
      code: "unavailable",
      message: stderrTail === "" ? reason : `${reason}\n${stderrTail.trim()}`,
    };
    for (const done of waiting.values()) done(new Error(dead.message));
    waiting.clear();
    endTurn("failed", dead);
  };
  proc.onExit(() => failure("opencode exited."));

  // initialize → (load | new). 앞 대화는 load가 답하기 전에 `session/update`로 다시 흐른다.
  const ready = (async () => {
    try {
      const init = await request("initialize", {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      });
      const loadable =
        (init.agentCapabilities as { loadSession?: boolean } | undefined)
          ?.loadSession === true;
      if (resume !== undefined && loadable) {
        replaying = true;
        try {
          await request("session/load", {
            sessionId: resume,
            cwd,
            mcpServers: [],
          });
          flushWriting();
          if (turn !== null) endTurn("completed");
          return;
        } catch {
        } finally {
          replaying = false;
        }
      }
      // 그 session을 못 읽으면 새 session으로 열고, 조용히 넘기지 않고 끝난 turn으로 알린다.
      if (resume !== undefined && dead === null)
        endTurn("failed", {
          code: "not_found",
          message: `The session ${resume} could not be loaded, so a new session was started.`,
        });
      sessionId = str(
        (await request("session/new", { cwd, mcpServers: [] })).sessionId,
      );
    } catch (cause) {
      failure(cause instanceof Error ? cause.message : String(cause));
    }
  })();

  function resendQueue() {
    for (const one of queue)
      publish({ type: "message_removed", message: one.id });
    for (const one of queue) publish({ type: "message_queued", queued: one });
  }

  function send(id: string, content: ContentBlock[]) {
    if (turn !== null) {
      const queued = { id, at: now(), content };
      queue.push(queued);
      publish({ type: "message_queued", queued });
      return;
    }
    addUser(id, content, now());
    if (dead === null) prompt(textOf(content));
    else endTurn("failed", dead);
  }

  function handle(message: AcpInput) {
    switch (message.type) {
      case "send":
        send(message.id, message.content);
        return;
      case "retry": {
        const content = userOf.get(message.turn);
        if (content !== undefined) send(ids.newId("msg"), content);
        return;
      }
      case "stop":
        if (turn === null) return;
        stopping = true;
        for (const request of [...approvals.keys()])
          closeApproval(request, "cancelled");
        write({ method: "session/cancel", params: { sessionId } });
        return;
      case "decide":
        closeApproval(
          message.request,
          message.choice.kind === "session" ? "once" : message.choice.kind,
          message.choice.kind === "reject" ? message.choice.reason : undefined,
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
      // 표준 protocol에는 도는 prompt에 끼워 넣는 steer가 없다(send_queued). answer는 질문을 내지 않아 오지 않는다.
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
        proc.kill();
      },
      // 아래 셋은 계약 stub이다. 실제 값은 handoff 길이 채운다.
      tuiCommand: () => "opencode",
      sessionId: () => null,
      running: () => ({ turn: false, tasks: 0 }),
    },
  };
};

export const opencodeAdapter: HarnessGuiAdapter = {
  handoff: "shared",
  start,
  exitTui: () =>
    Promise.resolve({
      ok: false,
      error: { code: "unavailable", message: "exitTui is not implemented yet" },
    }),
};
