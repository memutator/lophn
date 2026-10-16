import type { Result } from "../../../base/mod.ts";
import type {
  Effect,
  GateDenyReason,
  Intent,
  IntentKind,
  IntentTarget,
  TurnDecision,
} from "../../../protocol/approvals/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { JsonObject } from "../../../protocol/base/mod.ts";
import type { AgentRef } from "../../../protocol/lophn-agent/places.ts";
import type { Approvals } from "../../approvals/mod.ts";

// agent runtime이 Gate가 걸리는 tool을 실행하기 전에 core에 묻는 입구. 판정은 Approvals.judge가 한다.
// file·shell·web, 읽기 tool, 질문 tool, call·reply·cancel은 Gate가 없어 이 입구를 거치지 않는다.
// 거치는지는 resolve가 정하고, 거치지 않으면 check를 부르지 않는 것이 호출자의 일이다.

export type ToolGateCall = {
  session: Id<"ses">;
  turn: Id<"trn">;
  toolCall: Id<"tcl">;
  agent: AgentRef;
  tool: string;
  // 정규화한 입력. agent가 쓴 설명 글은 넣지 않는다.
  input: JsonObject;
};

type ResolvedIntent = {
  kind: IntentKind;
  target: IntentTarget;
  effect: Effect;
};

type ToolGateResult =
  | { kind: "run" }
  | { kind: "denied"; reason: GateDenyReason }
  | { kind: "rejected"; reason: string | null }
  | {
    kind: "cancelled";
    cause: Extract<TurnDecision, { outcome: "cancelled" }>["cause"];
  }
  // 허락 뒤 실행 직전에 intent가 달라졌거나 허락이 이미 쓰였다. 실행하지 않는다.
  | { kind: "changed" };

interface ToolGate {
  check(call: ToolGateCall): Promise<ToolGateResult>;
}

export type ToolGateDeps = {
  approvals: Pick<
    Approvals,
    "judge" | "openTurnRequest" | "waitTurnDecision" | "consumeTurnAllow"
  >;
  // 앱 app-api는 tool 이름에서 앱과 api를 풀고 효과를 활성 release 선언에서 읽는다.
  // 외부 MCP tool은 readOnlyHint가 참이면 read, 아니면 external이다.
  // 읽지 못하거나 정의가 사라졌으면 err이고 호출은 막힌다.
  resolve(
    call: ToolGateCall,
  ): Result<ResolvedIntent> | Promise<Result<ResolvedIntent>>;
};

export function createToolGate(deps: ToolGateDeps): ToolGate {
  async function intentOf(call: ToolGateCall): Promise<Intent | null> {
    const resolved = await deps.resolve(call);
    if (!resolved.ok) return null;
    return {
      kind: resolved.value.kind,
      actor: { kind: "agent", agent: call.agent, session: call.session },
      target: resolved.value.target,
      effect: resolved.value.effect,
      input: call.input,
      origin: {
        kind: "turn",
        session: call.session,
        turn: call.turn,
        tool_call: call.toolCall,
      },
    };
  }

  return {
    async check(call) {
      const intent = await intentOf(call);
      if (intent === null) return { kind: "denied", reason: "not_granted" };

      const verdict = await deps.approvals.judge(intent);
      if (!verdict.ok) return { kind: "denied", reason: "not_granted" };
      if (verdict.value.verdict === "deny") {
        return { kind: "denied", reason: verdict.value.reason };
      }
      if (verdict.value.verdict === "run") return { kind: "run" };

      const opened = deps.approvals.openTurnRequest(intent);
      if (!opened.ok) return { kind: "changed" };
      const decision = await deps.approvals.waitTurnDecision(opened.value.id);
      if (decision.outcome === "reject") {
        return { kind: "rejected", reason: decision.reason };
      }
      if (decision.outcome === "cancelled") {
        return { kind: "cancelled", cause: decision.cause };
      }

      // 허락은 그 intent에 한 번만 쓰인다. 실행 직전에 다시 만든 intent와 비교한다.
      const current = await intentOf(call);
      if (current === null) return { kind: "changed" };
      const used = await deps.approvals.consumeTurnAllow(
        opened.value.id,
        current,
      );
      return used.ok ? { kind: "run" } : { kind: "changed" };
    },
  };
}
