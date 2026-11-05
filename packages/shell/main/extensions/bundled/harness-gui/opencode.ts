// OpenCode adapter. OpenCode는 server(`opencode serve`)와 client(TUI, 데스크톱 앱)로 나뉜 구조라 데스크톱 앱처럼 server의
// HTTP+SSE API를 손으로 짠 client로 말한다(`@opencode/client`는 쓰지 않는다: effect에 기대고 OpenCode 판 하나에 묶인다).
// 탭마다 server 하나를 띄우고(`--stdio`: stdin을 쥐고 있는 동안이 server의 lease) GUI와 TUI(`opencode --server <url>`)가 같이 붙는다.
// server event를 ACP 갱신으로, 창의 ACP 입력을 API 호출로 옮긴다. 권한은 사람의 OpenCode 설정을 따른다(ask 규칙이 없으면 승인 카드는 뜨지 않는다).
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Result } from "../../../../../base/result.ts";
import type { AcpInput } from "../../../../../protocol/acp/input.ts";
import type {
  AcpEntry,
  AcpToolItem,
} from "../../../../../protocol/acp/items.ts";
import {
  EMPTY_ACP_STATE,
  reduceAcp,
} from "../../../../../protocol/acp/reduce.ts";
import type {
  AcpCommand,
  AcpModelGroup,
  AcpSessionMeta,
  AcpUsage,
} from "../../../../../protocol/acp/session.ts";
import type { AcpState, AcpUpdate } from "../../../../../protocol/acp/state.ts";
import type { AcpApprovalSubject } from "../../../../../protocol/approvals/gate-call.ts";
import type { ContentBlock } from "../../../../../protocol/lophn-agent/content-block.ts";
import type { HarnessGuiAdapter } from "./adapter.ts";

/** lophn이 녹화하고 확인한 OpenCode 판. 다르면 창에 한 번 알린다. */
export const RECORDED_OPENCODE_VERSION = "2.1.4";

type Json = Record<string, unknown>;

const rec = (value: unknown): Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : {};
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown) => (typeof value === "string" ? value : "");
const oneLine = (text: string, max: number) =>
  text
    .replace(/\s*\n\s*/g, " ")
    .trim()
    .slice(0, max);
const lineCount = (text: unknown) =>
  typeof text === "string" && text !== "" ? text.split("\n").length : 0;
const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

// --- server와 말하는 길 -------------------------------------------------------------------------------------------------

/** 요청 하나와 `/api/event` 구독. 기본은 실제 fetch이고 test는 녹화를 재생하는 대역을 끼운다. */
export type OpencodeTransport = {
  /** 2xx가 아니면 `status`를 단 오류로 reject한다. 204는 undefined다. */
  request(
    method: string,
    path: string,
    options?: { query?: Record<string, string | number>; body?: unknown },
  ): Promise<Json | undefined>;
  /** event를 하나씩 준다. 스스로 끊기면 `onEnd`가 오고, `close()`로 그치면 오지 않는다. */
  events(
    onEvent: (event: Json) => void,
    onEnd: (error: Error) => void,
  ): { close(): void };
};

export function fetchTransport(input: {
  url: string;
  password: string;
}): OpencodeTransport {
  const headers = {
    authorization: `Basic ${Buffer.from(`opencode:${input.password}`).toString("base64")}`,
  };
  const urlOf = (path: string, query?: Record<string, string | number>) => {
    const url = new URL(path, input.url);
    for (const [key, value] of Object.entries(query ?? {}))
      url.searchParams.append(key, String(value));
    return url;
  };
  return {
    async request(method, path, options) {
      const body = options?.body;
      const response = await fetch(urlOf(path, options?.query), {
        method,
        headers:
          body === undefined
            ? headers
            : { ...headers, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      const json = text === "" ? undefined : (JSON.parse(text) as Json);
      if (!response.ok) {
        throw Object.assign(
          new Error(
            str(json?.message) || `OpenCode answered ${response.status}`,
          ),
          { status: response.status },
        );
      }
      return json;
    },
    events(onEvent, onEnd) {
      const abort = new AbortController();
      void (async () => {
        const response = await fetch(urlOf("/api/event"), {
          headers: { ...headers, accept: "text/event-stream" },
          signal: abort.signal,
        });
        if (!response.ok || response.body === null)
          throw new Error(`OpenCode event stream answered ${response.status}`);
        const decoder = new TextDecoder();
        let buffer = "";
        for await (const chunk of response.body) {
          buffer += decoder
            .decode(chunk, { stream: true })
            .replaceAll("\r\n", "\n");
          for (
            let end = buffer.indexOf("\n\n");
            end >= 0;
            end = buffer.indexOf("\n\n")
          ) {
            const data = buffer
              .slice(0, end)
              .split("\n")
              .flatMap((line) =>
                line.startsWith("data:") ? [line.slice(5).trimStart()] : [],
              )
              .join("\n");
            buffer = buffer.slice(end + 2);
            if (data !== "") onEvent(JSON.parse(data) as Json);
          }
        }
        throw new Error("The OpenCode event stream closed.");
      })().catch((cause: unknown) => {
        if (!abort.signal.aborted)
          onEnd(cause instanceof Error ? cause : new Error(String(cause)));
      });
      return { close: () => abort.abort() };
    },
  };
}

/** 쓰는 endpoint만 둔 client. 이름은 OpenCode의 route 이름이다. */
export function createApi(transport: OpencodeTransport) {
  const call = (
    method: string,
    path: string,
    options?: { query?: Record<string, string | number>; body?: unknown },
  ) => transport.request(method, path, options);
  const session = (id: string) => `/api/session/${encodeURIComponent(id)}`;
  const data = async (result: Promise<Json | undefined>): Promise<unknown> =>
    (await result)?.data;
  return {
    info: async () => (await call("GET", "/api/info")) ?? {},
    models: async () => arr(await data(call("GET", "/api/model"))),
    defaultModel: async () =>
      rec(await data(call("GET", "/api/model/default"))),
    agents: async () => arr(await data(call("GET", "/api/agent"))),
    commands: async () => arr(await data(call("GET", "/api/command"))),
    create: async (body: Json) =>
      rec(await data(call("POST", "/api/session", { body }))),
    get: async (id: string) => rec(await data(call("GET", session(id)))),
    update: (id: string, body: Json) => call("PATCH", session(id), { body }),
    remove: (id: string) => call("DELETE", session(id)),
    fork: async (id: string, body: Json) =>
      rec(await data(call("POST", `${session(id)}/fork`, { body }))),
    messages: async (id: string, query: Record<string, string | number>) =>
      (await call("GET", `${session(id)}/message`, { query })) ?? {},
    context: async (id: string) =>
      arr(await data(call("GET", `${session(id)}/context`))),
    prompt: (id: string, body: Json) =>
      call("POST", `${session(id)}/prompt`, { body }),
    command: (id: string, body: Json) =>
      call("POST", `${session(id)}/command`, { body }),
    shell: (id: string, body: Json) =>
      call("POST", `${session(id)}/shell`, { body }),
    compact: (id: string) =>
      call("POST", `${session(id)}/compact`, { body: {} }),
    interrupt: (id: string) => call("POST", `${session(id)}/interrupt`),
    wait: (id: string) =>
      call("POST", `/api/experimental/session/${encodeURIComponent(id)}/wait`),
    revertStage: (id: string, body: Json) =>
      call("POST", `${session(id)}/revert/stage`, { body }),
    revertCommit: (id: string) => call("POST", `${session(id)}/revert/commit`),
    revertClear: (id: string) => call("DELETE", `${session(id)}/revert`),
    inbox: (id: string) => call("GET", `${session(id)}/inbox`),
    inboxUpdate: (id: string, inbox: string, body: Json) =>
      call("PATCH", `${session(id)}/inbox/${encodeURIComponent(inbox)}`, {
        body,
      }),
    inboxCancel: (id: string, inbox: string) =>
      call("DELETE", `${session(id)}/inbox/${encodeURIComponent(inbox)}`),
    switchModel: (id: string, body: Json) =>
      call("POST", `${session(id)}/model`, { body }),
    switchAgent: (id: string, body: Json) =>
      call("POST", `${session(id)}/agent`, { body }),
    permissionReply: (id: string, request: string, body: Json) =>
      call(
        "POST",
        `${session(id)}/permission/${encodeURIComponent(request)}/reply`,
        { body },
      ),
    formReply: (id: string, form: string, body: Json) =>
      call("POST", `${session(id)}/form/${encodeURIComponent(form)}/reply`, {
        body,
      }),
    formCancel: (id: string, form: string) =>
      call("DELETE", `${session(id)}/form/${encodeURIComponent(form)}`),
  };
}
export type OpencodeApi = ReturnType<typeof createApi>;

/** 0600 file 하나. 터미널 env는 PASSWORD가 든 이름을 지워 물려줄 수 없어서 TUI 명령이 이 file에서 읽는다. */
export type SecretFile = { path: string; remove(): Promise<void> };

export type OpencodeDeps = {
  connect(input: { url: string; password: string }): OpencodeTransport;
  writeSecret(text: string): Promise<SecretFile>;
};

const realDeps: OpencodeDeps = {
  connect: fetchTransport,
  async writeSecret(text) {
    // mkdtemp는 0700 폴더를 만든다.
    const dir = await mkdtemp(join(tmpdir(), "lophn-opencode-"));
    const path = join(dir, "password");
    await writeFile(path, text, { mode: 0o600 });
    return { path, remove: () => rm(dir, { recursive: true, force: true }) };
  },
};

// --- 값 옮기기 ----------------------------------------------------------------------------------------------------------

const CATEGORIES: Record<string, AcpToolItem["category"]> = {
  shell: "command",
  read: "read",
  glob: "list",
  grep: "search",
  webfetch: "web",
  websearch: "web",
};

const CAPABILITIES: AcpSessionMeta["capabilities"] = {
  model: true,
  effort: true,
  mode: true,
  commands: true,
  rewind: true,
  // `revert.stage {files}`가 file을 되돌린다(core/session/revert.ts).
  rewind_files: true,
  fork: true,
  compact: true,
  rename: true,
  usage: true,
  steer: true,
  queue_edit: true,
  // 창이 이미지를 임시 폴더에 쓰고 `file://` 링크로 보낸다.
  images: true,
  retry: true,
  sessions: false,
};

const client = (
  name: string,
  description: string,
  hint: string | null,
): AcpCommand => ({
  name,
  description,
  argument_hint: hint,
  source: "builtin",
});
const CLIENT_COMMANDS: AcpCommand[] = [
  client("undo", "Undo the last message and its file changes", null),
  client("redo", "Redo what /undo reverted", null),
  client("fork", "Fork this session", null),
  client("compact", "Summarize the conversation to free context", null),
  client("rename", "Rename this session", "title"),
  client("new", "Start a new session", null),
];

const RESTART_NOTICE =
  "The previous OpenCode server stopped while it was working. This server continues from where it left off.";

// 앱 context(`resource` block)도 글로 넘긴다. `file://` 링크는 server가 읽을 file이고, 이미지는 blob hash뿐이라 넘기지 못한다.
function promptOf(content: ContentBlock[]) {
  const files: { uri: string; name: string }[] = [];
  const text = content
    .flatMap((block) => {
      if (block.type === "text" || block.type === "resource")
        return [block.text];
      if (block.type !== "resource_link") return [];
      if (block.uri.startsWith("file://")) {
        files.push({ uri: block.uri, name: block.name });
        return [];
      }
      return [`${block.name}: ${block.uri}`];
    })
    .join("\n");
  return { text, files };
}

function contentOf(text: unknown, files: unknown): ContentBlock[] {
  const out: ContentBlock[] = [];
  if (str(text) !== "") out.push({ type: "text", text: str(text) });
  for (const one of arr(files).map(rec)) {
    const uri = str(one.uri) || str(rec(one.source).uri);
    if (uri === "") continue;
    const mime = str(one.mime);
    out.push({
      type: "resource_link",
      uri,
      name: str(one.name) || uri.slice(uri.lastIndexOf("/") + 1) || "file",
      ...(mime === "" ? {} : { mimeType: mime }),
    });
  }
  return out;
}

const modelKey = (ref: Json) => `${str(ref.providerID)}/${str(ref.id)}`;
// variant를 고르지 않은 session의 model은 variant가 "default"로 온다. 목록에 없는 값이라 고르지 않은 것으로 본다.
const variantOf = (ref: Json) =>
  str(ref.variant) === "default" ? "" : str(ref.variant);

// --- adapter ------------------------------------------------------------------------------------------------------------

type Call = {
  id: string;
  session: string;
  name: string;
  input: Json;
  started: boolean;
  done: boolean;
  /** 끝났을 때 `failed`를 어떻게 부를지. */
  hint?: "denied" | "cancelled";
  /** `subagent` tool이 연 child session. */
  child?: string;
  /** `question` tool이 연 form. 끝날 때 답 줄의 header가 된다. */
  form?: { group: string; headers: string[] };
};

type Approval = {
  server: string;
  session: string;
  action: string;
  save: string[];
  call: Call | undefined;
};

type Form = { id: string; session: string; fields: Json[]; call: Call };

export function createOpencodeAdapter(deps: OpencodeDeps): HarnessGuiAdapter {
  const start: HarnessGuiAdapter["start"] = async ({
    cwd,
    resume,
    session,
    spawn,
    clock,
    ids,
  }) => {
    const password = ids.newId("pwd");
    // env는 호출자(`index.ts`)가 login shell env < 탭의 hook env 순으로 합쳐 둔다. 여기서는 바꾸는 칸만 넘긴다.
    const proc = spawn("opencode", ["serve", "--stdio", "--port", "0"], {
      cwd,
      env: { OPENCODE_PASSWORD: password },
    });
    if (proc.pid === undefined) {
      return {
        ok: false,
        error: {
          code: "unavailable",
          message: "`opencode` was not found on PATH.",
        },
      } satisfies Result<never>;
    }

    let closed = false;
    let dead: { code: string; message: string } | null = null;
    let stderrTail = "";
    proc.onStderr((text) => {
      stderrTail = (stderrTail + text).slice(-500);
    });
    const exited = new Promise<void>((resolve) => proc.onExit(() => resolve()));

    // server가 첫 줄에 `{"url": …}`를 쓰면 준비된 것이다.
    const url = await new Promise<string | null>((resolve) => {
      let buffer = "";
      let settled = false;
      const timer = setTimeout(() => finish(null), 20_000);
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      proc.onStdout((text) => {
        if (settled) return;
        buffer += text;
        const line = buffer.split("\n").find((one) => one.startsWith("{"));
        if (line === undefined) return;
        try {
          finish(str((JSON.parse(line) as Json).url) || null);
        } catch {
          finish(null);
        }
      });
      proc.onExit(() => finish(null));
    });
    if (url === null) {
      proc.end();
      proc.kill();
      return {
        ok: false,
        error: {
          code: "unavailable",
          message: `OpenCode did not start.${stderrTail === "" ? "" : `\n${stderrTail.trim()}`}`,
        },
      } satisfies Result<never>;
    }

    const secret = await deps.writeSecret(password);
    const transport = deps.connect({ url, password });
    const api = createApi(transport);
    let events: { close(): void } | undefined;

    const now = () => clock.now();
    let seq = 0;
    // 창에 낸 갱신을 접어 둔다. rewind·fork가 숨길 항목과 줄 선 메시지를 여기서 읽는다.
    let mirror: AcpState = EMPTY_ACP_STATE;
    const emit = (update: AcpUpdate) => {
      if (closed) return;
      mirror = reduceAcp(mirror, update);
      session.publish(update);
    };

    let sessionId = resume ?? "";
    let turn: string | null = null;
    // 사람 메시지 id: 우리가 보낸 것은 창의 id를, 아닌 것은 server의 id를 ACP id로 쓴다.
    const acpOf = new Map<string, string>();
    const serverOf = new Map<string, string>();
    const own = new Map<string, ContentBlock[]>();
    const deliveryOf = new Map<string, "steer" | "queue">();
    // retry가 다시 보낼 turn의 사람 메시지.
    const userOf = new Map<string, ContentBlock[]>();
    const calls = new Map<string, Call>();
    const children = new Map<string, { running: boolean }>();
    const approvals = new Map<string, Approval>();
    const approvalOf = new Map<string, string>();
    const forms = new Map<string, Form>();
    let writing: {
      call: string;
      message: string;
      text: string;
      reasoning: string;
    } | null = null;
    let reverted = false;
    // 우리가 부른 rewind가 file도 되돌리라고 했는지. 되돌릴 file이 없으면 server가 `files: []`로 답해서 요청을 기억한다.
    let rewindFiles = false;
    // 앞 대화를 그리는 동안 온 event는 쌓아 두었다가 그린 뒤에 접는다.
    let replaying = true;
    // server가 이 session의 execution이 돈다고 알려 준 동안.
    let executing = false;
    let currentModel = "";
    let backlog: Json[] = [];
    let contextLimit = new Map<string, number>();
    let modelNames = new Map<string, string>();
    const sentKeys = new Set<string>();
    // 시작하는 동안 온 입력은 시작이 끝난 뒤에 받는다.
    let setupDone: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      setupDone = resolve;
    });
    session.onInput((input) => void ready.then(() => handle(input)));

    const publishMeta = (meta: Partial<AcpSessionMeta>) =>
      emit({ type: "session_changed", session: meta });

    function info(text: string) {
      emit({
        type: "notice_added",
        item: {
          kind: "notice",
          id: ids.newId("not"),
          seq: ++seq,
          at: now(),
          turn: turn ?? ids.newId("trn"),
          notice: { type: "info", text },
        },
      });
    }

    // 사람이 부른 동작이 실패하면 조용히 두지 않고 알린다.
    async function attempt(label: string, work: () => Promise<unknown>) {
      try {
        await work();
      } catch (cause) {
        info(`${label} failed: ${message(cause)}`);
      }
    }

    // --- turn, 글, tool ---

    // 이 turn이 이미 사람 메시지를 가져갔는지. 그 뒤에 오는 사람 메시지가 steer다.
    let turnHasUser = false;

    function startTurn(): string {
      if (turn !== null) return turn;
      turnHasUser = false;
      turn = ids.newId("trn");
      emit({ type: "turn_started", turn, at: now() });
      return turn;
    }

    function flushWriting() {
      if (writing === null || (writing.text === "" && writing.reasoning === ""))
        return;
      emit({
        type: "message_recorded",
        turn: startTurn(),
        message: ids.newId("msg"),
        model_call: writing.call,
        seq: ++seq,
        at: now(),
        body: {
          content:
            writing.text === "" ? [] : [{ type: "text", text: writing.text }],
          reasoning:
            writing.reasoning === ""
              ? null
              : { text: writing.reasoning, duration_ms: null },
          cards: [],
        },
      });
      writing = null;
    }

    function stream(
      kind: "text" | "reasoning",
      messageId: string,
      text: string,
    ) {
      if (writing !== null && writing.message !== messageId) flushWriting();
      writing ??= {
        call: ids.newId("mcl"),
        message: messageId,
        text: "",
        reasoning: "",
      };
      emit({
        type: "writing_streamed",
        turn: startTurn(),
        model_call: writing.call,
        kind,
        offset: writing[kind].length,
        text,
        at: now(),
      });
      writing[kind] += text;
    }

    function endTurn(
      outcome: "completed" | "stopped" | "failed",
      error?: { code: string; message: string },
    ) {
      if (turn === null && error === undefined) return;
      const id = turn ?? ids.newId("trn");
      for (const request of [...approvals.keys()])
        closeApproval(request, "cancelled", null);
      for (const form of [...forms.keys()]) resolveForm(form, "cancelled");
      flushWriting();
      writing = null;
      for (const call of calls.values())
        if (call.started && !call.done) toolEnd(call, "cancelled");
      calls.clear();
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
      turn = null;
    }

    const relative = (path: string) =>
      path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;

    function summaryOf(input: Json): string {
      for (const key of [
        "command",
        "filePath",
        "path",
        "pattern",
        "url",
        "query",
        "description",
        "code",
      ]) {
        const value = str(input[key]);
        if (value !== "") return oneLine(relative(value), 120);
      }
      return "";
    }

    function detailOf(name: string, input: Json): AcpToolItem["detail"] {
      if (name === "question")
        return { kind: "question", group: null, outcome: null, lines: [] };
      if (name === "subagent")
        return {
          kind: "call",
          call: null,
          to: str(input.agent) || "subagent",
          task: str(input.description) || str(input.prompt),
          reply: "result",
          state: null,
          fail_reason: null,
          session: null,
        };
      if (name === "patch") {
        const patch = str(input.patchText);
        const file = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/m.exec(
          patch,
        )?.[1];
        const body = patch.split("\n");
        return file === undefined
          ? { kind: "generic" }
          : {
              kind: "edit",
              document: file.startsWith("/") ? file : `${cwd}/${file}`,
              path: relative(file),
              added: body.filter((line) => line.startsWith("+")).length,
              removed: body.filter((line) => line.startsWith("-")).length,
            };
      }
      const path = str(input.filePath) || str(input.path);
      if ((name !== "edit" && name !== "write") || path === "")
        return { kind: "generic" };
      const absolute = path.startsWith("/") ? path : `${cwd}/${path}`;
      return {
        kind: "edit",
        document: absolute,
        path: relative(absolute),
        added: lineCount(input.newString ?? input.content),
        removed: lineCount(input.oldString),
      };
    }

    function toolStart(call: Call) {
      if (call.started) return;
      call.started = true;
      flushWriting();
      const summary = summaryOf(call.input);
      emit({
        type: "tool_started",
        item: {
          kind: "tool",
          id: call.id,
          seq: ++seq,
          at: now(),
          turn: startTurn(),
          tool: call.name,
          category: CATEGORIES[call.name] ?? "other",
          title: summary === "" ? call.name : `${call.name} ${summary}`,
          state: "running",
          duration_ms: null,
          detail: detailOf(call.name, call.input),
        },
      });
    }

    function toolEnd(
      call: Call,
      state: "ok" | "error" | "denied" | "cancelled",
      detail: AcpToolItem["detail"] | null = null,
    ) {
      call.done = true;
      emit({
        type: "tool_ended",
        tool_call: call.id,
        state,
        at: now(),
        detail,
      });
    }

    function callOf(sid: string, toolId: string, name = "tool"): Call {
      const key = `${sid}:${toolId}`;
      let call = calls.get(key);
      if (call === undefined) {
        call = {
          id: ids.newId("tcl"),
          session: sid,
          name,
          input: {},
          started: false,
          done: false,
        };
        calls.set(key, call);
      }
      return call;
    }

    // --- 승인 ---

    function subjectOf(data: Json, call: Call | undefined): AcpApprovalSubject {
      const action = str(data.action);
      const resources = arr(data.resources).map(str);
      const files = arr(rec(data.metadata).files).map(rec);
      if (files.length > 0) {
        return {
          kind: "file_change",
          changes: files.map((file) => ({
            path: str(file.file),
            change:
              file.status === "added"
                ? "create"
                : file.status === "deleted"
                  ? "delete"
                  : "update",
            added: typeof file.additions === "number" ? file.additions : null,
            removed: typeof file.deletions === "number" ? file.deletions : null,
          })),
        };
      }
      const detail =
        call === undefined ? null : detailOf(call.name, call.input);
      if (detail?.kind === "edit") {
        return {
          kind: "file_change",
          changes: [
            {
              path: detail.path,
              change: call?.name === "write" ? "create" : "update",
              added: detail.added,
              removed: detail.removed,
            },
          ],
        };
      }
      const command = str(call?.input.command) || resources.join("; ");
      if (action === "shell" && command !== "")
        return { kind: "shell", command };
      return {
        kind: "mcp_tool",
        server: "opencode",
        tool: action === "" ? (call?.name ?? "tool") : action,
        effect:
          action === "read" || action === "glob" || action === "grep"
            ? "read"
            : action === "edit" || action === "write" || action === "patch"
              ? "write"
              : "external",
      };
    }

    function openApproval(data: Json) {
      const sid = str(data.sessionID);
      const call = calls.get(`${sid}:${str(rec(data.source).id)}`);
      if (call !== undefined) toolStart(call);
      const save = arr(data.save)
        .map(str)
        .filter((one) => one !== "");
      const id = ids.newId("apr");
      approvals.set(id, {
        server: str(data.id),
        session: sid,
        action: str(data.action),
        save,
        call,
      });
      approvalOf.set(str(data.id), id);
      // `session`은 session 규칙으로 저장할 resource가 있을 때만이고, `always`는 사람의 project에 영구 규칙으로 남는다.
      emit({
        type: "approval_opened",
        approval: {
          id,
          subject: subjectOf(data, call),
          choices:
            save.length > 0
              ? ["once", "session", "always", "reject"]
              : ["once", "reject"],
          always_patterns:
            save.length > 0
              ? [
                  oneLine(
                    `Saved permanently to this project's OpenCode rules: ${save.join(", ")}`,
                    500,
                  ),
                ]
              : [],
        },
      });
    }

    function closeApproval(
      id: string,
      outcome: "allowed" | "denied" | "cancelled",
      choice: "once" | "session" | "always" | null,
      reason: string | null = null,
    ) {
      const open = approvals.get(id);
      if (open === undefined) return;
      approvals.delete(id);
      approvalOf.delete(open.server);
      if (outcome === "denied" && open.call !== undefined)
        open.call.hint = "denied";
      emit({
        type: "approval_closed",
        request: id,
        outcome,
        choice,
        reason,
        seq: ++seq,
        at: now(),
      });
    }

    async function decide(
      id: string,
      choice: Extract<AcpInput, { type: "decide" }>["choice"],
    ) {
      const open = approvals.get(id);
      if (open === undefined) return;
      if (choice.kind === "reject" && open.call !== undefined)
        open.call.hint = "denied";
      if (choice.kind === "session") {
        const current = arr((await api.get(open.session)).permissions);
        const rules = open.save.map((resource) => ({
          action: open.action,
          resource,
          effect: "allow",
        }));
        await api.update(open.session, { permissions: [...current, ...rules] });
      }
      const reason = choice.kind === "reject" ? choice.reason : undefined;
      await api.permissionReply(open.session, open.server, {
        decision:
          choice.kind === "reject"
            ? "reject"
            : choice.kind === "always"
              ? "always"
              : "once",
        ...(reason === undefined ? {} : { message: reason }),
      });
      if (choice.kind === "reject")
        closeApproval(id, "denied", null, reason ?? null);
      else closeApproval(id, "allowed", choice.kind);
    }

    // --- 질문 ---

    function openForm(form: Json) {
      const meta = rec(form.metadata);
      if (meta.kind !== "question") return;
      const sid = str(form.sessionID);
      const fields = arr(form.fields).map(rec);
      const call = callOf(sid, str(rec(meta.tool).id), "question");
      toolStart(call);
      const group = str(form.id);
      forms.set(group, { id: group, session: sid, fields, call });
      call.form = {
        group,
        headers: fields.map((field) => str(field.title) || str(field.key)),
      };
      emit({
        type: "question_asked",
        group,
        tool_call: call.id,
        questions: fields.map((field) => ({
          question:
            str(field.description) || str(field.title) || str(field.key),
          header: (str(field.title) || str(field.key)).slice(0, 24),
          options: arr(field.options)
            .map(rec)
            .map((option) => ({
              label: str(option.label),
              description: str(option.description) || str(option.label),
            })),
          multiSelect: field.type === "multiselect",
        })),
      });
    }

    function resolveForm(group: string, outcome: "submitted" | "cancelled") {
      if (!forms.delete(group)) return;
      emit({ type: "question_resolved", group, outcome });
    }

    async function answer(input: Extract<AcpInput, { type: "answer" }>) {
      const form = [...forms.values()].find(
        (one) => one.call.id === input.tool_call,
      );
      if (form === undefined) return;
      const reply: Json = {};
      form.fields.forEach((field, index) => {
        const given = input.answers[index];
        if (
          given === undefined ||
          given.status !== "answered" ||
          given.answer.length === 0
        )
          return;
        reply[str(field.key)] =
          field.type === "multiselect" ? given.answer : given.answer.join(", ");
      });
      const answered = Object.keys(reply).length > 0;
      if (answered)
        await api.formReply(form.session, form.id, { answer: reply });
      else await api.formCancel(form.session, form.id);
      resolveForm(form.id, answered ? "submitted" : "cancelled");
    }

    // --- event ---

    function userQueued(inbox: string, item: Json) {
      const payload = rec(item.payload);
      const acp = str(rec(payload.metadata).lophn) || inbox;
      acpOf.set(inbox, acp);
      serverOf.set(acp, inbox);
      deliveryOf.set(acp, item.delivery === "steer" ? "steer" : "queue");
      emit({
        type: "message_queued",
        queued: {
          id: acp,
          at: now(),
          content: own.get(acp) ?? contentOf(payload.text, payload.files),
        },
      });
    }

    function delivered(inbox: string) {
      const acp = acpOf.get(inbox) ?? inbox;
      const delivery = deliveryOf.get(acp);
      const queued = mirror.queued.find((one) => one.id === acp);
      if (delivery === undefined || queued === undefined) return;
      deliveryOf.delete(acp);
      const steered = delivery === "steer" && turnHasUser;
      const id = startTurn();
      turnHasUser = true;
      if (!userOf.has(id)) userOf.set(id, queued.content);
      emit({
        type: "message_taken",
        message: acp,
        seq: ++seq,
        delivery: steered ? "steer" : "next_turn",
        turn: steered ? null : id,
      });
    }

    function hideFrom(
      first: string,
      choice: "restore_all" | "messages_only",
      restored: number,
    ) {
      const index = mirror.items.findIndex((item) => item.id === first);
      if (index < 0) return;
      const tail = mirror.items.slice(index);
      const entries = tail.flatMap((item): AcpEntry[] =>
        item.kind === "hidden" ? item.items : [item],
      );
      const head = tail[0];
      if (head === undefined) return;
      emit({
        type: "hidden_added",
        item: {
          kind: "hidden",
          id: ids.newId("hid"),
          seq: head.seq,
          at: now(),
          checkpoint: first,
          choice,
          count: entries.length,
          restored,
          left: [],
          items: entries,
        },
      });
    }

    function onChild(type: string, data: Json, sid: string) {
      const child = children.get(sid);
      if (child === undefined) return;
      if (type === "session.execution.started") child.running = true;
      else if (type.startsWith("session.execution.")) child.running = false;
    }

    function onToolEvent(type: string, data: Json) {
      const sid = str(data.sessionID);
      const toolId = str(data.id);
      if (type === "session.tool.input.started") {
        callOf(sid, toolId, str(data.name)).name = str(data.name);
        return;
      }
      const call = callOf(sid, toolId);
      if (type === "session.tool.called") {
        call.input = rec(data.input);
        toolStart(call);
      } else if (type === "session.tool.success") {
        toolStart(call);
        const detail = endDetail(call, rec(data.metadata), "done");
        toolEnd(call, "ok", detail);
      } else if (type === "session.tool.failed") {
        toolStart(call);
        const error = rec(data.error);
        const kind = str(error.type);
        const state =
          call.hint ??
          (kind === "aborted"
            ? "cancelled"
            : /permission|declin|reject/i.test(kind)
              ? "denied"
              : "error");
        toolEnd(call, state, endDetail(call, rec(data.metadata), "failed"));
      }
    }

    // 끝날 때만 아는 칸(질문의 답, 하위 agent의 session과 결과)을 채운다.
    function endDetail(
      call: Call,
      metadata: Json,
      how: "done" | "failed",
    ): AcpToolItem["detail"] | null {
      if (call.name === "subagent") {
        const base = detailOf(call.name, call.input);
        return base.kind === "call"
          ? {
              ...base,
              state: how === "done" ? "done" : "failed",
              session: call.child ?? (str(metadata.sessionID) || null),
            }
          : null;
      }
      if (call.name === "question") {
        const headers = call.form?.headers ?? [];
        return {
          kind: "question",
          group: call.form?.group ?? null,
          outcome: how === "done" ? "submitted" : "cancelled",
          lines: arr(metadata.answers).map((one, index) => ({
            header: headers[index] ?? "",
            answer: arr(one).map(str).join(", ") || null,
          })),
        };
      }
      return null;
    }

    function onEvent(event: Json) {
      if (closed) return;
      if (replaying) {
        backlog.push(event);
        return;
      }
      const type = str(event.type);
      const data = rec(event.data);
      // plugin이 자리 잡은 뒤에야 agent·명령·model 목록이 차므로 바뀔 때마다 다시 읽는다.
      if (
        type === "agent.updated" ||
        type === "command.updated" ||
        type === "model.updated"
      ) {
        reloadLists();
        return;
      }
      const sid = str(data.sessionID) || str(rec(data.form).sessionID);
      if (sid === "") return;
      if (type === "session.created") {
        const parent = str(data.parentID);
        if (parent !== sessionId && !children.has(parent)) return;
        children.set(sid, { running: false });
        const task = [...calls.values()].find(
          (one) =>
            one.name === "subagent" && !one.done && one.child === undefined,
        );
        if (task !== undefined) task.child = sid;
        return;
      }
      const mine = sid === sessionId;
      if (!mine && !children.has(sid)) return;
      switch (type) {
        case "permission.asked":
          openApproval(data);
          return;
        case "permission.replied": {
          // 다른 client(TUI)가 먼저 답했거나 거절 하나가 같은 session의 나머지를 함께 거절했다. 답 없이 닫는다.
          const id = approvalOf.get(str(data.requestID));
          if (id === undefined) return;
          const reply = str(data.reply);
          if (reply === "reject") closeApproval(id, "denied", null);
          else
            closeApproval(
              id,
              "allowed",
              reply === "always" ? "always" : "once",
            );
          return;
        }
        case "form.created":
          openForm(rec(data.form));
          return;
        case "form.replied":
          resolveForm(str(data.id), "submitted");
          return;
        case "form.cancelled":
          resolveForm(str(data.id), "cancelled");
          return;
      }
      if (!mine) {
        onChild(type, data, sid);
        return;
      }
      switch (type) {
        case "session.execution.started":
          executing = true;
          startTurn();
          return;
        case "session.execution.succeeded":
          executing = false;
          endTurn("completed");
          refreshUsage();
          return;
        case "session.execution.interrupted":
          executing = false;
          endTurn("stopped");
          refreshUsage();
          return;
        case "session.execution.failed":
          executing = false;
          endTurn("failed", {
            code: "internal",
            message: str(rec(data.error).message) || "OpenCode failed.",
          });
          refreshUsage();
          return;
        case "session.text.delta":
        case "session.reasoning.delta":
          if (str(data.delta) !== "")
            stream(
              type === "session.text.delta" ? "text" : "reasoning",
              str(data.assistantMessageID),
              str(data.delta),
            );
          return;
        case "session.step.ended":
        case "session.step.failed":
          flushWriting();
          return;
        case "session.tool.input.started":
        case "session.tool.called":
        case "session.tool.success":
        case "session.tool.failed":
          onToolEvent(type, data);
          return;
        case "session.inbox.enqueued": {
          const item = rec(data.item);
          if (item.type === "user") userQueued(str(data.inboxID), item);
          return;
        }
        case "session.inbox.delivered":
          delivered(str(data.inboxID));
          return;
        case "session.inbox.delivery.changed": {
          const acp = acpOf.get(str(data.inboxID)) ?? str(data.inboxID);
          if (deliveryOf.has(acp))
            deliveryOf.set(acp, data.delivery === "steer" ? "steer" : "queue");
          return;
        }
        case "session.inbox.cancelled": {
          const acp = acpOf.get(str(data.inboxID)) ?? str(data.inboxID);
          deliveryOf.delete(acp);
          emit({ type: "message_removed", message: acp });
          return;
        }
        case "session.synthetic":
          if (rec(data.metadata).notice === "restart") info(RESTART_NOTICE);
          return;
        case "session.compaction.started":
          startTurn();
          info(
            data.reason === "auto"
              ? "Compacting the context to make room…"
              : "Compacting the context…",
          );
          return;
        case "session.compaction.ended":
          info("The context was compacted.");
          if (!executing) endTurn("completed");
          refreshUsage();
          return;
        case "session.compaction.failed":
          info(`Compaction failed: ${str(rec(data.error).message)}`);
          if (!executing) endTurn("completed");
          return;
        case "session.retry.scheduled":
          info(
            `Retrying after an error (attempt ${String(data.attempt)}): ${oneLine(str(rec(data.error).message), 160)}`,
          );
          return;
        case "session.renamed":
          publishMeta({ title: str(data.title) });
          return;
        case "session.model.selected":
          setModel(rec(data.model));
          return;
        case "session.agent.selected":
          publishMeta({ mode: str(data.agent) });
          return;
        case "session.shell.started":
        case "session.shell.ended":
          shellLine(rec(data.shell));
          return;
        case "session.revert.staged": {
          const revert = rec(data.revert);
          reverted = true;
          const files = arr(revert.files).length;
          const first =
            acpOf.get(str(revert.messageID)) ?? str(revert.messageID);
          hideFrom(
            first,
            files > 0 || rewindFiles ? "restore_all" : "messages_only",
            files,
          );
          rewindFiles = false;
          return;
        }
        case "session.revert.cleared":
        case "session.revert.committed":
          reverted = false;
          return;
      }
    }
    // `!` 명령은 tool 줄 하나다. 도는 execution이 없으면 이 줄이 끝날 때 turn도 끝난다.
    const shells = new Map<string, Call>();
    function shellLine(shell: Json) {
      const id = str(shell.id);
      let call = shells.get(id);
      if (call === undefined) {
        call = {
          id: ids.newId("tcl"),
          session: sessionId,
          name: "shell",
          input: { command: str(shell.command) },
          started: false,
          done: false,
        };
        shells.set(id, call);
        calls.set(`${sessionId}:${id}`, call);
        toolStart(call);
        return;
      }
      const status = str(shell.status);
      if (status === "running" || call.done) return;
      toolEnd(
        call,
        status === "exited" && shell.exit === 0
          ? "ok"
          : status === "killed"
            ? "cancelled"
            : "error",
      );
      if (!executing) endTurn("completed");
    }

    // --- meta ---

    function setModel(ref: Json) {
      const key = modelKey(ref);
      currentModel = key;
      const variant = variantOf(ref);
      publishMeta({
        model: {
          model: key,
          label: modelNames.get(key) ?? str(ref.id),
          options: variant === "" ? {} : { variant },
          layer: null,
        },
      });
    }

    async function loadMeta(): Promise<AcpSessionMeta> {
      const [models, agents, commands, current, fallback] = await Promise.all([
        api.models(),
        api.agents(),
        api.commands(),
        api.get(sessionId),
        api.defaultModel().catch((): Json => ({})),
      ]);
      const groups = new Map<string, AcpModelGroup>();
      contextLimit = new Map();
      modelNames = new Map();
      for (const model of models.map(rec)) {
        if (model.enabled === false) continue;
        const provider = str(model.providerID);
        const key = `${provider}/${str(model.modelID) || str(model.id)}`;
        const variants = arr(model.variants)
          .map((one) => str(rec(one).id))
          .filter((one) => one !== "");
        let group = groups.get(provider);
        if (group === undefined) {
          group = { id: provider, label: provider, models: [] };
          groups.set(provider, group);
        }
        group.models.push({
          id: key,
          label: str(model.name) || key,
          axes:
            variants.length === 0
              ? []
              : [
                  {
                    id: "variant",
                    label: "Variant",
                    values: variants.map((value) => ({ value, label: value })),
                  },
                ],
        });
        modelNames.set(key, str(model.name) || key);
        contextLimit.set(key, Number(rec(model.limit).context) || 0);
      }
      const ref = rec(current.model);
      const selected =
        str(ref.id) === ""
          ? {
              providerID: fallback.providerID,
              id: fallback.modelID,
              variant: undefined,
            }
          : ref;
      const key = modelKey(selected);
      currentModel = key;
      const variant = variantOf(selected);
      const modes = agents
        .map(rec)
        .filter((agent) => agent.mode !== "subagent" && agent.hidden !== true)
        .map((agent) => ({
          id: str(agent.id),
          label: str(agent.name) || str(agent.id),
          description: str(agent.description) || null,
        }));
      reverted = rec(current.revert).messageID !== undefined;
      const clientNames = new Set(CLIENT_COMMANDS.map((one) => one.name));
      return {
        title: str(current.title) || null,
        cli_session: sessionId,
        capabilities: CAPABILITIES,
        models: [...groups.values()],
        model:
          str(selected.id) === ""
            ? null
            : {
                model: key,
                label: modelNames.get(key) ?? str(selected.id),
                options: variant === "" ? {} : { variant },
                layer: null,
              },
        modes,
        mode: str(current.agent) || modes[0]?.id || null,
        commands: [
          ...CLIENT_COMMANDS,
          ...commands
            .map(rec)
            .filter((command) => !clientNames.has(str(command.name)))
            .map(
              (command): AcpCommand => ({
                name: str(command.name),
                description: str(command.description),
                argument_hint: null,
                source: "cli",
              }),
            ),
        ],
        usage: null,
      };
    }

    let reloading = false;
    function reloadLists() {
      if (reloading) return;
      reloading = true;
      void loadMeta()
        .then((meta) =>
          publishMeta({
            models: meta.models,
            modes: meta.modes,
            commands: meta.commands,
            model: meta.model,
            mode: meta.mode,
          }),
        )
        .catch(() => undefined) // 목록은 다음 갱신 때 다시 읽는다.
        .finally(() => {
          reloading = false;
        });
    }

    let refreshing = false;
    function refreshUsage() {
      if (refreshing || closed) return;
      refreshing = true;
      void usageOf()
        .then((usage) => publishMeta({ usage }))
        .catch(() => undefined) // 사용량은 꾸밈이라 못 읽어도 대화는 이어 간다.
        .finally(() => {
          refreshing = false;
        });
    }

    async function usageOf(): Promise<AcpUsage> {
      const [current, context] = await Promise.all([
        api.get(sessionId),
        api.context(sessionId),
      ]);
      const tokens = rec(current.tokens);
      const cache = rec(tokens.cache);
      const last = context
        .map(rec)
        .findLast(
          (one) => one.type === "assistant" && one.tokens !== undefined,
        );
      const step = rec(last?.tokens);
      const used =
        Number(step.input ?? 0) +
        Number(step.output ?? 0) +
        Number(rec(step.cache).read ?? 0) +
        Number(rec(step.cache).write ?? 0);
      const limit = contextLimit.get(currentModel) ?? 0;
      return {
        context:
          last === undefined || limit === 0 ? null : { tokens: used, limit },
        input_tokens: Number(tokens.input ?? 0),
        output_tokens: Number(tokens.output ?? 0),
        cache_read_tokens: Number(cache.read ?? 0),
        cache_write_tokens: Number(cache.write ?? 0),
        turns: null,
        costs: [
          {
            kind: "reported",
            currency: "USD",
            amount: String(Number(current.cost ?? 0)),
          },
        ],
        provider: null,
      };
    }

    // --- 앞 대화 ---

    function recordText(text: string, reasoning: string) {
      if (text === "" && reasoning === "") return;
      emit({
        type: "message_recorded",
        turn: startTurn(),
        message: ids.newId("msg"),
        model_call: null,
        seq: ++seq,
        at: now(),
        body: {
          content: text === "" ? [] : [{ type: "text", text }],
          reasoning:
            reasoning === "" ? null : { text: reasoning, duration_ms: null },
          cards: [],
        },
      });
    }

    function replayMessage(item: Json) {
      switch (str(item.type)) {
        case "user": {
          const content = contentOf(item.text, item.files);
          const steered = turnHasUser;
          const id = startTurn();
          turnHasUser = true;
          if (!userOf.has(id)) userOf.set(id, content);
          emit({
            type: "message_added",
            item: {
              kind: "message",
              id: str(item.id),
              seq: ++seq,
              at: now(),
              actor: "user",
              sender: null,
              call: null,
              reply_to: null,
              delivery: steered ? "steer" : "next_turn",
              turn: id,
              content,
              reasoning: null,
              cards: [],
              complete: true,
            },
          });
          return;
        }
        case "assistant": {
          let text = "";
          let reasoning = "";
          for (const part of arr(item.content).map(rec)) {
            if (part.type === "text") text += str(part.text);
            else if (part.type === "reasoning") reasoning += str(part.text);
            else {
              recordText(text, reasoning);
              text = reasoning = "";
              const state = rec(part.state);
              const call = callOf(sessionId, str(part.id), str(part.name));
              call.input = state.status === "streaming" ? {} : rec(state.input);
              toolStart(call);
              if (state.status === "completed")
                toolEnd(
                  call,
                  "ok",
                  endDetail(call, rec(state.metadata), "done"),
                );
              else if (state.status === "error")
                toolEnd(
                  call,
                  "error",
                  endDetail(call, rec(state.metadata), "failed"),
                );
            }
          }
          recordText(text, reasoning);
          return;
        }
        case "idle": {
          const outcome = str(item.outcome);
          endTurn(
            outcome === "interrupted"
              ? "stopped"
              : outcome === "failed"
                ? "failed"
                : "completed",
            outcome === "failed"
              ? {
                  code: "internal",
                  message: str(rec(item.error).message) || "OpenCode failed.",
                }
              : undefined,
          );
          return;
        }
        case "synthetic":
          if (rec(item.metadata).notice === "restart") info(RESTART_NOTICE);
          return;
        case "compaction":
          if (item.status === "completed") info("The context was compacted.");
          return;
        case "shell":
          shellLine({
            id: item.shellID,
            command: item.command,
            status: "running",
          });
          if (item.status !== "running")
            shellLine({
              id: item.shellID,
              status: item.status,
              exit: item.exit,
            });
          return;
      }
    }

    function endReplay() {
      replaying = false;
      const held = backlog;
      backlog = [];
      for (const event of held) onEvent(event);
    }

    // 마지막 page도 `cursor.next`를 싣는다. page가 덜 찼으면 끝이다.
    async function allMessages(id: string): Promise<Json[]> {
      const out: Json[] = [];
      let cursor = "";
      for (;;) {
        const page = await api.messages(
          id,
          cursor === "" ? { limit: 200, order: "asc" } : { limit: 200, cursor },
        );
        const items = arr(page.data).map(rec);
        out.push(...items);
        cursor = str(rec(page.cursor).next);
        if (items.length < 200 || cursor === "") return out;
      }
    }

    async function replay() {
      for (const item of await allMessages(sessionId)) replayMessage(item);
      // 끝맺지 못한 turn은 server가 멈췄던 것이다. 이어 가는 일은 새 execution이 연다.
      endTurn("stopped");
    }

    // --- 입력 ---

    async function sendPrompt(
      id: string,
      content: ContentBlock[],
      delivery: "steer" | "queue",
    ) {
      const { text, files } = promptOf(content);
      if (text.startsWith("!")) {
        await api.shell(sessionId, { command: text.slice(1).trim() });
        return;
      }
      // 되돌린 구간은 다음 보내기 전에 확정한다(TUI·데스크톱과 같다).
      if (reverted) {
        await api.revertCommit(sessionId);
        reverted = false;
      }
      own.set(id, content);
      // `metadata`로 우리가 보낸 것을 알아본다: event가 응답보다 먼저 와도 사람 메시지가 두 번 그려지지 않는다.
      await api.prompt(sessionId, {
        text,
        ...(files.length === 0 ? {} : { files }),
        delivery,
        metadata: { lophn: id },
      });
    }

    // 줄 선 메시지를 `from`부터 끝까지 다시 넣는다. inbox 순서는 넣은 순서라 순서를 바꾸려면 뒤를 다시 넣어야 한다.
    async function requeue(
      order: { id: string; content: ContentBlock[] }[],
      from: number,
    ) {
      const tail = order.slice(from);
      // 취소 event가 먼저 와서 지우기 전에 읽어 둔다.
      const deliveries = tail.map((one) => deliveryOf.get(one.id) ?? "queue");
      for (const one of tail) {
        const server = serverOf.get(one.id);
        if (server !== undefined) await api.inboxCancel(sessionId, server);
      }
      for (const [index, one] of tail.entries())
        await sendPrompt(one.id, one.content, deliveries[index] ?? "queue");
    }

    async function rewind(target: string, files: boolean) {
      if (mirror.queued.some((one) => one.id === target)) {
        // 아직 server에 닿지 않은 메시지는 되돌릴 기록이 없다. 줄에서 뺀다.
        const server = serverOf.get(target);
        if (server !== undefined) await api.inboxCancel(sessionId, server);
        return;
      }
      await api.interrupt(sessionId);
      await api.wait(sessionId);
      rewindFiles = files;
      await api.revertStage(sessionId, {
        messageID: serverOf.get(target) ?? target,
        files,
      });
    }

    // fork·new로 다른 session에 옮긴다. 그 session에 없는 앞 항목은 숨긴다(화면에 지우는 갱신이 없다).
    async function moveTo(id: string, hide: string | undefined) {
      endTurn("stopped");
      const users = mirror.items.flatMap((item) =>
        item.kind === "message" && item.actor === "user" ? [item.id] : [],
      );
      sessionId = id;
      calls.clear();
      children.clear();
      forms.clear();
      reverted = false;
      if (hide !== undefined) hideFrom(hide, "messages_only", 0);
      const created = await api.get(id);
      publishMeta({ cli_session: id, title: str(created.title) || null });
      // 새 session의 사람 메시지는 옛 id와 달라서, 순서대로 짝지어 rewind·fork가 맞는 id를 쓰게 한다.
      const fresh = (await allMessages(id))
        .filter((item) => item.type === "user")
        .map((item) => str(item.id));
      users.forEach((acp, index) => {
        const server = fresh[index];
        if (server !== undefined) serverOf.set(acp, server);
      });
      refreshUsage();
    }

    async function fork(target: string | null) {
      const before =
        target === null ? undefined : (serverOf.get(target) ?? target);
      const forked = await api.fork(
        sessionId,
        before === undefined ? {} : { before },
      );
      await moveTo(str(forked.id), target ?? undefined);
    }

    async function newSession() {
      const created = await api.create({ location: { directory: cwd } });
      await moveTo(str(created.id), mirror.items[0]?.id);
    }

    async function runCommand(name: string, argument: string) {
      switch (name) {
        case "undo": {
          const last = mirror.items.findLast(
            (item) => item.kind === "message" && item.actor === "user",
          );
          if (last === undefined) info("Nothing to undo.");
          else await rewind(last.id, true);
          return;
        }
        case "redo":
          await api.revertClear(sessionId);
          info(
            "Redo restored the files. The messages that /undo hid stay hidden in this view.",
          );
          return;
        case "fork":
          return fork(null);
        case "compact":
          await api.compact(sessionId);
          return;
        case "rename":
          if (argument.trim() === "") info("Usage: /rename <title>");
          else {
            await api.update(sessionId, { title: argument.trim() });
            publishMeta({ title: argument.trim() });
          }
          return;
        case "new":
          return newSession();
        default:
          await api.command(sessionId, { name, text: argument });
      }
    }

    async function setModelInput(
      input: Extract<AcpInput, { type: "set_model" }>,
    ) {
      const slash = input.model.indexOf("/");
      const ref: Json = {
        providerID: input.model.slice(0, slash),
        id: input.model.slice(slash + 1),
      };
      const variant = input.options.variant;
      if (variant !== undefined && variant !== "") ref.variant = variant;
      await api.switchModel(sessionId, { model: ref });
      setModel(ref);
    }

    async function handle(input: AcpInput) {
      if ("key" in input) {
        if (sentKeys.has(input.key)) return;
        sentKeys.add(input.key);
      }
      if (dead !== null) {
        if (input.type === "send") endTurn("failed", dead);
        return;
      }
      switch (input.type) {
        case "send":
          await attempt("Send", () =>
            sendPrompt(
              input.id,
              input.content,
              input.delivery === "steer" ? "steer" : "queue",
            ),
          );
          return;
        case "retry": {
          const content = userOf.get(input.turn);
          if (content !== undefined)
            await attempt("Retry", () =>
              sendPrompt(ids.newId("msg"), content, "queue"),
            );
          return;
        }
        case "stop":
          await attempt("Stop", () => api.interrupt(sessionId));
          return;
        case "answer":
          await attempt("Answer", () => answer(input));
          return;
        case "decide":
          await attempt("Decision", () => decide(input.request, input.choice));
          return;
        case "send_queued": {
          const server = serverOf.get(input.message);
          if (server !== undefined)
            await attempt("Send now", () =>
              api.inboxUpdate(sessionId, server, { delivery: "steer" }),
            );
          return;
        }
        case "remove_queued": {
          const server = serverOf.get(input.message);
          if (server !== undefined)
            await attempt("Remove", () => api.inboxCancel(sessionId, server));
          return;
        }
        case "edit_queued": {
          const order = mirror.queued.map((one) =>
            one.id === input.message ? { ...one, content: input.content } : one,
          );
          const index = order.findIndex((one) => one.id === input.message);
          if (index >= 0) await attempt("Edit", () => requeue(order, index));
          return;
        }
        case "move_queued": {
          const order = [...mirror.queued];
          const index = order.findIndex((one) => one.id === input.message);
          const target = index + (input.direction === "up" ? -1 : 1);
          const moved = order[index];
          const other = order[target];
          if (moved === undefined || other === undefined) return;
          order[index] = other;
          order[target] = moved;
          await attempt("Move", () => requeue(order, Math.min(index, target)));
          return;
        }
        case "set_model":
          await attempt("Model change", () => setModelInput(input));
          return;
        case "set_mode":
          await attempt("Mode change", async () => {
            await api.switchAgent(sessionId, { agent: input.mode });
            publishMeta({ mode: input.mode });
          });
          return;
        case "run_command":
          await attempt(`/${input.name}`, () =>
            runCommand(input.name, input.argument),
          );
          return;
        case "rewind":
          await attempt("Rewind", () => rewind(input.message, input.files));
          return;
        case "fork":
          await attempt("Fork", () => fork(input.message));
          return;
        case "compact":
          await attempt("Compact", () => api.compact(sessionId));
          return;
        case "rename":
          await attempt("Rename", async () => {
            await api.update(sessionId, { title: input.title });
            publishMeta({ title: input.title });
          });
          return;
      }
    }

    // --- 시작 ---

    const failure = (reason: string) => {
      if (closed || dead !== null) return;
      dead = {
        code: "unavailable",
        message: stderrTail === "" ? reason : `${reason}\n${stderrTail.trim()}`,
      };
      endTurn("failed", dead);
    };
    proc.onExit(() => failure("OpenCode exited."));

    try {
      const server = await api.info();
      const version = str(server.version);
      events = transport.events(onEvent, (cause) => failure(cause.message));
      let resumed = false;
      if (resume !== undefined)
        resumed = await api.get(resume).then(
          () => true,
          () => false,
        );
      if (!resumed)
        sessionId = str(
          (await api.create({ location: { directory: cwd } })).id,
        );
      publishMeta(await loadMeta());
      if (version !== RECORDED_OPENCODE_VERSION && version !== "")
        info(
          `OpenCode ${version} differs from ${RECORDED_OPENCODE_VERSION}, the version lophn checked, so some features may not work.`,
        );
      if (resumed) await replay();
      else if (resume !== undefined)
        endTurn("failed", {
          code: "not_found",
          message: `The session ${resume} could not be loaded, so a new session was started.`,
        });
      endReplay();
      refreshUsage();
    } catch (cause) {
      events?.close();
      proc.end();
      proc.kill();
      await secret.remove();
      return {
        ok: false,
        error: {
          code: "unavailable",
          message: `OpenCode did not respond: ${message(cause)}`,
        },
      } satisfies Result<never>;
    }

    setupDone();

    return {
      ok: true,
      value: {
        async stop() {
          closed = true;
          events?.close();
          // stdin이 닫히면 server가 스스로 끝난다(lease). 그래도 안 끝나면 process group째 끈다.
          proc.end();
          proc.kill();
          let timer: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([
            exited,
            new Promise((resolve) => {
              timer = setTimeout(resolve, 5000);
            }),
          ]);
          clearTimeout(timer);
          await secret.remove();
        },
        // password는 친 글에 싣지 않는다. 0600 file에서 읽어 그 명령에만 env로 준다.
        tuiCommand: () =>
          `OPENCODE_PASSWORD="$(cat '${secret.path.replaceAll("'", "'\\''")}')" opencode --server ${url} --session ${sessionId}`,
        sessionId: () => sessionId,
        running: () => ({
          turn: turn !== null,
          tasks: [...children.values()].filter((one) => one.running).length,
        }),
      },
    };
  };

  return {
    handoff: "shared",
    start,
    // TUI의 `/exit`(slash 명령 `app.exit`, 별칭 quit·q)다. 키(ctrl+c·ctrl+d)는 입력 상태에 따라 다른 뜻이라 쓰지 않는다.
    // 초안이 남아 있거나 dialog가 열려 있어 끝나지 않으면 호출한 쪽의 시간 제한이 오류로 알린다.
    exitTui(terminal) {
      terminal.type("/exit\r");
      return Promise.resolve({ ok: true, value: undefined });
    },
  };
}

export const opencodeAdapter = createOpencodeAdapter(realDeps);
