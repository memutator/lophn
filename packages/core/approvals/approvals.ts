// Approvals port의 구현. Gate를 돌리고, turn 안 request를 가진다.
// 결정 route는 wiring이 붙이고, 이 객체는 메모리 request를 맡는다.
import { err, ok, type Result } from "../../base/mod.ts";
import type { Clock, IdSource } from "../../base/mod.ts";
import {
  approvalsDecideTurn,
  type GateGrants,
  type GateVerdict,
  type Intent,
  type TurnDecision,
} from "../../protocol/approvals/mod.ts";
import type { Bus } from "../events/ports.ts";
import { allowanceKey } from "./grants/mod.ts";
import type { Approvals, Gate, Grants, SessionAllowances } from "./ports.ts";
import { createTurnRequests } from "./turn-requests.ts";

type ApprovalsDeps = {
  gate: Gate;
  grants: Grants;
  allowances: SessionAllowances;
  bus: Pick<Bus, "publish">;
  clock: Clock;
  ids: IdSource;
};

// 다른 단위가 쓰는 입구(Approvals)에 더해, 조립이 부르는 것이 있다.
export type ApprovalsService = Approvals & {
  // 사람이 turn 안 request를 결정한다. 결정 route(approvals/decide_turn)의 handler다.
  decideTurn(
    ctx: { actor: string },
    body: unknown,
  ): Promise<Result<{ outcome: TurnDecision }>>;
};

export function createApprovals(deps: ApprovalsDeps): ApprovalsService {
  const turns = createTurnRequests(deps);

  async function grantsOf(intent: Intent): Promise<Result<GateGrants>> {
    const actor = intent.actor;
    const app = actor.kind === "app"
      ? await deps.grants.appGrants(actor.app)
      : ok([]);
    if (!app.ok) return app;
    const agent = actor.kind === "agent"
      ? await deps.grants.agentGrant(actor.agent)
      : ok(null);
    if (!agent.ok) return agent;
    const reaction = await deps.grants.reactionGrant();
    if (!reaction.ok) return reaction;
    return ok({ app: app.value, agent: agent.value, reaction: reaction.value });
  }

  return {
    async judge(intent): Promise<Result<GateVerdict>> {
      const grants = await grantsOf(intent);
      if (!grants.ok) return grants;
      const verdict = deps.gate(intent, grants.value);
      if (verdict.verdict !== "ask" || intent.origin.kind !== "turn") {
        return ok(verdict);
      }
      // 이 session 동안 허락한 대상은 같은 session에서 다시 묻지 않는다.
      const key = allowanceKey(intent);
      return ok(
        key !== null && deps.allowances.has(intent.origin.session, key)
          ? { verdict: "run" }
          : verdict,
      );
    },
    openTurnRequest: turns.open,
    waitTurnDecision: turns.wait,
    consumeTurnAllow: turns.consume,
    cancelTurnRequests: turns.cancel,
    turnRequests: turns.list,
    decideTurn(ctx, body) {
      if (ctx.actor !== "user") {
        return Promise.resolve(err({
          code: "forbidden",
          message: "only the user decides a permission",
        }));
      }
      const input = approvalsDecideTurn.input.safeParse(body);
      if (!input.success) {
        return Promise.resolve(
          err({ code: "invalid_input", message: "invalid decision" }),
        );
      }
      return turns.decide(
        input.data.session,
        input.data.request,
        input.data.choice,
      );
    },
  };
}
