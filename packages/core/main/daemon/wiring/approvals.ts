import { homedir } from "node:os";
import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import type {
  LocalToolTrustSetting,
  TurnRequest,
} from "../../../../protocol/approvals/mod.ts";
import {
  DEFAULT_LOCAL_TOOL_TRUST_SETTING,
  DEFAULT_PERMISSION_RULES_SETTING,
  LOCAL_TOOL_TRUST_SETTING_KEY,
  localToolTrust,
  localToolUntrust,
  PERMISSION_RULES_SETTING_KEY,
  sessionGrantRevoke,
  sessionPermissionsRead,
  type ToolGateResult,
  toolGateCheck,
  toolGateInputSchema,
  turnRequestDecide,
} from "../../../../protocol/approvals/mod.ts";
import { workspaceSessionRead } from "../../../../protocol/lophn-agent/agent-sessions.ts";
import type { AskResult } from "../../../../protocol/lophn-agent/ask-tool.ts";
import {
  type AskQuestion,
  askAnswer,
  askRead,
  askWait,
} from "../../../../protocol/lophn-agent/ask-tool.ts";
import type { CallAskKind } from "../../../../protocol/lophn-agent/calls.ts";
import {
  blocksText,
  textBlocks,
} from "../../../../protocol/lophn-agent/content-block.ts";
import type { McpTrust } from "../../../../protocol/lophn-agent/mcp-settings.ts";
import { turnRead } from "../../../../protocol/lophn-agent/turn-reads.ts";
import {
  DEFAULT_PERMISSION_MODE,
  type ExecutionContext,
  type PermissionMode,
  type TurnMode,
} from "../../../../protocol/lophn-agent/turn-values.ts";
import type {
  AgentId,
  Workspace,
} from "../../../../protocol/lophn-agent/workspaces.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { workspaceDataToolsFolder } from "../../../agent-workspaces/workspace/data-folder.ts";
import { PROJECT_LAYER } from "../../../agent-workspaces/workspace/project-layer.ts";
import {
  type ApprovalsService,
  createApprovals,
  defaultModeSetting,
  isLocalToolTrusted,
  localToolTrustSetting,
  permissionRuleLayers,
  permissionRulesSetting,
  withAlwaysPermissionRules,
  withTrustedLocalTool,
} from "../../../approvals/mod.ts";
import { appSourcePath } from "../../../apps/lookups.ts";
import type { Bus } from "../../../events/ports.ts";
import { mergeMcpLayers } from "../../../lophn-agent/extensions/mcp-server.ts";
import { registeredMcpServers } from "../../../lophn-agent/extensions/mcp-snapshot.ts";
import { ledgerSnapshot } from "../../../lophn-agent/session/rewind/files.ts";
import {
  createToolGate,
  type ToolGateDeps,
} from "../../../lophn-agent/tool-judgment/mod.ts";
import { discoverLocalToolDigests } from "../../../lophn-agent/tools/local-tools.ts";
import { createQuestionWaits } from "../../../lophn-agent/tools/questions/mod.ts";
import {
  loadProjectCommands,
  resolveProjectCommandPolicy,
} from "../../../projects/commands/store.ts";
import { projectFolderPaths } from "../../../projects/lookups.ts";
import { callsAskOpen, callsAskWithdraw } from "../../../router/mod.ts";
import type { MemoryHandler } from "../../../server/mod.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import { sessionFoldersOf } from "../workspace-folders-glue.ts";
import { readAgentMcp } from "./agent-mcp.ts";
import { isDevicePrincipal } from "./app-principal.ts";
import type { WiringFactory } from "./context.ts";
import { createSkillDeployments } from "./skill-deploy.ts";

// tool Gate가 session의 agent를 읽는 core 내부 machine 자격이다. 기동 때 ledger에 기록한다.
const APPROVALS_PRINCIPAL = "machine:approvals";

const APPROVALS_CONTEXT: AuthenticatedContext = {
  principal: APPROVALS_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [
      workspaceSessionRead.name,
      turnRead.name,
      callsAskOpen.name,
      callsAskWithdraw.name,
    ],
    targets: {},
  },
  conditions: {},
  credential_ref: APPROVALS_PRINCIPAL,
};

const DROPPING_BUS: Bus = {
  publish() {},
  subscribe: () => () => {},
};

// 호출한 agent의 credential이 묶인 session·turn과 입력이 같을 때만 받는다.
function ownTurn(
  who: AuthenticatedContext,
  input: { session: string; turn: string },
): Result<void> {
  return who.actor === `agent:${input.session}` &&
    who.conditions.session === input.session &&
    who.conditions.turn === input.turn
    ? ok(undefined)
    : err({
        code: "forbidden",
        message: "the credential belongs to another session or turn",
      });
}

export type SessionInfo = {
  agent: AgentId;
  workspace: Workspace | null;
  // 팀 자식이면 부모 session.
  spawnedBy: string | null;
  permissionMode: PermissionMode;
};

function executionContextOf(
  spawnedBy: string | null,
  turnMode: TurnMode,
): ExecutionContext {
  if (spawnedBy !== null) return "team_child";
  return turnMode === "unattended" ? "unattended" : "attended";
}

// runtime이 Gate가 걸리는 tool을 실행하기 직전에 부르는 입구다. 판정, 묻기, 사람 결정 기다리기를 모두 여기서 한다.
// mode는 그 turn 행의 mode다(시작 때 정해 바뀌지 않는다). 읽지 못하면 판정하지 않는다.
export function toolGateHandler(deps: {
  approvals: ToolGateDeps["approvals"];
  onDenied?: ToolGateDeps["onDenied"];
  sessionOf(session: string): Promise<Result<SessionInfo>>;
  modeOf(turn: string): Promise<Result<TurnMode>>;
}): MemoryHandler {
  return async (who, body) => {
    const input = toolGateInputSchema.parse(body);
    const own = ownTurn(who, input);
    if (!own.ok) return own;
    const found = await deps.sessionOf(input.session);
    if (!found.ok) return found;
    const mode = await deps.modeOf(input.turn);
    if (!mode.ok) return mode;
    const executionContext = executionContextOf(
      found.value.spawnedBy,
      mode.value,
    );
    return await createToolGate({
      approvals: deps.approvals,
      ...(deps.onDenied === undefined ? {} : { onDenied: deps.onDenied }),
    }).check({
      session: input.session,
      turn: input.turn,
      toolCall: input.tool_call,
      agent: found.value.agent,
      workspace: found.value.workspace,
      mode: mode.value,
      permissionMode: found.value.permissionMode,
      executionContext,
      // 팀 자식이 ask 판정을 받으면 사람 대신 부모에게 간다(사람 전용 등급은 판정 엔진이 먼저 no_person으로 막는다).
      toParent: found.value.spawnedBy !== null,
      tool: input.tool,
      call: input.call,
    });
  };
}

// 앱 command 호출이 Gate에서 run으로 끝나면(배포되어 있거나 사람이 허락했다) 판정한 앱(id)과 command를 그 tool call에 묶어 적어 둔다. 앱 호출 경로(core)가
// 닿지 않은 앱의 호출을 이 기록으로 가린다: Gate를 지나지 않은 호출과 판정한 것과 다른 앱·command의 호출은 사람이 허락하지 않은 호출이다.
export function recordGateRuns(
  toolGate: MemoryHandler,
  service: Pick<ApprovalsService, "recordGateRun">,
): MemoryHandler {
  return async (who, body) => {
    const result = await toolGate(who, body);
    const input = toolGateInputSchema.safeParse(body);
    if (
      result.ok &&
      (result.value as ToolGateResult).kind === "run" &&
      input.success &&
      input.data.call.kind === "app_tool"
    ) {
      service.recordGateRun(input.data.session, input.data.tool_call, {
        app: input.data.call.app,
        tool: input.data.call.tool,
      });
    }
    return result;
  };
}

// `turn_requests/decide` 입구다. `local_tool`의 `once` 허락은 곧 신뢰 기록이다: 결정이 확정되면 `(path, sha256)`을
// `approvals.local_tool_trust`에 저장해 다음 호출은 파일이 바뀌기 전까지 다시 묻지 않는다.
// 원격 기기(`device:*`)는 로컬 tool 신뢰를 승인하지 못한다(desktop 전용).
export function turnRequestDecideHandler(deps: {
  pendingOf(session: string, request: string): TurnRequest | undefined;
  decide: MemoryHandler;
  trustLocalTool(path: string, sha256: string): void;
}): MemoryHandler {
  return async (who, body) => {
    const parsed = turnRequestDecide.input.safeParse(body);
    const pending = parsed.success
      ? deps.pendingOf(parsed.data.session, parsed.data.request)
      : undefined;
    if (
      isDevicePrincipal(who) &&
      pending?.subject.kind === "local_tool" &&
      parsed.success &&
      parsed.data.choice.kind !== "reject"
    ) {
      return err({
        code: "forbidden",
        message: "only the local user may approve local tools",
      });
    }
    const decided = await deps.decide(who, body);
    if (
      decided.ok &&
      (decided.value as { outcome?: { outcome?: string } })?.outcome
        ?.outcome === "allow" &&
      pending?.subject.kind === "local_tool"
    ) {
      deps.trustLocalTool(pending.subject.path, pending.subject.sha256);
    }
    return decided;
  };
}

// `ask` tool의 기다림 입구다. 사람 없는 turn(unattended)과 팀 자식의 질문을 여기서 한 번에 가른다:
// 자식이면 mode와 permission_mode에 상관없이 부모에게 가고, 팀 밖이면 unattended turn만 묻지 않고 돌려준다.
export function askWaitHandler(deps: {
  ask(
    call: { session: string; turn: string; tool_call: string },
    questions: AskQuestion[],
    toParent: boolean,
  ): Promise<AskResult>;
  sessionOf(session: string): Promise<Result<SessionInfo>>;
  modeOf(turn: string): Promise<Result<TurnMode>>;
}): MemoryHandler {
  return async (who, body) => {
    const input = askWait.input.parse(body);
    const own = ownTurn(who, input);
    if (!own.ok) return own;
    const found = await deps.sessionOf(input.session);
    if (!found.ok) return found;
    const mode = await deps.modeOf(input.turn);
    if (!mode.ok) return mode;
    const toParent = found.value.spawnedBy !== null;
    if (!toParent && mode.value === "unattended") {
      return ok({ outcome: "unattended" });
    }
    return ok(await deps.ask(input, input.questions, toParent));
  };
}

// 부모에게 가는 ask call 본문이다. 승인은 카드 내용(명령 글이나 tool 이름)만 싣고 agent가 쓴 설명은 싣지 않는다.
const ASK_HELP =
  "If you cannot decide, use `ask` yourself; it goes to your own parent or the person.";

function approvalText(subject: TurnRequest["subject"]): string {
  const what =
    subject.kind === "shell"
      ? `run this shell command:\n${subject.command}`
      : subject.kind === "file_read"
        ? `read the file:\n${subject.path}`
        : subject.kind === "file_write"
          ? `${subject.action} the file:\n${subject.path}`
          : subject.kind === "local_tool"
            ? `run local tool "${subject.name}":\n${subject.path}`
            : subject.kind === "project_command"
              ? `run project command "${subject.name}":\n${subject.command}${subject.cwd ? `\ncwd: ${subject.cwd}` : ""}${subject.env_keys.length > 0 ? `\nenv keys: ${subject.env_keys.join(", ")}` : ""}`
              : subject.kind === "mcp_tool"
                ? `use the tool ${subject.server}/${subject.tool}`
                : subject.kind === "app_tool"
                  ? `use the tool ${subject.tool}`
                  : "continue";
  return `A team member needs approval to ${what}\n\nReply with \`lophn call reply <call> --allow\` or \`lophn call reply <call> --reject --body <reason>\`. ${ASK_HELP}`;
}

function questionText(questions: readonly AskQuestion[]): string {
  const lines = questions.flatMap((one, at) => [
    `${at + 1}. [${one.header}] ${one.question}${one.multiSelect ? " (more than one may apply)" : ""}`,
    ...one.options.map(
      (option) => `   - ${option.label}: ${option.description}`,
    ),
  ]);
  return `A team member asks:\n${lines.join("\n")}\n\nReply with \`lophn call reply <call> --body <answer>\`. If you cannot answer, use \`ask\` yourself; it goes to your own parent or the person.`;
}

export const approvalsWiring: WiringFactory = () => {
  let stopWatching: (() => void) | undefined;
  // 내려갈 때 기다림을 모두 푼다. 풀지 않으면 기다리는 요청 때문에 서버가 멈추지 못한다.
  let releaseWaits: (() => void) | undefined;
  return {
    name: "approvals",
    records: () => [APPROVALS_CONTEXT],
    build(ctx) {
      // Bus는 events가 만들어 slot으로 낸다. slot이 비어 있으면 event를 버린다.
      const bus: Bus = ctx.peek.bus ?? DROPPING_BUS;
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      // 앱 skill 배포는 세 층의 설정에서 그때그때 읽는다.
      const deployments = createSkillDeployments(ctx);
      const permissionRulesNow = () =>
        ctx.peek.settings?.get(permissionRulesSetting) ??
        DEFAULT_PERMISSION_RULES_SETTING;
      const defaultModeNow = (): PermissionMode =>
        ctx.peek.settings?.get(defaultModeSetting) ?? DEFAULT_PERMISSION_MODE;
      const localToolTrustNow = (): LocalToolTrustSetting =>
        ctx.peek.settings?.get(localToolTrustSetting) ??
        DEFAULT_LOCAL_TOOL_TRUST_SETTING;
      const saveLocalToolTrust = (
        next: LocalToolTrustSetting,
      ): Result<void> => {
        const written = ctx.settingsUpdate([
          { key: LOCAL_TOOL_TRUST_SETTING_KEY, action: "set", value: next },
        ]);
        return !written.ok || written.value.rejected.length > 0
          ? err({
              code: "unavailable",
              message: "the local tool trust list could not be saved",
            })
          : ok(undefined);
      };

      const effectiveMcpServersOf = async (
        workspace: Workspace | null,
        agent: AgentId,
      ) => {
        const registered = await registeredMcpServers(ctx.ledgerPath, {
          projectLayer: PROJECT_LAYER,
          agents: () => readAgentMcp(ctx.ledgerPath),
        });
        if (!registered.ok) return registered;
        const globalServers = registered.value
          .filter((entry) => entry.workspace === null && entry.agent === null)
          .map((entry) => entry.server);
        const workspaceServers = registered.value
          .filter((entry) => {
            if (entry.agent !== null || entry.workspace === null) return false;
            if (workspace === null) return entry.workspace.kind === "home";
            return (
              entry.workspace.kind === workspace.kind &&
              entry.workspace.id === workspace.id
            );
          })
          .map((entry) => entry.server);
        const agentServers = registered.value
          .filter((entry) => entry.agent === agent)
          .map((entry) => entry.server);
        return ok(
          mergeMcpLayers([
            { servers: globalServers, off: [] },
            { servers: workspaceServers, off: [] },
            { servers: agentServers, off: [] },
          ]),
        );
      };

      const mcpTrustOf = async (
        serverName: string,
        workspace: Workspace | null,
        agent: AgentId,
      ): Promise<Result<McpTrust>> => {
        const merged = await effectiveMcpServersOf(workspace, agent);
        if (!merged.ok) return merged;
        const found = merged.value.find((server) => server.name === serverName);
        return ok(found?.trust ?? "untrusted");
      };

      const projectCommandPolicyOf = (
        project: string,
        commandId: string | null,
        agent: AgentId,
      ) => {
        const connection = openConnection(ctx.ledgerPath);
        if (!connection.ok) return Promise.resolve(connection);
        try {
          const loaded = loadProjectCommands(connection.value.sql, project);
          if (!loaded.ok) return Promise.resolve(loaded);
          return Promise.resolve(
            ok(
              resolveProjectCommandPolicy(
                loaded.value.commands,
                loaded.value.settings,
                commandId,
                agent,
              ),
            ),
          );
        } finally {
          connection.value.close();
        }
      };

      const service = createApprovals({
        appAccessOf: (who, app) => deployments.appAccess(who, app),
        // 판정마다 읽어 사람이 Settings에서 고친 값이 다음 호출부터 쓰인다.
        permissionRules: (workspace) =>
          permissionRuleLayers(permissionRulesNow(), workspace),
        projectCommandPolicyOf,
        mcpTrustOf,
        localToolTrustedOf: (path, sha256) =>
          isLocalToolTrusted(localToolTrustNow(), path, sha256),
        homeDir: homedir(),
        dataRoot: ctx.root.path,
        bus,
        clock: ctx.clock,
        ids,
      });

      // `always`는 사람의 결정에서만 온다(decide는 사람 자격만 받는다). 규칙은 workspace로 고른 층에 더한다.
      service.remember("shell", (request, workspace) => {
        const next = withAlwaysPermissionRules(
          permissionRulesNow(),
          workspace,
          request.always_patterns,
          ids,
        );
        const written = ctx.settingsUpdate([
          { key: PERMISSION_RULES_SETTING_KEY, action: "set", value: next },
        ]);
        return Promise.resolve(
          !written.ok || written.value.rejected.length > 0
            ? err({
                code: "internal",
                message: "the permission rule could not be saved",
              })
            : ok(undefined),
        );
      });
      // 배포되지 않은 앱 호출의 `always`는 그 앱의 public skill을 부른 session의 workspace 층에 배포한다.
      service.remember("app_tool", async (request, workspace) => {
        if (request.subject.kind !== "app_tool") return ok(undefined);
        const done = await deployments.deployAll(
          { layer: "workspace", workspace },
          request.subject.app,
        );
        return done.ok ? ok(undefined) : done;
      });
      ctx.provide("approvals", service);

      // runtime의 Gate 입구와 ask 기다림이다. 기다림은 여기 main thread 메모리에 있고 runtime은 결과만 받는다.
      const waits = createQuestionWaits({ bus, clock: ctx.clock, ids });
      ctx.provide("questionWaits", waits);
      // turn이 끝나거나 session이 닫히면 기다리던 turn request와 질문을 cancelled로 푼다.
      // session이 닫히면 메모리의 session grant와 최근 거부도 함께 비운다.
      // 사람이 기다리는 session에 메시지를 보내면 질문은 그 메시지로 풀린다.
      stopWatching = bus.subscribe(
        [
          {
            types: ["TurnEnded", "SessionEnded", "MessageReceived"],
          },
        ],
        {
          send(event) {
            if (!("session" in event)) return;
            if (event.type === "TurnEnded") {
              service.cancelTurnRequests(event.session, "turn_ended");
              waits.cancel(event.session, event.payload.turn);
            } else if (event.type === "SessionEnded") {
              service.cancelTurnRequests(event.session, "session_closed");
              service.sessionGrants.clear(event.session);
              waits.cancel(event.session);
            } else if (
              event.type === "MessageReceived" &&
              event.payload.from.kind === "human"
            ) {
              waits.humanMessage(event.session, blocksText(event.payload.body));
            }
          },
          close() {},
        },
      );
      // 팀 자식의 request·질문은 사람 대신 부모에게 가는 result call로 간다. call과 request(질문 묶음)의 짝은 메모리에만 둔다:
      // request가 메모리라 재시작하면 짝도 사라지고, 열린 ask call은 Router의 recover가 닫는다.
      // 꺼질 때는 call을 닫지 않는다(구독을 먼저 뗀다).
      const sessionInfo = async (
        session: string,
      ): Promise<Result<SessionInfo>> => {
        const found = await ctx.runtime.readers.read(
          workspaceSessionRead,
          APPROVALS_CONTEXT,
          { session },
        );
        if (!found.ok) return found;
        const { agent, workspace, spawned_by, permission_mode } = (
          found.value as {
            session: {
              agent: AgentId;
              workspace: Workspace | null;
              spawned_by: string | null;
              permission_mode: PermissionMode;
            };
          }
        ).session;
        return ok({
          agent,
          workspace,
          spawnedBy: spawned_by,
          permissionMode: permission_mode,
        });
      };
      const modeOf = async (turn: string): Promise<Result<TurnMode>> => {
        const found = await ctx.runtime.readers.read(
          turnRead,
          APPROVALS_CONTEXT,
          { turn },
        );
        if (!found.ok) return found;
        return ok((found.value as { turn: { mode: TurnMode } }).turn.mode);
      };
      const asks = new Map<
        string,
        { kind: CallAskKind; key: string; session: string }
      >();
      const callOf = new Map<string, string>();
      // 부모에게 갔고 아직 열려 있는 request·묶음. call을 여는 동안 닫혔는지 가린다.
      const waiting = new Set<string>();
      const run = async (
        route: { name: string },
        input: unknown,
      ): Promise<Result<Record<string, unknown>>> => {
        const done = await ctx.writer.command(APPROVALS_CONTEXT, {
          command: route.name,
          input,
          idempotency_key: ids.newId("idk"),
          compare: {},
          prepared: [],
        });
        return done.ok
          ? ok(done.value.result as Record<string, unknown>)
          : done;
      };
      const forget = (key: string) => {
        waiting.delete(key);
        const call = callOf.get(key);
        callOf.delete(key);
        if (call !== undefined) asks.delete(call);
        return call;
      };
      const settleGone = (kind: CallAskKind, key: string, reason: string) => {
        if (kind === "approval")
          service.answerFromParent(key, "reject", reason);
        else waits.settleGroup(key, { outcome: "cancelled", answers: [] });
      };
      const openAsk = async (
        kind: CallAskKind,
        key: string,
        session: string,
        turn: string,
        text: string,
      ) => {
        waiting.add(key);
        const found = await sessionInfo(session);
        const mode = await modeOf(turn);
        const parent = found.ok ? found.value.spawnedBy : null;
        const opened =
          parent === null || !mode.ok
            ? null
            : await run(callsAskOpen, {
                from: session,
                to: parent,
                ask: kind,
                body: textBlocks(text),
                unattended: mode.value === "unattended",
              });
        // 부모에게 닿지 않으면(끝났거나 call이 거절됐다) 자식의 turn이 걸리지 않게 바로 푼다.
        if (
          opened === null ||
          !opened.ok ||
          opened.value["state"] !== "accepted"
        ) {
          if (waiting.delete(key)) {
            settleGone(
              kind,
              key,
              "the request could not reach the parent session",
            );
          }
          return;
        }
        const call = String(opened.value["call"]);
        if (!waiting.has(key)) {
          // 여는 동안 다른 이유로 이미 닫혔다.
          void run(callsAskWithdraw, { call, session });
          return;
        }
        asks.set(call, { kind, key, session });
        callOf.set(key, call);
      };
      const closedOther = (key: string) => {
        const ask = asks.get(callOf.get(key) ?? "");
        const call = forget(key);
        if (ask !== undefined && call !== undefined) {
          void run(callsAskWithdraw, { call, session: ask.session });
        }
      };
      service.askReplies = {
        answered({ call, decision, text }) {
          const ask = asks.get(call);
          if (ask === undefined) return;
          forget(ask.key);
          if (ask.kind === "approval") {
            service.answerFromParent(
              ask.key,
              decision === "allow" ? "allow" : "reject",
              decision === "reject" && text.trim() !== ""
                ? text.trim().slice(0, 500)
                : null,
            );
          } else {
            waits.settleGroup(ask.key, {
              outcome: "parent_reply",
              message: text,
            });
          }
        },
        ended({ call }) {
          const ask = asks.get(call);
          if (ask === undefined) return;
          forget(ask.key);
          settleGone(
            ask.kind,
            ask.key,
            "the parent session ended without answering",
          );
        },
      };
      const stopAsks = bus.subscribe(
        [
          {
            types: [
              "TurnRequestOpened",
              "TurnRequestClosed",
              "QuestionAsked",
              "QuestionResolved",
            ],
          },
        ],
        {
          send(event) {
            if (!("session" in event)) return;
            if (event.type === "TurnRequestOpened") {
              const { request } = event.payload;
              if (request.to_parent) {
                void openAsk(
                  "approval",
                  request.id,
                  event.session,
                  request.turn,
                  approvalText(request.subject),
                );
              }
            } else if (event.type === "QuestionAsked") {
              const { group, turn, tool_call, to_parent } = event.payload;
              const read = to_parent
                ? waits.read(event.session, tool_call)
                : null;
              if (read?.ok) {
                void openAsk(
                  "question",
                  group,
                  event.session,
                  turn,
                  questionText(read.value.questions),
                );
              }
            } else if (event.type === "TurnRequestClosed") {
              closedOther(event.payload.request);
            } else if (event.type === "QuestionResolved") {
              closedOther(event.payload.group);
            }
          },
          close() {},
        },
      );
      const stopAll = stopWatching;
      stopWatching = () => {
        stopAll?.();
        stopAsks();
      };
      const gating = new Set<string>();
      releaseWaits = () => {
        waits.cancelAll();
        for (const session of gating) {
          service.cancelTurnRequests(session, "restart");
        }
      };
      const toolGate = toolGateHandler({
        approvals: {
          judge(call, who) {
            return service.judge(call, {
              agent: who.agent,
              session: who.session,
              workspace: who.workspace,
              mode: who.permissionMode ?? defaultModeNow(),
              context:
                who.executionContext ??
                (who.toParent
                  ? "team_child"
                  : who.mode === "unattended"
                    ? "unattended"
                    : "attended"),
              tool: who.tool,
            });
          },
          openTurnRequest(origin, subject, options) {
            gating.add(origin.session);
            return service.openTurnRequest(origin, subject, options);
          },
          waitTurnDecision: service.waitTurnDecision,
          publishDenial(entry) {
            service.publishDenial(
              {
                session: entry.session,
                turn: entry.turn,
                tool_call: entry.tool_call,
              },
              entry.denial,
            );
          },
        },
        sessionOf: sessionInfo,
        modeOf,
      });
      const toolGateRecorded = recordGateRuns(toolGate, service);
      const askWaitRoute = askWaitHandler({
        ask: (call, questions, toParent) =>
          waits.ask(call, questions, toParent),
        sessionOf: sessionInfo,
        modeOf,
      });
      const humanOnly = (who: AuthenticatedContext): Result<void> =>
        who.actor === "user"
          ? ok(undefined)
          : err({ code: "forbidden", message: "only the user answers" });
      const localHumanOnly = (who: AuthenticatedContext): Result<void> => {
        const user = humanOnly(who);
        if (!user.ok) return user;
        return isDevicePrincipal(who)
          ? err({
              code: "forbidden",
              message: "only the local user may trust local tools",
            })
          : ok(undefined);
      };

      const decideHandler = turnRequestDecideHandler({
        pendingOf: (session, request) =>
          service.turnRequests(session).find((req) => req.id === request),
        decide: (who, body) => service.decide(who, body),
        trustLocalTool: (path, sha256) => {
          const next = withTrustedLocalTool(
            localToolTrustNow(),
            path,
            sha256,
            ctx.clock.now(),
          );
          saveLocalToolTrust(next);
        },
      });

      const readPermissionsHandler: MemoryHandler = async (who, body) => {
        const user = humanOnly(who);
        if (!user.ok) return user;
        const parsed = sessionPermissionsRead.input.safeParse(body);
        if (!parsed.success) {
          return err({
            code: "invalid_input",
            message: "invalid session permissions input",
          });
        }
        const info = await sessionInfo(parsed.data.session);
        if (!info.ok) return info;
        const { agent, workspace, permissionMode } = info.value;

        const foldersSnap = ledgerSnapshot(ctx.ledgerPath, (lookup) => {
          const { folders } = sessionFoldersOf(
            lookup,
            ctx.root.path,
            parsed.data.session,
          );
          const source =
            workspace === null
              ? null
              : workspace.kind === "project"
                ? (projectFolderPaths(lookup.sql, workspace.id)[0] ?? null)
                : appSourcePath(lookup.sql, workspace.id);
          return { folders, source };
        });
        const workspaceFolders = foldersSnap.ok
          ? foldersSnap.value.folders
          : [];
        const sourceFolder = foldersSnap.ok ? foldersSnap.value.source : null;

        const mcpLoaded = await effectiveMcpServersOf(workspace, agent);
        const mcpServers = mcpLoaded.ok
          ? mcpLoaded.value.map((server) => ({
              name: server.name,
              trust: server.trust,
              enabled: server.enabled,
            }))
          : [];

        const trusted = localToolTrustNow();
        const digests = await discoverLocalToolDigests([
          `${ctx.root.path}/tools`,
          sourceFolder === null ? null : `${sourceFolder}/.lophn/tools`,
          workspaceDataToolsFolder(ctx.root.path, workspace as never),
        ]);
        const localTools = digests.map((digest) => ({
          name: digest.name,
          path: digest.realPath,
          sha256: digest.sha256,
          trusted: isLocalToolTrusted(trusted, digest.realPath, digest.sha256),
        }));

        return ok(
          service.buildSessionPermissions({
            session: parsed.data.session,
            mode: permissionMode,
            workspace,
            workspaceFolders,
            mcpServers,
            localTools,
          }),
        );
      };

      const trustLocalToolHandler: MemoryHandler = (who, body) => {
        const local = localHumanOnly(who);
        if (!local.ok) return local;
        return service.trustLocalTool(
          who,
          body,
          localToolTrustNow(),
          saveLocalToolTrust,
        );
      };

      const untrustLocalToolHandler: MemoryHandler = (who, body) => {
        const local = localHumanOnly(who);
        if (!local.ok) return local;
        return service.untrustLocalTool(
          who,
          body,
          localToolTrustNow(),
          saveLocalToolTrust,
        );
      };

      const askReadHandler: MemoryHandler = (who, body) => {
        const user = humanOnly(who);
        if (!user.ok) return user;
        const input = askRead.input.parse(body);
        return waits.read(input.session, input.tool_call);
      };
      const askAnswerHandler: MemoryHandler = (who, body) => {
        const user = humanOnly(who);
        if (!user.ok) return user;
        const input = askAnswer.input.parse(body);
        return waits.answer(input.session, input.tool_call, input.answers);
      };
      const key = (route: { resource: string; method: string }) =>
        `${route.resource}/${route.method}`;
      return ok({
        memory: [
          [key(turnRequestDecide), decideHandler],
          [key(toolGateCheck), toolGateRecorded],
          [key(sessionPermissionsRead), readPermissionsHandler],
          [
            key(sessionGrantRevoke),
            (who, body) => service.revokeGrant(who, body),
          ],
          [key(localToolTrust), trustLocalToolHandler],
          [key(localToolUntrust), untrustLocalToolHandler],
          [key(askWait), askWaitRoute],
          [key(askRead), askReadHandler],
          [key(askAnswer), askAnswerHandler],
        ],
      });
    },
    closeIntake() {
      stopWatching?.();
      releaseWaits?.();
    },
  };
};
