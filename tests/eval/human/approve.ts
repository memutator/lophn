import type {
  TurnRequest,
  TurnRequestChoice,
} from "../../../packages/protocol/approvals/mod.ts";
import type { ApproveRule } from "../types.ts";

// 거절 이유는 요청한 agent에게 그대로 간다(approval.md). 한 줄이다.
function reject(reason: string): TurnRequestChoice {
  return { kind: "reject", reason };
}

// 규칙 밖의 선택은 만들지 않는다: 시나리오가 모르는 허락이 생긴다. shell 밖(앱 tool·MCP tool은 묻지 않고,
// harness는 터미널에서 답하는 물음이다)은 규칙이 없어 거절이다.
export function chooseTurn(
  approve: ApproveRule,
  request: TurnRequest,
): {
  choice: TurnRequestChoice;
  rule: NonNullable<ApproveRule["shell"]> | null;
} {
  const rule =
    request.subject.kind === "shell" ? (approve.shell ?? null) : null;
  if (rule === null) {
    return {
      choice: reject("no approval rule in the scenario"),
      rule,
    };
  }
  if (rule === "reject") {
    return {
      choice: reject("rejected by the scenario approval rule"),
      rule,
    };
  }
  if (rule === "always" && request.always_patterns.length === 0) {
    return { choice: reject("rule choice not offered"), rule };
  }
  return { choice: { kind: rule }, rule };
}

// 동의의 거절은 이유를 싣지 않는다(activation.consent 입력에 칸이 없다).
export function chooseConsent(approve: ApproveRule): {
  choice: "allow" | "reject";
  rule: NonNullable<ApproveRule["activation"]> | null;
} {
  const rule = approve.activation ?? null;
  return { choice: rule === "allow" ? "allow" : "reject", rule };
}
