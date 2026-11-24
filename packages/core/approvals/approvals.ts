// Approvals port의 구현. Gate를 돌리고, turn 안 request를 가진다.
// 결정 route는 wiring이 붙이고, 이 객체는 메모리 request를 맡는다.
import { err, ok, type Result } from "../../base/mod.ts";
import type { Clock, IdSource } from "../../base/mod.ts";
import {
  type Assignment,
  type ShellRuleLayers,
  turnRequestDecide,
  type TurnRequestOutcome,
} from "../../protocol/approvals/mod.ts";
import type {
  AgentId,
  Workspace,
} from "../../protocol/lophn-agent/workspaces.ts";
import type { Bus } from "../events/ports.ts";
import { judge, type ProjectCommandPolicy } from "./gate/mod.ts";
import type { AlwaysEffect, Approvals, AskReplies } from "./ports.ts";
import { createTurnRequests } from "./turn-requests.ts";

type ApprovalsDeps = {
  assignmentOf(agent: AgentId): Promise<Result<Pick<Assignment, "entries">>>;
  shellRules(workspace: Workspace | null): ShellRuleLayers;
  projectCommandPolicyOf?(
    project: string,
    commandId: string | null,
    agent: AgentId,
  ): Promise<Result<ProjectCommandPolicy>>;
  bus: Pick<Bus, "publish">;
  clock: Clock;
  ids: IdSource;
};

// 다른 단위가 쓰는 입구(Approvals)에 더해, 조립이 부르는 것이 있다.
export type ApprovalsService = Approvals & {
  // 사람이 turn 안 request를 결정한다. 결정 route(turn_requests/decide)의 handler다.
  decide(
    ctx: { actor: string },
    body: unknown,
  ): Promise<Result<{ outcome: TurnRequestOutcome }>>;
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
  const turns = createTurnRequests(deps);
  const effects = new Map<string, AlwaysEffect>();

  return {
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
      return ok(
        judge(
          call,
          assignment,
          deps.shellRules(who.workspace),
          who.mode,
          who.toParent,
          projectCommand,
        ),
      );
    },
    openTurnRequest: turns.open,
    waitTurnDecision: turns.wait,
    cancelTurnRequests: turns.cancel,
    turnRequests: turns.list,
    remember(kind, effect) {
      effects.set(kind, effect);
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
      );
    },
  };
}
