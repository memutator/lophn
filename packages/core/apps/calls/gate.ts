import { ok, type Result } from "../../../base/mod.ts";
import type {
  JsonObject,
  JsonValue,
} from "../../../protocol/base/json-values.ts";
import type { Intent } from "../../../protocol/approvals/mod.ts";
import type { ToolDenial } from "../../../protocol/apps/calls/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { Approvals } from "../../approvals/ports.ts";
import type { VerifiedCaller } from "./caller.ts";

type GateCheck =
  | { pass: true; consume: (() => Promise<Result<void>>) | null }
  | {
    pass: false;
    code: Extract<
      ToolDenial["code"],
      "gate_blocked" | "rejected" | "cancelled"
    >;
  };

function asObject(input: JsonValue | undefined): JsonObject {
  if (input === undefined) return {};
  if (input !== null && typeof input === "object" && !Array.isArray(input)) {
    return input;
  }
  return { value: input };
}

// agent와 앱만 Gate를 거친다. 사람 자신의 동작은 거치지 않는다.
export function appToolIntent(
  caller: Exclude<VerifiedCaller, { kind: "person" }>,
  target: { app: Id<"app">; tool: string },
  effect: Intent["effect"],
  input: JsonValue | undefined,
): Intent {
  const common = {
    kind: "app_tool",
    target: { kind: "app_tool", ...target },
    effect,
    input: asObject(input),
  } as const;
  if (caller.kind === "agent") {
    return {
      ...common,
      actor: { kind: "agent", agent: caller.agent, session: caller.session },
      origin: {
        kind: "turn",
        session: caller.session,
        turn: caller.turn,
        tool_call: caller.toolCall,
      },
    };
  }
  return {
    ...common,
    actor: { kind: "app", app: caller.app },
    origin: { kind: "app", invocation: caller.parent.id },
  };
}

// 허락이면 실행 직전에 부를 consume을 돌려준다(물었던 것만 있다).
export async function askGate(
  approvals: Approvals,
  intent: Intent,
): Promise<Result<GateCheck>> {
  const verdict = await approvals.judge(intent);
  if (!verdict.ok) return verdict;
  if (verdict.value.verdict === "run") return ok({ pass: true, consume: null });
  if (verdict.value.verdict === "deny") {
    return ok({ pass: false, code: "gate_blocked" });
  }
  const opened = approvals.openTurnRequest(intent);
  if (!opened.ok) return opened;
  const requestId = opened.value.id;
  const decision = await approvals.waitTurnDecision(requestId);
  if (decision.outcome === "reject") {
    return ok({ pass: false, code: "rejected" });
  }
  if (decision.outcome === "cancelled") {
    return ok({ pass: false, code: "cancelled" });
  }
  return ok({
    pass: true,
    consume: () => approvals.consumeTurnAllow(requestId, intent),
  });
}
