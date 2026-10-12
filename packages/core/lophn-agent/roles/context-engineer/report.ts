import type {
  HandoffContent,
  HandoffReference,
} from "@lophn/protocol/lophn-agent";

// Context Engineer 역할의 충돌 handoff·보류·model 용도.
// 순수 함수다: IO·시계·model 호출이 없다. 읽기·검색·contract 호출은 harness/tools
// 묶음의 몫이고, 이 모듈은 그 결과로 조립할 판단의 모양만 정한다. 사람 결정은
// Question으로 묻고 답이 없으면 적용하지 않는다.

// handoff 근거 주소 상한이다. 소유 contract의 근거 한계와 같은 값이다.
export const EVIDENCE_LIMIT = 5;

// 같은 말이 나온 곳의 주소다. 실제 본문을 읽은 고정 판만 근거가 된다. 주소는 section
// 또는 줄 범위로 좁힌다(handoff 근거는 고정 version 주소다).
export type Occurrence = {
  document: string;
  version: string;
  section: string | null;
  start_line: number | null;
  end_line: number | null;
};

// 같은 말이 context마다 다른 뜻인 충돌을 lophn에 넘기는 handoff 초안이다. 충돌의 기획
// 판단은 사람에게 묻거나 lophn에 맡기고 용어를 합치지 않는다. 근거·질문은 lophn-agent/handoff의
// 고정 근거 모양으로 옮긴다.
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
      why: `context ${input.context}: 같은 말이 context 사이 다른 뜻을 가진다.`,
      // 사람 뜻 없이 합치지 않는다.
      excludes: ["용어집 자동 적용", "용어 자동 병합"],
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

// 보류. 사람의 결정(경계·용어의 뜻·위반의 처리 방향)에 답이 없으면 관련 변경을
// 제출하지 않고 보고에 미정으로 남긴다. 미답 내용은 계약이나 용어집에 적용하지 않는다.
export type HoldRecord = {
  name: string;
  reason: "no_answer";
  // 답을 기다리는 질문 묶음이다. 답이 없으면 묶음 전체가 보류의 근거다.
  group: string;
  held_changes: string[];
};

export function holdWithoutAnswer(
  name: string,
  group: string,
  heldChanges: readonly string[],
): HoldRecord {
  return {
    name,
    reason: "no_answer",
    group,
    held_changes: [...heldChanges],
  };
}

// 판단·정리의 용도다. 경계·계약·검색·용어 해석·Operator 설계의 본문은 judgment,
// 이미 정한 보고의 제목·요약은 organizing이다. 실제 model·계정은 preset 선택의 몫이라 여기서
// provider·model 이름을 정하지 않는다.
export type ModelUse = {
  call:
    | "boundary"
    | "contract"
    | "search"
    | "term_interpretation"
    | "operator_design"
    | "report_title"
    | "report_summary";
  purpose: "judgment" | "organizing";
};

export function purposeOf(call: ModelUse["call"]): ModelUse["purpose"] {
  return call === "report_title" || call === "report_summary"
    ? "organizing"
    : "judgment";
}
