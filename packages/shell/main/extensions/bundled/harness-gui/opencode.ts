// OpenCode adapter. OpenCode는 server(`opencode serve`)와 client(TUI, 데스크톱 앱)로 나뉜 구조라 데스크톱 앱처럼 server의
// HTTP+SSE API를 손으로 짠 client로 말한다(`@opencode/client`는 쓰지 않는다: effect에 기대고 OpenCode 판 하나에 묶인다).
// 탭마다 server 하나를 띄우고(`--stdio`: stdin을 쥐고 있는 동안이 server의 lease) GUI와 TUI(`opencode --server <url>`)가 같이 붙는다.
// server event를 ACP 갱신으로, 창의 ACP 입력을 API 호출로 옮긴다. 권한은 사람의 OpenCode 설정을 따른다(ask 규칙이 없으면 승인 카드는 뜨지 않는다).
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, sep } from "node:path";
import type { Result } from "../../../../../base/result.ts";
import { redactCredentials } from "../../../../../base/telemetry/log.ts";
import type { AcpInput } from "../../../../../protocol/acp/input.ts";
import {
  ACP_TOOL_BODY_LIMIT,
  type AcpEntry,
  type AcpToolBody,
  type AcpToolItem,
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
  AcpUsageLimit,
} from "../../../../../protocol/acp/session.ts";
import type {
  AcpChildUpdate,
  AcpState,
  AcpTask,
  AcpUpdate,
} from "../../../../../protocol/acp/state.ts";
import type { AcpApprovalSubject } from "../../../../../protocol/approvals/gate-call.ts";
import type { ContentBlock } from "../../../../../protocol/lophn-agent/content-block.ts";
import type { HarnessGuiAdapter } from "./adapter.ts";
import { classifyReceived } from "./received.ts";

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
// 창에 보이는 오류 글은 server와 process의 말이라 credential이 섞일 수 있다.
const message = (cause: unknown) =>
  redactCredentials(cause instanceof Error ? cause.message : String(cause));

/** SSE 한 건(`\n\n`까지)이 이보다 커지면 stream 오류로 끝낸다. */
const MAX_EVENT_BYTES = 64 * 1024 * 1024;
/** 요청 하나에 server가 답하기를 기다리는 시간. */
const REQUEST_WAIT_MS = 30_000;
// OpenCode 자신의 client(`packages/client/src/mcp.ts`)와 같은 간격이다.
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 10_000;
/** event 없이 이만큼 이어 실패하면 다시 구독을 그만둔다. */
const RECONNECT_GIVE_UP = 5;

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
            if (data === "") continue;
            // 틀린 event 하나로 stream 전체를 끝내지 않는다.
            let event: Json;
            try {
              event = JSON.parse(data) as Json;
            } catch {
              continue;
            }
            onEvent(event);
          }
          if (buffer.length > MAX_EVENT_BYTES)
            throw new Error(
              "The OpenCode event stream sent an event that was too large.",
            );
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
  type Options = { query?: Record<string, string | number>; body?: unknown };
  // 기한을 넘긴 요청은 끊지 않고 둔다: server는 이미 받았을 수 있어 그 호출만 실패로 보인다.
  const call = (method: string, path: string, options?: Options) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      transport.request(method, path, options),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `OpenCode did not answer ${method} ${path} in ${REQUEST_WAIT_MS / 1000} seconds.`,
              ),
            ),
          REQUEST_WAIT_MS,
        );
        // 답을 기다리는 timer가 process 종료를 붙잡지 않게 한다.
        timer.unref();
      }),
    ]).finally(() => clearTimeout(timer));
  };
  // 일이 끝나야 답하는 요청(기한 없음): `wait`는 execution이 멈출 때까지, `shell`은 명령이 끝날 때까지,
  // `command`는 plugin이 template을 펼칠 때까지, `revertStage`는 file을 되돌리는 동안 답하지 않는다.
  const slowCall = (method: string, path: string, options?: Options) =>
    transport.request(method, path, options);
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
    listSessions: async (query?: Record<string, string | number>) =>
      (await call("GET", "/api/session", { query })) ?? {},
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
      slowCall("POST", `${session(id)}/command`, { body }),
    shell: (id: string, body: Json) =>
      slowCall("POST", `${session(id)}/shell`, { body }),
    // 도는 명령 하나를 죽이고 지운다(`interrupt`는 turn을 멈출 뿐 명령은 그대로 둔다). 끝은 killed로 온다.
    killShell: (id: string, directory: string) =>
      call("DELETE", `/api/shell/${encodeURIComponent(id)}`, {
        query: { "location[directory]": directory },
      }),
    compact: (id: string) =>
      call("POST", `${session(id)}/compact`, { body: {} }),
    interrupt: (id: string) => call("POST", `${session(id)}/interrupt`),
    background: (id: string) => call("POST", `${session(id)}/background`),
    wait: (id: string) =>
      slowCall(
        "POST",
        `/api/experimental/session/${encodeURIComponent(id)}/wait`,
      ),
    revertStage: (id: string, body: Json) =>
      slowCall("POST", `${session(id)}/revert/stage`, { body }),
    permissions: async (id: string) =>
      arr(await data(call("GET", `${session(id)}/permission`))),
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
    usageLimits: async () =>
      (await call("GET", "/api/experimental/usage/limits")) ?? {},
    sessionStats: async (query: Record<string, string | number>) =>
      (await call("GET", "/api/experimental/session/stats", { query })) ?? {},
    exportSession: async (id: string) =>
      (await call(
        "GET",
        `/api/experimental/session/${encodeURIComponent(id)}/export`,
      )) ?? {},
    mcps: async () => (await call("GET", "/api/mcp")) ?? {},
    skills: async () => arr(await data(call("GET", "/api/skill"))),
    runSkill: (id: string, skill: string) =>
      call(
        "POST",
        `/api/experimental/session/${encodeURIComponent(id)}/skill`,
        { body: { id: skill } },
      ),
  };
}
export type OpencodeApi = ReturnType<typeof createApi>;

/** 0600 file 하나. 터미널 env는 PASSWORD가 든 이름을 지워 물려줄 수 없어서 TUI 명령이 이 file에서 읽는다. */
export type SecretFile = { path: string; remove(): Promise<void> };

export type OpencodeDeps = {
  connect(input: { url: string; password: string }): OpencodeTransport;
  writeSecret(text: string): Promise<SecretFile>;
  /** `/export`의 JSON을 tmpdir의 `name`에 쓰고 경로를 돌려준다. */
  writeExport(name: string, text: string): Promise<string>;
  /** 사람의 home. 명령 file을 읽는 전역 폴더(`~/.config/opencode`)의 뿌리다. */
  home: string;
  /**
   * `{dir}/{command,commands}/**\/*.md`의 명령 이름 → template 본문(frontmatter 뺀 것). 뒤 폴더가 앞 폴더를 덮는다.
   * server의 `GET /api/command`는 template을 주지 않아서 인자를 받는 명령인지는 file에서 읽는다.
   */
  readCommandTemplates(dirs: string[]): Promise<Map<string, string>>;
};

const realDeps: OpencodeDeps = {
  connect: fetchTransport,
  home: homedir(),
  async readCommandTemplates(dirs) {
    const out = new Map<string, string>();
    for (const dir of dirs) {
      for (const sub of ["command", "commands"]) {
        const root = join(dir, sub);
        const files = await readdir(root, { recursive: true }).catch(
          () => [] as string[],
        );
        for (const file of files.filter((one) => one.endsWith(".md")).sort()) {
          const text = await readFile(join(root, file), "utf8").catch(
            () => undefined,
          );
          if (text === undefined) continue;
          // OpenCode가 쓰는 이름: command 폴더 안의 상대 경로에서 `.md`를 뺀 것, 구분자는 `/`.
          const name = file.slice(0, -3).split(sep).join("/");
          out.set(
            name,
            text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim(),
          );
        }
      }
    }
    return out;
  },
  async writeSecret(text) {
    // mkdtemp는 0700 폴더를 만든다.
    const dir = await mkdtemp(join(tmpdir(), "lophn-opencode-"));
    const path = join(dir, "password");
    await writeFile(path, text, { mode: 0o600 });
    return { path, remove: () => rm(dir, { recursive: true, force: true }) };
  },
  async writeExport(name, text) {
    const path = join(tmpdir(), name);
    await writeFile(path, text);
    return path;
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
  // `session.background`가 지금 도는 foreground tool을 background 관찰로 옮긴다(idle이면 아무것도 안 한다).
  background: true,
  queue_edit: true,
  // 창이 이미지를 임시 폴더에 쓰고 `file://` 링크로 보낸다.
  images: true,
  retry: true,
  sessions: false,
  // OpenCode desktop은 자식 session에 composer 대신 상태 줄만 둔다(`subagent-bar.tsx`).
  stop_child: true,
  steer_child: false,
  tasks: true,
  toggles: true,
  goal: false,
  roles: false,
  shell: true,
  resume: true,
};

// 별칭은 TUI의 그 명령 `slash` 칸에서 옮겼다(`tui/src/app.tsx`, `routes/session/index.tsx`).
const slash = (
  name: string,
  description: string,
  more: Partial<AcpCommand> = {},
): AcpCommand => ({
  name,
  aliases: [],
  description,
  argument_hint: null,
  source: "harness",
  opens: null,
  ...more,
});
const CLIENT_COMMANDS: AcpCommand[] = [
  slash("new", "Start a new session", { aliases: ["clear"] }),
  slash("undo", "Undo the last message and its file changes"),
  slash("redo", "Redo what /undo reverted"),
  slash("fork", "Fork this session", { opens: "fork" }),
  slash("compact", "Summarize the conversation to free context", {
    opens: "compact",
  }),
  slash("rename", "Rename this session", {
    opens: "rename",
    argument_hint: "title",
  }),
  slash("models", "Choose the model", { opens: "model" }),
  slash("variants", "Choose the thinking effort", {
    aliases: ["thinking", "effort"],
    opens: "effort",
  }),
  slash("agents", "Choose the agent", { aliases: ["agent"], opens: "mode" }),
  slash("usage", "Show the usage limits", { opens: "usage" }),
  slash("status", "Show the server, agent, model and MCP status"),
  slash("stats", "Show session statistics"),
  slash("mcps", "List the MCP servers", { aliases: ["mcp"] }),
  slash("skills", "List the skills"),
  slash("export", "Export this session as JSON"),
  slash("resume", "Open an earlier session in this folder", {
    opens: "resume",
  }),
];

// 명령 file이 없는 내장 명령의 인자. 사람이 부를 때 쓰는 말은 server의 설명에 있다.
const BUILTIN_HINTS: Record<string, string> = { review: "[commit|branch|pr]" };
const TAKES_ARGUMENTS = /\$(?:ARGUMENTS|[1-9]\d*)/;

const AUTO_ACCEPT = "auto_accept";

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

const isoOf = (ms: unknown) =>
  typeof ms === "number" ? new Date(ms).toISOString() : null;

const modelKey = (ref: Json) => `${str(ref.providerID)}/${str(ref.id)}`;
// variant를 고르지 않은 session의 model은 variant가 "default"로 온다. 목록에 없는 값이라 고르지 않은 것으로 본다.
const variantOf = (ref: Json) =>
  str(ref.variant) === "default" ? "" : str(ref.variant);

// --- adapter ------------------------------------------------------------------------------------------------------------

// 대화 한 줄기. 부모 session 하나와 subagent 자식마다 하나씩이고, 갱신을 내는 길만 다르다(자식은 `child_update`로 싼다).
type Lane = {
  emit(update: AcpChildUpdate): void;
  seq: number;
  turn: string | null;
  /** 이 turn이 이미 사람 메시지를 가져갔는지. 그 뒤에 오는 사람 메시지가 steer다. */
  turnHasUser: boolean;
  writing: {
    call: string;
    message: string;
    text: string;
    reasoning: string;
  } | null;
};

type Call = {
  id: string;
  lane: Lane;
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

type Child = {
  lane: Lane;
  state: "running" | "done" | "failed" | "cancelled";
  /** 자식의 마지막 글 한 줄. */
  last: string | null;
  /** 이 자식을 연 부모의 `subagent` tool 줄. */
  call?: Call;
};

const TASK_STATES = {
  running: "running",
  done: "done",
  failed: "failed",
  cancelled: "stopped",
} as const;

// session message의 `idle` 줄(turn 하나가 끝났다는 표)을 turn의 끝으로 옮긴다.
function idleEnd(item: Json): {
  outcome: "completed" | "stopped" | "failed";
  error?: { code: string; message: string };
} {
  const outcome = str(item.outcome);
  if (outcome === "interrupted") return { outcome: "stopped" };
  if (outcome !== "failed") return { outcome: "completed" };
  return {
    outcome: "failed",
    error: {
      code: "internal",
      message:
        redactCredentials(str(rec(item.error).message)) || "OpenCode failed.",
    },
  };
}

const lastLine = (text: string) => oneLine(text, 200) || null;

/** tool 본문 한 쪽의 글자 수 상한(`ACP_TOOL_BODY_LIMIT`)을 넘으면 자른다. */
function bodyOf(input: unknown, output: string | null): AcpToolBody {
  const cut = (text: string | null) =>
    text !== null && text.length > ACP_TOOL_BODY_LIMIT
      ? text.slice(0, ACP_TOOL_BODY_LIMIT)
      : text;
  const text = input === undefined ? null : JSON.stringify(input, null, 2);
  return {
    input: cut(text),
    output: cut(output),
    truncated:
      (text?.length ?? 0) > ACP_TOOL_BODY_LIMIT ||
      (output?.length ?? 0) > ACP_TOOL_BODY_LIMIT,
  };
}

const textOf = (content: unknown) =>
  arr(content)
    .map(rec)
    .flatMap((one) => (one.type === "text" ? [str(one.text)] : []))
    .join("\n");

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
    // env는 extension spawner(`nodeSpawn`)가 login shell env < 여기서 넘기는 env 순으로 합친다. 여기서는 바꾸는 칸만 넘긴다.
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
    // 끝난 process에는 kill을 보내지 않는다.
    let alive = true;
    const exited = new Promise<void>((resolve) =>
      proc.onExit(() => {
        alive = false;
        resolve();
      }),
    );

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
          message: redactCredentials(
            `OpenCode did not start.${stderrTail === "" ? "" : `\n${stderrTail.trim()}`}`,
          ),
        },
      } satisfies Result<never>;
    }

    let secret: SecretFile;
    try {
      secret = await deps.writeSecret(password);
    } catch (cause) {
      proc.end();
      proc.kill();
      return {
        ok: false,
        error: {
          code: "unavailable",
          message: `OpenCode could not start: ${message(cause)}`,
        },
      } satisfies Result<never>;
    }
    const transport = deps.connect({ url, password });
    const api = createApi(transport);
    let events: { close(): void } | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const now = () => clock.now();
    // 창에 낸 갱신을 접어 둔다. rewind·fork가 숨길 항목과 줄 선 메시지를 여기서 읽는다.
    let mirror: AcpState = EMPTY_ACP_STATE;
    const emit = (update: AcpUpdate) => {
      if (closed) return;
      mirror = reduceAcp(mirror, update);
      session.publish(update);
    };
    const makeLane = (send: Lane["emit"]): Lane => ({
      emit: send,
      seq: 0,
      turn: null,
      turnHasUser: false,
      writing: null,
    });
    const main = makeLane(emit);

    let sessionId = resume ?? "";
    // 사람 메시지 id: 우리가 보낸 것은 창의 id를, 아닌 것은 server의 id를 ACP id로 쓴다.
    const acpOf = new Map<string, string>();
    const serverOf = new Map<string, string>();
    const own = new Map<string, ContentBlock[]>();
    const deliveryOf = new Map<string, "steer" | "queue">();
    // retry가 다시 보낼 turn의 사람 메시지.
    const userOf = new Map<string, ContentBlock[]>();
    const calls = new Map<string, Call>();
    const children = new Map<string, Child>();
    // background로 띄운 자식. 목록은 통째로 바뀐다(`tasks_changed`).
    let tasks: AcpTask[] = [];
    const approvals = new Map<string, Approval>();
    const approvalOf = new Map<string, string>();
    const forms = new Map<string, Form>();
    let reverted = false;
    // `/undo`가 숨긴 구간. `session.revert.cleared`(redo)가 오면 되살린다.
    let hiddenId: string | null = null;
    // 우리가 부른 rewind가 file도 되돌리라고 했는지. 되돌릴 file이 없으면 server가 `files: []`로 답해서 요청을 기억한다.
    let rewindFiles = false;
    // 앞 대화를 그리는 동안 온 event는 쌓아 두었다가 그린 뒤에 접는다.
    let replaying = true;
    // server가 이 session의 execution이 돈다고 알려 준 동안.
    let executing = false;
    let autoAccept = false;
    let currentModel = "";
    let backlog: Json[] = [];
    let contextLimit = new Map<string, number>();
    let modelNames = new Map<string, string>();
    let skillIds = new Set<string>();
    // 방금 보낸 server 명령의 친 글. 사람 메시지로는 template이 펼쳐진 글이 오기 때문이다.
    let pendingCommand: string | null = null;
    // 다시 열 때 마지막으로 끝난 `todowrite`의 todo(server에는 todo 상태가 없다).
    let lastTodos: unknown[] | null = null;
    const sentKeys = new Set<string>();
    // 시작하는 동안 온 입력은 시작이 끝난 뒤에 받는다.
    let setupDone: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      setupDone = resolve;
    });
    session.onInput((input) => void ready.then(() => handle(input)));

    const publishMeta = (meta: Partial<AcpSessionMeta>) =>
      emit({ type: "session_changed", session: meta });

    // turn 밖의 한 줄 알림이다.
    function info(text: string, level: "info" | "warning" = "info") {
      emit({
        type: "notice_added",
        item: {
          kind: "notice",
          id: ids.newId("not"),
          seq: ++main.seq,
          at: now(),
          turn: null,
          notice: { type: "info", text, level },
        },
      });
    }

    function commandOutput(name: string, text: string) {
      emit({
        type: "notice_added",
        item: {
          kind: "notice",
          id: ids.newId("not"),
          seq: ++main.seq,
          at: now(),
          turn: null,
          notice: {
            type: "command_output",
            command: name,
            text,
            format: "markdown",
          },
        },
      });
    }

    // 사람이 부른 동작이 실패하면 조용히 두지 않고 알린다.
    async function attempt(label: string, work: () => Promise<unknown>) {
      try {
        await work();
      } catch (cause) {
        info(`${label} failed: ${message(cause)}`, "warning");
      }
    }

    // --- turn, 글, tool ---

    function startTurn(lane: Lane): string {
      if (lane.turn !== null) return lane.turn;
      lane.turnHasUser = false;
      lane.turn = ids.newId("trn");
      lane.emit({ type: "turn_started", turn: lane.turn, at: now() });
      return lane.turn;
    }

    function flushWriting(lane: Lane) {
      const writing = lane.writing;
      if (writing === null || (writing.text === "" && writing.reasoning === ""))
        return;
      lane.emit({
        type: "message_recorded",
        turn: startTurn(lane),
        message: ids.newId("msg"),
        model_call: writing.call,
        seq: ++lane.seq,
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
      lane.writing = null;
    }

    function stream(
      lane: Lane,
      kind: "text" | "reasoning",
      messageId: string,
      text: string,
    ) {
      if (lane.writing !== null && lane.writing.message !== messageId)
        flushWriting(lane);
      lane.writing ??= {
        call: ids.newId("mcl"),
        message: messageId,
        text: "",
        reasoning: "",
      };
      lane.emit({
        type: "writing_streamed",
        turn: startTurn(lane),
        model_call: lane.writing.call,
        kind,
        offset: lane.writing[kind].length,
        text,
        at: now(),
      });
      lane.writing[kind] += text;
    }

    function endTurn(
      lane: Lane,
      outcome: "completed" | "stopped" | "failed",
      error?: { code: string; message: string },
    ) {
      if (lane.turn === null && error === undefined) return;
      const id = lane.turn ?? ids.newId("trn");
      // 승인과 질문은 자식 것도 부모에 그린다. 부모 turn이 끝날 때 함께 닫는다.
      if (lane === main) {
        for (const request of [...approvals.keys()])
          closeApproval(request, "cancelled", null);
        for (const form of [...forms.keys()]) resolveForm(form, "cancelled");
      }
      flushWriting(lane);
      lane.writing = null;
      for (const [key, call] of calls) {
        if (call.lane !== lane) continue;
        if (call.started && !call.done) toolEnd(call, "cancelled");
        calls.delete(key);
      }
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

    // subagent 줄의 detail은 자식의 지금 상태를 읽는다.
    function subagentDetail(call: Call): AcpToolItem["detail"] {
      const child =
        call.child === undefined ? undefined : children.get(call.child);
      return {
        kind: "subagent",
        agent: str(call.input.agent) || "subagent",
        description: str(call.input.description) || str(call.input.prompt),
        child: call.child ?? null,
        state: child?.state ?? "running",
        model: str(call.input.model) || null,
        last: child?.last ?? null,
      };
    }

    const detailFor = (call: Call) =>
      call.name === "subagent"
        ? subagentDetail(call)
        : detailOf(call.name, call.input);

    function toolStart(call: Call) {
      if (call.started) return;
      call.started = true;
      flushWriting(call.lane);
      const summary = summaryOf(call.input);
      call.lane.emit({
        type: "tool_started",
        item: {
          kind: "tool",
          id: call.id,
          seq: ++call.lane.seq,
          at: now(),
          by: "agent",
          turn: startTurn(call.lane),
          tool: call.name,
          category: CATEGORIES[call.name] ?? "other",
          title: summary === "" ? call.name : `${call.name} ${summary}`,
          state: "running",
          duration_ms: null,
          detail: detailFor(call),
          body: bodyOf(call.input, null),
        },
      });
    }

    function toolEnd(
      call: Call,
      state: "ok" | "error" | "denied" | "cancelled",
      detail: AcpToolItem["detail"] | null = null,
      output: string | null = null,
    ) {
      call.done = true;
      call.lane.emit({
        type: "tool_ended",
        tool_call: call.id,
        state,
        at: now(),
        detail,
        body: bodyOf(call.input, output),
      });
    }

    function callOf(
      lane: Lane,
      sid: string,
      toolId: string,
      name = "tool",
    ): Call {
      const key = `${sid}:${toolId}`;
      let call = calls.get(key);
      if (call === undefined) {
        call = {
          id: ids.newId("tcl"),
          lane,
          name,
          input: {},
          started: false,
          done: false,
        };
        calls.set(key, call);
      }
      return call;
    }

    // --- subagent ---

    function ensureChild(sid: string): Child {
      let child = children.get(sid);
      if (child === undefined) {
        child = {
          lane: makeLane((update) =>
            emit({ type: "child_update", child: sid, update }),
          ),
          state: "running",
          last: null,
        };
        children.set(sid, child);
      }
      return child;
    }

    function publishTasks() {
      emit({ type: "tasks_changed", tasks: [...tasks] });
    }

    // 자식의 상태나 마지막 글이 바뀌었다. 부모의 subagent 줄과 background task 목록에 옮긴다.
    function touchChild(sid: string, child: Child) {
      const call = child.call;
      if (call?.started === true)
        call.lane.emit({
          type: "tool_detail_changed",
          tool_call: call.id,
          detail: subagentDetail(call),
        });
      const task = tasks.find((one) => one.id === sid);
      if (task !== undefined && task.state !== TASK_STATES[child.state]) {
        tasks = tasks.map((one) =>
          one === task ? { ...one, state: TASK_STATES[child.state] } : one,
        );
        publishTasks();
      }
    }

    function setChildState(sid: string, state: Child["state"]) {
      const child = children.get(sid);
      if (child === undefined || child.state === state) return;
      child.state = state;
      touchChild(sid, child);
    }

    // 부모의 subagent tool과 자식 session을 짝짓는다. 자식을 만든 session.created가 아니라 tool의 metadata.sessionID가
    // 짝의 근거라서 자식이 여럿 같이 떠도 맞는다. 이어 말하기(input.sessionID)는 이미 있는 자식이다.
    function linkChild(call: Call, sid: string) {
      if (call.child === sid) return;
      call.child = sid;
      const child = ensureChild(sid);
      child.call = call;
      if (
        call.input.background === true &&
        !tasks.some((one) => one.id === sid)
      ) {
        tasks = [
          ...tasks,
          {
            id: sid,
            kind: "agent",
            description: str(call.input.description) || str(call.input.prompt),
            state: TASK_STATES[child.state],
            started_at: now(),
            output: null,
          },
        ];
        publishTasks();
      }
      touchChild(sid, child);
    }

    // tool이 끝날 때 자식 session의 execution event를 놓쳤으면(다시 열 때) tool 결과로 상태를 정한다.
    function settleChild(call: Call, metadata: Json, failed: boolean) {
      if (call.name !== "subagent") return;
      const sid = str(metadata.sessionID);
      if (sid !== "") linkChild(call, sid);
      if (call.child === undefined) return;
      if (children.get(call.child)?.state !== "running") return;
      const status = str(metadata.status);
      if (failed) setChildState(call.child, "failed");
      else if (status === "completed") setChildState(call.child, "done");
      else if (status !== "running" && status !== "")
        setChildState(
          call.child,
          status === "cancelled" ? "cancelled" : "failed",
        );
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
      // 카드를 열지 않고 한 번만 허락한다. `always`와 session 규칙은 사람의 project에 규칙을 남기니 보내지 않는다.
      if (autoAccept) {
        void attempt("Auto-accept", () =>
          api.permissionReply(sid, str(data.id), { decision: "once" }),
        );
        return;
      }
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
        mode: null,
        seq: ++main.seq,
        at: now(),
      });
    }

    async function decide(
      id: string,
      choice: Extract<AcpInput, { type: "decide" }>["choice"],
    ) {
      const open = approvals.get(id);
      if (open === undefined) return;
      if (choice.kind === "mode") return;
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
      const call = callOf(main, sid, str(rec(meta.tool).id), "question");
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
      // server 명령(`/review`)은 template이 펼쳐진 글로 온다. 우리가 보낸 명령은 친 글을 보인다.
      const typed = pendingCommand;
      pendingCommand = null;
      emit({
        type: "message_queued",
        queued: {
          id: acp,
          at: now(),
          content:
            own.get(acp) ??
            (typed !== null && acp === inbox
              ? [{ type: "text", text: typed }]
              : contentOf(payload.text, payload.files)),
        },
      });
    }

    function delivered(inbox: string) {
      const acp = acpOf.get(inbox) ?? inbox;
      const delivery = deliveryOf.get(acp);
      const queued = mirror.queued.find((one) => one.id === acp);
      if (delivery === undefined || queued === undefined) return;
      deliveryOf.delete(acp);
      const steered = delivery === "steer" && main.turnHasUser;
      const id = startTurn(main);
      main.turnHasUser = true;
      if (!userOf.has(id)) userOf.set(id, queued.content);
      emit({
        type: "message_taken",
        message: acp,
        seq: ++main.seq,
        delivery: steered ? "steer" : "next_turn",
        turn: steered ? null : id,
      });
      // inbox id가 곧 그 CLI의 message id다(`rewind`가 이 id를 쓴다).
      emit({ type: "origin_set", message: acp, origin: inbox });
    }

    /** 숨긴 구간의 id. 숨길 항목이 없으면 undefined. */
    function hideFrom(
      first: string,
      choice: "restore_all" | "messages_only",
      restored: number,
    ): string | undefined {
      const index = mirror.items.findIndex((item) => item.id === first);
      if (index < 0) return undefined;
      const tail = mirror.items.slice(index);
      const entries = tail.flatMap((item): AcpEntry[] =>
        item.kind === "hidden" ? item.items : [item],
      );
      const head = tail[0];
      if (head === undefined) return undefined;
      const id = ids.newId("hid");
      emit({
        type: "hidden_added",
        item: {
          kind: "hidden",
          id,
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
      return id;
    }

    // 부모와 자식이 같이 받는 event(글, tool, step 끝). 처리했으면 true.
    function laneEvent(lane: Lane, type: string, data: Json): boolean {
      switch (type) {
        case "session.text.delta":
        case "session.reasoning.delta":
          if (str(data.delta) !== "")
            stream(
              lane,
              type === "session.text.delta" ? "text" : "reasoning",
              str(data.assistantMessageID),
              str(data.delta),
            );
          return true;
        case "session.step.ended":
        case "session.step.failed":
          flushWriting(lane);
          return true;
        case "session.tool.input.started":
        case "session.tool.progress":
        case "session.tool.called":
        case "session.tool.success":
        case "session.tool.failed":
          onToolEvent(lane, type, data);
          return true;
      }
      return false;
    }

    function onToolEvent(lane: Lane, type: string, data: Json) {
      const sid = str(data.sessionID);
      const toolId = str(data.id);
      if (type === "session.tool.input.started") {
        callOf(lane, sid, toolId, str(data.name)).name = str(data.name);
        return;
      }
      const call = callOf(lane, sid, toolId);
      if (type === "session.tool.progress") {
        const child = str(rec(data.metadata).sessionID);
        if (call.name === "subagent" && child !== "") linkChild(call, child);
      } else if (type === "session.tool.called") {
        call.input = rec(data.input);
        toolStart(call);
      } else if (type === "session.tool.success") {
        toolStart(call);
        const metadata = rec(data.metadata);
        settleChild(call, metadata, false);
        const todos = call.name === "todowrite" ? call.input.todos : undefined;
        if (Array.isArray(todos)) publishPlan(todos);
        toolEnd(
          call,
          "ok",
          endDetail(call, metadata, "done"),
          textOf(data.content),
        );
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
        settleChild(call, rec(data.metadata), true);
        toolEnd(
          call,
          state,
          endDetail(call, rec(data.metadata), "failed"),
          str(error.message),
        );
      }
    }

    function publishPlan(todos: unknown[]) {
      emit({
        type: "plan_changed",
        entries: todos
          .map(rec)
          .filter((todo) => str(todo.content) !== "")
          .map((todo) => ({
            text: str(todo.content),
            status:
              todo.status === "in_progress" ||
              todo.status === "completed" ||
              todo.status === "cancelled"
                ? todo.status
                : "pending",
          })),
      });
    }

    // 끝날 때만 아는 칸(질문의 답, subagent의 결과)을 채운다.
    function endDetail(
      call: Call,
      metadata: Json,
      how: "done" | "failed",
    ): AcpToolItem["detail"] | null {
      if (call.name === "subagent") return subagentDetail(call);
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

    const executionOf = (type: string) =>
      type === "session.execution.succeeded"
        ? ({ outcome: "completed", child: "done" } as const)
        : type === "session.execution.interrupted"
          ? ({ outcome: "stopped", child: "cancelled" } as const)
          : type === "session.execution.failed"
            ? ({ outcome: "failed", child: "failed" } as const)
            : undefined;

    function childEvent(sid: string, child: Child, type: string, data: Json) {
      const lane = child.lane;
      if (type === "session.execution.started") {
        startTurn(lane);
        setChildState(sid, "running");
        return;
      }
      const end = executionOf(type);
      if (end !== undefined) {
        endTurn(
          lane,
          end.outcome,
          end.outcome === "failed"
            ? {
                code: "internal",
                message:
                  redactCredentials(str(rec(data.error).message)) ||
                  "OpenCode failed.",
              }
            : undefined,
        );
        setChildState(sid, end.child);
        return;
      }
      if (laneEvent(lane, type, data)) return;
      if (type === "session.text.ended") {
        child.last = lastLine(str(data.text)) ?? child.last;
        touchChild(sid, child);
      } else if (type === "session.inbox.enqueued") {
        const item = rec(data.item);
        // 자식의 첫 메시지(부모가 맡긴 일)다. 줄을 서지 않고 바로 대화에 든다.
        if (item.type === "user")
          userMessage(lane, str(data.inboxID), rec(item.payload), false);
      }
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
        type === "model.updated" ||
        type === "skill.updated"
      ) {
        reloadLists();
        return;
      }
      const sid = str(data.sessionID) || str(rec(data.form).sessionID);
      if (sid === "") return;
      if (type === "session.created") {
        const parent = str(data.parentID);
        if (parent === sessionId || children.has(parent)) ensureChild(sid);
        return;
      }
      const mine = sid === sessionId;
      const child = mine ? undefined : children.get(sid);
      if (!mine && child === undefined) return;
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
      if (child !== undefined) {
        childEvent(sid, child, type, data);
        return;
      }
      const end = executionOf(type);
      if (end !== undefined) {
        executing = false;
        endTurn(
          main,
          end.outcome,
          end.outcome === "failed"
            ? {
                code: "internal",
                message:
                  redactCredentials(str(rec(data.error).message)) ||
                  "OpenCode failed.",
              }
            : undefined,
        );
        refreshUsage();
        return;
      }
      if (laneEvent(main, type, data)) return;
      switch (type) {
        case "session.execution.started":
          executing = true;
          startTurn(main);
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
          startTurn(main);
          info(
            data.reason === "auto"
              ? "Compacting the context to make room…"
              : "Compacting the context…",
          );
          return;
        case "session.compaction.ended":
          info("The context was compacted.");
          if (!executing) endTurn(main, "completed");
          refreshUsage();
          return;
        case "session.compaction.failed":
          info(
            `Compaction failed: ${redactCredentials(str(rec(data.error).message))}`,
            "warning",
          );
          if (!executing) endTurn(main, "completed");
          return;
        case "session.retry.scheduled":
          info(
            `Retrying after an error (attempt ${String(data.attempt)}): ${oneLine(redactCredentials(str(rec(data.error).message)), 160)}`,
            "warning",
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
          shellLine(rec(data.shell), str(rec(data.output).output));
          return;
        case "session.revert.staged": {
          const revert = rec(data.revert);
          reverted = true;
          const files = arr(revert.files).length;
          const first =
            acpOf.get(str(revert.messageID)) ?? str(revert.messageID);
          hiddenId =
            hideFrom(
              first,
              files > 0 || rewindFiles ? "restore_all" : "messages_only",
              files,
            ) ?? null;
          rewindFiles = false;
          return;
        }
        case "session.revert.cleared":
          // `/redo`든 TUI든 되돌림을 풀면 숨긴 메시지가 제자리로 돌아온다.
          reverted = false;
          if (hiddenId !== null)
            emit({ type: "hidden_restored", hidden: hiddenId });
          hiddenId = null;
          return;
        case "session.revert.committed":
          // 다음 보내기가 되돌린 것을 확정했다. 되살리지 않는다.
          reverted = false;
          hiddenId = null;
          return;
      }
    }
    // `!` 명령은 사람 쪽 tool 줄 하나다. 도는 execution이 없어서 turn을 열지도 닫지도 않는다: 도는 turn 중이면 그 turn에 들고,
    // 아니면 turn 밖(`turn: null`)이다. 사람 말풍선은 따로 없다(이 줄이 사람 쪽 줄이다).
    const shells = new Map<string, { id: string; command: string }>();
    const shellBody = (command: string, output: string | null) => {
      const cut = (text: string | null) =>
        text !== null && text.length > ACP_TOOL_BODY_LIMIT
          ? text.slice(0, ACP_TOOL_BODY_LIMIT)
          : text;
      return {
        input: cut(command),
        output: cut(output),
        truncated:
          command.length > ACP_TOOL_BODY_LIMIT ||
          (output?.length ?? 0) > ACP_TOOL_BODY_LIMIT,
      };
    };
    function shellLine(shell: Json, output = "") {
      const key = str(shell.id);
      let line = shells.get(key);
      if (line === undefined) {
        line = { id: ids.newId("tcl"), command: str(shell.command) };
        shells.set(key, line);
        emit({
          type: "tool_started",
          item: {
            kind: "tool",
            id: line.id,
            seq: ++main.seq,
            at: now(),
            by: "user",
            turn: main.turn,
            tool: "shell",
            category: "command",
            title: oneLine(line.command.split("\n")[0] ?? "", 120),
            state: "running",
            duration_ms: null,
            detail: { kind: "generic" },
            body: shellBody(line.command, null),
          },
        });
      }
      const status = str(shell.status);
      if (status === "running") return;
      shells.delete(key);
      emit({
        type: "tool_ended",
        tool_call: line.id,
        state:
          status === "exited" && shell.exit === 0
            ? "ok"
            : status === "killed"
              ? "cancelled"
              : "error",
        at: now(),
        detail: null,
        body: shellBody(line.command, output),
      });
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
      const [models, agents, commands, current, fallback, skills, templates] =
        await Promise.all([
          api.models(),
          api.agents(),
          api.commands(),
          api.get(sessionId),
          api.defaultModel().catch((): Json => ({})),
          api.skills().catch((): unknown[] => []),
          deps
            .readCommandTemplates([
              join(deps.home, ".config", "opencode"),
              join(cwd, ".opencode"),
            ])
            .catch(() => new Map<string, string>()),
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
                    kind: "choice" as const,
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
      // 이름이 겹치면 client 명령 표가 이긴다. skill은 그 뒤다.
      const known = new Set(CLIENT_COMMANDS.map((one) => one.name));
      const serverCommands = commands
        .map(rec)
        .filter((one) => !known.has(str(one.name)))
        .map((one) => {
          const name = str(one.name);
          const template = templates.get(name);
          const hint =
            template === undefined
              ? BUILTIN_HINTS[name]
              : TAKES_ARGUMENTS.test(template)
                ? "[args]"
                : undefined;
          return slash(
            name,
            str(one.description),
            hint === undefined ? {} : { argument_hint: hint },
          );
        });
      for (const one of serverCommands) known.add(one.name);
      const skillCommands = skills
        .map(rec)
        .filter((one) => str(one.id) !== "" && !known.has(str(one.id)))
        .map((one) =>
          slash(str(one.id), str(one.description), { source: "skill" }),
        );
      skillIds = new Set(skillCommands.map((one) => one.name));
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
        commands: [...CLIENT_COMMANDS, ...serverCommands, ...skillCommands],
        usage: null,
        toggles: [autoAcceptToggle()],
        goal: null,
        roles: null,
        harness: "opencode",
      };
    }

    const autoAcceptToggle = () => ({
      id: AUTO_ACCEPT,
      label: "Auto-accept permissions",
      description:
        "Allow every permission request once without asking. Nothing is saved to the project's rules.",
      on: autoAccept,
    });

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

    // label은 TUI `/usage`를 따른다. Go의 meter 셋과 Console의 월 budget이다.
    function limitsOf(reply: Json): AcpUsageLimit[] {
      const info = rec(reply.data);
      const out: AcpUsageLimit[] = [];
      const go = rec(info.go);
      for (const [key, label] of [
        ["rolling", "Go rolling"],
        ["weekly", "Go weekly"],
        ["monthly", "Go monthly"],
      ] as const) {
        const meter = rec(go[key]);
        if (typeof meter.percent !== "number") continue;
        out.push({
          id: `go_${key}`,
          label,
          used_percent: meter.percent,
          left: null,
          resets_at: isoOf(meter.resetsAt),
        });
      }
      for (const budget of arr(info.budgets).map(rec)) {
        const limit = Number(budget.limit);
        const spent = Number(budget.spent);
        out.push({
          id: `budget_${str(budget.id)}`,
          label: "Monthly budget",
          used_percent:
            limit > 0
              ? Math.min(100, Math.max(0, (spent / limit) * 100))
              : null,
          left: `$${Math.max(0, limit - spent).toFixed(2)} left`,
          resets_at: isoOf(budget.resetsAt),
        });
      }
      return out;
    }

    async function usageOf(): Promise<AcpUsage> {
      const [current, context, limits] = await Promise.all([
        api.get(sessionId),
        api.context(sessionId),
        // 로그인하지 않았으면 404나 null이다. 한도는 꾸밈이라 못 읽으면 빈 배열이다.
        api.usageLimits().then(limitsOf, (): AcpUsageLimit[] => []),
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
          last === undefined || limit === 0
            ? null
            : { tokens: used, limit, parts: [] },
        limits,
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

    function recordText(lane: Lane, text: string, reasoning: string) {
      if (text === "" && reasoning === "") return;
      lane.emit({
        type: "message_recorded",
        turn: startTurn(lane),
        message: ids.newId("msg"),
        model_call: null,
        seq: ++lane.seq,
        at: now(),
        body: {
          content: text === "" ? [] : [{ type: "text", text }],
          reasoning:
            reasoning === "" ? null : { text: reasoning, duration_ms: null },
          cards: [],
        },
      });
    }

    // 사람 메시지 하나를 대화에 바로 올린다. 다시 열 때와 자식 session의 첫 메시지다. `origin`은 그 CLI의 message id다.
    // 다른 agent가 넣은 lophn call·reply는 받은 메시지로 그린다(rewind 글도 origin도 아니다).
    function userMessage(
      lane: Lane,
      id: string,
      payload: Json,
      replay: boolean,
    ) {
      const received = classifyReceived(str(payload.text));
      const content =
        received === null
          ? contentOf(payload.text, payload.files)
          : [{ type: "text" as const, text: received.text }];
      const steered = lane.turnHasUser;
      const turnId = startTurn(lane);
      lane.turnHasUser = true;
      if (received === null && replay && !userOf.has(turnId))
        userOf.set(turnId, content);
      lane.emit({
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
          delivery: steered ? "steer" : "next_turn",
          turn: turnId,
          origin: received === null ? id : null,
          content,
          reasoning: null,
          cards: [],
          complete: true,
        },
      });
    }

    // 다시 열 때 읽을 자식 session. subagent tool의 결과가 자식 session id를 싣는다.
    let replayChildren: string[] = [];

    function replayMessage(lane: Lane, sid: string, item: Json) {
      switch (str(item.type)) {
        case "user":
          userMessage(lane, str(item.id), item, lane === main);
          return;
        case "assistant": {
          let text = "";
          let reasoning = "";
          for (const part of arr(item.content).map(rec)) {
            if (part.type === "text") text += str(part.text);
            else if (part.type === "reasoning") reasoning += str(part.text);
            else {
              recordText(lane, text, reasoning);
              text = reasoning = "";
              const state = rec(part.state);
              const call = callOf(lane, sid, str(part.id), str(part.name));
              call.input = state.status === "streaming" ? {} : rec(state.input);
              toolStart(call);
              if (call.name === "todowrite" && state.status === "completed")
                lastTodos = arr(call.input.todos);
              if (state.status === "completed") {
                settleChild(call, rec(state.metadata), false);
                toolEnd(
                  call,
                  "ok",
                  endDetail(call, rec(state.metadata), "done"),
                  textOf(state.content),
                );
              } else if (state.status === "error") {
                settleChild(call, rec(state.metadata), true);
                toolEnd(
                  call,
                  "error",
                  endDetail(call, rec(state.metadata), "failed"),
                  str(rec(state.error).message) || textOf(state.content),
                );
              }
              if (call.child !== undefined) replayChildren.push(call.child);
            }
          }
          recordText(lane, text, reasoning);
          if (lane !== main) {
            const child = [...children.values()].find(
              (one) => one.lane === lane,
            );
            if (child !== undefined && text !== "")
              child.last = lastLine(text) ?? child.last;
          }
          return;
        }
        case "idle": {
          const outcome = str(item.outcome);
          const end = idleEnd(item);
          endTurn(lane, end.outcome, end.error);
          if (lane !== main) {
            const child = [...children.entries()].find(
              ([, one]) => one.lane === lane,
            );
            if (child !== undefined)
              setChildState(
                child[0],
                outcome === "interrupted"
                  ? "cancelled"
                  : outcome === "failed"
                    ? "failed"
                    : "done",
              );
          }
          return;
        }
        case "synthetic":
          if (lane === main && rec(item.metadata).notice === "restart")
            info(RESTART_NOTICE);
          return;
        case "compaction":
          if (lane === main && item.status === "completed")
            info("The context was compacted.");
          return;
        case "shell":
          if (lane !== main) return;
          shellLine({
            id: item.shellID,
            command: item.command,
            status: "running",
          });
          if (item.status !== "running")
            shellLine(
              { id: item.shellID, status: item.status, exit: item.exit },
              str(rec(item.output).output),
            );
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

    async function replayLane(lane: Lane, sid: string) {
      for (const item of await allMessages(sid)) {
        replayMessage(lane, sid, item);
        // 자식의 대화는 부모의 subagent 줄을 그린 뒤에 읽는다.
        for (const child of replayChildren.splice(0)) {
          const one = children.get(child);
          if (one !== undefined) await replayLane(one.lane, child);
        }
      }
      // 끝맺지 못한 turn은 server가 멈췄던 것이다. 이어 가는 일은 새 execution이 연다.
      endTurn(lane, "stopped");
    }

    async function replay() {
      await replayLane(main, sessionId);
      // 마지막으로 끝난 todowrite가 지금의 계획이다(desktop `sessionTodos`와 같다).
      if (lastTodos !== null) publishPlan(lastTodos);
    }

    // --- 입력 ---

    // `!` 뒤의 글을 사람이 돌린 명령으로 보낸다. 결과는 `session.shell.*` event로 shellLine이 그린다.
    async function runShell(command: string) {
      if (command.trim() === "") return;
      await api.shell(sessionId, { command: command.trim() });
    }

    async function sendPrompt(
      id: string,
      content: ContentBlock[],
      delivery: "steer" | "queue",
    ) {
      const { text, files } = promptOf(content);
      if (text.startsWith("!")) return runShell(text.slice(1));
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
      // 도는 execution이 있을 때만 멈추고 기다린다. 쉬는 session은 바로 되돌린다.
      if (executing) {
        await api.interrupt(sessionId);
        await api.wait(sessionId);
      }
      rewindFiles = files;
      await api.revertStage(sessionId, {
        messageID: serverOf.get(target) ?? target,
        files,
      });
    }

    // fork·new로 다른 session에 옮긴다. 그 session에 없는 앞 항목은 숨긴다(화면에 지우는 갱신이 없다).
    async function moveTo(id: string, hide: string | undefined) {
      endTurn(main, "stopped");
      const users = mirror.items.flatMap((item) =>
        item.kind === "message" && item.actor === "user" ? [item.id] : [],
      );
      sessionId = id;
      calls.clear();
      children.clear();
      if (tasks.length > 0) {
        tasks = [];
        publishTasks();
      }
      forms.clear();
      reverted = false;
      hiddenId = null;
      if (hide !== undefined) hideFrom(hide, "messages_only", 0);
      const created = await api.get(id);
      publishMeta({ cli_session: id, title: str(created.title) || null });
      // 새 session의 사람 메시지는 옛 id와 달라서, 순서대로 짝지어 rewind·fork가 맞는 id를 쓰게 한다.
      const fresh = (await allMessages(id))
        .filter(
          (item) =>
            item.type === "user" && classifyReceived(str(item.text)) === null,
        )
        .map((item) => str(item.id));
      users.forEach((acp, index) => {
        const server = fresh[index];
        if (server === undefined) return;
        serverOf.set(acp, server);
        // bookmark의 key가 되는 CLI message id도 새 session의 것으로 바뀐다.
        emit({ type: "origin_set", message: acp, origin: server });
      });
      refreshUsage();
    }

    async function fork(target: string | null) {
      const from = mirror.session?.title || "(untitled)";
      const before =
        target === null ? undefined : (serverOf.get(target) ?? target);
      const forked = await api.fork(
        sessionId,
        before === undefined ? {} : { before },
      );
      await moveTo(str(forked.id), target ?? undefined);
      info(`Forked from “${from}”. The original session is unchanged.`);
    }

    // 같은 폴더의 다른 session을 이 탭에서 연다. fork·new와 달리 다른 대화라서 앞 항목을 짝짓지 않고 통째로 비우고 다시 그린다.
    async function openSession(target: string) {
      if (target === sessionId) return;
      if (executing || main.turn !== null) {
        info("Stop the running turn before opening another session.");
        return;
      }
      await api.get(target);
      sessionId = target;
      calls.clear();
      children.clear();
      tasks = [];
      forms.clear();
      shells.clear();
      acpOf.clear();
      serverOf.clear();
      own.clear();
      deliveryOf.clear();
      userOf.clear();
      replayChildren = [];
      lastTodos = null;
      pendingCommand = null;
      rewindFiles = false;
      hiddenId = null;
      main.writing = null;
      main.turnHasUser = false;
      replaying = true;
      emit({ type: "session_reset" });
      publishMeta(await loadMeta());
      await replay();
      endReplay();
      refreshUsage();
    }

    async function newSession() {
      const created = await api.create({ location: { directory: cwd } });
      await moveTo(str(created.id), mirror.items[0]?.id);
    }

    // 표(`CLIENT_COMMANDS`)의 `opens`가 null인 명령과 server 명령·skill을 한다. 화면이 여는 명령은 여기 오지 않는다.
    async function runCommand(name: string, argument: string) {
      switch (name) {
        case "undo": {
          const last = mirror.items.findLast(
            (item) => item.kind === "message" && item.actor === "user",
          );
          if (last === undefined) info("Nothing to undo.");
          else {
            await rewind(last.id, true);
            // TUI와 데스크톱처럼 되돌린 사람 글을 입력칸에 돌려준다.
            if (last.kind === "message")
              emit({
                type: "draft_set",
                key: ids.newId("drf"),
                content: last.content,
              });
          }
          return;
        }
        case "redo":
          await api.revertClear(sessionId);
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
        case "status":
          return commandOutput(name, await statusText());
        case "stats":
          return commandOutput(name, await statsText());
        case "mcps":
          return commandOutput(name, await mcpsText());
        case "skills":
          return commandOutput(name, await skillsText());
        case "export":
          return commandOutput(name, await exportText());
        default:
          if (skillIds.has(name)) {
            await api.runSkill(sessionId, name);
            return;
          }
          // 도는 중에 보낸 명령은 desktop처럼 줄에 선다. `run_command`에 첨부 칸이 없어 첨부는 싣지 못한다.
          pendingCommand = `/${name}${argument === "" ? "" : ` ${argument}`}`;
          await api
            .command(sessionId, {
              name,
              text: argument,
              ...(executing ? { delivery: "queue" } : {}),
            })
            .catch((cause: unknown) => {
              pendingCommand = null;
              throw cause;
            });
      }
    }

    const cell = (text: string) => oneLine(text, 200).replaceAll("|", "\\|");
    const table = (head: string[], rows: string[][]) =>
      [
        `| ${head.join(" | ")} |`,
        `| ${head.map(() => "---").join(" | ")} |`,
        ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
      ].join("\n");

    async function statusText() {
      const [server, mcps] = await Promise.all([api.info(), api.mcps()]);
      const meta = mirror.session;
      return table(
        ["Item", "Value"],
        [
          ["OpenCode", str(server.version)],
          ["Agent", meta?.mode ?? ""],
          ["Model", meta?.model?.model ?? ""],
          ...arr(rec(mcps).data)
            .map(rec)
            .map((one) => [
              `MCP ${str(one.name)}`,
              [str(rec(one.status).status), str(rec(one.status).error)]
                .filter((part) => part !== "")
                .join(": "),
            ]),
        ],
      );
    }

    async function statsText() {
      // 기간은 TUI `/stats`의 기본값(올해 1월 1일부터)이다.
      const stats = rec(
        rec(
          await api.sessionStats({
            from: new Date(new Date(now()).getFullYear(), 0, 1).getTime(),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          }),
        ).data,
      );
      const tokens = rec(stats.tokens);
      const totals = rec(rec(stats.tools).totals);
      const n = (value: unknown) => Number(value ?? 0).toLocaleString("en-US");
      return [
        table(
          ["Stat", "Value"],
          [
            ["Sessions", n(stats.sessions)],
            ["Subagents", n(stats.subagents)],
            ["Prompts", n(stats.prompts)],
            ["Steps", n(stats.steps)],
            ["Input tokens", n(tokens.input)],
            ["Output tokens", n(tokens.output)],
            ["Cost", `$${Number(stats.cost ?? 0).toFixed(2)}`],
            ["Active days", n(stats.activeDays)],
            ["Best streak", n(stats.streak)],
            ["Tool calls", `${n(totals.calls)} (${n(totals.failed)} failed)`],
          ],
        ),
        "",
        table(
          ["Model", "Steps", "Cost"],
          arr(stats.models)
            .map(rec)
            .slice(0, 5)
            .map((one) => [
              `${str(rec(one.model).providerID)}/${str(rec(one.model).id)}`,
              n(one.steps),
              `$${Number(one.cost ?? 0).toFixed(2)}`,
            ]),
        ),
      ].join("\n");
    }

    async function mcpsText() {
      const list = arr(rec(await api.mcps()).data).map(rec);
      if (list.length === 0) return "No MCP servers are configured.";
      return table(
        ["Server", "Status", "Detail"],
        list.map((one) => [
          str(one.name),
          str(rec(one.status).status),
          str(rec(one.status).error),
        ]),
      );
    }

    async function skillsText() {
      const list = (await api.skills()).map(rec);
      if (list.length === 0) return "No skills are available.";
      return table(
        ["Skill", "Description"],
        list.map((one) => [str(one.name) || str(one.id), str(one.description)]),
      );
    }

    async function exportText() {
      const exported = rec((await api.exportSession(sessionId)).data);
      const path = await deps.writeExport(
        `session-${sessionId}.json`,
        JSON.stringify(exported, null, 2),
      );
      return `Exported the session to \`${path}\`.`;
    }

    async function setAutoAccept(on: boolean) {
      autoAccept = on;
      publishMeta({ toggles: [autoAcceptToggle()] });
      // 켜는 순간 열려 있는 카드도 한 번만 허락한다(desktop의 sweep과 같다).
      if (!on) return;
      for (const [id, open] of [...approvals]) {
        await api.permissionReply(open.session, open.server, {
          decision: "once",
        });
        closeApproval(id, "allowed", "once");
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
        if (input.type === "send") endTurn(main, "failed", dead);
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
        case "run_shell":
          await attempt("Shell", () => runShell(input.command));
          return;
        case "open_session":
          await attempt("Open session", async () => {
            try {
              await openSession(input.cli_session);
            } finally {
              // 읽다 실패해도 쌓아 둔 event를 놓지 않는다.
              if (replaying) endReplay();
            }
          });
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
        case "stop_shell": {
          const opened = [...shells].find(([, line]) => line.id === input.item);
          if (opened !== undefined)
            await attempt("Stop", () => api.killShell(opened[0], cwd));
          return;
        }
        case "stop_child":
          await attempt("Stop", () => api.interrupt(input.child));
          return;
        case "stop_task":
          await attempt("Stop", () => api.interrupt(input.task));
          return;
        case "background_tool":
          await attempt("Background", () => api.background(sessionId));
          return;
        case "set_toggle":
          if (input.id === AUTO_ACCEPT)
            await attempt("Auto-accept", () => setAutoAccept(input.on));
          return;
      }
    }

    // --- 시작 ---

    const failure = (reason: string) => {
      if (closed || dead !== null) return;
      dead = {
        code: "unavailable",
        message: redactCredentials(
          stderrTail === "" ? reason : `${reason}\n${stderrTail.trim()}`,
        ),
      };
      endTurn(main, "failed", dead);
      // 다시 구독을 포기했는데 process가 산 채면 server를 끈다(shared handoff의 TUI도 같이 끝난다).
      clearTimeout(retry);
      events?.close();
      if (alive) {
        proc.end();
        proc.kill();
      }
    };
    proc.onExit(() => failure("OpenCode exited."));

    // event stream이 끊겨도 session은 산다. 간격을 두고 다시 붙고, event 없이 이어 실패하면 그때 죽는다.
    // OpenCode는 끊긴 사이 event를 다시 보내지 않아서, 다시 붙은 뒤 첫 event(`server.connected`)에서 놓친 것을 읽는다.
    let failures = 0;
    let delay = RECONNECT_MIN_MS;
    let dropped = false;
    let eventWarned = false;
    const subscribe = () => {
      events = transport.events(
        (event) => {
          failures = 0;
          delay = RECONNECT_MIN_MS;
          if (dropped) {
            dropped = false;
            void catchUp();
          }
          try {
            onEvent(event);
          } catch (cause) {
            // 틀린 event 하나는 버린다. 알림은 처음 한 번만.
            if (!eventWarned) {
              eventWarned = true;
              info(
                `OpenCode sent an event lophn could not read: ${message(cause)}`,
                "warning",
              );
            }
          }
        },
        (cause) => {
          if (closed || dead !== null) return;
          failures += 1;
          if (!alive || failures >= RECONNECT_GIVE_UP) {
            failure(cause.message);
            return;
          }
          dropped = true;
          retry = setTimeout(subscribe, delay);
          delay = Math.min(delay * 2, RECONNECT_MAX_MS);
        },
      );
    };

    // 끊긴 사이 끝난 turn은 닫고, 아직 도는 turn은 빠진 출력이 있을 수 있다고 알리며, 끊긴 사이 뜬 승인은 다시 읽는다.
    async function catchUp() {
      if (replaying || main.turn === null) return;
      try {
        const last = arr(
          (await api.messages(sessionId, { limit: 1, order: "desc" })).data,
        ).map(rec)[0];
        if (last?.type === "idle") {
          executing = false;
          const end = idleEnd(last);
          endTurn(main, end.outcome, end.error);
          return;
        }
        info(
          "The connection to OpenCode dropped; some output may be missing.",
          "warning",
        );
        for (const request of (await api.permissions(sessionId)).map(rec))
          if (!approvalOf.has(str(request.id))) openApproval(request);
      } catch (cause) {
        info(`Catching up with OpenCode failed: ${message(cause)}`, "warning");
      }
    }

    try {
      const server = await api.info();
      const version = str(server.version);
      subscribe();
      let resumed = false;
      // 404는 첫 메시지 전의 TUI session처럼 저장된 적이 없는 것이다. 조용히 새로 열고, 그 밖의 실패만 알린다.
      let notLoaded = false;
      if (resume !== undefined)
        resumed = await api.get(resume).then(
          () => true,
          (cause: { status?: number }) => {
            notLoaded = cause.status !== 404;
            return false;
          },
        );
      if (!resumed)
        sessionId = str(
          (await api.create({ location: { directory: cwd } })).id,
        );
      publishMeta(await loadMeta());
      if (version !== RECORDED_OPENCODE_VERSION && version !== "")
        info(
          `OpenCode ${version} differs from ${RECORDED_OPENCODE_VERSION}, the version lophn checked, so some features may not work.`,
          "warning",
        );
      if (resumed) await replay();
      else if (notLoaded)
        endTurn(main, "failed", {
          code: "not_found",
          message: `The session ${resume} could not be loaded, so a new session was started.`,
        });
      endReplay();
      refreshUsage();
    } catch (cause) {
      clearTimeout(retry);
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
          clearTimeout(retry);
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
        // 이 폴더의 최근 session. subagent 자식(parentID)은 빠진다. 2.1.4가 lab과 같은 query 이름을 받는 것은 녹화 list로 확인했다.
        async sessions() {
          const page = await api.listSessions({
            directory: cwd,
            parentID: "null",
            order: "desc",
            limit: 30,
          });
          return arr(page.data)
            .map(rec)
            .map((one) => ({
              id: str(one.id),
              title: str(one.title) || "(untitled)",
              updated_at: isoOf(rec(one.time).updated),
            }));
        },
        running: () => ({
          turn: main.turn !== null,
          tasks: tasks.filter((one) => one.state === "running").length,
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
