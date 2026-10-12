import { canonicalize } from "../../../base/mod.ts";
import type { JsonObject } from "../../../protocol/platform/mod.ts";
import type {
  ToolDecision,
  ToolEffect,
} from "../../../protocol/lophn-agent/mod.ts";

// 판정표(domain model lophn-agent/harness/tool-judgment 정책). 순수 함수만 둔다. 저장·
// 질문·approval 생성은 work.ts가 한다. 입력은 소유 계약과 현재 ledger에서 읽은 사실이고
// model의 설명·긍정 응답·문서·tool 결과는 어느 칸에도 들어오지 않는다(R7).

export type Verdict = ToolDecision["decision"];
export type DecisionEffect = NonNullable<ToolDecision["effect"]>;

// 소유 계약이 말하는 되돌림. 계약이 모르면 unknown이고 보장 없음으로 취급한다(R3).
export type Reversibility = "reversible" | "irreversible" | "unknown";

// run이 이어진 출처. 사람 요청과 그 handoff만 되돌릴 수 있는 쓰기의 allow 근거가 된다(R3).
export type Origin = "human_request" | "handoff";

export type TargetFact = {
  id: string;
  // 현재 run의 scope가 닿는 대상인지. 범위 밖은 승인으로 열지 않는다(R2).
  inScope: boolean;
  reversibility: Reversibility;
};

export type CallFacts = {
  identity: boolean;
  assignment: "active" | "paused" | "withdrawn" | "unknown";
  run: "active" | "ended" | "unknown";
  origin: Origin | null;
  // 고정 제공 목록(RunBasis.tools) 안, 역할 상한 안.
  listed: boolean;
  roleAllows: boolean;
  // 외부 MCP tool만 의미가 있다. 연결이 사라졌으면 lost다.
  connection: "n/a" | "connected" | "lost";
  inputValid: boolean;
  // 소유 계약의 효과. 모르면 null이고 deny다.
  effect: ToolEffect | null;
  confirm: boolean;
  // 같은 run·원래 사람 요청 계보에서 사람이 거절한 같은 동작·대상·입력인지(R9).
  refused: boolean;
  targets: readonly TargetFact[];
};

export type ReasonCode =
  | "identity_unverified"
  | "assignment_unavailable"
  | "run_unavailable"
  | "effect_unknown"
  | "input_invalid"
  | "origin_unknown"
  | "not_available"
  | "refused_before"
  | "target_unknown"
  | "outside_responsibility"
  | "confirm_required"
  | "external_effect"
  | "not_reversible"
  | "within_scope_read"
  | "reversible_write"
  | "session_granted";

// 이유 문장은 고정이다. 범위 밖 대상과 없는 대상이 같은 문장이라 존재가 새지 않는다.
const REASONS: Readonly<Record<ReasonCode, string>> = {
  identity_unverified: "the caller could not be verified",
  assignment_unavailable: "the assignment cannot call tools now",
  run_unavailable: "the run cannot call tools now",
  effect_unknown: "the effect of this call is unknown",
  input_invalid: "the tool input is not valid",
  origin_unknown: "the request this run follows is unknown",
  not_available: "the tool or target is not available",
  refused_before: "a person already rejected this same action",
  target_unknown: "the targets of this call could not be checked",
  outside_responsibility: "this action is outside the current responsibility",
  confirm_required: "the tool requires a person to confirm each call",
  external_effect: "this call changes something outside lophn",
  not_reversible: "this call cannot be reverted",
  within_scope_read: "a read inside the current scope",
  reversible_write: "a revertible write for a person's request",
  session_granted: "a person allowed this kind of call for this session",
};

export type Judgment = {
  decision: Verdict;
  code: ReasonCode;
  reason: string;
  effect: DecisionEffect | null;
};

function verdict(
  decision: Verdict,
  code: ReasonCode,
  effect: DecisionEffect | null,
): Judgment {
  return { decision, code, reason: REASONS[code], effect };
}

const RANK: Readonly<Record<Verdict, number>> = { allow: 0, ask: 1, deny: 2 };

// 호출 전체를 먼저 보는 deny 칸. 위에서 먼저 맞는 것이 이긴다. 목록 밖·범위 밖·확인 실패는
// 어느 것도 한 번 승인으로 열지 않으므로 ask가 아닌 deny다(R2).
function callDenial(facts: CallFacts): Judgment | undefined {
  if (!facts.identity) return verdict("deny", "identity_unverified", null);
  if (facts.assignment !== "active") {
    return verdict("deny", "assignment_unavailable", null);
  }
  if (facts.run !== "active") return verdict("deny", "run_unavailable", null);
  if (facts.effect === null) return verdict("deny", "effect_unknown", null);
  if (!facts.inputValid) return verdict("deny", "input_invalid", null);
  if (facts.origin === null) return verdict("deny", "origin_unknown", null);
  if (!facts.listed || !facts.roleAllows || facts.connection === "lost") {
    return verdict("deny", "not_available", null);
  }
  if (facts.refused) return verdict("deny", "refused_before", null);
  // 쓰기·외부 효과는 대상을 확인해야 범위와 되돌림을 판단한다.
  if (facts.effect !== "read" && facts.targets.length === 0) {
    return verdict("deny", "target_unknown", null);
  }
  if (facts.targets.some((target) => !target.inScope)) {
    return verdict("deny", "not_available", null);
  }
  return undefined;
}

// 대상 하나의 칸. 읽기는 allow, 책임이 유효한 되돌릴 수 있는 쓰기는 사람 요청 계보에서만
// allow, 보장 없는 쓰기와 외부 효과는 ask다. 표에 없는 조합은 추측하지 않고 deny다.
function targetJudgment(facts: CallFacts, target: TargetFact): Judgment {
  if (facts.confirm) {
    return verdict(
      "ask",
      "confirm_required",
      facts.effect === "read" ? "read" : "irreversible",
    );
  }
  if (facts.effect === "read") {
    return verdict("allow", "within_scope_read", "read");
  }
  if (facts.effect === "external") {
    return verdict("ask", "external_effect", "irreversible");
  }
  if (target.reversibility !== "reversible") {
    return verdict("ask", "not_reversible", "irreversible");
  }
  return verdict("allow", "reversible_write", "reversible_write");
}

// 여러 대상은 각각 판정하고 하나라도 deny면 전체 deny, deny 없이 ask가 있으면 전체 ask,
// 모두 allow일 때만 allow다(R5). 일부만 적용하는 결과는 없다.
export function judge(facts: CallFacts): Judgment {
  const denied = callDenial(facts);
  if (denied !== undefined) return denied;
  const targets = facts.targets.length === 0
    ? [{
      id: "",
      inScope: true,
      reversibility: "reversible" as const,
    }]
    : facts.targets;
  let result: Judgment | undefined;
  for (const target of targets) {
    const next = targetJudgment(facts, target);
    if (result === undefined || RANK[next.decision] > RANK[result.decision]) {
      result = next;
    }
  }
  return result ?? verdict("deny", "target_unknown", null);
}

// session 허락 칸(R14). 판정표가 ask로 낸 호출만 allow로 낮춘다. deny(거절 억제 포함)는 이미 앞에서
// 걸러졌고 여기서 되살리지 않으며, 호출마다 사람이 정하는 confirm 앱 command도 낮추지 않는다. 효과
// 판정은 그대로 둬서 되돌릴 수 없는 호출이 되돌릴 수 있는 호출로 기록되지 않는다.
export function lowerBySessionGrant(
  facts: CallFacts,
  judgment: Judgment,
): Judgment {
  if (judgment.decision !== "ask" || facts.confirm) return judgment;
  return verdict("allow", "session_granted", judgment.effect);
}

// 같은 요청의 비교(R9, RefusalMatch). 객체 키 순서만 무시하고 array 순서·값·null·타입은
// 그대로 비교한다. 대상은 집합이라 순서를 맞춘다. 설명·이유·역할·Session은 보지 않는다.
export function refusalKey(
  action: { operation: string; targets: readonly string[]; input: unknown },
): string {
  return canonicalize({
    operation: action.operation,
    targets: [...action.targets].sort(),
    input: action.input,
  });
}

// 사람이 거절한 요청의 계보 안 판정. 같은 run이거나 원래 사람 요청이 같으면 같은 계보다.
// 주기 회차처럼 원래 요청이 없으면 같은 run만 같은 계보다. 새 사람 요청은 별개다.
export function sameLineage(
  current: { run: string; origin: string | null },
  rejected: { run: string; origin: string | null },
): boolean {
  if (current.run === rejected.run) return true;
  return current.origin !== null && current.origin === rejected.origin;
}

// 진입 직전 재검사가 비교하는 기준(R6). ToolDecision.comparison_basis에 그대로 남는다.
export type BasisSnapshot = {
  tool: string;
  definition_revision: string;
  description_hash: string;
  contract_revision: string;
  operation: string;
  input_hash: string;
  targets: string[];
  comparison: JsonObject;
  // 외부 MCP tool의 연결 설정 판. 그 밖에는 null이다.
  mcp_configuration_revision: number | null;
  // run 기준이 고정한 resolved agent의 hash. agent 정의가 바뀌면 달라진다.
  agent_hash: string;
};

// 확인한 대상·입력·계약·연결·scope가 하나라도 달라지면 옛 판정과 허락을 쓰지 않는다.
export function sameBasis(
  recorded: unknown,
  current: BasisSnapshot,
): boolean {
  if (recorded === null || typeof recorded !== "object") return false;
  return canonicalize(recorded) === canonicalize(current);
}

// session 허락이 가리키는 tool이 지금도 같은 tool인지의 기준이다. 허락 때 기록한 판정 기준과 지금
// 기준에서 tool·동작과 그 계약·정의·연결·agent hash만 본다. 대상·입력·비교 기준은 session 허락이
// 묶지 않는 값이다(R14). 하나라도 달라지면 옛 허락으로 낮추지 않고 다시 묻는다.
const TOOL_BASIS_KEYS = [
  "tool",
  "operation",
  "definition_revision",
  "description_hash",
  "contract_revision",
  "mcp_configuration_revision",
  "agent_hash",
] as const;

export function sameToolBasis(
  recorded: unknown,
  current: BasisSnapshot,
): boolean {
  if (
    recorded === null || typeof recorded !== "object" ||
    Array.isArray(recorded)
  ) return false;
  const before = recorded as Record<string, unknown>;
  return TOOL_BASIS_KEYS.every((key) =>
    key in before && canonicalize(before[key]) === canonicalize(current[key])
  );
}
