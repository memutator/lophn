// Codex adapter. 탭 전용 `codex app-server`를 unix socket으로 띄우고(GUI는 그 위 WebSocket client, TUI는 `codex resume --remote`로
// 같은 server에 붙는다) app-server 이벤트를 ACP 갱신으로, 창의 ACP 입력을 JSON-RPC(`jsonrpc` 칸 없음)로 옮긴다.
// 설정과 login은 사람의 것을 쓴다. 사람 설정이 never·danger-full-access일 때만 on-request·workspace-write로 바꾼다.
// 흐름과 이유는 architecture/harness-gui.md의 Codex adapter 절이다.
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { WebSocket } from "ws";
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
import type { AcpTerminal } from "../../../../../protocol/extensions/mod.ts";
import type { ContentBlock } from "../../../../../protocol/lophn-agent/content-block.ts";
import type { HarnessGuiAdapter, HarnessGuiRun } from "./adapter.ts";

// app-server 메시지에서 읽는 칸만 읽는다. 모양은 `codex app-server generate-ts --experimental`이 정한다.
// biome-ignore lint/suspicious/noExplicitAny: wire JSON을 칸마다 타입으로 옮기지 않는다.
type J = any;
type Json = Record<string, J>;

/** app-server와 말하는 길과 file system. 기본은 실제 socket이고 test는 녹화를 재생하는 가짜를 넣는다. */
export type CodexLink = {
  send(text: string): void;
  onMessage(listener: (text: string) => void): void;
  onClose(listener: () => void): void;
  close(): void;
};
export type CodexIo = {
  /** socket을 둘 폴더. 사람 소유이고 group·other가 쓸 수 없어야 한다(app-server가 검사한다). */
  makeDir(): string;
  removeDir(dir: string): void;
  /** socket이 생길 때까지 기다려 붙는다. `alive()`가 false가 되면 포기한다. */
  connect(socket: string, alive: () => boolean): Promise<CodexLink>;
};

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

const realIo: CodexIo = {
  // unix socket 경로는 108자를 넘으면 안 되어 짧은 tmp 폴더에 둔다. mkdtemp는 0700이다.
  makeDir: () => mkdtempSync(join(tmpdir(), "lophn-codex-")),
  removeDir: (dir) => rmSync(dir, { recursive: true, force: true }),
  async connect(socket, alive) {
    for (let attempt = 0; alive() && attempt < 100; attempt += 1) {
      try {
        const ws = await new Promise<WebSocket>((resolve, reject) => {
          const one = new WebSocket("ws://localhost/rpc", {
            createConnection: () => net.connect(socket),
            perMessageDeflate: false,
          });
          one.once("open", () => resolve(one));
          one.once("error", reject);
        });
        ws.on("error", () => {});
        return {
          send: (text) => ws.send(text),
          onMessage: (listener) =>
            void ws.on("message", (raw) => listener(String(raw))),
          onClose: (listener) => void ws.on("close", listener),
          close: () => ws.close(),
        };
      } catch {
        await sleep(100);
      }
    }
    throw new Error("The Codex app-server did not open its socket.");
  },
};

// 그리지 않는 알림. 이 connection에서만 끈다(TUI는 자기 것을 받는다).
const OPT_OUT = [
  "thread/started",
  "thread/status/changed",
  "thread/readState/changed",
  "thread/goal/cleared",
  "thread/compacted",
  "thread/archived",
  "thread/unarchived",
  "thread/closed",
  "thread/queue/changed",
  "turn/diff/updated",
  "turn/moderationMetadata",
  "item/plan/delta",
  "item/commandExecution/outputDelta",
  "item/commandExecution/terminalInteraction",
  "item/fileChange/outputDelta",
  "item/fileChange/patchUpdated",
  "item/mcpToolCall/progress",
  "item/autoApprovalReview/started",
  "item/autoApprovalReview/completed",
  "hook/started",
  "hook/completed",
  "rawResponseItem/completed",
  "mcpServer/startupStatus/updated",
  "account/updated",
  "account/rateLimits/updated",
  "remoteControl/status/changed",
  "app/list/updated",
  "skills/changed",
  "fs/changed",
  "deprecationNotice",
  "configWarning",
  "warning",
  "guardianWarning",
  "model/rerouted",
  "model/verification",
];

// 늦은 JSON-RPC 오류 code. 이 창이 옮기지 못하는 server 요청에 쓴다.
const UNSUPPORTED = -32000;
const OK = (): Result<void> => ({ ok: true, value: undefined });

type Item = {
  type: string;
  id: string;
  text?: string;
  clientId?: string | null;
  content?: J[];
  summary?: string[];
  command?: string;
  commandActions?: { type: string; command: string }[];
  status?: string;
  changes?: { path: string; kind: { type: string }; diff: string }[];
  server?: string;
  tool?: string;
  namespace?: string | null;
  query?: string;
  path?: string;
  success?: boolean | null;
  prompt?: string | null;
  kind?: string;
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

function changeCounts(change: NonNullable<Item["changes"]>[number]) {
  if (change.kind.type === "add")
    return { added: lineCount(change.diff), removed: 0 };
  if (change.kind.type === "delete")
    return { added: 0, removed: lineCount(change.diff) };
  let added = 0;
  let removed = 0;
  for (const line of change.diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
    else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
  }
  return { added, removed };
}

// 사람 메시지 → UserInput. file chip(`file://` resource_link)은 mention이고 앱 context(`resource`)는 글이다.
// 이미지는 blob hash뿐이라 넘기지 못한다.
function inputOf(content: ContentBlock[]): J[] {
  const text = content
    .flatMap((block) =>
      block.type === "text" || block.type === "resource" ? [block.text] : [],
    )
    .join("\n");
  const mentions = content.flatMap((block) =>
    block.type === "resource_link" && block.uri.startsWith("file://")
      ? [
          {
            type: "mention",
            name: block.name,
            path: decodeURIComponent(block.uri.slice("file://".length)),
          },
        ]
      : [],
  );
  return [
    ...(text === "" && mentions.length > 0
      ? []
      : [{ type: "text", text, text_elements: [] }]),
    ...mentions,
  ];
}

// 다른 client가 보낸 UserInput → 사람 메시지 content.
function contentOf(input: J[]): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  for (const one of input) {
    if (one.type === "text" && one.text) {
      blocks.push({ type: "text", text: one.text });
    } else if (one.type === "mention") {
      blocks.push({
        type: "resource_link",
        uri: `file://${one.path}`,
        name: one.name || basename(one.path),
      });
    } else if (one.type === "skill") {
      blocks.push({ type: "text", text: `$${one.name}` });
    } else if (one.type === "image" || one.type === "localImage") {
      blocks.push({ type: "text", text: "[image]" });
    }
  }
  return blocks;
}

function toolState(item: Item): "ok" | "error" | "denied" | "cancelled" {
  if (item.success === false) return "error";
  switch (item.status) {
    case undefined:
    case "completed":
      return "ok";
    case "failed":
      return "error";
    case "declined":
      return "denied";
    default:
      return "cancelled";
  }
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

// 권한 mode. 데스크톱의 agent mode 표와 같다(`permissions`는 profile id).
const MODES = {
  "read-only": {
    permissions: ":read-only",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
  },
  auto: {
    permissions: ":workspace",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
  },
  guardian: {
    permissions: ":workspace",
    approvalPolicy: "on-request",
    approvalsReviewer: "guardian_subagent",
  },
  "full-access": {
    permissions: ":danger-full-access",
    approvalPolicy: "never",
    approvalsReviewer: "user",
  },
} as const;
const MODE_CHOICES = {
  "read-only": [
    "Read-only",
    "Codex reads files and asks before editing or running commands.",
  ],
  auto: [
    "Auto",
    "Codex edits files in the workspace and asks before anything else.",
  ],
  guardian: [
    "Guardian approvals",
    "A reviewer agent approves requests for you.",
  ],
  "full-access": [
    "Full access",
    "Codex runs anything without asking, with no sandbox.",
  ],
  granular: ["Granular", "Approval rules from your Codex config."],
} as const;

type Settings = {
  model: string;
  effort: string | null;
  approvalPolicy: J;
  approvalsReviewer: string;
  sandbox: string;
  plan: boolean;
};

function modeOf(settings: Settings): string | null {
  if (
    settings.approvalsReviewer === "guardian_subagent" ||
    settings.approvalsReviewer === "auto_review"
  )
    return "guardian";
  if (typeof settings.approvalPolicy === "object") return "granular";
  return settings.sandbox === "dangerFullAccess"
    ? "full-access"
    : settings.sandbox === "readOnly"
      ? "read-only"
      : settings.sandbox === "workspaceWrite"
        ? "auto"
        : null;
}

// thread/start·resume·fork 응답과 thread/settings/updated의 알림은 칸 이름이 조금 다르다.
function settingsOf(wire: J): Settings {
  const sandbox = wire.sandboxPolicy ?? wire.sandbox;
  return {
    model: wire.model,
    effort: wire.effort ?? wire.reasoningEffort ?? null,
    approvalPolicy: wire.approvalPolicy,
    approvalsReviewer: wire.approvalsReviewer,
    sandbox: typeof sandbox === "string" ? sandbox : (sandbox?.type ?? ""),
    plan: wire.collaborationMode?.mode === "plan",
  };
}

const CAPABILITIES: AcpCapabilities = {
  model: true,
  effort: true,
  mode: true,
  commands: true,
  rewind: true,
  rewind_files: false, // thread/revert는 file을 되돌리지 않는다.
  fork: true,
  compact: true,
  rename: true,
  usage: true,
  steer: true,
  queue_edit: true,
  images: false, // 입력의 image는 blob hash뿐이라 localImage 경로를 만들 수 없다.
  retry: true,
  sessions: false,
};

const BASE_COMMANDS = [
  ["compact", "Compact the conversation context", null],
  ["review", "Review uncommitted changes", "[instructions]"],
  ["goal", "Set a goal for Codex", "<objective>"],
  ["rename", "Rename this conversation", "<name>"],
  ["fork", "Fork this conversation", null],
  ["new", "Start a new conversation in this tab", null],
  ["status", "Show model, permissions and context use", null],
] as const;

type Call = { id: string; done: boolean; changes: AcpApprovalFiles };
type AcpApprovalFiles = {
  path: string;
  change: "create" | "update" | "delete";
  added: number;
  removed: number;
}[];
type ApprovalWait = {
  /** app-server가 요청에 붙인 id. 답에 그대로 쓴다. */
  rpc: number | string;
  /** 서버가 허락한 결정. 없는 것은 보내지 않는다. */
  session: boolean;
  /** 영구 규칙이 되는 결정(서버가 낸 그대로). 없으면 영구 선택지가 없다. */
  always: J | null;
};
type AskWait = {
  rpc: number | string;
  group: string;
  call: Call;
  ids: string[];
};

export function createCodexAdapter(io: CodexIo): HarnessGuiAdapter {
  return {
    handoff: "shared",

    // TUI는 빈 composer에서 Ctrl+C로 바로 끝난다(`DOUBLE_PRESS_QUIT_SHORTCUT_ENABLED = false`, tui/src/chatwidget/interaction.rs
    // `on_ctrl_c`). composer에 글이 있으면 먼저 지우고 일하는 중이면 먼저 멈추므로 끝날 때까지 몇 번 더 누른다.
    exitTui(terminal: AcpTerminal) {
      return new Promise<Result<void>>((resolve) => {
        let presses = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const off = terminal.onForegroundExit(() => finish(OK()));
        function finish(result: Result<void>) {
          clearTimeout(timer);
          off();
          resolve(result);
        }
        function press() {
          if (terminal.state() === "shell") return finish(OK());
          if (presses >= 4)
            return finish({
              ok: false,
              error: {
                code: "unavailable",
                message: "Codex did not exit after Ctrl+C.",
              },
            });
          presses += 1;
          terminal.type("\x03");
          timer = setTimeout(press, 700);
        }
        press();
      });
    },

    async start({ cwd, resume, session, spawn, clock, ids }) {
      let seq = 0;
      let closed = false;
      let dead: { code: string; message: string } | null = null;
      let stderrTail = "";
      const now = () => clock.now();
      // 숨기기(rewind·fork·new)가 항목을 알아야 해서 낸 갱신을 그대로 접어 둔다.
      let mirror: AcpState = EMPTY_ACP_STATE;
      const publish = (update: AcpUpdate) => {
        if (closed) return;
        mirror = reduceAcp(mirror, update);
        session.publish(update);
      };

      const dir = io.makeDir();
      const socket = join(dir, "codex.sock");
      const proc = spawn(
        "codex",
        ["app-server", "--listen", `unix://${socket}`],
        {
          cwd,
        },
      );
      if (proc.pid === undefined) {
        io.removeDir(dir);
        return {
          ok: false,
          error: {
            code: "unavailable",
            message: "`codex` was not found on PATH.",
          },
        };
      }
      let exited = false;
      const exit = new Promise<void>((done) =>
        proc.onExit(() => {
          exited = true;
          done();
        }),
      );
      proc.onStdout(() => {});
      proc.onStderr((text) => {
        stderrTail = (stderrTail + text).slice(-500);
      });

      // --- JSON-RPC
      let link: CodexLink | null = null;
      let nextRequest = 0;
      const pending = new Map<
        number,
        { resolve(value: Json): void; reject(cause: Error): void }
      >();
      const write = (message: Json) => link?.send(JSON.stringify(message));
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
      // 실패해도 대화를 멈추지 않는 호출. 오류는 한 줄 알림으로 보인다.
      const attempt = async (what: string, call: () => Promise<unknown>) => {
        try {
          await call();
        } catch (cause) {
          info(`${what} failed: ${(cause as Error).message}`);
        }
      };

      let threadId = "";
      // 이 thread에 대화가 한 번이라도 있었나(rollout이 있나). 없으면 TUI가 resume으로 붙지 못한다.
      let materialized = false;
      let policy: Json = {};
      let settings: Settings | null = null;
      let models: J[] = [];
      let skills = new Map<string, string>();
      let canPlan = false;
      // turn: 도는 turn의 id(ACP). codexTurn: 그 turn의 app-server id(steer와 interrupt가 쓴다).
      let turn: string | null = null;
      let codexTurn: string | null = null;
      let lastTurn: string | null = null;
      let stopPending = false;
      let reverting = false;
      let modelCall: string | null = null;
      const streamed = { text: 0, reasoning: 0 };
      let reasoning = "";
      const summarized = new Set<string>();
      const calls = new Map<string, Call>();
      const approvals = new Map<string, ApprovalWait>();
      const asks = new Map<string, AskWait>();
      const queue: { id: string; at: string; content: ContentBlock[] }[] = [];
      // retry가 다시 보낼 사람 메시지. turn마다 첫 메시지다.
      const userOf = new Map<string, ContentBlock[]>();
      // ACP turn → app-server turn. rewind·fork가 어느 turn인지 안다.
      const wireOf = new Map<string, string>();
      // 우리가 clientUserMessageId로 보낸 메시지. 그 echo는 다시 그리지 않는다.
      const sent = new Set<string>();

      // --- session meta
      const meta: AcpSessionMeta = {
        title: null,
        cli_session: null,
        capabilities: CAPABILITIES,
        models: [],
        model: null,
        modes: [],
        mode: null,
        commands: [],
        usage: null,
      };
      let metaSent = false;
      function change(partial: Partial<AcpSessionMeta>) {
        Object.assign(meta, partial);
        if (metaSent) publish({ type: "session_changed", session: partial });
      }
      function modelMeta(): Partial<AcpSessionMeta> {
        const groups: AcpModelGroup[] = [
          {
            id: "codex",
            label: "Codex",
            models: models.map((one) => ({
              id: one.model,
              label: one.displayName || one.model,
              axes: [
                {
                  id: "effort",
                  label: "Effort",
                  values: (one.supportedReasoningEfforts ?? []).map(
                    (effort: J) => ({
                      value: effort.reasoningEffort,
                      label: effort.reasoningEffort,
                    }),
                  ),
                },
              ],
            })),
          },
        ];
        const current = settings;
        return {
          models: groups,
          model:
            current === null
              ? null
              : {
                  model: current.model,
                  label:
                    models.find((one) => one.model === current.model)
                      ?.displayName || current.model,
                  options: current.effort ? { effort: current.effort } : {},
                  layer: null,
                },
        };
      }
      function modesMeta(): Partial<AcpSessionMeta> {
        const mode = settings === null ? null : modeOf(settings);
        const ids: string[] = ["read-only", "auto", "full-access"];
        if (mode === "guardian" || mode === "granular") ids.push(mode);
        return {
          mode,
          modes: ids.map((id) => {
            const [label, description] =
              MODE_CHOICES[id as keyof typeof MODE_CHOICES];
            return { id, label, description };
          }),
        };
      }
      function applySettings(wire: J) {
        settings = settingsOf(wire);
        change({ ...modelMeta(), ...modesMeta() });
      }
      function commandsMeta(): Partial<AcpSessionMeta> {
        return {
          commands: [
            ...BASE_COMMANDS.map(([name, description, hint]) => ({
              name,
              description,
              argument_hint: hint,
              source: "cli" as const,
            })),
            ...(canPlan
              ? [
                  {
                    name: "plan",
                    description: "Turn plan mode on or off",
                    argument_hint: null,
                    source: "cli" as const,
                  },
                ]
              : []),
            ...[...skills.keys()].map((name) => ({
              name,
              description: `Run the ${name} skill`,
              argument_hint: "[request]",
              source: "skill" as const,
            })),
          ],
        };
      }

      // --- ACP 항목
      function info(text: string) {
        const owner = turn ?? lastTurn ?? (lastTurn = ids.newId("trn"));
        publish({
          type: "notice_added",
          item: {
            kind: "notice",
            id: ids.newId("not"),
            seq: ++seq,
            at: now(),
            turn: owner,
            notice: { type: "info", text },
          },
        });
      }

      function startTurn(): string {
        turn = ids.newId("trn");
        lastTurn = turn;
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

      function describe(item: Item, call: Call) {
        let tool: string;
        let category: AcpToolItem["category"] = "other";
        let title: string;
        let detail: AcpToolItem["detail"] = { kind: "generic" };
        switch (item.type) {
          case "commandExecution": {
            const actions = (item.commandActions ?? []).map(
              (one) => one.command,
            );
            tool = "shell";
            category = commandCategory(item);
            title = `shell ${oneLine(actions.length > 0 ? actions.join(" && ") : (item.command ?? ""), 120)}`;
            break;
          }
          case "fileChange": {
            const changes = item.changes ?? [];
            call.changes = changes.map((one) => ({
              path: relative(cwd, one.path),
              change:
                one.kind.type === "add"
                  ? "create"
                  : one.kind.type === "delete"
                    ? "delete"
                    : "update",
              ...changeCounts(one),
            }));
            const paths = call.changes.map((one) => one.path);
            const first = paths[0] ?? "";
            tool = "apply_patch";
            title = `apply_patch ${oneLine(first, 100)}${paths.length > 1 ? ` (+${paths.length - 1} files)` : ""}`;
            detail = {
              kind: "edit",
              document: changes[0]?.path ?? first,
              path: first,
              added: call.changes.reduce((sum, one) => sum + one.added, 0),
              removed: call.changes.reduce((sum, one) => sum + one.removed, 0),
            };
            break;
          }
          case "webSearch":
            tool = "web_search";
            category = "web";
            title = `web_search ${oneLine(item.query ?? "", 100)}`;
            break;
          case "imageView":
            tool = "view_image";
            category = "read";
            title = `view_image ${basename(item.path ?? "")}`;
            break;
          case "collabAgentToolCall":
            tool = `agent.${item.tool ?? "call"}`;
            title = `${tool} ${oneLine(item.prompt ?? "", 80)}`;
            break;
          case "subAgentActivity":
            tool = "agent.activity";
            title = `subagent ${item.kind ?? "activity"}`;
            break;
          case "dynamicToolCall":
            tool = `${item.namespace ? `${item.namespace}.` : ""}${item.tool ?? "tool"}`;
            title = tool;
            break;
          default:
            tool = `${item.server ?? "mcp"}.${item.tool ?? "tool"}`;
            title = tool;
        }
        return { tool, category, title: title.trim(), detail };
      }

      const TOOL_ITEMS = new Set([
        "commandExecution",
        "fileChange",
        "mcpToolCall",
        "dynamicToolCall",
        "webSearch",
        "imageView",
        "collabAgentToolCall",
        "subAgentActivity",
      ]);

      function toolStart(item: Item): Call {
        const known = calls.get(item.id);
        if (known !== undefined) return known;
        const call: Call = { id: ids.newId("tcl"), done: false, changes: [] };
        calls.set(item.id, call);
        modelCall = null;
        const shown = describe(item, call);
        publish({
          type: "tool_started",
          item: {
            kind: "tool",
            id: call.id,
            seq: ++seq,
            at: now(),
            turn: ensureTurn(),
            tool: shown.tool,
            category: shown.category,
            title: shown.title,
            state: "running",
            duration_ms: null,
            detail: shown.detail,
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

      function record(text: string) {
        publish({
          type: "message_recorded",
          turn: ensureTurn(),
          message: ids.newId("msg"),
          model_call: modelCall,
          seq: ++seq,
          at: now(),
          body: {
            content: [{ type: "text", text }],
            reasoning:
              reasoning === "" ? null : { text: reasoning, duration_ms: null },
            cards: [],
          },
        });
        reasoning = "";
        modelCall = null;
        streamed.text = 0;
        streamed.reasoning = 0;
      }

      function itemDone(item: Item) {
        if (item.type === "agentMessage" || item.type === "plan") {
          if (item.text) record(item.text);
        } else if (item.type === "reasoning") {
          const parts =
            (item.summary ?? []).length > 0 ? item.summary : item.content;
          const text = (parts ?? [])
            .filter((one) => typeof one === "string")
            .join("\n\n");
          if (text !== "")
            reasoning = reasoning === "" ? text : `${reasoning}\n\n${text}`;
        } else if (TOOL_ITEMS.has(item.type)) {
          const call = toolStart(item);
          if (!call.done) toolEnd(call, toolState(item));
        } else if (item.type === "contextCompaction") {
          info("Context compacted.");
        } else if (item.type === "enteredReviewMode") {
          info(`Review started: ${oneLine(item.text ?? "", 120)}`);
        } else if (item.type === "exitedReviewMode") {
          info("Review finished.");
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

      // --- 숨기기(rewind, fork, new): 낸 항목 중 `fromSeq` 뒤를 hidden 하나로 묶는다.
      function hideFrom(fromSeq: number, checkpoint: string) {
        const entries: AcpEntry[] = mirror.items
          .filter((one) => one.seq >= fromSeq)
          .flatMap((one) => (one.kind === "hidden" ? one.items : [one]));
        if (entries.length === 0) return;
        publish({
          type: "hidden_added",
          item: {
            kind: "hidden",
            id: ids.newId("hid"),
            seq: Math.min(...entries.map((one) => one.seq)),
            at: now(),
            checkpoint,
            choice: "messages_only",
            count: entries.length,
            restored: 0,
            left: [],
            items: entries,
          },
        });
      }
      const messageItem = (id: string) =>
        mirror.items
          .flatMap((one) => (one.kind === "hidden" ? one.items : [one]))
          .find((one) => one.kind === "message" && one.id === id);

      // --- approvals
      function openApproval(
        rpc: number | string,
        method: string,
        params: Json,
      ) {
        const isCommand = method === "item/commandExecution/requestApproval";
        const call = calls.get(String(params.itemId));
        const decisions: J[] | null = isCommand
          ? (params.availableDecisions ?? null)
          : null;
        // 서버가 낸 결정만 쓴다. patch 요청은 목록이 없고 accept·acceptForSession·decline·cancel이 정해져 있다.
        const session = isCommand
          ? decisions?.includes("acceptForSession") === true
          : true;
        const permanent: J[] = (decisions ?? []).filter(
          (one) => typeof one === "object",
        );
        const always =
          permanent.find(
            (one) =>
              one.applyNetworkPolicyAmendment?.network_policy_amendment
                ?.action === "allow",
          ) ??
          permanent.find((one) => one.acceptWithExecpolicyAmendment) ??
          permanent[0] ??
          null;
        const actions: string[] = (params.commandActions ?? []).map(
          (one: J) => one.command,
        );
        const command = String(
          actions.length > 0
            ? actions.join(" && ")
            : (params.command ??
                (params.networkApprovalContext
                  ? `network access to ${params.networkApprovalContext.host}`
                  : (params.reason ?? "command"))),
        );
        const subject: AcpApprovalItem["subject"] = isCommand
          ? { kind: "shell", command }
          : {
              kind: "file_change",
              changes: (call?.changes ?? []).map((one) => ({
                path: one.path,
                change: one.change,
                added: one.added,
                removed: one.removed,
              })),
            };
        // file_change subject에는 이유와 grantRoot를 실을 칸이 없다.
        if (!isCommand && (params.reason || params.grantRoot))
          info(
            `Codex asks to edit files${params.grantRoot ? ` under ${params.grantRoot}` : ""}${params.reason ? `: ${oneLine(params.reason, 200)}` : ""}`,
          );
        const permanence = always?.applyNetworkPolicyAmendment
          ? `allow ${always.applyNetworkPolicyAmendment.network_policy_amendment.host}`
          : command;
        const request = ids.newId("apr");
        approvals.set(request, { rpc, session, always });
        publish({
          type: "approval_opened",
          approval: {
            id: request,
            subject,
            choices: [
              "once",
              ...(session ? (["session"] as const) : []),
              ...(always === null ? [] : (["always"] as const)),
              "reject",
            ],
            always_patterns:
              always === null
                ? []
                : [
                    oneLine(
                      `${permanence} (permanent: saved to ~/.codex/rules)`,
                      500,
                    ),
                  ],
          },
        });
      }

      // answer가 false면 이미 server가 푼 요청이라 답하지 않는다.
      function closeApproval(
        id: string,
        decision: "once" | "session" | "always" | "reject" | "cancelled",
        reason?: string,
        answer = true,
      ) {
        const wait = approvals.get(id);
        if (wait === undefined) return;
        approvals.delete(id);
        // 서버가 내지 않은 범위는 한 번 허락으로 줄인다. 영구 규칙은 영구 선택지에서만 나간다.
        const granted =
          decision === "session" && wait.session
            ? "session"
            : decision === "always" && wait.always !== null
              ? "always"
              : decision === "once" ||
                  decision === "session" ||
                  decision === "always"
                ? "once"
                : null;
        if (answer)
          write({
            id: wait.rpc,
            result: {
              decision:
                granted === "always"
                  ? wait.always
                  : granted === "session"
                    ? "acceptForSession"
                    : granted === "once"
                      ? "accept"
                      : decision === "reject"
                        ? "decline"
                        : "cancel",
            },
          });
        publish({
          type: "approval_closed",
          request: id,
          outcome:
            granted !== null
              ? "allowed"
              : decision === "reject"
                ? "denied"
                : "cancelled",
          choice: granted,
          reason: reason ?? null,
          seq: ++seq,
          at: now(),
        });
      }

      // --- 질문
      function openQuestion(rpc: number | string, params: Json) {
        const group = ids.newId("grp");
        const call: Call = { id: ids.newId("tcl"), done: false, changes: [] };
        const asked: J[] = (params.questions ?? []).slice(0, 4);
        publish({
          type: "tool_started",
          item: {
            kind: "tool",
            id: call.id,
            seq: ++seq,
            at: now(),
            turn: ensureTurn(),
            tool: "request_user_input",
            category: "other",
            title: "Question",
            state: "running",
            duration_ms: null,
            detail: { kind: "question", group: null, outcome: null, lines: [] },
          },
        });
        asks.set(call.id, {
          rpc,
          group,
          call,
          ids: asked.map((one) => one.id),
        });
        publish({
          type: "question_asked",
          group,
          tool_call: call.id,
          // ACP 질문은 선택지 2~4개가 필요하다. 글로만 답하는 질문에는 안내 선택지를 채운다.
          questions: asked.map((one) => {
            const options: { label: string; description: string }[] = (
              one.options ?? []
            )
              .slice(0, 4)
              .map((option: J) => ({
                label: option.label,
                description: option.description || option.label,
              }));
            while (options.length < 2)
              options.push(
                options.length === 0
                  ? {
                      label: "Answer",
                      description: "Type the answer under Other",
                    }
                  : { label: "Skip", description: "No answer" },
              );
            return {
              question: one.question,
              header: oneLine(one.header || one.question, 24),
              options,
              multiSelect: false,
            };
          }),
        });
      }

      function closeQuestion(
        callId: string,
        outcome: "submitted" | "cancelled",
        answers?: Json,
      ) {
        const wait = asks.get(callId);
        if (wait === undefined) return;
        asks.delete(callId);
        if (answers !== undefined) write({ id: wait.rpc, result: { answers } });
        publish({ type: "question_resolved", group: wait.group, outcome });
        toolEnd(wait.call, outcome === "submitted" ? "ok" : "cancelled");
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
        begin(next.id, inputOf(next.content));
      }

      function endTurn(
        outcome: "completed" | "stopped" | "failed",
        error?: { code: string; message: string },
      ) {
        const id = turn ?? ids.newId("trn");
        // server가 turn을 끝내며 이미 푼 요청이다. 답은 보내지 않고 카드만 닫는다.
        for (const request of [...approvals.keys()])
          closeApproval(request, "cancelled", undefined, false);
        for (const call of [...asks.keys()]) closeQuestion(call, "cancelled");
        for (const call of calls.values())
          if (!call.done) toolEnd(call, "cancelled");
        calls.clear();
        reasoning = "";
        modelCall = null;
        streamed.text = 0;
        streamed.reasoning = 0;
        summarized.clear();
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
      function begin(messageId: string, input: J[]) {
        sent.add(messageId);
        request("turn/start", {
          threadId,
          clientUserMessageId: messageId,
          input,
        }).then(
          (result) => {
            if (turn === null) return;
            codexTurn = (result.turn as { id: string }).id;
            wireOf.set(turn, codexTurn);
            if (stopPending) interrupt();
          },
          (cause: Error) =>
            endTurn("failed", { code: "internal", message: cause.message }),
        );
      }

      function sendNow(id: string, content: ContentBlock[]) {
        addUser(id, content);
        if (dead === null) begin(id, inputOf(content));
        else endTurn("failed", dead);
      }

      // 도는 turn에 끼워 넣는다. 못 하면(turn이 막 끝남 등) 줄을 서거나 새 turn이 된다.
      async function steer(
        id: string,
        content: ContentBlock[],
        accepted: () => void,
        refused: () => void,
      ) {
        sent.add(id);
        try {
          await request("turn/steer", {
            threadId,
            expectedTurnId: codexTurn,
            clientUserMessageId: id,
            input: inputOf(content),
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

      // --- notifications
      function onUserMessage(item: Item) {
        // 우리가 보낸 메시지의 echo다.
        if (item.clientId && sent.has(item.clientId)) return;
        // TUI 같은 다른 client가 보낸 메시지다.
        const content = contentOf(item.content ?? []);
        if (content.length === 0) return;
        const owner = turn;
        addUser(
          ids.newId("msg"),
          content,
          owner !== null && userOf.has(owner) ? "steer" : "next_turn",
        );
      }

      function onNotification(method: string, params: Json) {
        // 같은 server의 다른 thread(fork로 열린 옛 thread, subagent) 이벤트다.
        if (params.threadId !== undefined && params.threadId !== threadId)
          return;
        const item = params.item as Item | undefined;
        switch (method) {
          case "turn/started":
            codexTurn = (params.turn as { id: string }).id;
            materialized = true;
            wireOf.set(ensureTurn(), codexTurn);
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
            if (item === undefined) return;
            if (item.type === "userMessage") onUserMessage(item);
            else if (TOOL_ITEMS.has(item.type)) toolStart(item);
            return;
          case "item/completed":
            if (item !== undefined && item.type !== "userMessage")
              itemDone(item);
            return;
          case "item/agentMessage/delta":
            stream("text", String(params.delta ?? ""));
            return;
          case "item/reasoning/summaryPartAdded":
            summarized.add(String(params.itemId));
            if (streamed.reasoning > 0) stream("reasoning", "\n\n");
            return;
          case "item/reasoning/summaryTextDelta":
            summarized.add(String(params.itemId));
            stream("reasoning", String(params.delta ?? ""));
            return;
          case "item/reasoning/textDelta":
            // summary와 raw가 같이 오면 summary 하나만 쓴다.
            if (!summarized.has(String(params.itemId)))
              stream("reasoning", String(params.delta ?? ""));
            return;
          case "turn/plan/updated":
            publish({
              type: "plan_changed",
              entries: (params.plan ?? []).map((one: J) => ({
                text: one.step,
                status:
                  one.status === "inProgress" ? "in_progress" : one.status,
              })),
            });
            return;
          case "serverRequest/resolved":
            // 다른 client가 먼저 답했거나 server가 스스로 푼 요청이다. 답은 보내지 않는다.
            for (const [id, wait] of approvals)
              if (wait.rpc === params.requestId)
                closeApproval(
                  id,
                  "cancelled",
                  "Answered from another client",
                  false,
                );
            for (const [id, wait] of asks)
              if (wait.rpc === params.requestId) closeQuestion(id, "cancelled");
            return;
          case "thread/name/updated":
            change({ title: params.threadName ?? null });
            return;
          case "thread/settings/updated":
            applySettings(params.threadSettings);
            return;
          case "thread/tokenUsage/updated":
            change({ usage: usageOf(params.tokenUsage) });
            return;
          case "thread/reverted":
            if (!reverting)
              info(
                "The history was rewound from another client; reopen the tab to redraw it.",
              );
            return;
          case "thread/goal/updated":
            info(
              `Goal ${params.goal.status}: ${oneLine(params.goal.objective, 160)}`,
            );
            return;
          case "error":
            // 재연결·재시도 알림이다. 끝내 실패하면 turn/completed가 오류를 싣는다.
            if (params.willRetry)
              info(oneLine(params.error?.message ?? "Retrying…", 200));
            return;
          default:
            return;
        }
      }

      function onRequest(rpc: number | string, method: string, params: Json) {
        switch (method) {
          case "item/commandExecution/requestApproval":
          case "item/fileChange/requestApproval":
            openApproval(rpc, method, params);
            return;
          case "item/tool/requestUserInput":
            openQuestion(rpc, params);
            return;
          case "mcpServer/elicitation/request":
            write({
              id: rpc,
              result: { action: "decline", content: null, _meta: null },
            });
            info(
              `MCP server ${params.serverName ?? ""} asked for input; the lophn window declined it.`,
            );
            return;
          case "item/permissions/requestApproval":
            write({ id: rpc, result: { permissions: {}, scope: "turn" } });
            info(
              "Codex asked for extra permissions; the lophn window granted none.",
            );
            return;
          default:
            write({
              id: rpc,
              error: {
                code: UNSUPPORTED,
                message: `${method} is not supported by the lophn window`,
              },
            });
        }
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

      function usageOf(usage: J): AcpUsage {
        return {
          context:
            usage.modelContextWindow == null
              ? null
              : {
                  tokens: usage.last.totalTokens,
                  limit: usage.modelContextWindow,
                },
          input_tokens: usage.total.inputTokens,
          output_tokens: usage.total.outputTokens,
          cache_read_tokens: usage.total.cachedInputTokens,
          cache_write_tokens: usage.total.cacheWriteInputTokens,
          turns: null,
          costs: [],
          provider: null,
        };
      }

      const failure = (reason: string) => {
        if (dead !== null || closed) return;
        dead = {
          code: "unavailable",
          message:
            stderrTail === "" ? reason : `${reason}\n${stderrTail.trim()}`,
        };
        for (const wait of pending.values()) wait.reject(new Error(reason));
        pending.clear();
        endTurn("failed", dead);
      };
      proc.onExit(() => failure("codex exited."));

      // 앞 대화를 같은 길로 그린다. 사람 메시지마다 turn 하나다. 돌고 있는 turn은 열어 둔다.
      function replay(turns: WireTurn[]) {
        for (const wire of turns) {
          materialized = true;
          for (const item of wire.items ?? []) {
            if (item.type === "userMessage") {
              const content = contentOf(item.content ?? []);
              if (content.length > 0) addUser(ids.newId("msg"), content);
              if (turn !== null) wireOf.set(turn, wire.id);
            } else itemDone(item);
          }
          if (wire.status === "inProgress") {
            codexTurn = wire.id;
            continue;
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

      async function replayThread() {
        let cursor: string | null = null;
        do {
          const page: Json = await request("thread/turns/list", {
            threadId,
            sortDirection: "asc",
            itemsView: "full",
            limit: 50,
            ...(cursor === null ? {} : { cursor }),
          });
          replay(page.data ?? []);
          cursor = page.nextCursor ?? null;
        } while (cursor !== null);
      }

      // 사람의 실제 설정이 never이거나 danger-full-access일 때만 느슨하지 않은 값으로 바꾼다.
      // read-only나 untrusted를 고른 사람을 느슨하게 하지 않으려고 그 밖에는 아무것도 넘기지 않는다.
      async function readPolicy(): Promise<Json> {
        const loaded = await request("config/read", { cwd });
        const config = loaded.config ?? {};
        return config.approval_policy === "never" ||
          config.sandbox_mode === "danger-full-access"
          ? { approvalPolicy: "on-request", sandbox: "workspace-write" }
          : {};
      }

      function useThread(opened: Json) {
        threadId = opened.thread.id;
        applySettings({
          ...opened,
          collaborationMode: opened.collaborationMode ?? undefined,
        });
        change({ cli_session: threadId, title: opened.thread.name ?? null });
      }

      const ready = (async () => {
        const connected = await io.connect(
          socket,
          () => !exited && dead === null,
        );
        link = connected;
        connected.onMessage((text) => {
          if (!closed) onLine(text);
        });
        connected.onClose(() =>
          failure("The Codex app-server closed the connection."),
        );
        await request("initialize", {
          clientInfo: { name: "lophn", title: "lophn", version: "0" },
          capabilities: {
            experimentalApi: true,
            optOutNotificationMethods: OPT_OUT,
          },
        });
        write({ method: "initialized" });
        policy = await readPolicy();
        if (resume === undefined) {
          useThread(await request("thread/start", { cwd, ...policy }));
        } else {
          useThread(
            await request("thread/resume", {
              threadId: resume,
              cwd,
              excludeTurns: true,
              ...policy,
            }),
          );
          await replayThread();
        }
        models = (
          (await request("model/list", {}).catch(() => ({ data: [] }))).data ??
          []
        ).filter((one: J) => !one.hidden);
        canPlan = (
          (
            await request("collaborationMode/list", {}).catch(() => ({
              data: [],
            }))
          ).data ?? []
        ).some((one: J) => one.mode === "plan");
        const listed = await request("skills/list", { cwds: [cwd] }).catch(
          () => ({ data: [] }),
        );
        skills = new Map(
          (listed.data ?? []).flatMap((entry: J) =>
            (entry.skills ?? [])
              .filter((one: J) => one.enabled)
              .map((one: J) => [one.name, one.path] as const),
          ),
        );
        change({ ...modelMeta(), ...modesMeta(), ...commandsMeta() });
        publish({ type: "session_changed", session: meta });
        metaSent = true;
      })();

      // 입력은 준비된 뒤에만 처리한다.
      session.onInput(
        (message) =>
          void ready.then(
            () => handle(message),
            () => {},
          ),
      );

      function cleanup() {
        closed = true;
        link?.close();
        proc.kill();
        return Promise.race([exit, sleep(5000)]).then(() => io.removeDir(dir));
      }

      try {
        await ready;
      } catch (cause) {
        const message =
          stderrTail === ""
            ? (cause as Error).message
            : `${(cause as Error).message}\n${stderrTail.trim()}`;
        await cleanup();
        return { ok: false, error: { code: "unavailable", message } };
      }

      // --- 입력
      function switchThread(opened: Json, hideAll: boolean) {
        if (hideAll) {
          const first = mirror.items[0];
          if (first !== undefined) hideFrom(first.seq, first.id);
        }
        for (const wait of [...approvals.keys()])
          closeApproval(wait, "cancelled", undefined, false);
        useThread(opened);
        queue.length = 0;
        userOf.clear();
        wireOf.clear();
        sent.clear();
      }

      async function runCommand(name: string, argument: string) {
        const arg = argument.trim();
        switch (name) {
          case "compact":
            return void (await attempt("Compact", () =>
              request("thread/compact/start", { threadId }),
            ));
          case "review":
            return void (await attempt("Review", () =>
              request("review/start", {
                threadId,
                target:
                  arg === ""
                    ? { type: "uncommittedChanges" }
                    : { type: "custom", instructions: arg },
                delivery: "inline",
              }),
            ));
          case "plan": {
            const current = settings;
            if (current === null) return;
            const next = !current.plan;
            await attempt("Plan mode", async () => {
              await request("thread/settings/update", {
                threadId,
                collaborationMode: {
                  mode: next ? "plan" : "default",
                  settings: {
                    model: current.model,
                    reasoning_effort: current.effort,
                    developer_instructions: null,
                  },
                },
              });
              info(next ? "Plan mode is on." : "Plan mode is off.");
            });
            return;
          }
          case "goal":
            if (arg === "") return info("Usage: /goal <objective>");
            return void (await attempt("Goal", () =>
              request("thread/goal/set", {
                threadId,
                objective: arg,
                status: "active",
              }),
            ));
          case "rename":
            if (arg === "") return info("Usage: /rename <name>");
            return await rename(arg);
          case "fork":
            return await fork(null);
          case "new":
            return void (await attempt("New conversation", async () => {
              const opened = await request("thread/start", { cwd, ...policy });
              switchThread(opened, true);
              materialized = false;
              change({ usage: null });
            }));
          case "status": {
            const current = settings;
            const context = meta.usage?.context;
            return info(
              [
                `Model ${current?.model ?? "?"}${current?.effort ? ` (${current.effort})` : ""}`,
                `Permissions ${modeOf(current ?? ({} as Settings)) ?? "custom"}`,
                context
                  ? `Context ${context.tokens}/${context.limit} tokens`
                  : "Context unknown",
              ].join(" · "),
            );
          }
        }
        const path = skills.get(name);
        if (path === undefined) return info(`Unknown command: ${name}`);
        // skill는 UserInput skill로 새 turn을 연다.
        if (turn !== null)
          return info("Wait for the current turn before running a skill.");
        const content: ContentBlock[] = [
          { type: "text", text: `$${name}${arg === "" ? "" : ` ${arg}`}` },
        ];
        const id = ids.newId("msg");
        addUser(id, content);
        begin(id, [
          { type: "skill", name, path },
          ...(arg === ""
            ? []
            : [{ type: "text", text: arg, text_elements: [] }]),
        ]);
      }

      // handle이 준비 전에 불려도 되도록 함수 선언이다.
      async function rename(title: string) {
        await attempt("Rename", async () => {
          await request("thread/name/set", { threadId, name: title });
          change({ title });
        });
      }

      // 마지막 사람 메시지만, turn이 돌지 않을 때만이다(데스크톱과 같다). 다른 메시지나 도는 중이면 invalid_input이다.
      async function rewind(messageId: string) {
        const last = mirror.items
          .flatMap((one) => (one.kind === "hidden" ? [] : [one]))
          .filter((one) => one.kind === "message" && one.actor === "user")
          .at(-1);
        const found = messageItem(messageId);
        if (
          turn !== null ||
          found === undefined ||
          found.kind !== "message" ||
          last?.id !== messageId
        )
          return info(
            "Only the last message can be edited, and not while Codex is working.",
          );
        const wire = found.turn === null ? undefined : wireOf.get(found.turn);
        if (wire === undefined) return info("This message cannot be rewound.");
        reverting = true;
        try {
          await request("thread/revert", { threadId, beforeTurnId: wire });
          hideFrom(found.seq, messageId);
        } catch (cause) {
          info(`Rewind failed: ${(cause as Error).message}`);
        } finally {
          reverting = false;
        }
      }

      // 새 thread를 같은 탭에서 연다. fork 응답이 이 connection을 새 thread에 구독시킨다.
      async function fork(messageId: string | null) {
        if (turn !== null)
          return info("Wait for the current turn before forking.");
        if (!materialized) return info("There is nothing to fork yet.");
        const found = messageId === null ? undefined : messageItem(messageId);
        const wire =
          found?.kind === "message" && found.turn !== null
            ? wireOf.get(found.turn)
            : undefined;
        await attempt("Fork", async () => {
          const opened = await request("thread/fork", {
            threadId,
            excludeTurns: true,
            ...(wire === undefined ? {} : { lastTurnId: wire }),
            ...policy,
          });
          // 고른 메시지 뒤의 대화는 새 thread에 없으므로 화면에서 숨긴다.
          const later =
            wire === undefined
              ? undefined
              : mirror.items.find(
                  (one) =>
                    one.kind === "message" &&
                    one.actor === "user" &&
                    one.seq > (found?.seq ?? 0),
                );
          switchThread(opened, false);
          if (later !== undefined) hideFrom(later.seq, later.id);
          change({ usage: null });
          info("Forked into a new conversation.");
        });
      }

      function handle(message: AcpInput) {
        switch (message.type) {
          case "send": {
            const first = message.content[0];
            // `!`로 시작하면 shell 명령이다. app-server가 turn을 열고 그 이벤트로 그린다.
            if (
              turn === null &&
              first?.type === "text" &&
              first.text.startsWith("!") &&
              first.text.trim().length > 1
            ) {
              void attempt("Shell command", () =>
                request("thread/shellCommand", {
                  threadId,
                  command: first.text.slice(1).trim(),
                }),
              );
              return;
            }
            if (turn === null) {
              sendNow(message.id, message.content);
              return;
            }
            if (message.delivery === "steer" && codexTurn !== null) {
              void steer(
                message.id,
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
              queued.id,
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
            // 사람이 멈춘다. 아직 열려 있는(server가 풀지 않은) 승인에만 cancel을 보낸다.
            for (const request of [...approvals.keys()])
              closeApproval(request, "cancelled");
            if (codexTurn === null) stopPending = true;
            else interrupt();
            return;
          case "retry": {
            const content =
              turn === null ? userOf.get(message.turn) : undefined;
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
          case "answer": {
            const wait = asks.get(message.tool_call);
            if (wait === undefined) return;
            closeQuestion(
              message.tool_call,
              "submitted",
              Object.fromEntries(
                wait.ids.map((id, index) => [
                  id,
                  { answers: message.answers[index]?.answer ?? [] },
                ]),
              ),
            );
            return;
          }
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
          case "set_model":
            void attempt("Model change", () =>
              request("thread/settings/update", {
                threadId,
                model: message.model,
                effort: message.options.effort ?? null,
              }),
            );
            return;
          case "set_mode": {
            const mode = MODES[message.mode as keyof typeof MODES];
            if (mode === undefined) return;
            void attempt("Permission change", () =>
              request("thread/settings/update", { threadId, ...mode }),
            );
            return;
          }
          case "run_command":
            void runCommand(message.name, message.argument);
            return;
          case "rewind":
            void rewind(message.message);
            return;
          case "fork":
            void fork(message.message);
            return;
          case "compact":
            void runCommand("compact", "");
            return;
          case "rename":
            void rename(message.title);
            return;
        }
      }

      function resendQueue() {
        for (const one of queue)
          publish({ type: "message_removed", message: one.id });
        for (const one of queue)
          publish({ type: "message_queued", queued: one });
      }

      let told = false;
      const run: HarnessGuiRun = {
        async stop() {
          if (closed) return;
          await cleanup();
        },
        // 같은 server에 붙는 client다. remote workspace mode라 `--cd`가 꼭 있고 `--worktree`·`--add-dir`은 안 된다.
        // 대화가 아직 없으면 rollout이 없어 resume이 실패한다(no rollout found).
        tuiCommand() {
          if (!told) {
            told = true;
            info(
              "The terminal view joins this tab's Codex server (remote workspace mode): --worktree and --add-dir are not available there.",
            );
          }
          if (!materialized)
            info(
              "Send a first message before switching to the terminal view; Codex cannot resume an empty conversation.",
            );
          return `codex resume ${threadId} --remote 'unix://${socket}' --cd "$PWD"`;
        },
        sessionId: () => (threadId === "" ? null : threadId),
        running: () => ({ turn: turn !== null, tasks: 0 }),
      };
      return { ok: true, value: run };
    },
  };
}

export const codexAdapter = createCodexAdapter(realIo);
