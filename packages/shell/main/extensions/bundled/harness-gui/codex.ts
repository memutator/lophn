// Codex adapter. 사람의 `codex app-server`를 stdio JSON-RPC(줄마다 JSON, `jsonrpc` 칸 없음)로 띄우고,
// app-server 이벤트를 ACP 갱신으로, 창의 ACP 입력을 RPC로 옮긴다. 설정과 login은 사람의 것을 쓰되
// sandbox와 승인은 사람의 설정(이 기계는 never + danger-full-access)이 아니라 늘 아래 값으로 넘긴다.
import type { Result } from "../../../../../base/result.ts";
import type { AcpInput } from "../../../../../protocol/acp/input.ts";
import type {
  AcpApprovalItem,
  AcpToolItem,
} from "../../../../../protocol/acp/items.ts";
import type { AcpUpdate } from "../../../../../protocol/acp/state.ts";
import type { ContentBlock } from "../../../../../protocol/lophn-agent/content-block.ts";
import type { HarnessGuiAdapter } from "./adapter.ts";

// Codex 데스크톱의 기본이다. 파일은 작업 폴더 안에서만 쓰고 나머지는 묻는다.
const THREAD_POLICY = {
  approvalPolicy: "on-request",
  sandbox: "workspace-write",
} as const;

// app-server 메시지에서 읽는 칸만 적은 모양이다.
type Json = Record<string, unknown>;
type Item = {
  type: string;
  id: string;
  text?: string;
  content?: unknown[];
  summary?: string[];
  command?: string;
  commandActions?: { type: string; command: string }[];
  status?: string;
  changes?: { path: string; kind: { type: string }; diff: string }[];
  server?: string;
  tool?: string;
  query?: string;
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

// 앱 context(`resource` block)도 글로 넘긴다. 이미지는 blob hash뿐이라 넘기지 못한다.
const textOf = (content: ContentBlock[]) =>
  content
    .flatMap((block) =>
      block.type === "text" || block.type === "resource" ? [block.text] : [],
    )
    .join("\n");
const textInput = (content: ContentBlock[]) => [
  { type: "text", text: textOf(content), text_elements: [] },
];

function toolState(
  status: string | undefined,
): "ok" | "error" | "denied" | "cancelled" {
  return status === "completed"
    ? "ok"
    : status === "failed"
      ? "error"
      : status === "declined"
        ? "denied"
        : "cancelled";
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

function editCounts(changes: NonNullable<Item["changes"]>) {
  let added = 0;
  let removed = 0;
  for (const change of changes) {
    if (change.kind.type === "add") added += lineCount(change.diff);
    else if (change.kind.type === "delete") removed += lineCount(change.diff);
    else
      for (const line of change.diff.split("\n")) {
        if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
        else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
      }
  }
  return { added, removed };
}

type Call = { id: string; done: boolean; paths: string[] };
type ApprovalWait = {
  /** app-server가 요청에 붙인 id. 답에 그대로 쓴다. */
  rpc: number | string;
  /** `acceptForSession`을 낼 수 있는 요청이다. */
  session: boolean;
};

export const codexAdapter: HarnessGuiAdapter = {
  async start({ cwd, resume, session, spawn, clock, ids }) {
    let seq = 0;
    let closed = false;
    let dead: { code: string; message: string } | null = null;
    let stderrTail = "";
    const now = () => clock.now();
    const publish = (update: AcpUpdate) => {
      if (!closed) session.publish(update);
    };

    const proc = spawn("codex", ["app-server"], { cwd });
    if (proc.pid === undefined) {
      return {
        ok: false,
        error: {
          code: "unavailable",
          message: "`codex` was not found on PATH.",
        },
      } satisfies Result<never>;
    }

    // --- JSON-RPC
    let nextRequest = 0;
    const pending = new Map<
      number,
      { resolve(value: Json): void; reject(cause: Error): void }
    >();
    const write = (message: Json) => proc.write(`${JSON.stringify(message)}\n`);
    const request = (method: string, params: Json) =>
      new Promise<Json>((resolve, reject) => {
        if (dead !== null) {
          reject(new Error(dead.message));
          return;
        }
        const id = ++nextRequest;
        pending.set(id, { resolve, reject });
        write({ id, method, params });
      });

    let threadId = "";
    // turn: 도는 turn의 id(ACP). codexTurn: 그 turn의 app-server id(steer와 interrupt가 쓴다).
    let turn: string | null = null;
    let codexTurn: string | null = null;
    let stopPending = false;
    let modelCall: string | null = null;
    const streamed = { text: 0, reasoning: 0 };
    let reasoning = "";
    const calls = new Map<string, Call>();
    const approvals = new Map<string, ApprovalWait>();
    const queue: { id: string; at: string; content: ContentBlock[] }[] = [];
    // retry가 다시 보낼 사람 메시지. turn마다 첫 메시지다.
    const userOf = new Map<string, ContentBlock[]>();

    function startTurn(): string {
      turn = ids.newId("trn");
      publish({ type: "turn_started", turn, at: now() });
      return turn;
    }
    const ensureTurn = () => turn ?? startTurn();

    function addUser(
      id: string,
      content: ContentBlock[],
      delivery: "next_turn" | "steer" = "next_turn",
    ) {
      const owner = delivery === "steer" ? turn : ensureTurn();
      if (owner !== null && !userOf.has(owner)) userOf.set(owner, content);
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
          delivery,
          turn: owner,
          content,
          reasoning: null,
          cards: [],
          complete: true,
        },
      });
    }

    // --- items
    function toolStart(item: Item): Call {
      const known = calls.get(item.id);
      if (known !== undefined) return known;
      const call: Call = { id: ids.newId("tcl"), done: false, paths: [] };
      calls.set(item.id, call);
      modelCall = null;
      let tool: string;
      let category: AcpToolItem["category"] = "other";
      let title: string;
      let detail: AcpToolItem["detail"] = { kind: "generic" };
      if (item.type === "commandExecution") {
        const actions = (item.commandActions ?? []).map((one) => one.command);
        tool = "shell";
        category = commandCategory(item);
        title = `shell ${oneLine(actions.length > 0 ? actions.join(" && ") : (item.command ?? ""), 120)}`;
      } else if (item.type === "fileChange") {
        const changes = item.changes ?? [];
        call.paths = changes.map((one) => relative(cwd, one.path));
        tool = "apply_patch";
        const first = call.paths[0] ?? "";
        title = `apply_patch ${oneLine(first, 100)}${call.paths.length > 1 ? ` (+${call.paths.length - 1} files)` : ""}`;
        detail = {
          kind: "edit",
          document: changes[0]?.path ?? first,
          path: first,
          ...editCounts(changes),
        };
      } else {
        tool = `${item.server ?? "mcp"}.${item.tool ?? "tool"}`;
        title = tool;
      }
      publish({
        type: "tool_started",
        item: {
          kind: "tool",
          id: call.id,
          seq: ++seq,
          at: now(),
          turn: ensureTurn(),
          tool,
          category,
          title: title.trim(),
          state: "running",
          duration_ms: null,
          detail,
        },
      });
      return call;
    }

    function toolEnd(call: Call, state: ReturnType<typeof toolState>) {
      call.done = true;
      publish({
        type: "tool_ended",
        tool_call: call.id,
        state,
        at: now(),
        detail: null,
      });
    }

    function itemDone(item: Item) {
      if (item.type === "agentMessage") {
        if (!item.text) return;
        publish({
          type: "message_recorded",
          turn: ensureTurn(),
          message: ids.newId("msg"),
          model_call: modelCall,
          seq: ++seq,
          at: now(),
          body: {
            content: [{ type: "text", text: item.text }],
            reasoning:
              reasoning === "" ? null : { text: reasoning, duration_ms: null },
            cards: [],
          },
        });
        reasoning = "";
        modelCall = null;
        streamed.text = 0;
        streamed.reasoning = 0;
      } else if (item.type === "reasoning") {
        const parts =
          (item.summary ?? []).length > 0 ? item.summary : item.content;
        const text = (parts ?? [])
          .filter((one) => typeof one === "string")
          .join("\n\n");
        if (text !== "")
          reasoning = reasoning === "" ? text : `${reasoning}\n\n${text}`;
      } else if (
        item.type === "commandExecution" ||
        item.type === "fileChange" ||
        item.type === "mcpToolCall"
      ) {
        const call = toolStart(item);
        if (!call.done) toolEnd(call, toolState(item.status));
      }
    }

    function stream(kind: "text" | "reasoning", text: string) {
      if (text === "") return;
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

    // --- approvals
    function openApproval(rpc: number | string, method: string, params: Json) {
      const isCommand = method === "item/commandExecution/requestApproval";
      const call = calls.get(String(params.itemId));
      const decisions = params.availableDecisions;
      // 명령은 서버가 허락하는 결정에 acceptForSession이 있을 때만 "이 session 동안"을 낸다.
      const session = isCommand
        ? Array.isArray(decisions) && decisions.includes("acceptForSession")
        : true;
      const command = String(params.command ?? params.reason ?? "command");
      const paths = oneLine((call?.paths ?? []).join(", "), 200);
      const subject: AcpApprovalItem["subject"] = isCommand
        ? { kind: "shell", command }
        : {
            kind: "mcp_tool",
            server: "codex",
            tool: paths === "" ? "apply_patch" : `apply_patch: ${paths}`,
            effect: "write",
          };
      const request = ids.newId("apr");
      approvals.set(request, { rpc, session });
      publish({
        type: "approval_opened",
        approval: {
          id: request,
          subject,
          always_patterns: session
            ? [oneLine(isCommand ? command : "apply_patch", 500)]
            : [],
        },
      });
    }

    function closeApproval(
      id: string,
      decision: "once" | "always" | "reject" | "cancelled",
      reason?: string,
      answer = true,
    ) {
      const wait = approvals.get(id);
      if (wait === undefined) return;
      approvals.delete(id);
      const always = decision === "always" && wait.session;
      if (answer)
        write({
          id: wait.rpc,
          result: {
            decision:
              decision === "reject"
                ? "decline"
                : decision === "cancelled"
                  ? "cancel"
                  : always
                    ? "acceptForSession"
                    : "accept",
          },
        });
      const allowed = decision === "once" || decision === "always";
      publish({
        type: "approval_closed",
        request: id,
        outcome: allowed
          ? "allowed"
          : decision === "reject"
            ? "denied"
            : "cancelled",
        choice: allowed ? (always ? "always" : "once") : null,
        reason: reason ?? null,
        seq: ++seq,
        at: now(),
      });
    }

    // --- turns
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
      begin(next.content);
    }

    function endTurn(
      outcome: "completed" | "stopped" | "failed",
      error?: { code: string; message: string },
    ) {
      const id = turn ?? ids.newId("trn");
      for (const request of [...approvals.keys()])
        closeApproval(request, "cancelled");
      for (const call of calls.values())
        if (!call.done) toolEnd(call, "cancelled");
      calls.clear();
      reasoning = "";
      modelCall = null;
      streamed.text = 0;
      streamed.reasoning = 0;
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
      codexTurn = null;
      stopPending = false;
      if (dead === null) startNext();
    }

    const interrupt = () =>
      void request("turn/interrupt", { threadId, turnId: codexTurn }).catch(
        () => {},
      );

    // ACP turn은 이미 시작했다. app-server에 새 turn을 연다.
    function begin(content: ContentBlock[]) {
      request("turn/start", { threadId, input: textInput(content) }).then(
        (result) => {
          if (turn === null) return;
          codexTurn = (result.turn as { id: string }).id;
          if (stopPending) interrupt();
        },
        (cause: Error) =>
          endTurn("failed", { code: "internal", message: cause.message }),
      );
    }

    function sendNow(id: string, content: ContentBlock[]) {
      addUser(id, content);
      if (dead === null) begin(content);
      else endTurn("failed", dead);
    }

    // 도는 turn에 끼워 넣는다. 못 하면(turn이 막 끝남 등) 줄을 서거나 새 turn이 된다.
    async function steer(
      content: ContentBlock[],
      accepted: () => void,
      refused: () => void,
    ) {
      try {
        await request("turn/steer", {
          threadId,
          expectedTurnId: codexTurn,
          input: textInput(content),
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

    function onNotification(method: string, params: Json) {
      const item = params.item as Item | undefined;
      switch (method) {
        case "turn/started":
          codexTurn = (params.turn as { id: string }).id;
          ensureTurn();
          return;
        case "turn/completed": {
          const wire = params.turn as WireTurn;
          endTurn(
            wire.status === "completed"
              ? "completed"
              : wire.status === "interrupted"
                ? "stopped"
                : "failed",
            wire.status === "failed"
              ? {
                  code: "internal",
                  message: wire.error?.message ?? "codex turn failed",
                }
              : undefined,
          );
          return;
        }
        case "item/started":
          if (
            item !== undefined &&
            (item.type === "commandExecution" ||
              item.type === "fileChange" ||
              item.type === "mcpToolCall")
          )
            toolStart(item);
          return;
        case "item/completed":
          if (item !== undefined) itemDone(item);
          return;
        case "item/agentMessage/delta":
          stream("text", String(params.delta ?? ""));
          return;
        case "item/reasoning/summaryTextDelta":
        case "item/reasoning/textDelta":
          stream("reasoning", String(params.delta ?? ""));
          return;
        case "serverRequest/resolved":
          // app-server가 스스로 푼 요청(turn interrupt 등)이다. 답은 보내지 않는다.
          for (const [id, wait] of approvals)
            if (wait.rpc === params.requestId)
              closeApproval(id, "cancelled", undefined, false);
          return;
        default:
          return;
      }
    }

    function onRequest(rpc: number | string, method: string, params: Json) {
      if (
        method === "item/commandExecution/requestApproval" ||
        method === "item/fileChange/requestApproval"
      ) {
        openApproval(rpc, method, params);
        return;
      }
      // 질문, 권한 확장 같은 요청은 아직 옮기지 않는다. 답을 안 하면 turn이 멈추므로 오류로 돌려준다.
      write({
        id: rpc,
        error: {
          code: -32601,
          message: `${method} is not supported by the lophn window`,
        },
      });
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
        wait.reject(new Error(message.error.message));
      else wait.resolve(message.result ?? {});
    }

    let buffer = "";
    proc.onStdout((text) => {
      buffer += text;
      for (
        let end = buffer.indexOf("\n");
        end >= 0;
        end = buffer.indexOf("\n")
      ) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        if (line !== "" && !closed) onLine(line);
      }
    });
    proc.onStderr((text) => {
      stderrTail = (stderrTail + text).slice(-500);
    });

    const failure = (reason: string) => {
      if (dead !== null || closed) return;
      dead = {
        code: "unavailable",
        message: stderrTail === "" ? reason : `${reason}\n${stderrTail.trim()}`,
      };
      for (const wait of pending.values()) wait.reject(new Error(reason));
      pending.clear();
      endTurn("failed", dead);
    };
    proc.onExit(() => failure("codex exited."));

    // 앞 대화는 resume 응답의 turn과 item으로 같은 길을 거쳐 그린다. 사람 메시지마다 turn 하나다.
    function replay(turns: WireTurn[]) {
      for (const wire of turns) {
        for (const item of wire.items ?? []) {
          if (item.type !== "userMessage") {
            itemDone(item);
            continue;
          }
          const text = (item.content ?? [])
            .flatMap((one) => {
              const input = one as { type: string; text?: string };
              return input.type === "text" && input.text ? [input.text] : [];
            })
            .join("\n");
          if (text !== "") addUser(ids.newId("msg"), [{ type: "text", text }]);
        }
        if (turn !== null)
          endTurn(
            wire.status === "failed"
              ? "failed"
              : wire.status === "completed"
                ? "completed"
                : "stopped",
            wire.status === "failed"
              ? {
                  code: "internal",
                  message: wire.error?.message ?? "codex turn failed",
                }
              : undefined,
          );
      }
    }

    const ready = (async () => {
      await request("initialize", {
        clientInfo: { name: "lophn", title: null, version: "0" },
        capabilities: null,
      });
      write({ method: "initialized" });
      const opened =
        resume === undefined
          ? await request("thread/start", { cwd, ...THREAD_POLICY })
          : await request("thread/resume", {
              threadId: resume,
              cwd,
              ...THREAD_POLICY,
            });
      const thread = opened.thread as { id: string; turns?: WireTurn[] };
      threadId = thread.id;
      if (resume !== undefined) replay(thread.turns ?? []);
    })().catch((cause: Error) => failure(cause.message));

    function resendQueue() {
      for (const one of queue)
        publish({ type: "message_removed", message: one.id });
      for (const one of queue) publish({ type: "message_queued", queued: one });
    }

    function handle(message: AcpInput) {
      switch (message.type) {
        case "send": {
          if (turn === null) {
            sendNow(message.id, message.content);
            return;
          }
          if (message.delivery === "steer" && codexTurn !== null) {
            void steer(
              message.content,
              () => addUser(message.id, message.content, "steer"),
              () =>
                turn === null
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
          if (queued === undefined || turn === null || codexTurn === null)
            return;
          void steer(
            queued.content,
            () => {
              const index = queue.indexOf(queued);
              if (index < 0) return;
              queue.splice(index, 1);
              publish({
                type: "message_taken",
                message: queued.id,
                seq: ++seq,
                delivery: "steer",
                turn: null,
              });
            },
            () => {},
          );
          return;
        }
        case "stop":
          if (turn === null) return;
          if (codexTurn === null) stopPending = true;
          else interrupt();
          return;
        case "retry": {
          const content = turn === null ? userOf.get(message.turn) : undefined;
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
        // codex에는 질문 도구 응답(answer)이 아직 없다.
        default:
          return;
      }
    }
    session.onInput((message) => void ready.then(() => handle(message)));

    return {
      ok: true,
      value: {
        stop() {
          if (closed) return;
          for (const id of [...approvals.keys()])
            closeApproval(id, "cancelled");
          closed = true;
          proc.kill();
        },
      },
    };
  },
};
