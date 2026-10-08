// lophn의 앱 기획 문서 검사(roles/lophn#R6, R9, R10). 순수 함수다(plan.ts의
// 프로젝트 기획 검사와 같은 모양). 앱 기획은 기존 앱 변경 → 문서로 남기기 →
// 기존 SDK 활용 → 새 앱 순서로 대조하며(R6) SDK 후보는 그 앱이 이미 쓰는 재료,
// 개인 SDK, lophn SDK, 새 코드 순으로 고른다(R9). 기획 문서는 위험을 첫 줄에
// 놓고(무엇 200자·왜 500자·버린 세 방안·재사용·새로 만들 것·근거 주소)를 쓰되
// acceptance check은 쓰지 않는다(R10) — 이 검사는 계약이다: prompt 글의 요구
// (lophn.md 표)를 선택·저장 전에 한 번 더 본다.

// 앱 기획 순서의 방안이다(R6).
export const APP_PLAN_OPTIONS = [
  "change_existing_app",
  "leave_as_documents",
  "reuse_existing_sdk",
  "new_app",
] as const;
export type AppPlanOption = (typeof APP_PLAN_OPTIONS)[number];

export const APP_PLAN_OPTION_WORDS: Record<AppPlanOption, string> = {
  change_existing_app: "an existing app changes to cover this work",
  leave_as_documents: "documents keep this work instead of an app",
  reuse_existing_sdk: "an existing SDK holds this work",
  new_app: "a new app holds this work",
};

// 앱 기획의 SDK 후보다(R9). 순서는 그 앱이 이미 쓰는 재료, 개인 SDK, lophn SDK,
// 새 코드다. 확인한 version·입력·출력·접근 조건과 확인이 필요한 조건을 구별한다.
export type SdkCandidate = {
  // R9 순서이다.
  kind: "app_material" | "personal_sdk" | "lophn_sdk" | "new_code";
  // 대상의 주소다. new_code는 없다.
  address: string | null;
  // 계약을 읽고 확인한 version이다. 확인하지 못했으면 null이다.
  version: string | null;
  // 계약에서 확인한 입력·출력·접근 조건이다.
  inputs: string;
  outputs: string;
  access: string;
  // 계약 일부가 없어 확정이 아닌 조건이다(R9: 확인 필요).
  unchecked: string[];
};

// SDK 후보의 상한 순서다(R9).
export const SDK_CANDIDATE_ORDER: readonly SdkCandidate["kind"][] = [
  "app_material",
  "personal_sdk",
  "lophn_sdk",
  "new_code",
];

// 기획에 두는 자료 근거다(plan.ts와 같다). 주소는 ……기준이고 version은 고정한 판이다.
export type AppPlanMaterial = {
  address: string;
  version: string | null;
  reason: string;
};

// 앱 기획 한 건이 가진 내용이다(R6, R9, R10).
export type AppPlanDraft = {
  // 위험이 첫 줄이다(R10).
  risks: string[];
  // 무엇 200자 이하(R10).
  what: string;
  // 왜 500자 이하(R10).
  why: string;
  // 앞선 세 방안을 버린 이유다(R6, R10). new_app은 앞선 셋을 버려야 하고
  // 앞선 방안이 맞으면 뒤를 추천하지 않는다(R6).
  chosen: AppPlanOption;
  rejected: { option: AppPlanOption; reason: string }[];
  // 재사용할 것이다(R10). 없으면 없음이라고 적는다.
  reuse: string;
  // 새로 만들 것이다(R10). 없으면 없음이라고 적는다.
  build: string;
  // SDK 후보다(R9).
  sdk_candidates: SdkCandidate[];
  // 위험과 각 주장의 근거 주소 또는 근거 없음이다(R10).
  materials: AppPlanMaterial[];
  // acceptance check은 쓰지 않는다(R10).
  acceptance_checks: string[];
};

// 기존 앱 목록·SDK 안내를 읽기 전에는 맞는 재료가 없다고 결론 내리지 않는다(R6).
// 이 입력은 읽은 앱·SDK 자리다. 아무것도 읽지 않았으면 기획 검사는 fail이다.
export type AppPlanReads = {
  // 읽은 앱 목록의 주소다(app.list 계약). 안 읽었으면 빈 목록이다.
  apps: readonly string[];
  // 읽은 SDK 안내의 주소다(sdk.list·sdk.contract 계약).
  sdk_guides: readonly string[];
};

// 읽기 전 "재료 없음" 결론을 차단하는지 본다(R6). 앱 목록·SDK 안내를 하나도
// 읽지 않았으면 새 앱 결론은 근거가 없다.
export function readsBeforeConclusion(reads: AppPlanReads): boolean {
  return reads.apps.length > 0 && reads.sdk_guides.length > 0;
}

export type AppPlanCheckError =
  | { code: "risk_first" }
  | { code: "what_over_200" }
  | { code: "what_blank" }
  | { code: "why_over_500" }
  | { code: "why_blank" }
  | { code: "rejected_missing"; option: AppPlanOption }
  | { code: "rejected_reason_blank"; option: AppPlanOption }
  | { code: "reuse_absent" }
  | { code: "build_absent" }
  | { code: "sdk_order"; order: string }
  | { code: "sdk_unchecked_confirmed" }
  | { code: "materials_empty" }
  | { code: "material_blank_reason" }
  | { code: "material_no_basis" }
  | { code: "acceptance_check_present" }
  | { code: "conclusion_before_reads" };

// 무엇·왜의 글자 상한이다(R10).
export const APP_PLAN_TEXT_LIMITS = {
  what: 200,
  why: 500,
} as const;

// 새 앱 기획이 등록·채택 질문 뒤 App Engineer assignment로 이어지는 근거다(R12).
export type NewAppHandoff = {
  // 등록 질문 참조다(apps/registration의 질문). 등록 전에는 없다.
  registration_question: string | null;
  // 채택 질문 참조다(apps/registration 채택 경로).
  adoption_question: string | null;
  // 준비된 App Engineer assignment다. 담당이 없으면 null이다(R12).
  assignment: string | null;
};

// 준비된 assignment에 채택 근거를 전달할 수 있는지 본다(R12). 등록·채택 질문을
// 거치지 않았거나 담당이 없으면 handoff 준비가 안 된 것이다.
export function newAppHandoffReady(handoff: NewAppHandoff): boolean {
  return handoff.registration_question !== null &&
    handoff.adoption_question !== null &&
    handoff.assignment !== null;
}

// 담당이 없을 때 적는 문장이다(R12: 담당이 없으면 handoff 준비가 안 됐다고 설명한다).
export const NO_ASSIGNMENT_WORD =
  "no App Engineer was assigned, so the handoff is not prepared yet";

// 앱 기획을 검사한다(R6, R9, R10). 위험이 첫 줄이고 무엇·왜가 상한 안이며
// 앞선 방안마다 이유가 있고 SDK 후보가 R9 순서이며 근거 주소가 있고 acceptance
// check이 없어야 통과다. 읽기 전 결론은 차단한다(R6).
export function checkAppPlan(
  draft: AppPlanDraft,
  reads: AppPlanReads,
): { ok: true } | { ok: false; error: AppPlanCheckError } {
  // 읽기 전 "재료 없음" 결론은 차단한다(R6).
  if (!readsBeforeConclusion(reads) && draft.chosen === "new_app") {
    return { ok: false, error: { code: "conclusion_before_reads" } };
  }
  // 위험은 첫 줄이다(R10: 위험을 첫 줄에 놓는다). 내용이 비면 위험이 아니다.
  if (
    draft.risks.length === 0 || draft.risks.some((risk) => risk.trim() === "")
  ) {
    return { ok: false, error: { code: "risk_first" } };
  }
  // 무엇 200자(R10).
  if (draft.what.trim() === "") {
    return { ok: false, error: { code: "what_blank" } };
  }
  if (draft.what.length > APP_PLAN_TEXT_LIMITS.what) {
    return { ok: false, error: { code: "what_over_200" } };
  }
  // 왜 500자(R10).
  if (draft.why.trim() === "") {
    return { ok: false, error: { code: "why_blank" } };
  }
  if (draft.why.length > APP_PLAN_TEXT_LIMITS.why) {
    return { ok: false, error: { code: "why_over_500" } };
  }
  // 앞선 방안의 이유다(R6, R10). 선택이 몇 번째든 그 앞의 방안은 버렸어야 하고
  // 몰랐던 방안을 버렸다고 남기지 않는다.
  const chosenIndex = APP_PLAN_OPTIONS.indexOf(draft.chosen);
  const expected = APP_PLAN_OPTIONS.slice(0, chosenIndex);
  const rejectedOptions = draft.rejected.map((rejected) => rejected.option);
  for (const option of expected) {
    if (!rejectedOptions.includes(option)) {
      return { ok: false, error: { code: "rejected_missing", option } };
    }
  }
  if (rejectedOptions.some((option) => !expected.includes(option))) {
    return {
      ok: false,
      error: { code: "rejected_missing", option: draft.chosen },
    };
  }
  for (const rejected of draft.rejected) {
    if (rejected.reason.trim() === "") {
      return {
        ok: false,
        error: { code: "rejected_reason_blank", option: rejected.option },
      };
    }
  }
  // 재사용할 것과 새로 만들 것은 없으면 없음으로 남는다(R10).
  if (draft.reuse.trim() === "") {
    return { ok: false, error: { code: "reuse_absent" } };
  }
  if (draft.build.trim() === "") {
    return { ok: false, error: { code: "build_absent" } };
  }
  // SDK 후보는 R9 순서대로 둔다. 미확인 조건을 확정으로 적지 않는다(R9).
  const kinds = draft.sdk_candidates.map((candidate) => candidate.kind);
  for (let i = 1; i < kinds.length; i++) {
    const before = SDK_CANDIDATE_ORDER.indexOf(kinds[i - 1]!);
    const after = SDK_CANDIDATE_ORDER.indexOf(kinds[i]!);
    if (before > after) {
      return {
        ok: false,
        error: { code: "sdk_order", order: kinds.join(",") },
      };
    }
    if (before === after) {
      return {
        ok: false,
        error: { code: "sdk_order", order: kinds.join(",") },
      };
    }
  }
  for (const candidate of draft.sdk_candidates) {
    // 계약을 읽지 못한 조건은 확정이 아니라 확인 필요로 남는다(R9).
    if (
      candidate.unchecked.length > 0 &&
      (candidate.inputs.trim() === "" && candidate.outputs.trim() === "" &&
        candidate.access.trim() === "")
    ) {
      return { ok: false, error: { code: "sdk_unchecked_confirmed" } };
    }
  }
  // 위험과 각 주장의 근거 주소다(R10). 자료가 없으면 근거가 없다.
  if (draft.materials.length === 0) {
    return { ok: false, error: { code: "materials_empty" } };
  }
  if (draft.materials.some((material) => material.reason.trim() === "")) {
    return { ok: false, error: { code: "material_blank_reason" } };
  }
  // acceptance check은 쓰지 않는다(R10: 상세 설계 인터뷰와 구별한다).
  if (draft.acceptance_checks.length > 0) {
    return { ok: false, error: { code: "acceptance_check_present" } };
  }
  return { ok: true };
}

// 기존 앱 목록·SDK 안내를 읽지 않은 run이 "맞는 재료가 없다"고 결론 내리지
// 못하게 본다(R6). fake provider script가 같은 입력으로 두 번 읽는지 본다.
export function materialsEmpty(
  reads: AppPlanReads,
): boolean {
  return reads.apps.length === 0 && reads.sdk_guides.length === 0;
}

// 앱 기획의 선택과 버린 방안을 요청 범위 기획 문서로 남기는 본문이다
// (roles/lophn#R10, plan.ts의 프로젝트 기획 문서와 같은 모양). 위험이 첫 줄이고
// acceptance check 자리는 없다(R10).
export function appPlanDocumentBody(draft: AppPlanDraft): string {
  const rejected = draft.rejected.length === 0
    ? "None: no earlier option was rejected."
    : draft.rejected.map((entry) =>
      `- ${
        APP_PLAN_OPTION_WORDS[entry.option]
      }: rejected because ${entry.reason}`
    ).join("\n");
  const risks = draft.risks.map((risk) => `- ${risk}`).join("\n");
  const sdk = draft.sdk_candidates.length === 0
    ? "None."
    : draft.sdk_candidates.map((candidate) =>
      `- ${candidate.kind}${
        candidate.address === null ? "" : ` at ${candidate.address}`
      }${
        candidate.version === null ? "" : ` version ${candidate.version}`
      }: inputs ${candidate.inputs}, outputs ${candidate.outputs}, access ${candidate.access}${
        candidate.unchecked.length === 0
          ? ""
          : `, needs confirmation: ${candidate.unchecked.join(", ")}`
      }`
    ).join("\n");
  const materials = draft.materials.map((material) =>
    `- ${material.address}${
      material.version === null ? "" : ` at ${material.version}`
    }: ${material.reason}`
  ).join("\n");
  return [
    `# App plan`,
    ``,
    `## Risks`,
    ``,
    risks,
    ``,
    `## What`,
    ``,
    draft.what,
    ``,
    `## Why`,
    ``,
    draft.why,
    ``,
    `## Rejected options`,
    ``,
    rejected,
    ``,
    `## Reuse and new build`,
    ``,
    `Reuse: ${draft.reuse}`,
    `New build: ${draft.build}`,
    ``,
    `## SDK candidates`,
    ``,
    sdk,
    ``,
    `## Basis`,
    ``,
    materials,
    ``,
  ].join("\n");
}
