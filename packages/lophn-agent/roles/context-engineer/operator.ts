import type {
  OperatorApprovalBundle,
  PresetDefinition,
} from "../../../contracts/lophn-agent/mod.ts";

// Operator 초안 제안(roles/context-engineer R17–R19). 순수 함수다: IO·시계·model 호출이
// 없다. 수동 업무 관측은 harness/tools 묶음의 몫이고, 이 모듈은
// 그 관측으로 제안할 판단의 모양만 정한다. 사람 결정은 승인으로 묻고 초안은 승인 전에
// 적용하지 않는다(P9): 승인 후의 실제 적용은 lophn-agent/assignments의 몫이다.

export type OperatorBundle = OperatorApprovalBundle;

// Operator 후보 근거(R17). 최근 30일 같은 수동 업무 횟수다.
export type OperatorEvidence = {
  manual_runs_30d: number;
};

export const MANUAL_RUNS_MIN = 4;
export const MANUAL_WINDOW_DAYS = 30;

// 후보 근거가 시작 충분한지 본다(R17). 수동 업무가 요구 횟수를 넘을 때만 시작한다.
// 단순 합계나 자료 수집만 있는 일은 제안하지 않는다: false는 제안 없음이다.
export function evidenceEnough(
  evidence: OperatorEvidence,
): boolean {
  return evidence.manual_runs_30d >= MANUAL_RUNS_MIN;
}

// 반복 판단의 설명 항목이다(R18). prompt에 판단·제외·필요 근거·비교 기준·갱신 조건을
// 모두 적는다(R18, roles/operator R1).
export type JudgmentTerms = {
  judgment: string;
  excludes: string[];
  evidence_rule: string;
  comparison_basis: string;
  update_condition: string;
};

// 초안 조립 항목이다(R18). scope는 project 또는 app 하나다.
export type DraftScope =
  | { kind: "project"; id: string }
  | { kind: "app"; id: string };

export type OperatorDraft = {
  judgment: JudgmentTerms;
  scope: DraftScope;
  // preset 전체 구성(고르는 실제 context·읽을 자료)이다(R18, presets#R15).
  preset: PresetDefinition;
  // 기존 남길 문서 최소 1개(실제 첫 version이 있는)다(R18, assignments#R6).
  outputs: { document: string; content: string }[];
  // 주기와 승인 앱 read다(R18, assignments#R8).
  schedule: { first_at: string; every_ms: number };
  read_apps: string[];
  read_commands: { app: string; command: string }[];
  // 전후 판과 이유다(R18, presets#R15). 사람이 검토할 수 있게 남긴다.
  before: string | null;
  after: string;
  reason: string;
};

export const DRAFT_OUTPUT_MIN = 1;

// 초안을 검사한다(R18). 판단 항목이 다 있고, 범위는 project 또는 app 하나,
// 남길 문서는 최소 DRAFT_OUTPUT_MIN개, 고르는 context는 그 project에 있는 context,
// 읽을 자료는 승인 앱 안에 있는지 본다.
export function checkDraft(
  draft: OperatorDraft,
  documentVersions: ReadonlyMap<string, number | undefined>,
  // 초안의 project에 있는 context의 ID다. preset이 고르는 context가 여기 없으면 거절한다.
  projectContexts: ReadonlySet<string>,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const terms = draft.judgment;
  if (terms.judgment.trim() === "") problems.push("judgment missing");
  if (terms.evidence_rule.trim() === "") problems.push("evidence rule missing");
  if (terms.comparison_basis.trim() === "") {
    problems.push("comparison basis missing");
  }
  if (terms.update_condition.trim() === "") {
    problems.push("update condition missing");
  }
  for (const excluded of terms.excludes) {
    if (excluded.trim() === "") problems.push("blank excluded item");
  }
  if (draft.outputs.length < DRAFT_OUTPUT_MIN) {
    problems.push("no existing output document declared");
  }
  for (const output of draft.outputs) {
    const first = documentVersions.get(output.document);
    // 기존 남길 문서는 실제 첫 version이 있어야 한다(R18, assignments#R6).
    if (first === undefined || first < 1) {
      problems.push(`document without a first version: ${output.document}`);
    }
  }
  for (const selection of draft.preset.context) {
    if (selection.kind !== "context") continue;
    if (selection.target === null || !projectContexts.has(selection.target)) {
      problems.push(`context not in the project: ${selection.target}`);
    }
  }
  const commandApps = new Set(
    draft.read_commands.map((command) => command.app),
  );
  for (const app of commandApps) {
    if (!draft.read_apps.includes(app)) {
      problems.push(`read command without an approval read app: ${app}`);
    }
  }
  if (draft.schedule.every_ms <= 0) problems.push("nonpositive schedule");
  return { ok: problems.length === 0, problems };
}

// 겹침이다(R19). 같은 project 또는 app에 책임이 겹치는 Operator를 비교한다.
export type DraftOverlap = {
  assignment: string;
  scope: DraftScope;
  // 기존 preset 판이다. 같은 preset ID다.
  preset: string;
  outputs: readonly string[];
  // 겹친 남길 문서다.
  shared_outputs: string[];
};

// 겹치는 Operator가 있으면 새 assignment를 늘리지 않고 기존 preset 판·남길 문서
// 변경을 제안한다(R19). 겹침 근거는 초안 reason에 남긴다.
export function overlapOf(
  draft: OperatorDraft,
  existing: readonly DraftOverlap[],
): DraftOverlap | undefined {
  for (const candidate of existing) {
    if (candidate.scope.kind !== draft.scope.kind) continue;
    if (candidate.scope.id !== draft.scope.id) continue;
    return candidate;
  }
  return undefined;
}

// 겹침 제안이다(R19). 기존 Operator의 assignment id와 겹친 근거를 붙인다.
export function overlapRevision(input: {
  draft: OperatorDraft;
  overlap: DraftOverlap;
  overlapping_reason: string;
}): OperatorDraft {
  const shared = input.overlap.shared_outputs.length > 0
    ? ` 겹치는 남길 문서: ${input.overlap.shared_outputs.join(", ")}.`
    : " 같은 범위의 Operator가 이미 있다.";
  return {
    ...input.draft,
    // 겹침 근거는 사람이 검토할 수 있게 reason에 남긴다(R19).
    reason: input.overlapping_reason.trim() === ""
      ? input.draft.reason
      : `${input.draft.reason} ${input.overlapping_reason.trim()}${shared}`,
  };
}
