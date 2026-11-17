// Antigravity(`agy`) adapter. 사람 PATH의 `agy acp`(ACP stdio, JSON-RPC 2.0 줄)를 띄워 `session/update`를 lophn ACP 갱신으로,
// 창의 ACP 입력을 ACP 요청으로 옮긴다. agy는 승인(`session/request_permission`)과 질문(`elicitation/create`)을 우리에게 요청으로
// 보내므로 사람이 정하기 전에는 답하지 않는다. 판은 사람 기계의 1.5.9(녹화 fixtures/antigravity)에 맞춘다.
// agy의 대화 id(`sessionId`)가 TUI의 conversation id라 `agy --conversation <id>`로 같은 대화를 잇는다. 사람의 `~/.gemini`는 읽기만 한다.
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { Result } from "../../../../../base/result.ts";
import { redactCredentials } from "../../../../../base/telemetry/log.ts";
import type { AcpInput } from "../../../../../protocol/acp/input.ts";
import {
  ACP_TOOL_BODY_LIMIT,
  type AcpNoticeItem,
  type AcpToolDetail,
  type AcpToolItem,
} from "../../../../../protocol/acp/items.ts";
import type {
  AcpCommand,
  AcpSessionMeta,
  AcpUsage,
} from "../../../../../protocol/acp/session.ts";
import type { AcpUpdate } from "../../../../../protocol/acp/state.ts";
import type { AcpApprovalSubject } from "../../../../../protocol/approvals/gate-call.ts";
import type {
  AcpCliSession,
  AcpTerminal,
} from "../../../../../protocol/extensions/mod.ts";
import type { ContentBlock } from "../../../../../protocol/lophn-agent/content-block.ts";
import type { HarnessGuiAdapter, HarnessGuiRun } from "./adapter.ts";
import { resendQueue, swapQueued } from "./queue.ts";
import { classifyReceived, type ReceivedText } from "./received.ts";

type Start = HarnessGuiAdapter["start"];

/** adapter가 파일 시스템에 닿는 길. 이미지 첨부를 읽고 agy 대화 file이 있는지만 본다. 쓰는 길은 없다. test가 바꾼다. */
export type AntigravityIo = {
  /** 사람의 home. `<home>/.gemini/antigravity-cli/conversations/<id>.db`가 대화 하나다. */
  home: string;
  readFile(path: string): Promise<Uint8Array>;
  exists(path: string): Promise<boolean>;
};

type Json = Record<string, unknown>;
type Reply =
  | { ok: true; data: Json }
  | { ok: false; error: string; code?: number };

const RECORDED_VERSION = "1.5.9";
// agy 판이 gate하지 않는다. adapter는 lophn의 제품 판을 모른다.
const CLIENT_VERSION = "0.0.0";
const MAX_FRAME_BYTES = 64 * 1024 * 1024;
const REQUEST_WAIT_MS = 30_000;
// stop이 도는 turn의 취소를 기다리는 시간. 넘으면 답을 기다리지 않고 stdin을 닫는다.
const STOP_POLITE_MS = 3000;
const EXIT_WAIT_MS = 3000;
// 우리 prompt 없이 agy가 스스로 낸 일(예약, 목표)은 turn을 끝낼 답이 없어 조용해지면 닫는다.
const IDLE_CLOSE_MS = 1500;
// turn이 끝나야 답하는 요청은 기한에서 뺀다.
const UNTIMED = new Set(["session/prompt", "session/load"]);
const EFFORT_ORDER = ["low", "medium", "high"];

const isRec = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const rec = (value: unknown): Json => (isRec(value) ? value : {});
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown) => (typeof value === "string" ? value : "");
const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const oneLine = (text: string, max: number) =>
  text
    .replace(/\s*\n\s*/g, " ")
    .trim()
    .slice(0, max);
const lines = (text: string) =>
  text === "" ? 0 : text.replace(/\n$/, "").split("\n").length;
const relative = (cwd: string, path: string) =>
  path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;
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
// biome-ignore lint/suspicious/noControlCharactersInRegex: 터미널 색 escape를 지운다.
const ANSI = /\u001b\[[0-9;]*m/g;
const plain = (text: string) => text.replace(ANSI, "");
const pick = (args: Json, keys: readonly string[]) => {
  for (const key of keys) {
    const value = str(args[key]);
    if (value !== "") return value;
  }
  return "";
};
// agy의 같은 tool이 입력 이름을 줄마다 다르게 쓴다(녹화와 다른 client의 관찰).
const COMMAND_KEYS = ["CommandLine", "command_line", "commandLine", "command"];
const PATH_KEYS = [
  "Path",
  "path",
  "AbsolutePath",
  "TargetFile",
  "FilePath",
  "file_path",
];
const OTHER_KEYS = ["Url", "url", "Query", "query", "Pattern", "pattern"];
// shell 출력 앞에 붙는 시각과 종료 줄. 사람이 보는 것은 명령 출력이다.
const SHELL_HEADER =
  /^(?:(?:Created At|Completed At): .*\n)*(?:Command exited with code -?\d+\.\n\n)?(?:Command output:\n)?/;
const CATEGORIES: Record<string, AcpToolItem["category"]> = {
  execute: "command",
  read: "read",
  search: "search",
  fetch: "web",
  list_dir: "list",
};
const SLASH = /^\/(\S+)(?:\s+([\s\S]*))?$/;
const POSIX_SAFE = /^[A-Za-z0-9._/:=+@-]+$/;
const shq = (value: string) =>
  POSIX_SAFE.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

type Opt = { value: string; name: string; description: string | null };
type Config = { id: string; current: string; options: Opt[] };
type Card = {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
};

type Call = {
  id: string;
  agy: string;
  name: string;
  kind: string;
  args: Json;
  /** 절대 경로. 없으면 "". */
  path: string;
  input: string;
  done: boolean;
  question?: { group: string; asked: Card[]; answers: string[][] };
};
type Queued = {
  id: string;
  content: ContentBlock[];
  text: string;
  steer: boolean;
};
// 사람 응답을 기다리는 agy 요청 하나. 한 번에 하나만 카드로 연다(composer 위 자리가 하나다).
type Dialog =
  | {
      kind: "approval";
      rpc: string | number;
      request: string;
      call: Call | undefined;
      tc: Json;
      options: { id: string; kind: string }[];
    }
  | {
      kind: "question";
      rpc: string | number;
      group: string;
      toolCall: string;
      asked: Card[];
      // 질문마다 form 칸 이름과 고른 글 → 값. 권한 요청 형태의 질문은 칸이 없고 optionId가 값이다.
      fields: { key: string; values: Map<string, string> }[] | null;
      permission: { id: string; label: string }[] | null;
    };

const ADAPTER_COMMANDS: AcpCommand[] = [
  {
    name: "resume",
    aliases: [],
    description: "Open an earlier conversation in this folder",
    argument_hint: null,
    source: "harness",
    opens: "resume",
  },
];

const start: (io: AntigravityIo) => Start =
  (io) =>
  async ({ cwd, resume, session, spawn, clock, ids }) => {
    let closed = false;
    let exited = false;
    let stopping = false;
    let started = false;
    let stderrTail = "";
    const tail = () =>
      stderrTail === "" ? "" : `\n${redactCredentials(stderrTail.trim())}`;
    const now = () => clock.now();

    // 지난 대화를 한 묶음으로 그리려고 replay 동안은 모아 두었다가 한꺼번에 publish한다(지키는 것 11).
    let held: AcpUpdate[] | null = null;
    let seq = 0;
    const publish = (update: AcpUpdate) => {
      if (closed) return;
      if (held !== null) held.push(update);
      else session.publish(update);
    };

    // --- 연결 ---
    let proc!: ReturnType<typeof spawn>;
    let counter = 0;
    const waiting = new Map<number, (reply: Reply) => void>();
    let gone: Promise<void> = Promise.resolve();
    let warnedUnreadable = false;
    function unreadable(why: string) {
      if (warnedUnreadable) return;
      warnedUnreadable = true;
      info(`agy sent a message lophn could not read: ${why}`, "warning");
    }
    const write = (body: Json) => {
      if (exited) return;
      proc.write(`${JSON.stringify({ jsonrpc: "2.0", ...body })}\n`);
    };
    function request(method: string, params: Json): Promise<Reply> {
      if (exited) return Promise.resolve({ ok: false, error: "agy exited" });
      const id = ++counter;
      return new Promise((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        waiting.set(id, (reply) => {
          clearTimeout(timer);
          resolve(reply);
        });
        if (!UNTIMED.has(method)) {
          timer = setTimeout(() => {
            waiting.delete(id);
            resolve({
              ok: false,
              error: `agy did not answer ${method} in 30 seconds.`,
            });
          }, REQUEST_WAIT_MS);
        }
        write({ id, method, params });
      });
    }
    const respond = (rpc: string | number, result: Json) =>
      write({ id: rpc, result });

    function connect() {
      const mine = spawn("agy", ["acp"], { cwd });
      proc = mine;
      exited = false;
      stderrTail = "";
      let buffer = "";
      // 넘친 줄을 버리는 중이면 다음 줄바꿈까지 받은 것도 그 줄의 꼬리라 버린다.
      let skipping = false;
      let done: () => void = () => {};
      gone = new Promise<void>((resolve) => {
        done = resolve;
      });
      function onLine(line: string) {
        if (line.trim() === "") return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch {
          return unreadable("a line is not JSON");
        }
        if (!isRec(parsed)) return unreadable("it is not an object");
        try {
          onMessage(parsed);
        } catch (error) {
          unreadable(reason(error));
        }
      }
      mine.onStderr((text) => {
        stderrTail = (stderrTail + text).slice(-500);
      });
      mine.onStdout((text) => {
        if (proc !== mine) return;
        buffer += text;
        for (
          let at = buffer.indexOf("\n");
          at >= 0;
          at = buffer.indexOf("\n")
        ) {
          const line = buffer.slice(0, at);
          buffer = buffer.slice(at + 1);
          if (skipping) skipping = false;
          else if (line.length > MAX_FRAME_BYTES)
            unreadable("a line is too long");
          else onLine(line);
        }
        if (buffer.length > MAX_FRAME_BYTES) {
          buffer = "";
          skipping = true;
          unreadable("a line is too long");
        }
      });
      mine.onExit((code) => {
        if (proc !== mine) return;
        exited = true;
        for (const answer of waiting.values()) {
          answer({ ok: false, error: "agy exited" });
        }
        waiting.clear();
        done();
        if (!started || closed || stopping || reviving !== null) return;
        const message = `agy exited${code === null ? "" : ` (code ${code})`}.${tail()}`;
        if (turn !== null) {
          endTurn("failed", { code: "unavailable", message });
        } else info(message, "warning");
      });
    }

    function onMessage(msg: Json) {
      if (typeof msg.method === "string") {
        if (msg.id === undefined) onNotification(msg.method, rec(msg.params));
        else
          onAgentRequest(
            msg.id as string | number,
            msg.method,
            rec(msg.params),
          );
        return;
      }
      if (typeof msg.id !== "number") return;
      const answer = waiting.get(msg.id);
      if (answer === undefined) return;
      waiting.delete(msg.id);
      if (msg.error !== undefined) {
        const error = rec(msg.error);
        answer({
          ok: false,
          error: redactCredentials(str(error.message) || "agy failed"),
          ...(typeof error.code === "number" ? { code: error.code } : {}),
        });
      } else answer({ ok: true, data: rec(msg.result) });
    }

    // --- 대화 상태 ---
    let sessionId = "";
    // load 중에는 아직 우리 것으로 확정하지 않은 id의 갱신도 받는다.
    let opening = false;
    let replaying = false;
    let turn: string | null = null;
    let turnWork = false;
    // turn이 열린 동안 prompt 요청이 몇 개 답을 기다리는가. steer는 첫 prompt에 바로 end_turn을 답하고 이어 가므로
    // ACP turn은 마지막 prompt가 답할 때 끝난다.
    let outstanding = 0;
    let cancelling = false;
    let lastStop = "";
    let driven = false;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let commandPrompts = 0;
    const calls = new Map<string, Call>();
    const denied = new Set<string>();
    const turnText = new Map<string, string>();
    // 창이 낸 사람 메시지가 agy에서 되돌아오는 글. 겹쳐 내지 않으려고 거른다. steer는 되돌아올 때 줄에서 대화로 올라간다.
    let echoes: { text: string; id: string; queued: boolean }[] = [];
    let queue: Queued[] = [];
    let steered: Queued[] = [];
    let warnings: string[] = [];
    let stream: {
      call: string;
      text: string;
      thought: string;
      warning: boolean;
    } | null = null;

    let configs: Config[] = [];
    let legacy: string[] = [];
    let changed = { model: false, thought: false, mode: false };
    let title: string | null = null;
    let context: { used: number; size: number } | null = null;
    let totals: Record<string, number> | null = null;
    let commands: { name: string; description: string; hint: string | null }[] =
      [];
    let canImage = true;
    let metaReady = false;
    let reviving: Promise<string | null> | null = null;

    const norm = (text: string) => text.trim();
    const db = (id: string) =>
      join(io.home, ".gemini", "antigravity-cli", "conversations", `${id}.db`);

    function startTurn(): string {
      const id = ids.newId("trn");
      turn = id;
      turnWork = false;
      lastStop = "";
      publish({ type: "turn_started", turn: id, at: now() });
      return id;
    }
    const ensureTurn = () => turn ?? startTurn();

    // `outside`는 도는 turn의 일부가 아닌 알림이다(명령 출력).
    function notice(body: AcpNoticeItem["notice"], outside = false) {
      publish({
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
    function info(text: string, level: "info" | "warning" = "info") {
      notice({ type: "info", text: redactCredentials(plain(text)), level });
    }

    function addMessage(
      id: string,
      content: ContentBlock[],
      extra?: { received?: ReceivedText; delivery?: "next_turn" | "steer" },
    ) {
      const mine = ensureTurn();
      publish({
        type: "message_added",
        item: {
          kind: "message",
          id,
          seq: ++seq,
          at: now(),
          actor: extra?.received === undefined ? "user" : "received",
          sender: extra?.received?.sender ?? null,
          call: extra?.received?.call ?? null,
          reply_to: extra?.received?.reply_to ?? null,
          delivery: extra?.delivery ?? "next_turn",
          turn: mine,
          origin: null,
          content,
          reasoning: null,
          cards: [],
          complete: true,
        },
      });
      return mine;
    }

    // 사람이 아닌 쪽이 넣은 user 글(lophn call·reply)은 받은 메시지로, 나머지는 사람 메시지로 그린다.
    function addUserText(text: string) {
      const received = classifyReceived(text);
      if (received !== null) {
        addMessage(ids.newId("msg"), [{ type: "text", text: received.text }], {
          received,
        });
      } else addMessage(ids.newId("msg"), [{ type: "text", text }]);
    }

    // --- 글 ---
    // 같은 응답의 글 조각은 tool이나 다음 사람 말이 끼기 전까지 한 message다.
    function closeStream() {
      const current = stream;
      if (current === null) return;
      stream = null;
      if (current.warning) {
        // 상류 오류(과부하, 한도)는 답이 아니라 경고다. turn 끝에서 알림이나 실패로 낸다.
        warnings.push(current.text.trim());
        return;
      }
      if (current.text === "" && current.thought === "") return;
      turnWork = true;
      publish({
        type: "message_recorded",
        turn: ensureTurn(),
        message: ids.newId("msg"),
        model_call: current.call,
        seq: ++seq,
        at: now(),
        body: {
          content:
            current.text === "" ? [] : [{ type: "text", text: current.text }],
          reasoning:
            current.thought === ""
              ? null
              : { text: current.thought, duration_ms: null },
          cards: [],
        },
      });
    }

    function onText(kind: "text" | "thought", text: string) {
      if (text === "") return;
      activity();
      if (stream === null) {
        stream = {
          call: ids.newId("mcl"),
          text: "",
          thought: "",
          warning: kind === "text" && /^\s*⚠/u.test(text),
        };
      }
      const current = stream;
      if (!current.warning) {
        publish({
          type: "writing_streamed",
          turn: ensureTurn(),
          model_call: current.call,
          kind: kind === "text" ? "text" : "reasoning",
          offset: current[kind].length,
          text,
          at: now(),
        });
      }
      current[kind] += text;
    }

    // 우리가 연 turn이 아닌 곳에서 agy가 일을 시작하면 turn을 열고, 조용해지면 닫는다.
    function activity() {
      if (replaying) {
        ensureTurn();
        return;
      }
      if (turn === null) {
        startTurn();
        driven = true;
      }
      if (!driven || outstanding > 0) return;
      clearTimeout(idle);
      idle = setTimeout(() => {
        if (open !== null || dialogs.length > 0) return activity();
        driven = false;
        endTurn("completed");
      }, IDLE_CLOSE_MS);
    }

    // --- tool ---
    function detailOf(call: Call): AcpToolDetail {
      if (call.name === "ask_question") {
        return { kind: "question", group: null, outcome: null, lines: [] };
      }
      if (call.kind === "edit" && call.path !== "") {
        return {
          kind: "edit",
          document: call.path,
          path: relative(cwd, call.path),
          added: lines(pick(call.args, ["Content", "content", "Replacement"])),
          removed: lines(pick(call.args, ["Target"])),
        };
      }
      return { kind: "generic" };
    }

    function startCall(u: Json): Call {
      closeStream();
      activity();
      const args = isRec(u.rawInput) ? u.rawInput : rec(u.args);
      const name = str(u.name) || "tool";
      const located = str(rec(arr(u.locations)[0]).path);
      const given = pick(args, PATH_KEYS) || located;
      const call: Call = {
        id: ids.newId("tcl"),
        agy: str(u.toolCallId),
        name,
        kind: str(u.kind),
        args,
        path: given === "" ? "" : isAbsolute(given) ? given : join(cwd, given),
        input: JSON.stringify(args, null, 2),
        done: false,
      };
      calls.set(call.agy, call);
      turnWork = true;
      const first = rec(arr(args.questions)[0]);
      const summary = oneLine(
        pick(args, COMMAND_KEYS) ||
          (call.path === "" ? "" : relative(cwd, call.path)) ||
          str(first.question) ||
          pick(args, OTHER_KEYS),
        120,
      );
      publish({
        type: "tool_started",
        item: {
          kind: "tool",
          id: call.id,
          seq: ++seq,
          at: now(),
          by: "agent",
          turn: ensureTurn(),
          tool: name,
          category:
            CATEGORIES[call.kind] ?? CATEGORIES[name] ?? ("other" as const),
          title: summary === "" ? name : `${name} ${summary}`,
          state: "running",
          duration_ms: null,
          detail: detailOf(call),
          body: bodyOf(call.input, null),
        },
      });
      return call;
    }

    function outputOf(call: Call, u: Json): string | null {
      const raw = rec(u.rawOutput);
      const written = str(raw.output);
      if (call.kind === "execute" || written !== "") {
        const text = plain(written).replace(/\r\n/g, "\n");
        return (
          (call.kind === "execute" ? text.replace(SHELL_HEADER, "") : text) ||
          null
        );
      }
      const text = arr(u.content)
        .map((one) => {
          const inner = rec(rec(one).content);
          return rec(one).type === "content" ? str(inner.text) : "";
        })
        .join("");
      return text === "" ? null : text;
    }

    function endCall(call: Call, u: Json) {
      if (call.done) return;
      call.done = true;
      const raw = rec(u.rawOutput);
      const exit = typeof raw.exit_code === "number" ? raw.exit_code : 0;
      const state: "ok" | "error" | "denied" | "cancelled" =
        str(u.status) === "completed"
          ? exit === 0
            ? "ok"
            : "error"
          : denied.has(call.agy)
            ? "denied"
            : cancelling || str(u.status) === "cancelled"
              ? "cancelled"
              : "error";
      let detail: AcpToolDetail | null = null;
      const diff = arr(u.content)
        .map(rec)
        .find((one) => one.type === "diff");
      if (diff !== undefined) {
        const path = str(diff.path);
        const document = isAbsolute(path) ? path : join(cwd, path);
        detail = {
          kind: "edit",
          document,
          path: relative(cwd, document),
          added: lines(str(diff.newText)),
          removed: lines(str(diff.oldText)),
        };
      } else if (call.name === "ask_question") {
        const asked = call.question;
        const given = arr(call.args.questions).map(rec);
        detail = {
          kind: "question",
          group: asked?.group ?? null,
          outcome: state === "ok" ? "submitted" : "cancelled",
          lines: (asked?.asked ?? given.map(toCard)).map((one, index) => ({
            header: one.header,
            answer: asked?.answers[index]?.join(", ") ?? null,
          })),
        };
      }
      publish({
        type: "tool_ended",
        tool_call: call.id,
        state,
        at: now(),
        detail,
        body: bodyOf(call.input, outputOf(call, u)),
      });
    }

    function onTool(u: Json) {
      const id = str(u.toolCallId);
      if (id === "") return;
      const call = calls.get(id) ?? startCall(u);
      const status = str(u.status);
      if (status === "completed" || status === "failed") endCall(call, u);
    }

    // --- 사람이 답할 것(승인과 질문) ---
    let dialogs: Dialog[] = [];
    let open: Dialog | null = null;

    const toCard = (one: Json): Card => ({
      question: str(one.question) || "Question",
      header: oneLine(str(one.question) || "Question", 24),
      options: arr(one.options).map((option) => ({
        label: str(option),
        description: str(option),
      })),
      multiSelect: one.is_multi_select === true,
    });

    function subjectOf(call: Call | undefined, tc: Json): AcpApprovalSubject {
      const kind = call?.kind ?? str(tc.kind);
      const name = call?.name ?? str(tc.name);
      const args = call?.args ?? rec(tc.rawInput);
      const command = pick(args, COMMAND_KEYS);
      if (kind === "execute" && command !== "")
        return { kind: "shell", command };
      if (kind === "edit" && call !== undefined && call.path !== "") {
        return {
          kind: "file_change",
          changes: [
            {
              path: relative(cwd, call.path),
              change: name.includes("write") ? "create" : "update",
              added: null,
              removed: null,
            },
          ],
        };
      }
      return {
        kind: "mcp_tool",
        server: "antigravity",
        tool: name || "tool",
        effect:
          kind === "read" || kind === "search"
            ? "read"
            : kind === "edit"
              ? "write"
              : "external",
      };
    }

    function pump() {
      if (open !== null) return;
      const next = dialogs.shift();
      if (next === undefined) return;
      open = next;
      if (next.kind === "approval") {
        const always = next.options.some((one) => one.kind === "allow_always");
        publish({
          type: "approval_opened",
          approval: {
            id: next.request,
            subject: subjectOf(next.call, next.tc),
            choices: always ? ["once", "always", "reject"] : ["once", "reject"],
            // agy가 allow_always를 자기 설정에 저장한다(영구).
            always_patterns: always
              ? ["Saved permanently to Antigravity's permission settings"]
              : [],
          },
        });
      } else {
        publish({
          type: "question_asked",
          group: next.group,
          tool_call: next.toolCall,
          questions: next.asked,
        });
      }
    }

    function closeDialog(
      dialog: Dialog,
      how:
        | {
            approval: "allowed" | "denied" | "cancelled";
            choice?: "once" | "always";
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
          reason: null,
          mode: null,
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

    const cancelledAnswer = (dialog: Dialog): Json =>
      dialog.kind === "question" && dialog.permission === null
        ? { action: "cancel" }
        : { outcome: { outcome: "cancelled" } };

    // 열린 요청 전부를 취소로 답한다(사람이 멈췄거나 turn이 끝났다).
    function cancelDialogs() {
      const all = [open, ...dialogs].filter((one) => one !== null);
      dialogs = [];
      for (const dialog of all) {
        respond(dialog.rpc, cancelledAnswer(dialog));
        closeDialog(
          dialog,
          dialog.kind === "approval"
            ? { approval: "cancelled" }
            : { question: "cancelled" },
        );
      }
    }

    function onPermission(rpc: string | number, params: Json) {
      const tc = rec(params.toolCall);
      const agy = str(tc.toolCallId);
      const options = arr(params.options)
        .map(rec)
        .map((one) => ({
          id: str(one.optionId),
          kind: str(one.kind),
          name: str(one.name) || str(one.optionId),
        }));
      if (agy.startsWith("interaction_")) {
        const shown = options.map((one) => ({ id: one.id, label: one.name }));
        const label = str(tc.title) || "Question";
        const cardOptions = shown
          .map((one) => ({ label: one.label, description: one.label }))
          .slice(0, 4);
        // 질문 카드는 선택지가 둘 이상이어야 한다. 모자라면 취소로 답하는 칸을 더한다.
        while (cardOptions.length < 2) {
          cardOptions.push({ label: "Cancel", description: "Cancel" });
        }
        const group = ids.newId("qgr");
        const call = calls.get(agy);
        dialogs.push({
          kind: "question",
          rpc,
          group,
          toolCall: call?.id ?? ids.newId("tcl"),
          asked: [
            {
              question: label,
              header: oneLine(label, 24),
              options: cardOptions,
              multiSelect: false,
            },
          ],
          fields: null,
          permission: shown,
        });
        return pump();
      }
      const call = calls.get(agy) ?? (agy === "" ? undefined : startCall(tc));
      dialogs.push({
        kind: "approval",
        rpc,
        request: ids.newId("apr"),
        call,
        tc,
        options,
      });
      pump();
    }

    function onElicitation(rpc: string | number, params: Json) {
      const props = rec(rec(params.requestedSchema).properties);
      const fields: { key: string; values: Map<string, string> }[] = [];
      const asked: Card[] = [];
      const keys = Object.keys(props)
        .filter((key) => /^q\d+$/.test(key))
        .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
        .slice(0, 4);
      for (const key of keys) {
        const field = rec(props[key]);
        const values = new Map<string, string>();
        const options = arr(field.oneOf)
          .map(rec)
          .map((one) => ({
            label: str(one.title) || str(one.const),
            value: str(one.const),
          }))
          .slice(0, 4);
        for (const one of options) values.set(one.label, one.value);
        const label = str(field.title) || str(params.message) || "Question";
        // 질문 카드는 선택지가 둘 이상이어야 한다. 선택지가 없는 칸은 자유 답만 받는다.
        const shown = options.map((one) => ({
          label: one.label,
          description: one.label,
        }));
        while (shown.length < 2) {
          shown.push({ label: "Other", description: "Other" });
        }
        asked.push({
          question: label,
          header: oneLine(label, 24),
          options: shown,
          multiSelect: false,
        });
        fields.push({ key, values });
      }
      const call = calls.get(str(params.toolCallId));
      const group = ids.newId("qgr");
      if (asked.length === 0) {
        respond(rpc, { action: "decline" });
        return;
      }
      if (call !== undefined) call.question = { group, asked, answers: [] };
      dialogs.push({
        kind: "question",
        rpc,
        group,
        toolCall: call?.id ?? ids.newId("tcl"),
        asked,
        fields,
        permission: null,
      });
      pump();
    }

    function onAgentRequest(
      rpc: string | number,
      method: string,
      params: Json,
    ) {
      if (method === "session/request_permission") onPermission(rpc, params);
      else if (method === "elicitation/create") onElicitation(rpc, params);
      else
        write({
          id: rpc,
          error: { code: -32601, message: `${method} is not supported` },
        });
    }

    function decide(message: Extract<AcpInput, { type: "decide" }>) {
      const dialog = open;
      if (dialog?.kind !== "approval" || dialog.request !== message.request) {
        return;
      }
      const kind = message.choice.kind;
      if (kind === "session" || kind === "mode") return;
      const want =
        kind === "once"
          ? ["allow_once"]
          : kind === "always"
            ? ["allow_always"]
            : ["reject_once", "reject_always"];
      const option = want
        .map((one) => dialog.options.find((it) => it.kind === one))
        .find((it) => it !== undefined);
      // 맞는 선택지가 없으면 허락하지 않고 취소로 답한다.
      if (option === undefined) {
        respond(dialog.rpc, { outcome: { outcome: "cancelled" } });
        closeDialog(dialog, { approval: "cancelled" });
        return;
      }
      respond(dialog.rpc, {
        outcome: { outcome: "selected", optionId: option.id },
      });
      if (kind === "reject" && dialog.call !== undefined) {
        denied.add(dialog.call.agy);
      }
      closeDialog(
        dialog,
        kind === "reject"
          ? { approval: "denied" }
          : {
              approval: "allowed",
              choice: kind === "always" ? "always" : "once",
            },
      );
    }

    function answer(message: Extract<AcpInput, { type: "answer" }>) {
      const dialog = open;
      if (dialog?.kind !== "question") return;
      const given = message.answers.map((one) =>
        one.status === "answered" ? one.answer : [],
      );
      if (dialog.permission !== null) {
        const label = given[0]?.[0];
        const picked = dialog.permission.find((one) => one.label === label);
        respond(
          dialog.rpc,
          picked === undefined
            ? { outcome: { outcome: "cancelled" } }
            : { outcome: { outcome: "selected", optionId: picked.id } },
        );
        closeDialog(dialog, {
          question: picked === undefined ? "cancelled" : "submitted",
        });
        return;
      }
      const call = [...calls.values()].find(
        (one) => one.question?.group === dialog.group,
      );
      if (call?.question) call.question.answers = given;
      // 칸 이름이 틀리면 agy는 "You did not make a choice"로 본다(녹화). 고른 글은 const, 자유 글은 `<칸>_other`다.
      const content: Json = {};
      (dialog.fields ?? []).forEach((field, index) => {
        const reply = given[index] ?? [];
        const label = reply[0];
        const value = label === undefined ? undefined : field.values.get(label);
        if (value !== undefined) content[field.key] = value;
        else if (reply.length > 0)
          content[`${field.key}_other`] = reply.join(", ");
      });
      const answered = Object.keys(content).length > 0;
      respond(
        dialog.rpc,
        answered ? { action: "accept", content } : { action: "decline" },
      );
      closeDialog(dialog, { question: answered ? "submitted" : "cancelled" });
    }

    // --- 갱신 ---
    function onUser(text: string) {
      if (replaying) {
        closeStream();
        endTurn("completed");
        addUserText(text);
        return;
      }
      const index = echoes.findIndex((one) => one.text === norm(text));
      const echo = echoes[index];
      if (echo !== undefined) {
        echoes.splice(index, 1);
        if (echo.queued) takeSteered(echo.id);
        return;
      }
      // 명령 prompt는 agy가 펼친 글을 되돌려 줄 수 있다. 사람이 친 글이 아니라 그리지 않는다.
      if (commandPrompts > 0) return;
      closeStream();
      activity();
      addUserText(text);
    }

    function takeSteered(id: string) {
      const index = steered.findIndex((one) => one.id === id);
      if (index < 0) return;
      steered.splice(index, 1);
      closeStream();
      publish({
        type: "message_taken",
        message: id,
        seq: ++seq,
        delivery: "steer",
        turn: null,
      });
    }

    function onUpdate(u: Json) {
      switch (str(u.sessionUpdate)) {
        case "user_message_chunk": {
          const content = rec(u.content);
          if (content.type === "text") onUser(str(content.text));
          return;
        }
        case "agent_message_chunk":
        case "agent_thought_chunk": {
          const content = rec(u.content);
          if (content.type !== "text") return;
          onText(
            u.sessionUpdate === "agent_message_chunk" ? "text" : "thought",
            str(content.text),
          );
          return;
        }
        case "tool_call":
        case "tool_call_update":
          return onTool(u);
        case "session_info_update":
          if (typeof u.title === "string") {
            title = u.title;
            publishPart({ title });
          }
          return;
        case "usage_update":
          if (typeof u.used === "number" && typeof u.size === "number") {
            context = { used: u.used, size: u.size };
            publishPart({ usage: usageOf() });
          }
          return;
        case "available_commands_update":
          commands = arr(u.availableCommands)
            .map(rec)
            .filter((one) => str(one.name) !== "")
            .map((one) => ({
              name: str(one.name),
              description: str(one.description),
              hint: str(rec(one.input).hint) || null,
            }));
          publishPart({ commands: commandList() });
          return;
        case "config_option_update":
          applyConfigs(u.configOptions);
          publishMeta();
          return;
        case "current_mode_update": {
          const mode = configs.find((one) => one.id === "mode");
          if (mode !== undefined) mode.current = str(u.currentModeId);
          publishPart({ mode: modeNow() });
          return;
        }
      }
    }

    function onNotification(method: string, params: Json) {
      if (method === "session/update") {
        const id = str(params.sessionId);
        if (!opening && id !== "" && id !== sessionId) return;
        onUpdate(rec(params.update));
      } else if (method === "$/cancel_request") {
        // agy가 이미 포기한 요청이다. 답하지 않고 카드만 닫는다.
        const target = [open, ...dialogs].find(
          (one) => one?.rpc === params.requestId,
        );
        if (target)
          closeDialog(
            target,
            target.kind === "approval"
              ? { approval: "cancelled" }
              : { question: "cancelled" },
          );
      }
    }

    // --- turn ---
    function endTurn(
      outcome: "completed" | "stopped" | "failed",
      error?: { code: string; message: string },
    ) {
      if (turn === null) return;
      closeStream();
      clearTimeout(idle);
      driven = false;
      let failure = error ?? null;
      const alerts = warnings;
      warnings = [];
      let result = outcome;
      if (alerts.length > 0) {
        if (outcome === "completed" && !turnWork) {
          result = "failed";
          failure = {
            code: "unavailable",
            message: redactCredentials(alerts.join("\n").replace(/^⚠\s*/u, "")),
          };
        } else
          for (const text of alerts)
            info(text.replace(/^⚠\s*/u, ""), "warning");
      }
      for (const one of [...steered]) takeSteered(one.id);
      echoes = [];
      cancelDialogs();
      for (const call of calls.values()) {
        if (!call.done) endCall(call, { status: "cancelled" });
      }
      calls.clear();
      const id = turn;
      turn = null;
      outstanding = 0;
      cancelling = false;
      publish({
        type: "turn_ended",
        turn: id,
        at: now(),
        outcome: result,
        active_ms: null,
        error: failure,
        messages: [],
        seq: ++seq,
      });
      if (!replaying) void Promise.resolve().then(flushQueue);
    }

    function onPromptReply(
      reply: Reply,
      meta: { command?: string; steer?: string },
    ) {
      outstanding = Math.max(0, outstanding - 1);
      if (meta.command !== undefined) commandPrompts -= 1;
      let failed: string | null = null;
      if (reply.ok) {
        lastStop = str(reply.data.stopReason);
        addTokens(rec(reply.data.usage));
      } else if (meta.steer !== undefined) {
        // 받지 못한 steer는 줄에서 빼고 알린다. 도는 turn은 그대로다.
        steered = steered.filter((one) => one.id !== meta.steer);
        echoes = echoes.filter((one) => one.id !== meta.steer);
        publish({ type: "message_removed", message: meta.steer });
        info(`agy did not take the message: ${reply.error}`, "warning");
      } else failed = reply.error;
      if (outstanding > 0 || turn === null) return;
      if (failed !== null) {
        endTurn("failed", {
          code: exited ? "unavailable" : "internal",
          message: `${failed}${exited ? tail() : ""}`,
        });
        return;
      }
      if (meta.command !== undefined && !turnWork) {
        notice(
          {
            type: "command_output",
            command: meta.command,
            text:
              meta.command === "compact"
                ? `Compacted the conversation.${context === null ? "" : ` The context now holds ${context.used} of ${context.size} tokens.`}`
                : `Ran /${meta.command}.`,
            format: "markdown",
          },
          true,
        );
      }
      if (cancelling || lastStop === "cancelled") endTurn("stopped");
      else if (lastStop === "refusal") {
        endTurn("failed", {
          code: "forbidden",
          message: "agy declined the request.",
        });
      } else endTurn("completed");
    }

    function addTokens(usage: Json) {
      if (totals === null) return;
      for (const [key, value] of [
        ["input", usage.inputTokens],
        ["output", usage.outputTokens],
        ["cacheRead", usage.cachedReadTokens],
        ["cacheWrite", usage.cachedWriteTokens],
        ["turns", 1],
      ] as const) {
        if (typeof value === "number") totals[key] = (totals[key] ?? 0) + value;
      }
      publishPart({ usage: usageOf() });
    }

    // --- 설정과 meta ---
    function applyConfigs(list: unknown) {
      if (!Array.isArray(list)) return;
      configs = list.map(rec).flatMap((one) => {
        const options = arr(one.options).flatMap((option) => {
          const inner = rec(option);
          const flat = Array.isArray(inner.options) ? inner.options : [inner];
          return flat.map(rec).map((it) => ({
            value: str(it.value),
            name: str(it.name) || str(it.value),
            description: str(it.description) || null,
          }));
        });
        return str(one.id) === ""
          ? []
          : [{ id: str(one.id), current: str(one.currentValue), options }];
      });
    }
    const cfg = (id: string) => configs.find((one) => one.id === id);
    const modelNow = () => cfg("model")?.current ?? "";
    const modeNow = () => cfg("mode")?.current ?? null;

    // 모델마다 thinking 단계가 있는지는 session/new의 legacy id(`gemini-3.8-flash-low`)에서 읽고, 지금 모델은 thought_level 칸이 맞다.
    function efforts(model: string): Opt[] {
      const seen = legacy.flatMap((id) =>
        id.startsWith(`${model}-`) &&
        EFFORT_ORDER.includes(id.slice(model.length + 1))
          ? [id.slice(model.length + 1)]
          : [],
      );
      if (seen.length > 0) {
        return EFFORT_ORDER.filter((one) => seen.includes(one)).map((one) => ({
          value: one,
          name: capital(one),
          description: null,
        }));
      }
      return model === modelNow() ? (cfg("thought_level")?.options ?? []) : [];
    }

    function usageOf(): AcpUsage | null {
      if (context === null && totals === null) return null;
      return {
        context:
          context === null
            ? null
            : { tokens: context.used, limit: context.size, parts: [] },
        limits: [],
        input_tokens: totals?.input ?? null,
        output_tokens: totals?.output ?? null,
        cache_read_tokens: totals?.cacheRead ?? null,
        cache_write_tokens: totals?.cacheWrite ?? null,
        turns: totals?.turns ?? null,
        costs: [],
        provider: null,
      };
    }

    function commandList(): AcpCommand[] {
      return [
        ...commands.map((one) => ({
          name: one.name,
          aliases: [],
          description: one.description,
          argument_hint: one.hint,
          source: "harness" as const,
          opens: one.name === "compact" ? ("compact" as const) : null,
        })),
        ...ADAPTER_COMMANDS,
      ];
    }
    const isCommand = (name: string) =>
      commandList().some((one) => one.name === name);

    function meta(): AcpSessionMeta {
      const model = cfg("model");
      const thought = cfg("thought_level");
      const mode = cfg("mode");
      const current = model?.options.find((one) => one.value === model.current);
      return {
        title,
        cli_session: sessionId === "" ? null : sessionId,
        capabilities: {
          model: true,
          effort: true,
          mode: true,
          commands: true,
          rewind: false,
          rewind_files: false,
          fork: false,
          compact: true,
          rename: false,
          usage: true,
          steer: true,
          background: false,
          queue_edit: true,
          images: canImage,
          retry: true,
          sessions: false,
          stop_child: false,
          steer_child: false,
          tasks: false,
          toggles: false,
          goal: false,
          roles: false,
          shell: false,
          resume: true,
        },
        models:
          model === undefined
            ? []
            : [
                {
                  id: "antigravity",
                  label: "Antigravity",
                  models: model.options.map((one) => {
                    const levels = efforts(one.value);
                    return {
                      id: one.value,
                      label: one.name,
                      axes:
                        levels.length === 0
                          ? []
                          : [
                              {
                                id: "effort",
                                label: "Thinking",
                                kind: "choice" as const,
                                values: levels.map((level) => ({
                                  value: level.value,
                                  label: level.name,
                                })),
                              },
                            ],
                    };
                  }),
                },
              ],
        model:
          model === undefined
            ? null
            : {
                model: model.current,
                label: current?.name ?? model.current,
                options:
                  thought === undefined ? {} : { effort: thought.current },
                layer: null,
              },
        modes: (mode?.options ?? []).map((one) => ({
          id: one.value,
          label: one.name,
          description: one.description,
        })),
        mode: mode?.current ?? null,
        commands: commandList(),
        usage: usageOf(),
        toggles: [],
        goal: null,
        roles: null,
        harness: "antigravity",
      };
    }
    const publishMeta = () => {
      metaReady = true;
      publish({ type: "session_changed", session: meta() });
    };
    // 첫 갱신은 칸을 다 싣는다(지키는 것 계약). meta가 나가기 전의 일부 갱신은 상태만 두고 첫 publishMeta가 싣는다.
    const publishPart = (part: Partial<AcpSessionMeta>) => {
      if (metaReady) publish({ type: "session_changed", session: part });
    };

    // --- 대화 열기 ---
    function resetConversation() {
      stream = null;
      calls.clear();
      denied.clear();
      turnText.clear();
      echoes = [];
      queue = [];
      steered = [];
      warnings = [];
      title = null;
      context = null;
    }

    // 새 대화를 열거나(id 없음, 파일 없음) 있는 대화를 load한다. load는 지난 대화를 갱신으로 먼저 흘리므로 모아서 낸다.
    // discard는 process를 다시 띄운 뒤 이미 화면에 있는 대화를 다시 읽기만 하는 길이다.
    async function openConversation(
      id: string | null,
      how: "draw" | "discard",
    ): Promise<string | null> {
      const saved = seq;
      opening = true;
      const loading = id !== null && (await io.exists(db(id)));
      let reply: Reply;
      if (loading) {
        replaying = true;
        held = [];
        reply = await request("session/load", {
          sessionId: id,
          cwd,
          mcpServers: [],
        });
        if (reply.ok) {
          closeStream();
          endTurn("completed");
        }
      } else {
        reply = await request("session/new", { cwd, mcpServers: [] });
      }
      const replay = held ?? [];
      held = null;
      replaying = false;
      opening = false;
      if (!reply.ok) {
        // 모은 갱신은 버렸으니 절반 그린 turn과 tool도 같이 버린다.
        seq = saved;
        turn = null;
        stream = null;
        calls.clear();
        return reply.error;
      }
      sessionId = loading ? (id ?? "") : str(reply.data.sessionId);
      applyConfigs(reply.data.configOptions);
      legacy = arr(rec(reply.data.models).availableModels).map((one) =>
        str(rec(one).modelId),
      );
      changed = { model: false, thought: false, mode: false };
      // 지난 대화의 token 합은 모르니 새 대화만 합을 센다.
      totals = loading ? null : {};
      if (how === "draw") {
        publishMeta();
        for (const update of replay) publish(update);
      } else seq = saved;
      return null;
    }

    // process가 죽은 뒤 같은 대화로 다시 띄운다. 이미 화면에 있는 대화라 다시 그리지 않는다.
    function revive(): Promise<string | null> {
      reviving ??= (async () => {
        try {
          connect();
          const init = await request("initialize", initParams());
          if (!init.ok) return `agy did not restart: ${init.error}${tail()}`;
          const failed = await openConversation(sessionId, "discard");
          return failed === null
            ? null
            : `agy did not reopen the conversation: ${failed}`;
        } finally {
          reviving = null;
        }
      })();
      return reviving;
    }
    const alive = async () => (exited ? await revive() : null);

    const initParams = () => ({
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
        elicitation: { form: {} },
      },
      clientInfo: { name: "lophn", version: CLIENT_VERSION },
    });

    // --- 입력 ---
    // 같은 글(이미지 뒤의 글 한 덩이)을 agy에 준다. 앱 context와 이미지 아닌 file도 글이다.
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

    async function blocksOf(content: ContentBlock[], text: string) {
      const blocks: Json[] = [];
      for (const block of canImage ? content : []) {
        if (
          block.type !== "resource_link" ||
          !block.mimeType?.startsWith("image/")
        ) {
          continue;
        }
        try {
          const bytes = await io.readFile(block.uri.replace(/^file:\/\//, ""));
          blocks.push({
            type: "image",
            mimeType: block.mimeType,
            data: Buffer.from(bytes).toString("base64"),
          });
        } catch {
          info(`Could not read the image ${block.name}.`, "warning");
        }
      }
      if (text !== "") blocks.push({ type: "text", text });
      return blocks;
    }

    function prompt(
      blocks: Json[],
      meta: { command?: string; steer?: string },
    ) {
      outstanding += 1;
      driven = false;
      clearTimeout(idle);
      if (meta.command !== undefined) commandPrompts += 1;
      void request("session/prompt", { sessionId, prompt: blocks })
        .then((reply) => onPromptReply(reply, meta))
        .catch((error) => info(`prompt failed: ${reason(error)}`, "warning"));
    }

    // 쉬는 중에 turn을 연다. 줄에서 온 메시지는 이미 줄에 있으니 가져간 것으로, 새 메시지는 대화에 넣는다.
    async function beginTurn(one: {
      id: string;
      content: ContentBlock[];
      queued: boolean;
    }) {
      const text = textOf(one.content);
      // process를 다시 띄우면 지난 대화를 읽으며 turn 상태를 쓰므로 turn을 열기 전에 끝낸다.
      const dead = await alive();
      const mine = ensureTurn();
      turnText.set(mine, text);
      if (one.queued) {
        publish({
          type: "message_taken",
          message: one.id,
          seq: ++seq,
          delivery: "next_turn",
          turn: mine,
        });
      } else addMessage(one.id, one.content);
      if (dead !== null) {
        endTurn("failed", { code: "unavailable", message: dead });
        return;
      }
      if (norm(text) !== "") {
        echoes.push({ text: norm(text), id: one.id, queued: false });
      }
      prompt(await blocksOf(one.content, text), {});
    }

    async function steer(one: Queued) {
      publish({
        type: "message_queued",
        queued: { id: one.id, at: now(), content: one.content },
      });
      steered.push(one);
      if (norm(one.text) !== "") {
        echoes.push({ text: norm(one.text), id: one.id, queued: true });
      }
      prompt(await blocksOf(one.content, one.text), { steer: one.id });
    }

    function flushQueue() {
      if (turn !== null || outstanding > 0 || cancelling || stopping || closed)
        return;
      const one = queue.shift();
      if (one === undefined) return;
      void beginTurn({ ...one, queued: true }).catch((error) =>
        info(`send failed: ${reason(error)}`, "warning"),
      );
    }

    function unavailable(what: string) {
      info(`${what} is not available over Antigravity's ACP mode.`, "warning");
    }

    async function runCommand(name: string, argument: string) {
      if (name === "resume") {
        return void info("Pick an earlier conversation from the session menu.");
      }
      if (!isCommand(name)) {
        return void info(`agy has no /${name} command.`, "warning");
      }
      if (turn !== null || outstanding > 0 || cancelling) {
        return void info(
          `Wait for the turn to finish before running /${name}.`,
          "warning",
        );
      }
      const dead = await alive();
      ensureTurn();
      if (dead !== null) {
        endTurn("failed", { code: "unavailable", message: dead });
        return;
      }
      prompt(
        [
          {
            type: "text",
            text: `/${name}${argument === "" ? "" : ` ${argument}`}`,
          },
        ],
        { command: name },
      );
    }

    async function onSend(message: Extract<AcpInput, { type: "send" }>) {
      const text = textOf(message.content);
      const slash = SLASH.exec(text.trim());
      if (slash?.[1] !== undefined && isCommand(slash[1])) {
        return runCommand(slash[1], slash[2]?.trim() ?? "");
      }
      const busy = turn !== null || outstanding > 0 || cancelling;
      if (!busy) {
        return beginTurn({
          id: message.id,
          content: message.content,
          queued: false,
        });
      }
      const one: Queued = {
        id: message.id,
        content: message.content,
        text,
        steer: message.delivery === "steer",
      };
      // 취소 중인 prompt가 답하기 전에 보내면 agy가 거절한다. 그때는 줄에 세워 둔다.
      if (one.steer && !cancelling) return steer(one);
      queue.push(one);
      publish({
        type: "message_queued",
        queued: { id: one.id, at: now(), content: one.content },
      });
    }

    function stopTurn() {
      if (turn === null || cancelling) return;
      cancelling = true;
      cancelDialogs();
      write({ method: "session/cancel", params: { sessionId } });
    }

    async function openSession(target: string) {
      if (turn !== null || outstanding > 0) {
        return void info(
          "Stop the running turn before opening another conversation.",
          "warning",
        );
      }
      if (!(await io.exists(db(target)))) {
        return void info(
          "That conversation is no longer on this computer.",
          "warning",
        );
      }
      const before = sessionId;
      void request("session/close", { sessionId: before });
      resetConversation();
      publish({ type: "session_reset" });
      const failed = await openConversation(target, "draw");
      if (failed === null) return;
      info(`Could not open the conversation: ${failed}`, "warning");
      const back = await openConversation(before, "draw");
      if (back !== null)
        info(`Could not reopen the earlier conversation: ${back}`, "warning");
    }

    async function setModel(message: Extract<AcpInput, { type: "set_model" }>) {
      const set = async (configId: string, value: string) => {
        const reply = await request("session/set_config_option", {
          sessionId,
          configId,
          value,
        });
        if (!reply.ok) {
          info(`Could not change ${configId}: ${reply.error}`, "warning");
          return false;
        }
        applyConfigs(reply.data.configOptions);
        return true;
      };
      if (message.model !== modelNow()) {
        if (!(await set("model", message.model))) return;
        changed.model = true;
      }
      const effort = message.options.effort;
      const thought = cfg("thought_level");
      if (
        effort !== undefined &&
        thought !== undefined &&
        effort !== thought.current &&
        thought.options.some((one) => one.value === effort)
      ) {
        if (await set("thought_level", effort)) changed.thought = true;
      }
      publishMeta();
    }

    async function setMode(mode: string) {
      if (!(cfg("mode")?.options ?? []).some((one) => one.value === mode))
        return;
      const reply = await request("session/set_mode", {
        sessionId,
        modeId: mode,
      });
      if (!reply.ok) {
        return void info(
          `Could not change the mode: ${reply.error}`,
          "warning",
        );
      }
      const current = cfg("mode");
      if (current !== undefined) current.current = mode;
      changed.mode = true;
      publishMeta();
    }

    async function handle(message: AcpInput) {
      switch (message.type) {
        case "send":
          return onSend(message);
        case "stop":
          return stopTurn();
        case "retry": {
          const text = turnText.get(message.turn);
          if (text === undefined || turn !== null || outstanding > 0) return;
          return beginTurn({
            id: ids.newId("msg"),
            content: [{ type: "text", text }],
            queued: false,
          });
        }
        case "decide":
          return decide(message);
        case "answer":
          return answer(message);
        case "send_queued": {
          const index = queue.findIndex((one) => one.id === message.message);
          const one = queue[index];
          // 쉬는 중이거나 취소 중이면 줄이 알아서 흐른다.
          if (one === undefined || turn === null || cancelling) return;
          queue.splice(index, 1);
          publish({ type: "message_removed", message: one.id });
          return steer(one);
        }
        case "remove_queued": {
          const index = queue.findIndex((one) => one.id === message.message);
          if (index < 0) return;
          queue.splice(index, 1);
          publish({ type: "message_removed", message: message.message });
          return;
        }
        case "edit_queued": {
          const one = queue.find((it) => it.id === message.message);
          if (one === undefined) return;
          one.content = message.content;
          one.text = textOf(message.content);
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
          return setModel(message);
        case "set_mode":
          return setMode(message.mode);
        case "run_command":
          return runCommand(message.name, message.argument);
        case "compact":
          return runCommand("compact", "");
        case "open_session":
          return openSession(message.cli_session);
        case "rewind":
          return unavailable("Rewind");
        case "fork":
          return unavailable("Fork");
        case "rename":
          return unavailable("Rename");
        case "stop_child":
        case "steer_child":
          return unavailable("Subagent control");
        case "stop_task":
        case "background_tool":
          return unavailable("Background tasks");
        case "set_toggle":
          return unavailable("Toggles");
        case "set_goal":
          return unavailable("Goal");
        case "run_shell":
        case "stop_shell":
          return unavailable("Shell mode");
        case "use_role":
          return unavailable("Roles");
      }
    }

    // --- 시작 ---
    connect();
    const init = await request("initialize", initParams());
    if (!init.ok) {
      closed = true;
      proc.kill();
      return {
        ok: false,
        error: {
          code: "unavailable",
          message: `\`agy\` did not start: ${init.error}${tail()}`,
        },
      };
    }
    canImage =
      rec(rec(init.data.agentCapabilities).promptCapabilities).image !== false;
    // 저장되지 않은 대화(file 없음)는 resume하지 않고 실패 없이 새 대화로 연다(지키는 것 23).
    const failed = await openConversation(resume ?? null, "draw");
    if (failed !== null) {
      closed = true;
      proc.kill();
      return {
        ok: false,
        error: {
          code: "unavailable",
          message: `agy could not open the conversation: ${failed}${tail()}`,
        },
      };
    }
    started = true;
    const version = str(rec(init.data.agentInfo).version);
    if (version !== "" && version !== RECORDED_VERSION) {
      info(
        `Antigravity ${version} differs from ${RECORDED_VERSION}, the version lophn checked, so some features may not work.`,
        "warning",
      );
    }

    let chain: Promise<void> = Promise.resolve();
    session.onInput((message) => {
      chain = chain
        .then(() => handle(message))
        .catch((error) =>
          info(`${message.type} failed: ${reason(error)}`, "warning"),
        );
    });

    let stopped: Promise<void> | null = null;
    const run: HarnessGuiRun = {
      stop() {
        stopped ??= (async () => {
          stopping = true;
          clearTimeout(idle);
          // 도는 turn은 취소를 3초까지 기다린다. 답 없는 agy가 stop을 붙들지 않는다.
          if (turn !== null) {
            stopTurn();
            await Promise.race([
              new Promise<void>((resolve) => {
                const poll = setInterval(() => {
                  if (turn === null || exited) {
                    clearInterval(poll);
                    resolve();
                  }
                }, 50);
                setTimeout(() => {
                  clearInterval(poll);
                  resolve();
                }, STOP_POLITE_MS);
              }),
              gone,
            ]);
          }
          closed = true;
          if (!exited) {
            // stdin을 닫으면 agy가 끝난다. 안 끝나면 process group에 SIGTERM이다.
            proc.end();
            const kill = setTimeout(() => proc.kill(), EXIT_WAIT_MS);
            await gone;
            clearTimeout(kill);
          }
        })();
        return stopped;
      },
      // `--model`은 `agy models`의 legacy id(thinking 단계가 id 끝에 붙는다)로 준다. agy는 `--model <legacy id>`와 `--effort`를
      // 같이 주면 거절하므로(`--model X conflicts with --effort`) 단계는 id에 싣는다. GUI에서 바꾼 값만 싣는다.
      tuiCommand() {
        const parts = ["agy", "--conversation", shq(sessionId)];
        if (changed.model || changed.thought) {
          const model = modelNow();
          const thought = cfg("thought_level")?.current ?? "";
          const composite = `${model}-${thought}`;
          if (thought !== "" && legacy.includes(composite)) {
            parts.push("--model", shq(composite));
          } else {
            parts.push("--model", shq(model));
            if (changed.thought && thought !== "")
              parts.push("--effort", shq(thought));
          }
        }
        const mode = modeNow();
        if (changed.mode && (mode === "accept-edits" || mode === "plan")) {
          parts.push("--mode", mode);
        }
        return parts.join(" ");
      },
      async sessions() {
        if (exited) return [];
        const reply = await request("session/list", { cwd });
        if (!reply.ok) return [];
        const here = cwd.replace(/\/+$/, "");
        return arr(reply.data.sessions)
          .map(rec)
          .filter((one) => str(one.cwd).replace(/\/+$/, "") === here)
          .sort((a, b) => str(b.updatedAt).localeCompare(str(a.updatedAt)))
          .slice(0, 30)
          .map(
            (one): AcpCliSession => ({
              id: str(one.sessionId),
              title: str(one.title) || null,
              updated_at: str(one.updatedAt) || null,
            }),
          );
      },
      sessionId: () => (sessionId === "" ? null : sessionId),
      running: () => ({ turn: turn !== null, tasks: 0 }),
    };
    return { ok: true, value: run };
  };

export function createAntigravityAdapter(io: AntigravityIo): HarnessGuiAdapter {
  return {
    handoff: "restart",
    start: start(io),
    // TUI의 agy는 Ctrl+C를 두 번 눌러야 끝난다(첫 번은 입력을 지우거나 도는 일을 멈추고 안내만 낸다). foreground가 끝난 뒤에야
    // resolve해서 한 대화를 두 process가 같이 쥐지 않는다.
    exitTui(terminal: AcpTerminal) {
      return new Promise<Result<void>>((resolve) => {
        let presses = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const deadline = setTimeout(
          () =>
            finish({
              ok: false,
              error: {
                code: "unavailable",
                message: "Antigravity did not exit after Ctrl+C.",
              },
            }),
          5000,
        );
        const off = terminal.onForegroundExit(() =>
          finish({ ok: true, value: undefined }),
        );
        function finish(result: Result<void>) {
          clearTimeout(timer);
          clearTimeout(deadline);
          off();
          resolve(result);
        }
        function press() {
          if (terminal.state() === "shell") {
            return finish({ ok: true, value: undefined });
          }
          if (presses >= 4) return;
          presses += 1;
          terminal.type("\x03");
          timer = setTimeout(press, 400);
        }
        press();
      });
    },
  };
}

export const antigravityAdapter = createAntigravityAdapter({
  home: homedir(),
  readFile,
  exists: (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
});
