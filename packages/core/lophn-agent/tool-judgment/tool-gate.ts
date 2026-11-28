import { ok, type Result } from "../../../base/mod.ts";
import type {
  AskedCall,
  GateCall,
  Judgment,
  PermissionDenial,
  ToolGateResult,
  TurnRequest,
  TurnRequestChoiceKind,
  TurnRequestOutcome,
} from "../../../protocol/approvals/mod.ts";
import type {
  ExecutionContext,
  PermissionMode,
  TurnMode,
} from "../../../protocol/lophn-agent/turn-values.ts";
import type {
  AgentId,
  Workspace,
} from "../../../protocol/lophn-agent/workspaces.ts";

// agent runtime이 Gate가 걸리는 tool을 실행하기 전에 core에 묻는 입구. 판정은 Approvals.judge가 한다.
// 거치는지는 tool 정의의 gate가 정하고, gate가 없으면 check를 부르지 않는 것이 호출자의 일이다.

export type ToolGateCall = {
  session: string;
  turn: string;
  toolCall: string;
  agent: AgentId;
  workspace: Workspace | null;
  mode: TurnMode;
  permissionMode?: PermissionMode;
  executionContext?: ExecutionContext;
  // 팀 자식 session이면 true. 사람 대신 부모에게 묻는다.
  toParent: boolean;
  tool: string;
  call: AskedCall;
};

export type DeniedToolNotice = {
  session: string;
  turn: string;
  tool_call: string;
  denial: PermissionDenial;
};

export type ToolGateApprovals = {
  judge(
    call: GateCall,
    who: {
      agent: AgentId;
      session: string;
      workspace: Workspace | null;
      mode: TurnMode;
      permissionMode?: PermissionMode;
      executionContext?: ExecutionContext;
      toParent: boolean;
      tool?: string;
    },
  ): Promise<Result<Judgment>>;
  openTurnRequest(
    origin: {
      session: string;
      turn: string;
      tool_call: string;
      workspace: Workspace | null;
      toParent: boolean;
    },
    subject: TurnRequest["subject"],
    options?: {
      allowedChoices?: readonly TurnRequestChoiceKind[];
      reason?: string | null;
      outsideRewind?: boolean;
      alwaysPatterns?: readonly string[];
    },
  ): Result<TurnRequest>;
  waitTurnDecision(request: string): Promise<TurnRequestOutcome>;
  publishDenial?(entry: DeniedToolNotice): void;
};

interface ToolGate {
  check(call: ToolGateCall): Promise<Result<ToolGateResult>>;
}

export type ToolGateDeps = {
  approvals: ToolGateApprovals;
  // 거부 시 PermissionDenied event 발행 및 최근 거부 기록을 남기는 port. 없으면 approvals.publishDenial을 쓴다.
  onDenied?(entry: DeniedToolNotice): void;
};

export function createToolGate(deps: ToolGateDeps): ToolGate {
  return {
    async check(call) {
      const judged = await deps.approvals.judge(call.call, {
        agent: call.agent,
        session: call.session,
        workspace: call.workspace,
        mode: call.mode,
        ...(call.permissionMode === undefined
          ? {}
          : { permissionMode: call.permissionMode }),
        ...(call.executionContext === undefined
          ? {}
          : { executionContext: call.executionContext }),
        toParent: call.toParent,
        tool: call.tool,
      });
      if (!judged.ok) return judged;
      const judgment = judged.value;
      if (judgment.kind === "deny") {
        const notice: DeniedToolNotice = {
          session: call.session,
          turn: call.turn,
          tool_call: call.toolCall,
          denial: judgment.denial,
        };
        if (deps.onDenied !== undefined) {
          deps.onDenied(notice);
        } else {
          deps.approvals.publishDenial?.(notice);
        }
        return ok({ kind: "denied", denial: judgment.denial });
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
        {
          allowedChoices: judgment.allowed_choices,
          reason: judgment.reason,
          outsideRewind: judgment.outside_rewind,
          ...(judgment.always_patterns === undefined
            ? {}
            : { alwaysPatterns: judgment.always_patterns }),
        },
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
