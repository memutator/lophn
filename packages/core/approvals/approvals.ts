// Approvals port의 구현. 통합 판정 엔진을 돌리고, turn 안 request와 session grant를 관리한다.

import type { Clock, IdSource } from "../../base/mod.ts";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  type IsolationBackend,
  type LocalToolTrustSetting,
  localToolTrust,
  localToolUntrust,
  type PermissionRuleLayers,
  type SessionPermissionsLocalTool,
  type SessionPermissionsMcpServer,
  type SessionPermissionsOutput,
  sessionGrantRevoke,
  type TurnRequestOutcome,
  turnRequestDecide,
} from "../../protocol/approvals/mod.ts";
import type { McpTrust } from "../../protocol/lophn-agent/mcp-settings.ts";
import type { PermissionMode } from "../../protocol/lophn-agent/turn-values.ts";
import type {
  AgentId,
  Workspace,
} from "../../protocol/lophn-agent/workspaces.ts";
import type { Bus } from "../events/ports.ts";
import { evaluatePermission, type ProjectCommandPolicy } from "./gate/mod.ts";
import {
  withoutTrustedLocalTool,
  withTrustedLocalTool,
} from "./permission-rules/mod.ts";
import type {
  AlwaysEffect,
  Approvals,
  AskReplies,
  SessionEffect,
} from "./ports.ts";
import {
  createSessionGrantStore,
  sessionGrantInputForRequest,
} from "./session-grants.ts";
import { createTurnRequests } from "./turn-requests.ts";

// app_tool 호출의 앱이 그 session에 닿는지다. 앱의 public skill이 배포됐고(전역, 그 workspace, 그 agent) 그 session이 끄지 않았거나 앱 자기
// workspace의 session이면 닿는다. `skills`는 그 앱의 public skill 이름이고 `mayDeploy`는 그 agent가 묻지 않고 배포할 수 있는가다.
// 조립이 apps와 배포 기록을 읽어 꽂는다.
export type AppAccess = {
  reached: boolean;
  slug: string;
  skills: readonly string[];
  mayDeploy: boolean;
};

// Gate가 판정한 앱 command: 앱 id와 command 이름이다.
export type GateJudged = { app: string; tool: string };

export type ApprovalsDeps = {
  appAccessOf(
    who: { agent: AgentId; workspace: Workspace | null },
    app: string,
  ): Promise<Result<AppAccess>>;
  permissionRules(workspace: Workspace | null): PermissionRuleLayers;
  projectCommandPolicyOf?(
    project: string,
    commandId: string | null,
    agent: AgentId,
  ): Promise<Result<ProjectCommandPolicy>>;
  mcpTrustOf?(
    server: string,
    workspace: Workspace | null,
    agent: AgentId,
  ): Promise<Result<McpTrust>> | McpTrust;
  localToolTrustedOf?(path: string, sha256: string): boolean;
  homeDir?: string;
  dataRoot?: string;
  isolation?: IsolationBackend;
  bus: Pick<Bus, "publish">;
  clock: Clock;
  ids: IdSource;
};

export type SessionPermissionsViewInput = {
  readonly session: string;
  readonly mode: PermissionMode;
  readonly workspace: Workspace | null;
  readonly workspaceFolders: readonly string[];
  readonly mcpServers: readonly SessionPermissionsMcpServer[];
  readonly localTools: readonly SessionPermissionsLocalTool[];
};

// 다른 단위가 쓰는 입구(Approvals)에 더해, 조립이 부르는 route handler 도우미가 있다.
export type ApprovalsService = Approvals & {
  // 사람이 turn 안 request를 결정한다. 결정 route(turn_requests/decide)의 handler다.
  decide(
    ctx: { actor: string },
    body: unknown,
  ): Promise<Result<{ outcome: TurnRequestOutcome }>>;
  // 사람이 `/permissions`에서 이 대화 동안 허락을 개별 해제한다(`permissions/revoke-grant`).
  revokeGrant(
    ctx: { actor: string },
    body: unknown,
  ): Result<{ revoked: boolean }>;
  // `/permissions` 화면(`permissions/read`) 응답을 조립한다.
  buildSessionPermissions(
    input: SessionPermissionsViewInput,
  ): SessionPermissionsOutput;
  // 사람이 로컬 tool 스크립트를 신뢰 목록에 더한다(`permissions/trust-local-tool`).
  trustLocalTool(
    ctx: { actor: string },
    body: unknown,
    current: LocalToolTrustSetting,
    save: (next: LocalToolTrustSetting) => Result<void>,
  ): Result<{ trusted: boolean }>;
  // 사람이 로컬 tool 스크립트를 신뢰 목록에서 뺀다(`permissions/untrust-local-tool`).
  untrustLocalTool(
    ctx: { actor: string },
    body: unknown,
    current: LocalToolTrustSetting,
    save: (next: LocalToolTrustSetting) => Result<void>,
  ): Result<{ removed: boolean }>;
  // 부모가 팀 자식의 request를 푼다. allow는 once뿐이라 always 규칙이 더해지지 않는다.
  answerFromParent(
    request: string,
    decision: "allow" | "reject",
    reason: string | null,
  ): void;
  // Router가 ask call의 답을 알리는 입구다. 짝 표는 조립이 갖고 이 칸을 꽂는다.
  askReplies: AskReplies;
  // Gate가 앱 command 호출(tool call)을 보내도 된다고 끝냈다(배포되어 있거나 사람이 허락했다). 앱 호출 경로(core)가 닿지 않은 앱의 호출을
  // 그 호출을 Gate가 보낸 것인지로 본다: 사람이 허락하지 않은 배포 밖 호출은 Gate를 지나지 않은 호출이라 거절된다.
  // 기록은 판정한 것(앱 id와 command)에 묶인다: 같은 tool call id로 다른 앱이나 command를 부르는 호출은 판정되지 않은 호출이다.
  recordGateRun(session: string, toolCall: string, judged: GateJudged): void;
  gateRan(session: string, toolCall: string, judged: GateJudged): boolean;
};

export function createApprovals(deps: ApprovalsDeps): ApprovalsService {
  const sessionGrants = createSessionGrantStore({
    clock: deps.clock,
    ids: deps.ids,
  });
  const turns = createTurnRequests({
    permissionRules: deps.permissionRules,
    homeDir: deps.homeDir,
    dataRoot: deps.dataRoot,
    bus: deps.bus,
    clock: deps.clock,
    ids: deps.ids,
  });
  const effects = new Map<string, AlwaysEffect>();
  // session마다 Gate가 run으로 끝낸 `<tool call>\0<앱 id>\0<command>`다.
  const gateRuns = new Map<string, Set<string>>();
  const gateKey = (toolCall: string, judged: GateJudged) =>
    `${toolCall}\0${judged.app}\0${judged.tool}`;
  let customSessionEffect: SessionEffect | undefined;

  const applySessionEffect: SessionEffect = async (request, workspace) => {
    const grantInput = sessionGrantInputForRequest(
      request,
      deps.permissionRules(workspace),
      deps.homeDir,
      deps.dataRoot,
    );
    if (grantInput !== null) {
      sessionGrants.grant(request.session, grantInput);
    }
    if (customSessionEffect !== undefined) {
      return await customSessionEffect(request, workspace);
    }
    return ok(undefined);
  };

  return {
    sessionGrants,

    async judge(call, who) {
      let appAccess: AppAccess | null = null;
      if (call.kind === "app_tool") {
        const loaded = await deps.appAccessOf(who, call.app);
        if (!loaded.ok) return loaded;
        appAccess = loaded.value;
      }
      let projectCommand: ProjectCommandPolicy | undefined;
      if (
        (call.kind === "project_command" ||
          call.kind === "project_command_definition") &&
        deps.projectCommandPolicyOf !== undefined
      ) {
        const loaded = await deps.projectCommandPolicyOf(
          call.project,
          call.kind === "project_command" ? call.command_id : null,
          who.agent,
        );
        if (!loaded.ok) return loaded;
        projectCommand = loaded.value;
      }
      let mcpTrust: McpTrust | undefined = who.mcpTrust;
      if (
        call.kind === "mcp_tool" &&
        mcpTrust === undefined &&
        deps.mcpTrustOf !== undefined
      ) {
        const loaded = await deps.mcpTrustOf(
          call.server,
          who.workspace,
          who.agent,
        );
        if (typeof loaded === "string") {
          mcpTrust = loaded;
        } else {
          if (!loaded.ok) return loaded;
          mcpTrust = loaded.value;
        }
      }
      const localToolTrusted =
        call.kind === "local_tool"
          ? (deps.localToolTrustedOf?.(call.path, call.sha256) ?? false)
          : undefined;

      return ok(
        evaluatePermission(
          {
            call,
            tool: who.tool,
            appAccess,
            projectCommand,
            mcpTrust,
            localToolTrusted,
            homeDir: deps.homeDir,
            dataRoot: deps.dataRoot,
            isolation: deps.isolation ?? "none",
          },
          deps.permissionRules(who.workspace),
          sessionGrants.list(who.session),
          who.mode,
          who.context,
        ),
      );
    },

    openTurnRequest: turns.open,
    waitTurnDecision: turns.wait,

    recordGateRun(session, toolCall, judged) {
      const calls = gateRuns.get(session) ?? new Set<string>();
      calls.add(gateKey(toolCall, judged));
      gateRuns.set(session, calls);
    },

    gateRan: (session, toolCall, judged) =>
      gateRuns.get(session)?.has(gateKey(toolCall, judged)) === true,

    cancelTurnRequests(session, cause) {
      gateRuns.delete(session);
      turns.cancel(session, cause);
      // session이 닫히거나 재시작하면 메모리의 session grant와 최근 거부도 함께 비운다.
      if (cause === "session_closed" || cause === "restart") {
        sessionGrants.clear(session);
      }
    },

    turnRequests: turns.list,

    remember(kind, effect) {
      effects.set(kind, effect);
    },

    rememberSession(effect) {
      customSessionEffect = effect;
    },

    publishDenial(origin, denial) {
      const recorded = sessionGrants.recordDenial(origin.session, {
        turn: origin.turn,
        tool_call: origin.tool_call,
        denial,
      });
      deps.bus.publish({
        session: origin.session,
        type: "PermissionDenied",
        at: recorded.at,
        payload: {
          turn: origin.turn,
          tool_call: origin.tool_call,
          denial,
        },
      });
      return recorded;
    },

    answerFromParent: turns.answerFromParent,
    askReplies: { answered() {}, ended() {} },

    decide(ctx, body) {
      if (ctx.actor !== "user") {
        return Promise.resolve(
          err({
            code: "forbidden",
            message: "only the user decides a request",
          }),
        );
      }
      const input = turnRequestDecide.input.safeParse(body);
      if (!input.success) {
        return Promise.resolve(
          err({ code: "invalid_input", message: "invalid decision" }),
        );
      }
      return turns.decide(
        input.data.session,
        input.data.request,
        input.data.choice,
        effects,
        applySessionEffect,
      );
    },

    revokeGrant(ctx, body) {
      if (ctx.actor !== "user") {
        return err({
          code: "forbidden",
          message: "only the user revokes a session grant",
        });
      }
      const input = sessionGrantRevoke.input.safeParse(body);
      if (!input.success) {
        return err({ code: "invalid_input", message: "invalid revoke input" });
      }
      return ok({
        revoked: sessionGrants.revoke(input.data.session, input.data.grant),
      });
    },

    buildSessionPermissions(input) {
      const layers = deps.permissionRules(input.workspace);
      return {
        session: input.session,
        mode: input.mode,
        workspace_folders: [...input.workspaceFolders],
        opened_folders: sessionGrants.openedFolders(input.session),
        floor_count: layers.floor.length,
        global_rules: [...layers.global],
        project_rules: [...layers.project],
        session_grants: sessionGrants.list(input.session),
        mcp_servers: [...input.mcpServers],
        local_tools: [...input.localTools],
        recent_denials: sessionGrants.recentDenials(input.session),
      };
    },

    trustLocalTool(ctx, body, current, save) {
      if (ctx.actor !== "user") {
        return err({
          code: "forbidden",
          message: "only the user trusts a local tool",
        });
      }
      const input = localToolTrust.input.safeParse(body);
      if (!input.success) {
        return err({
          code: "invalid_input",
          message: "invalid local tool trust input",
        });
      }
      const next = withTrustedLocalTool(
        current,
        input.data.path,
        input.data.sha256,
        deps.clock.now(),
      );
      const saved = save(next);
      if (!saved.ok) return saved;
      return ok({ trusted: true });
    },

    untrustLocalTool(ctx, body, current, save) {
      if (ctx.actor !== "user") {
        return err({
          code: "forbidden",
          message: "only the user untrusts a local tool",
        });
      }
      const input = localToolUntrust.input.safeParse(body);
      if (!input.success) {
        return err({
          code: "invalid_input",
          message: "invalid local tool untrust input",
        });
      }
      const { entries, removed } = withoutTrustedLocalTool(
        current,
        input.data.path,
      );
      if (removed) {
        const saved = save(entries);
        if (!saved.ok) return saved;
      }
      return ok({ removed });
    },
  };
}
