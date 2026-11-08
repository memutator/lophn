import { ok, type Result } from "../../../base/mod.ts";
import type {
  GateCall,
  ToolGateResult,
} from "../../../protocol/approvals/mod.ts";
import type {
  AgentId,
  Workspace,
} from "../../../protocol/lophn-agent/workspaces.ts";
import type { TurnMode } from "../../../protocol/lophn-agent/turn-values.ts";
import type { Approvals } from "../../approvals/mod.ts";

// agent runtime이 Gate가 걸리는 tool을 실행하기 전에 core에 묻는 입구. 판정은 Approvals.judge가 한다.
// file·web, 읽기 tool, 질문 tool, call·reply·cancel은 Gate가 없어 이 입구를 거치지 않는다. shell.run은 shell 규칙으로 거친다.
// 거치는지는 tool 정의의 gate가 정하고, gate가 없으면 check를 부르지 않는 것이 호출자의 일이다.

export type ToolGateCall = {
  session: string;
  turn: string;
  toolCall: string;
  agent: AgentId;
  workspace: Workspace | null;
  mode: TurnMode;
  // spawned_by가 있고 skip이 아닌 session. shell ask를 사람 대신 부모에게 보낸다.
  toParent: boolean;
  tool: string;
  call: GateCall;
};

interface ToolGate {
  check(call: ToolGateCall): Promise<Result<ToolGateResult>>;
}

export type ToolGateDeps = {
  approvals: Pick<Approvals, "judge" | "openTurnRequest" | "waitTurnDecision">;
};

export function createToolGate(deps: ToolGateDeps): ToolGate {
  return {
    async check(call) {
      const judged = await deps.approvals.judge(call.call, {
        agent: call.agent,
        session: call.session,
        workspace: call.workspace,
        mode: call.mode,
        toParent: call.toParent,
      });
      if (!judged.ok) return judged;
      const judgment = judged.value;
      if (judgment.kind === "deny") {
        return ok({ kind: "denied", reason: judgment.reason });
      }
      if (judgment.kind === "run") return ok({ kind: "run" });

      const opened = deps.approvals.openTurnRequest(
        {
          session: call.session,
          turn: call.turn,
          tool_call: call.toolCall,
          workspace: call.workspace,
          toParent: call.toParent,
        },
        call.call,
      );
      if (!opened.ok) return opened;
      // 물은 입력을 그대로 실행한다. 허락 뒤 다시 판정하거나 비교하지 않는다.
      const outcome = await deps.approvals.waitTurnDecision(opened.value.id);
      if (outcome.outcome === "reject") {
        return ok({
          kind: "rejected",
          reason: outcome.reason,
          by: opened.value.to_parent ? "parent" : "person",
        });
      }
      if (outcome.outcome === "cancelled") {
        return ok({ kind: "cancelled", cause: outcome.cause });
      }
      return ok({ kind: "run" });
    },
  };
}
