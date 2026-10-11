import { assert, assertEquals } from "@std/assert";
import {
  checkDraft,
  type DraftOverlap,
  evidenceEnough,
  MANUAL_RUNS_MIN,
  type OperatorDraft,
  overlapOf,
  overlapRevision,
} from "./mod.ts";
import { productPresetDefinition } from "../../presets/mod.ts";

// roles/context-engineer의 Operator 제안(순수 규칙 R17–R19)을 본다. 근거 게이트는
// 후보 근거가 요구 횟수·기간을 넘을 때만 제안으로 가고, 초안은 판단 항목 전부와
// 기존 남길 문서 최소 1개를 담으며, 겹치는 Operator는 기존 판·남길 문서 변경 제안과
// 겹침 근거로 간다. 실제 provider·사람 데이터 root는 열지 않는다(모두 순수 함수다).

const HASH = "a".repeat(64);
const DOC_A = "doc_01arz3ndektsv4rrffq69g5fa1";
const DOC_B = "doc_01arz3ndektsv4rrffq69g5fa2";
const PROJECT = "prj_01arz3ndektsv4rrffq69g5fa1";
const APP = "app_01arz3ndektsv4rrffq69g5fa1";
const CTX_A = "ctx_01arz3ndektsv4rrffq69g5fa1";
const CTX_OTHER = "ctx_01arz3ndektsv4rrffq69g5fa2";
// 초안의 project에 있는 context다.
const CONTEXTS: ReadonlySet<string> = new Set([CTX_A]);
const ASG_EXISTING = "asg_01arz3ndektsv4rrffq69g5fa1";

function draft(over: Partial<OperatorDraft> = {}): OperatorDraft {
  return {
    judgment: {
      judgment: "수동으로 반복하던 project 인덱스 갱신을 맡는다",
      excludes: ["프로젝트 관리", "역할 변경"],
      evidence_rule: "확인한 사실·판단·불확실함을 구분해 남긴다",
      comparison_basis: "지난 회차의 기준 자료와 비교한다",
      update_condition: "기준을 넘을 때만 새 version을 남긴다",
    },
    scope: { kind: "project", id: PROJECT },
    preset: productPresetDefinition("context_engineer", HASH),
    outputs: [{ document: DOC_A, content: "주간 변화 요약" }],
    schedule: { first_at: "2026-02-01T00:00:00.000Z", every_ms: 3_600_000 },
    read_apps: [],
    read_commands: [],
    before: null,
    after: "수동 갱신이 반복된다",
    reason: "같은 수동 업무가 30일 안에 4회 넘게 반복된다",
    ...over,
  };
}

function draftScope(
  kind: "project" | "app",
  id: string,
): DraftOverlap["scope"] {
  return kind === "project" ? { kind: "project", id } : { kind: "app", id };
}

Deno.test("lophn-agent/roles/context-engineer#R17 [ctx-I58d]: 같은 수동 업무가 요구 횟수를 넘을 때만 제안으로 간다", () => {
  assert(evidenceEnough({ manual_runs_30d: MANUAL_RUNS_MIN }));
  // 요구에 못 미치면 단순 합계·수집만 있는 일이라 제안하지 않는다.
  assertEquals(
    evidenceEnough({ manual_runs_30d: MANUAL_RUNS_MIN - 1 }),
    false,
  );
});

Deno.test("lophn-agent/roles/context-engineer#R18 [ctx-I58d]: 초안은 판단 항목 전부와 기존 남길 문서 최소 1개를 담는다", () => {
  // 판단 항목이 다 있으면 통과한다(R18).
  const versions = new Map([
    [DOC_A, 1],
    [DOC_B, 3],
  ]);
  const checked = checkDraft(draft(), versions, CONTEXTS);
  assert(checked.ok, JSON.stringify(checked.problems));
  // 판단 항목이 비면 거절된다(R18).
  for (
    const field of [
      "judgment",
      "evidence_rule",
      "comparison_basis",
      "update_condition",
    ] as const
  ) {
    const blanked = draft({
      judgment: { ...draft().judgment, [field]: " " },
    });
    const result = checkDraft(blanked, versions, CONTEXTS);
    assertEquals(result.ok, false, field);
  }
  // 기존 남길 문서가 없으면 거절된다(R18, assignments#R6).
  const no_outputs = checkDraft(draft({ outputs: [] }), versions, CONTEXTS);
  assertEquals(no_outputs.ok, false);
  // 첫 version이 없는 문서는 남길 문서가 아니다(R18, assignments#R6).
  const no_first = checkDraft(
    draft({ outputs: [{ document: DOC_B, content: "x" }] }),
    versions,
    CONTEXTS,
  );
  assert(no_first.ok, JSON.stringify(no_first.problems));
  const no_version = checkDraft(
    draft({ outputs: [{ document: DOC_A, content: "x" }] }),
    new Map([[DOC_A, undefined]]),
    CONTEXTS,
  );
  assertEquals(no_version.ok, false);
});

Deno.test("lophn-agent/roles/context-engineer#R18 [ctx-I58d]: preset이 고르는 context는 그 project에 있는 context여야 한다", () => {
  const versions = new Map([[DOC_A, 1]]);
  const base = productPresetDefinition("context_engineer", HASH);
  const picking = (target: string) =>
    draft({
      preset: {
        ...base,
        context: [{ kind: "context", target, section: null }],
      },
    });
  const inside = checkDraft(picking(CTX_A), versions, CONTEXTS);
  assert(inside.ok, JSON.stringify(inside.problems));
  // 다른 project의 context나 없는 context를 고르면 거절된다.
  const outside = checkDraft(picking(CTX_OTHER), versions, CONTEXTS);
  assertEquals(outside.ok, false);
  assert(outside.problems.some((problem) => problem.includes(CTX_OTHER)));
  // 풀이 선택(all)은 실행 때 active context로 풀리므로 여기서 거르지 않는다.
  assert(checkDraft(draft(), versions, new Set()).ok);
});

Deno.test("lophn-agent/roles/context-engineer#R18 [ctx-I58d]: 읽을 자료는 승인 앱 안에서만 선언된다", () => {
  const versions = new Map([[DOC_A, 1]]);
  // 읽을 명령의 앱이 승인 read 앱 목록에 있으면 통과한다(R18).
  const with_command = checkDraft(
    draft({
      read_apps: [APP],
      read_commands: [{ app: APP, command: "usage.read" }],
    }),
    versions,
    CONTEXTS,
  );
  assert(with_command.ok, JSON.stringify(with_command.problems));
  // 승인 앱 목록에 없는 명령은 거절된다(R18, assignments#R8).
  const outside = checkDraft(
    draft({
      read_apps: [],
      read_commands: [{ app: APP, command: "usage.read" }],
    }),
    versions,
    CONTEXTS,
  );
  assertEquals(outside.ok, false);
});

Deno.test("lophn-agent/roles/context-engineer#R19 [ctx-I58d]: 겹치는 Operator는 기존 판·남길 문서 변경 제안과 겹침 근거로 간다", () => {
  const samples = draft();
  // 같은 scope의 Operator가 없으면 새 assignment 제안이다(R13).
  const no_overlap = overlapOf(samples, []);
  assertEquals(no_overlap, undefined);
  // 같은 project의 Operator가 있으면 겹침이다(R13).
  const existing: DraftOverlap = {
    assignment: ASG_EXISTING,
    scope: draftScope("project", PROJECT),
    preset: "pst_01arz3ndektsv4rrffq69g5fa1",
    outputs: [DOC_A],
    shared_outputs: [DOC_A],
  };
  const overlap = overlapOf(samples, [existing]);
  assert(overlap !== undefined);
  assertEquals(overlap.assignment, ASG_EXISTING);
  // 겹침 근거가 reason에 남는다(R13).
  const revision = overlapRevision({
    draft: samples,
    overlap,
    overlapping_reason: "같은 project의 Operator가 이미 있다",
  });
  assert(revision.reason.includes("같은 project의 Operator가 이미 있다"));
  assert(revision.reason.includes(DOC_A));
  // 다른 scope는 겹치지 않는다(R13).
  const other_project = overlapOf(
    draft({ scope: { kind: "project", id: "prj_01arz3ndektsv4rrffq69g5fa2" } }),
    [existing],
  );
  assertEquals(other_project, undefined);
});
