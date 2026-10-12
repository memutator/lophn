import type { PlaceRef } from "@lophn/protocol/projects";

// lophn의 프로젝트 기획 문서 검사(roles/lophn#R7, R8). 순수 함수다. 기획은 기존
// 프로젝트 목적 안에 두기 → 기존 context의 경계 넓히기 → 새 프로젝트 순서로
// 판단하며 앞선 방안이 맞으면 새 프로젝트를 추천하지 않는다(R7). 경계 넓히기는 lophn이 context를
// 고치는 것이 아니라 Context Engineer가 계약의 Source를 바꿔 달라는 handoff다: 이 방안을 고르면
// 내줄 것에 context_engineer가 있어야 한다(R7, R13). 기획 문서는 다섯
// 내용(목적 한 문장, 앞선 두 방안을 버린 이유, 둘 자료와 자리 후보, 연결할
// 컨텍스트와 목적, 다른 프로젝트·앱에 내줄 것 또는 없음)을 모두 적는다(R8) — 이
// 검사는 글자 모양이 아니라 계약이다: prompt 글의 요구(lophn.md 표)를 선택·저장
// 전에 한 번 더 본다.

// 프로젝트 기획 순서의 방안이다(R7).
export const PLAN_OPTIONS = [
  "within_existing_project",
  "widen_context_boundary",
  "new_project",
] as const;
export type PlanOption = (typeof PLAN_OPTIONS)[number];

export const PLAN_OPTION_WORDS: Record<PlanOption, string> = {
  within_existing_project: "an existing project holds this work",
  widen_context_boundary:
    "Context Engineer widens an existing context's sources to cover this work",
  new_project: "a new project holds this work",
};

// 기획에 두는 자료·자리 근거다. 주소는 ……기준이고 version은 고정한 판이다.
export type PlanMaterial = {
  // 자료 주소(문서·context·앱의 정본 주소).
  address: string;
  version: string | null;
  // 이 자료를 고른 이유 한 줄.
  reason: string;
};

// 기획 한 건이 가진 다섯 내용(R8)이다.
export type PlanDraft = {
  // 목적 한 문장.
  purpose: string;
  // 선택한 방안.
  chosen: PlanOption;
  // 앞선 두 방안을 버린 이유다(R7). 선택이 세 번째면 둘 다, 두 번째면 첫 것만,
  // 첫 번째면 없다(R7: 앞선 방안이 맞으면 뒤를 추천하지 않는다).
  rejected: { option: PlanOption; reason: string }[];
  // 둘 자료와 자리 후보다(R8). 자료 주소와 version이 근거다.
  materials: PlanMaterial[];
  place_candidates: {
    place: PlaceRef | null;
    name: string;
    reason: string;
  }[];
  // 연결할 컨텍스트와 목적이다(R8). 없으면 연결할 것이 없다고 적는다.
  contexts: { context: string; purpose: string }[];
  // 다른 프로젝트·앱에 내줄 것이다(R8). 없으면 없음이라고 적는다.
  handoffs: { role: string; what: string }[];
};

// 경계 넓히기 변경을 맡는 handoff 수신 역할이다(R7, R13).
export const CONTEXT_ENGINEER_ROLE = "context_engineer";

// 내줄 것이 없을 때 적는 문장이다(R8: 내줄 것이 없으면 없음이라고 적는다).
export const NO_HANDOFF_WORD = "없음";

export type PlanCheckError =
  | { code: "purpose_not_one_sentence" }
  | { code: "purpose_blank" }
  | { code: "rejected_missing"; option: PlanOption }
  | { code: "rejected_reason_blank"; option: PlanOption }
  | { code: "materials_empty" }
  | { code: "material_blank_reason" }
  | { code: "place_candidates_empty" }
  | { code: "contexts_empty" }
  | { code: "context_blank_purpose" }
  | { code: "handoffs_missing_none_word" }
  | { code: "context_engineer_handoff_missing" };

// 목적이 한 문장인지. 마침표·물음표·느낌표로 끝나는 사람이 쓴 한 문장이다.
// 줄바꿈이 있거나 문장을 이루지 않으면 아니다.
export function oneSentence(purpose: string): boolean {
  const text = purpose.trim();
  if (text === "" || /[\r\n]/.test(text) || /\s\s/.test(text)) return false;
  return /^[^.!?。？！]*[.!?。？！]$/.test(text);
}

// 기획을 검사한다. 다섯 내용이 모두 있어 통과다(R8). 내줄 것이 없으면 문장으로
// 남아 있어야 하고(R8), 버린 방안은 앞선 방안(R7 순서에서 선택 전의 방안)마다
// 이유가 필요하다.
export function checkPlan(
  draft: PlanDraft,
): { ok: true } | { ok: false; error: PlanCheckError } {
  if (draft.purpose.trim() === "") {
    return { ok: false, error: { code: "purpose_blank" } };
  }
  if (!oneSentence(draft.purpose)) {
    return { ok: false, error: { code: "purpose_not_one_sentence" } };
  }
  if (!PLAN_OPTIONS.includes(draft.chosen)) {
    return {
      ok: false,
      error: { code: "rejected_missing", option: draft.chosen },
    };
  }
  const chosenIndex = PLAN_OPTIONS.indexOf(draft.chosen);
  const expected = PLAN_OPTIONS.slice(0, chosenIndex);
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
  if (draft.materials.length === 0) {
    return { ok: false, error: { code: "materials_empty" } };
  }
  if (draft.materials.some((material) => material.reason.trim() === "")) {
    return { ok: false, error: { code: "material_blank_reason" } };
  }
  if (draft.place_candidates.length === 0) {
    return { ok: false, error: { code: "place_candidates_empty" } };
  }
  if (draft.contexts.length === 0) {
    return { ok: false, error: { code: "contexts_empty" } };
  }
  if (draft.contexts.some((context) => context.purpose.trim() === "")) {
    return { ok: false, error: { code: "context_blank_purpose" } };
  }
  if (
    draft.handoffs.length === 0 ||
    draft.handoffs.some((entry) =>
      entry.role.trim() === "" || entry.what.trim() === ""
    )
  ) {
    return { ok: false, error: { code: "handoffs_missing_none_word" } };
  }
  if (
    draft.chosen === "widen_context_boundary" &&
    !draft.handoffs.some((entry) => entry.role === CONTEXT_ENGINEER_ROLE)
  ) {
    return { ok: false, error: { code: "context_engineer_handoff_missing" } };
  }
  return { ok: true };
}

// 기획의 선택과 버린 방안을 요청 범위 기획 문서에 남기는 본문이다(roles/lophn#R11).
// 고정 자리·시리즈가 아니라 이 run의 요청 범위 문서다. 버린 방안은 R7 순서대로,
// 내줄 것은 없을 때 없음이라고 적는다(R8).
export function planDocumentBody(draft: PlanDraft): string {
  const rejected = draft.rejected.length === 0
    ? "None: no earlier option was rejected."
    : draft.rejected.map((entry) =>
      `- ${PLAN_OPTION_WORDS[entry.option]}: rejected because ${entry.reason}`
    ).join("\n");
  const materials = draft.materials.map((material) =>
    `- ${material.address}${
      material.version === null ? "" : ` at ${material.version}`
    }: ${material.reason}`
  ).join("\n");
  const places = draft.place_candidates.map((candidate) =>
    `- ${
      candidate.place === null ? "where it is" : JSON.stringify(candidate.place)
    } as ${candidate.name}: ${candidate.reason}`
  ).join("\n");
  const contexts = draft.contexts.map((context) =>
    `- ${context.context}: ${context.purpose}`
  ).join("\n");
  const handoffs = draft.handoffs.length === 0
    ? NO_HANDOFF_WORD
    : draft.handoffs.map((entry) => `- ${entry.role}: ${entry.what}`).join(
      "\n",
    );
  return [
    `# Plan`,
    ``,
    `Purpose: ${draft.purpose}`,
    ``,
    `## Chosen option`,
    ``,
    PLAN_OPTION_WORDS[draft.chosen],
    ``,
    `## Rejected options`,
    ``,
    rejected,
    ``,
    `## Materials and place candidates`,
    ``,
    materials,
    ``,
    places,
    ``,
    `## Contexts to connect`,
    ``,
    contexts,
    ``,
    `## Handoffs to other projects and apps`,
    ``,
    handoffs,
    ``,
  ].join("\n");
}
