import type {
  FixedVersionReference,
  HandoffContent,
  HandoffReference,
  QuestionOption,
} from "@lophn/contracts/lophn-agent";

// Context Engineer 역할의 충돌 handoff·해석 질문·보류(roles/context-engineer R10, R12, R20).
// 순수 함수다: IO·시계·model 호출이 없다. 읽기·검색·contract 호출은 harness/tools
// 묶음의 몫이고, 이 모듈은 그 결과로 조립할 판단의 모양만 정한다. 사람 결정은
// Question으로 묻고 답이 없으면 적용하지 않는다(R10).

// handoff 근거 주소 상한이다. 소유 contract의 근거 한계와 같은 값이다.
export const EVIDENCE_LIMIT = 5;

// 한 용어의 출현 주소다. 실제 본문을 읽은 고정 판만 근거가 된다. 주소는 section
// 또는 줄 범위로 좁힌다(소유 contract의 agent 근거 규약).
export type Occurrence = {
  document: string;
  version: string;
  section: string | null;
  start_line: number | null;
  end_line: number | null;
};

// 대응 후보와 충돌이다(R12). 같은 뜻의 다른 말(corresponds)과 같은 말의 다른 뜻
// (conflicts)은 보고에서 구별한다.
export type TermRelation = {
  name: string;
  other: string;
  relation: "corresponds" | "conflicts";
};

// 용어 해석 질문 초안이다(R10). 선택지의 action은 항상 null이다: 고정 action은
// 사람이 열람한 owner 동작을 고정하는 별도 경로(lophn-agent#T29)의 몫이다.
export function interpretationQuestion(input: {
  name: string;
  other: string;
  // 어느 말의 어떤 뜻을 묻는지 관점이다.
  question: string;
  evidence: readonly FixedVersionReference[];
}): {
  question: string;
  options: QuestionOption[];
  recommendation: { option_key: string; explanation: string } | null;
} {
  const options: QuestionOption[] = [
    {
      key: "keep-first",
      label: `"${input.name}"으로 정한다`,
      description:
        `"${input.name}"을 "${input.other}"와 같은 뜻으로 쓴다. 답을 정의로 적용한다.`,
      evidence: [...input.evidence],
      adoption: null,
      // action은 모델이 싣지 않는다.
      action: null,
    },
    {
      key: "keep-second",
      label: `"${input.other}"으로 정한다`,
      description: `"${input.other}"을 올바른 말로 쓴다. 답을 정의로 적용한다.`,
      evidence: [...input.evidence],
      adoption: null,
      action: null,
    },
    {
      key: "undecided",
      label: "아직 정하지 않는다",
      description: "정의를 적용하지 않고 후보로 남긴다.",
      evidence: [],
      adoption: null,
      action: null,
    },
  ];
  return {
    question: input.question,
    options,
    recommendation: null,
  };
}

// 용어 충돌을 lophn에 넘기는 handoff 초안이다(R12). 충돌의 기획 판단은 lophn의
// 몫이다. 근거·질문은 lophn-agent/handoff의 고정 근거 모양으로 옮긴다.
export function conflictHandoff(input: {
  name: string;
  other: string;
  context: string;
  evidence: readonly Occurrence[];
  question: string;
}): {
  to_role: "lophn";
  content: HandoffContent;
  references: HandoffReference[];
} {
  return {
    to_role: "lophn",
    content: {
      what: `"${input.name}"과 "${input.other}"의 뜻이 달라 결정이 필요하다.`,
      why:
        `컨텍스트 ${input.context}: 같은 말이 컨텍스트 사이 다른 뜻을 가진다.`,
      // 사람 뜻 없이 합치지 않는다(R12).
      excludes: ["정의 자동 적용", "용어 자동 병합"],
      expected_outputs: [input.question],
    },
    references: input.evidence.slice(0, EVIDENCE_LIMIT).map((
      place,
    ) => ({
      document: place.document,
      version: place.version,
      section: place.section,
      question: null,
    })),
  };
}

// 보류(R10). 답이 없으면 관련 변경을 보류하고 보고에 남긴다. 미답 내용은
// 정의로 적용하지 않는다.
export type HoldRecord = {
  name: string;
  reason: "no_answer";
  question: string;
  held_changes: string[];
};

export function holdWithoutAnswer(
  name: string,
  question: string,
  heldChanges: readonly string[],
): HoldRecord {
  return {
    name,
    reason: "no_answer",
    question,
    held_changes: [...heldChanges],
  };
}

// 판단·정리의 용도다(R20). 경계·계약·용어 해석의 본문은 judgment, 이미 정한
// 보고의 제목·요약은 organizing이다. 실제 model·계정은 preset 선택의 몫이라 여기서
// provider·model 이름을 정하지 않는다.
export type ModelUse = {
  call:
    | "design_body"
    | "term_interpretation"
    | "report_title"
    | "report_summary";
  purpose: "judgment" | "organizing";
};

export function purposeOf(call: ModelUse["call"]): ModelUse["purpose"] {
  return call === "report_title" || call === "report_summary"
    ? "organizing"
    : "judgment";
}

export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
