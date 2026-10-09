// roles 화면의 순수 규칙. 화면 컴포넌트와 core 통로가 같이 쓴다.
import { type WorkStatus, workStatus } from "../../../conversation/model.ts";
import type {
  BasisSummary,
  Cost,
  CostKind,
  MadeLink,
  ModelAttempt,
  PresetDefinition,
  ReviewTrace,
  RoleKind,
  RoleRow,
  StepOutcome,
  ToolStep,
  WorkRow,
} from "./source.ts";

export type { WorkStatus };

const ROLE_ORDER: readonly RoleKind[] = [
  "lophn",
  "context_engineer",
  "app_engineer",
  "operator",
];

function stateRank(row: RoleRow): number {
  return row.state === "withdrawn" ? 1 : 0;
}

/** 목록 순서. 회수된 담당은 아래, 나머지는 lophn·Context Engineer·App Engineer·Operator 순이다. */
export function sortRoles(rows: readonly RoleRow[]): readonly RoleRow[] {
  return [...rows].sort((a, b) =>
    stateRank(a) - stateRank(b) ||
    ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
    (a.scope.id ?? "").localeCompare(b.scope.id ?? "") ||
    a.id.localeCompare(b.id)
  );
}

/** 대화 입력 gate. 회수된 담당은 지난 대화만 읽고 새 입력창이 없다(shell/desktop#R4). */
export function readOnlyConversation(role: RoleRow): boolean {
  return role.state === "withdrawn";
}

/** 새 대화를 열 자리. App Engineer·Operator는 담당 범위, 나머지는 전역이다. */
export function workPlaceOf(
  role: RoleRow,
):
  | { readonly kind: "global"; readonly id: null }
  | { readonly kind: "project" | "app"; readonly id: string } {
  if (role.scope.kind !== "all" && role.scope.id !== null) {
    return { kind: role.scope.kind, id: role.scope.id };
  }
  return { kind: "global", id: null };
}

function seq(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/** 앞선 일이 실패하거나 멈춰 사람의 확인을 기다리는 접수된 일. 확인 전에는 시작하지 않는다. */
export function awaitsRestart(work: WorkRow): boolean {
  return work.state === "accepted" && work.after !== null &&
    work.after.stopped && !work.startConfirmed;
}

export function statusOf(work: WorkRow): WorkStatus {
  if (awaitsRestart(work)) return "waiting";
  return workStatus({
    id: work.id,
    session: work.session,
    state: work.state,
    outcome: work.outcome?.kind ?? null,
    stateSeq: work.stateSeq,
    acceptedSeq: work.acceptedSeq,
  });
}

export const STATUS_ORDER: readonly WorkStatus[] = [
  "in-progress",
  "waiting",
  "stopped",
  "done",
];

export interface WorkGroup {
  readonly status: WorkStatus;
  readonly items: readonly WorkRow[];
}

/** 하는 일을 지금·기다림·멈춤·끝남 순으로 묶는다. 비는 묶음은 없고 안은 늦게 접수한 일이 먼저다. */
export function groupWorks(works: readonly WorkRow[]): readonly WorkGroup[] {
  return STATUS_ORDER.flatMap((status) => {
    const items = works
      .filter((work) => statusOf(work) === status)
      .sort((a, b) => {
        const left = seq(a.acceptedSeq);
        const right = seq(b.acceptedSeq);
        return left === right ? 0 : left < right ? 1 : -1;
      });
    return items.length === 0 ? [] : [{ status, items }];
  });
}

/**
 * 다시 시작: 앞선 일이 실패하거나 멈춘 뒤 사람의 확인을 기다리는 일을 이어서 시작한다(run-loop의
 * confirm-next). 다시 시키기와 다른 행동이다.
 */
export function canRestart(role: RoleRow, work: WorkRow): boolean {
  return role.state === "enabled" && awaitsRestart(work);
}

/**
 * 다시 시키기: 멈춘 일을 처음 요청 글 그대로 새 요청으로 보낸다. 새 일이 생기고 이전 일은 그대로다.
 * 멈춘 담당의 입력은 소유 concern의 허용 결과를 그대로 따르므로 회수된 담당만 막는다.
 */
export function canAskAgain(role: RoleRow, work: WorkRow): boolean {
  return role.state !== "withdrawn" && work.origin === "message" &&
    work.requestMessage !== null && work.session !== null &&
    statusOf(work) === "stopped";
}

export function canStop(work: WorkRow): boolean {
  return work.state !== "finished";
}

// 도구 이름의 앞 구간을 사람이 읽는 대상 이름으로 바꾼다.
const TARGETS = {
  document: "document",
  project: "project",
  app: "app",
  context: "focus",
  term: "meaning",
  visual: "chart",
  file: "file",
  format: "guide",
  guide: "guide",
  sdk: "guide",
  skill: "skill",
  question: "question",
  approval: "approval",
  handoff: "role",
} as const;

export type StepTarget =
  | (typeof TARGETS)[keyof typeof TARGETS]
  | "outside"
  | "tool";

export function stepTarget(step: ToolStep): StepTarget {
  if (step.source === "outside") return "outside";
  const head = step.tool.split(".")[0] ?? "";
  return (TARGETS as Record<string, StepTarget>)[head] ?? "tool";
}

export type StepStatus =
  | "done"
  | "failed"
  | "denied"
  | "not-run"
  | "unclear"
  | "unfinished";

/** 한 단계의 상태. 끝났다는 사실만으로 성공이라 말하지 않는다. */
export function stepStatus(step: ToolStep): StepStatus {
  const outcome: StepOutcome = step.outcome;
  if (outcome === "success") return "done";
  if (outcome === "failure") return "failed";
  if (outcome === "uncertain") return "unclear";
  if (outcome === "unfinished") return "unfinished";
  return step.decision?.kind === "deny" ? "denied" : "not-run";
}

export interface ActivityCount {
  readonly status: Exclude<StepStatus, "done">;
  readonly count: number;
}

/** 접은 도구 활동에 남는 실패·거절 요약. 0인 칸은 없다(R21). */
export function activityProblems(trace: ReviewTrace): readonly ActivityCount[] {
  const tools = trace.tools;
  const counts: ActivityCount[] = [
    { status: "failed", count: tools.failed.length },
    { status: "denied", count: tools.denied.length },
    { status: "not-run", count: tools.notExecuted.length },
    { status: "unclear", count: tools.uncertain.length },
    { status: "unfinished", count: tools.unfinished.length },
  ];
  return counts.filter((item) => item.count > 0);
}

export type CostLabel =
  | { readonly kind: "billed"; readonly text: string }
  | { readonly kind: "estimated"; readonly text: string }
  | { readonly kind: "subscription" }
  | { readonly kind: "free" }
  | { readonly kind: "unknown" };

function money(amount: string, currency: string | null): string {
  return currency === null ? amount : `${amount} ${currency}`;
}

/**
 * 호출 하나의 비용 표시. 실제 청구·추정·구독 포함·확인된 무료·모름을 구별한다. 금액이 없으면 모름이고
 * 0으로 채우지 않는다. 금액은 받은 글 그대로다(반올림하지 않는다).
 */
export function costLabel(
  cost: Pick<Cost, "kind" | "amount" | "currency">,
): CostLabel {
  const kind: CostKind = cost.kind;
  if (kind === "subscription") return { kind: "subscription" };
  if (cost.amount === null) return { kind: "unknown" };
  if (kind === "reported") {
    return { kind: "billed", text: money(cost.amount, cost.currency) };
  }
  if (kind === "estimated") {
    return { kind: "estimated", text: money(cost.amount, cost.currency) };
  }
  if (kind === "free") return { kind: "free" };
  return { kind: "unknown" };
}

export interface TokenPart {
  readonly part: "input" | "output" | "cache-read" | "cache-write";
  /** 보고된 수. 보고되지 않았으면 null이고 0으로 읽지 않는다. */
  readonly count: number | null;
}

export function tokenParts(usage: ModelAttempt["usage"]): readonly TokenPart[] {
  return [
    { part: "input", count: usage.input },
    { part: "output", count: usage.output },
    { part: "cache-read", count: usage.cacheRead },
    { part: "cache-write", count: usage.cacheWrite },
  ];
}

/** 근거 본문에서 화면이 읽는 것. 모양이 다르면 모르는 칸은 null이다. */
export function basisOf(value: unknown): BasisSummary {
  const object = (item: unknown): Record<string, unknown> | null =>
    typeof item === "object" && item !== null && !Array.isArray(item)
      ? item as Record<string, unknown>
      : null;
  const root = object(value);
  const preset = object(root?.["preset"]);
  const models = object(root?.["models"]);
  const text = (item: unknown): string | null =>
    typeof item === "string" ? item : null;
  const revision = preset?.["revision"];
  return {
    presetRevision: typeof revision === "number" ? revision : null,
    judgmentModel: text(object(models?.["judgment"])?.["model_name"]),
    organizingModel: text(object(models?.["organizing"])?.["model_name"]),
  };
}

export type NextAction = "ask-again" | "restart" | "answer" | "undo" | "none";

/**
 * 기본 화면의 필요한 다음 행동 하나. 멈춘 일은 다시 시키기(또는 다시 시작), 기다리는 일은 확인할
 * 것으로 가서 답하기, 끝난 일은 만든 것이 있을 때 되돌리기다. 만든 것이 없으면 없다.
 */
export function nextAction(
  role: RoleRow,
  work: WorkRow,
  made: readonly MadeLink[],
): NextAction {
  if (canRestart(role, work)) return "restart";
  if (canAskAgain(role, work)) return "ask-again";
  if (statusOf(work) === "waiting") return "answer";
  if (work.state === "finished" && made.length > 0) return "undo";
  return "none";
}

/** Preset 편집 결과가 원본과 달라졌는지. 저장 단추를 정한다. */
export function changed(a: PresetDefinition, b: PresetDefinition): boolean {
  const pick = (item: PresetDefinition) =>
    JSON.stringify([
      item.name,
      item.decisions &&
      [item.decisions.provider, item.decisions.accounts, item.decisions.model],
      item.summaries &&
      [item.summaries.provider, item.summaries.accounts, item.summaries.model],
      item.context,
      item.skills,
      item.servers,
      item.tools,
    ]);
  return pick(a) !== pick(b);
}

/** 계정 순서 이동. 범위 밖이면 그대로다. */
export function moveAccount(
  accounts: readonly string[],
  key: string,
  by: -1 | 1,
): readonly string[] {
  const from = accounts.indexOf(key);
  const to = from + by;
  if (from < 0 || to < 0 || to >= accounts.length) return accounts;
  const next = [...accounts];
  [next[from], next[to]] = [next[to]!, next[from]!];
  return next;
}
