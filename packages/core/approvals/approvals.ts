// Approvals port의 구현. 통합 판정 엔진을 돌리고, turn 안 request와 session grant를 관리한다.

import type { Clock, IdSource } from "../../base/mod.ts";
import { err, ok, type Result } from "../../base/mod.ts";
import {
  type Assignment,
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

export type ApprovalsDeps = {
  assignmentOf(agent: AgentId): Promise<Result<Pick<Assignment, "entries">>>;
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
      let assignment: Pick<Assignment, "entries"> | null = null;
      if (call.kind === "app_tool") {
        const loaded = await deps.assignmentOf(who.agent);
        if (!loaded.ok) return loaded;
        assignment = loaded.value;
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
            assignment,
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

    cancelTurnRequests(session, cause) {
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
