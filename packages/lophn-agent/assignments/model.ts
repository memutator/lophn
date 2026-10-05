import {
  type Assignment,
  type AssignmentScope,
  type OperatorApprovalBundle,
  type pauseReasonSchema,
  type ReadCommand,
  RUN_OUTCOME_REASONS,
  type Schedule,
} from "../../contracts/lophn-agent/mod.ts";
import type { z } from "zod";
import type { RequestContext } from "../../contracts/platform/mod.ts";
import { parseActor } from "../../contracts/platform/mod.ts";

type PauseReason = z.infer<typeof pauseReasonSchema>;

// row를 화면 값으로 바꾸는 도움. entity와 상태 전이 규칙은 domain-model
// lophn-agent/assignments의 표·상태 그대로다. 순수 함수만 있고 IO는 없다.

export type AssignmentRow = {
  id: string;
  preset_id: string;
  preset_revision: number;
  role: string;
  scope_kind: string;
  scope_id: string | null;
  state: string;
  pause_reason_kind: string | null;
  pause_detail: string | null;
  pause_runs: string | null;
  pause_target: string | null;
  last_due_at: string | null;
  approval: string | null;
  revision: number;
};

export type AssignmentDefinition = {
  preset: string;
  preset_revision: number;
  scope: AssignmentScope;
  outputs: { document: string; content: string }[];
  read_apps: string[];
  read_commands: ReadCommand[];
  schedule: Schedule | null;
};

export type ScopeOutput = Assignment["scope"];

function scopeOf(row: AssignmentRow): AssignmentScope {
  if (row.scope_kind === "all") return { kind: "all", id: null };
  if (row.scope_kind === "project") {
    return { kind: "project", id: row.scope_id ?? "" };
  }
  return { kind: "app", id: row.scope_id ?? "" };
}

function runsOf(row: AssignmentRow): string[] {
  if (row.pause_runs === null) return [];
  try {
    const parsed = JSON.parse(row.pause_runs) as unknown;
    return Array.isArray(parsed) ? parsed.map((run) => String(run)) : [];
  } catch {
    return [];
  }
}

// pause_runs은 과거 판에 보존한 실패 근거다. 빈 목록은 run이 없는 머신 근거다.
export function pauseReasonOf(row: AssignmentRow): PauseReason | null {
  if (row.state !== "paused" || row.pause_reason_kind === null) return null;
  return {
    kind: row.pause_reason_kind as PauseReason["kind"],
    detail: row.pause_detail ?? "",
    runs: runsOf(row),
    target: row.pause_target ?? null,
  };
}

type Reason = z.infer<typeof pauseReasonSchema>;

export function recordOf(
  row: AssignmentRow,
  definition: AssignmentDefinition,
): Assignment {
  return {
    id: row.id,
    role: row.role as Assignment["role"],
    preset: definition.preset,
    preset_revision: definition.preset_revision,
    scope: scopeOf(row),
    state: row.state as Assignment["state"],
    pause_reason: pauseReasonOf(row),
    outputs: definition.outputs,
    read_apps: definition.read_apps,
    read_commands: definition.read_commands,
    schedule: definition.schedule,
    last_due_at: row.last_due_at,
    approval: row.approval,
    revision: row.revision,
  };
}

// done element의 정확한 삭제 근처 여부가 아니라 보관 여부만 본다.
export function pausedOf(row: AssignmentRow): boolean {
  return row.state === "paused";
}

export function withdrawnOf(row: AssignmentRow): boolean {
  return row.state === "withdrawn";
}

// Builtin Assignment(role=lophn·context_engineer)의 전역 중복만 제한한다(R2).
export function isBuiltin(role: string): boolean {
  return role === "lophn" || role === "context_engineer";
}

export function isAppEngineer(role: string): boolean {
  return role === "app_engineer";
}

export function isOperator(role: string): boolean {
  return role === "operator";
}

// operator만 schedule·outputs·read_apps·read_commands를 갖는다. 나머지는
// shape 검사가 이미 거른다. machine만 builtin·app_engineer를 만든다.
export function requireRole(
  ctx: RequestContext,
  kinds: readonly ("user" | "machine")[],
): boolean {
  const kind = parseActor(ctx.actor)?.kind;
  return kind === "user" || kind === "machine" ? kinds.includes(kind) : false;
}

// 남길 판단 항목과 승인 접수 read_apps·read_commands의 정확한 파싱은
// assignmentRecordShape에서 이미 검사한다. withdraw된 assignment도 과거
// outputs·앱 목록을 그대로 돌려준다(R16).

type BundleInput = {
  preset: string;
  preset_revision: number;
  scope: AssignmentScope;
  outputs: readonly { document: string; content: string }[];
  read_apps: readonly string[];
  read_commands: readonly ReadCommand[];
  schedule: Schedule;
  reason: string;
};

// 적용 묶음을 과거 판 blob에 남길 정의 파트로 좁힌다. reason은 decision 근거다.
export function bundleDefinition(
  bundle: OperatorApprovalBundle,
): AssignmentDefinition {
  return {
    preset: bundle.preset,
    preset_revision: bundle.preset_revision,
    scope: bundle.scope,
    outputs: bundle.outputs.map((output) => ({
      document: output.document,
      content: output.content,
    })),
    read_apps: [...bundle.read_apps],
    read_commands: bundle.read_commands.map((command) => ({
      app: command.app,
      command: command.command,
    })),
    schedule: bundle.schedule,
  };
}

export type { BundleInput };

// 실패 집계(R10, R11, 질문 Q17). 종료 event seq 순서로 정상 완료에서 끊고,
// 미시작·사람 중단 등은 세지도 지우지도 않는다.
export type EndedRun = {
  run: string;
  started: boolean;
  outcome: { kind: string; reason: string };
};

// 정상 완료와 Operator 무변화 완료에서 끊는다(R11). completed의 두 reason은
// answer_completed와 no_change뿐이다.
export function clearsBundle(outcome: EndedRun["outcome"]): boolean {
  return outcome.kind === "completed" &&
    RUN_OUTCOME_REASONS.completed.includes(
      outcome.reason as (typeof RUN_OUTCOME_REASONS)["completed"][number],
    );
}

export function countsFailure(run: EndedRun): boolean {
  return run.started && run.outcome.kind === "failed";
}

// 가장 최근 AssignmentResumed(처음엔 AssignmentCreated) seq 이후의 종료 결과를
// 종료 seq 순으로 거친다. 시작한 뒤 확인된 종료 없이 failed로 끝난 run은 실패로
// 세고, 시작 전에 끝난 run은 세지 않는다(Q17). 실패 3개가 모이면 그 run 3개다.
export function newFailureBundle(
  runs: readonly EndedRun[],
): string[] | null {
  const bundle: string[] = [];
  for (const run of runs) {
    if (clearsBundle(run.outcome)) {
      bundle.length = 0;
      continue;
    }
    if (countsFailure(run)) bundle.push(run.run);
    if (bundle.length === 3) return bundle;
  }
  return null;
}
