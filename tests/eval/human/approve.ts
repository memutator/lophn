import type {
  PendingApproval,
  RequestChoice,
  TurnChoice,
  TurnPermissionRequest,
} from "../../../packages/protocol/approvals/mod.ts";
import type { ApproveRule } from "../types.ts";

type Reject = { kind: "reject"; reason: string };

// 거절 이유는 요청한 agent에게 그대로 간다(approval.md). 한 줄이다.
function rejectFor(rule: RequestChoice | null): Reject {
  return {
    kind: "reject",
    reason: rule === "reject"
      ? "rejected by the scenario approval rule"
      : "no approval rule in the scenario",
  };
}

// 규칙 밖의 선택은 만들지 않는다: 시나리오가 모르는 grant가 생긴다. allow만 가장 좁은 once로 좁힌다.
export function chooseTurn(
  approve: ApproveRule,
  request: TurnPermissionRequest,
): { choice: TurnChoice; rule: RequestChoice | null } {
  const rule = approve[request.intent.kind] ?? null;
  if (rule === null || rule === "reject") {
    return { choice: rejectFor(rule), rule };
  }
  if (request.choices.includes(rule)) return { choice: { kind: rule }, rule };
  if (rule === "allow" && request.choices.includes("once")) {
    return { choice: { kind: "once" }, rule };
  }
  return {
    choice: { kind: "reject", reason: "rule choice not offered" },
    rule,
  };
}

// 보류 request의 선택지는 allow·reject다. once 같은 turn용 규칙은 choices에 없어 거절이다.
export function choosePending(
  approve: ApproveRule,
  request: PendingApproval,
): {
  choice: { kind: "allow" } | Reject;
  rule: RequestChoice | null;
} {
  const rule = approve[request.intent.kind] ?? null;
  if (rule === "allow" && request.choices.includes("allow")) {
    return { choice: { kind: "allow" }, rule };
  }
  if (rule === null || rule === "reject") {
    return { choice: rejectFor(rule), rule };
  }
  return {
    choice: { kind: "reject", reason: "rule choice not offered" },
    rule,
  };
}
