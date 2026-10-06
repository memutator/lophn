import type { ContextTarget } from "@lophn/contracts/documents";
import type {
  FixedVersionReference,
  HandoffContent,
  HandoffReference,
  QuestionOption,
} from "@lophn/contracts/lophn-agent";

// Context Engineer 역할의 설계 보고·용어 후보 검사(roles/context-engineer R6–R10).
// 순수 함수다: IO·시계·model 호출이 없다. 읽기·검색·contract 호출은 harness/tools
// 묶음의 몫이고, 이 모듈은 그 결과로 조립할 판단의 모양만 정한다(R14). 사람 결정은
// Question으로 묻고 답이 없으면 적용하지 않는다(R10): 정의 확정·충돌 해석·assignment
// 적용은 각 소유 concern의 몫이라 여기서 다시 판단하지 않는다.

// 사람이 받아들인 용어가 보고에 실릴 수 있는 수(R7).
export const REPORT_TERM_LIMIT = 30;

// 후보당 출현 주소 상한(R8). 소유 contract의 근거 한계와 같은 값이다.
export const CANDIDATE_EVIDENCE_LIMIT = 5;

// 한 용어가 후보가 되기 위해 그대로 출현해야 하는 서로 다른 문서 수(R8).
export const CANDIDATE_DOCUMENT_MIN = 3;

// 관점 값(R6). 값 정의 자체는 documents/contexts(CONTEXT_PERSPECTIVES)의 몫이다.
export const PERSPECTIVES = ["basis", "reference", "watch"] as const;
export type Perspective = (typeof PERSPECTIVES)[number];

// 설계 보고의 범위 한 줄(R7). 항목 주소·관점·이유다.
export type ScopeLine = {
  target: ContextTarget;
  perspective: Perspective;
  // 이유는 줄바꿈을 접어 한 줄로 쓴다.
  reason: string;
};

// 설계 보고의 용어(R7). 사람이 받아들인 것만 confirmed에 들어가고 미정 후보는 별도다.
export type ReportTerms = {
  confirmed: string[];
  undecided: string[];
};

// 설계 보고(R7). 컨텍스트별 목적·범위·용어·경계 네 부분이다.
export type DesignReport = {
  context: string;
  purpose: string;
  scope: ScopeLine[];
  terms: ReportTerms;
  boundaries: string[];
};

// 관점 선택의 근거 모양(R6). 책임 근거는 기준, 배경 지식은 참고, 변화 추적은 watch다.
export type PerspectiveReason = {
  responsible_evidence: boolean;
  background_knowledge: boolean;
  change_tracking: boolean;
};

// 목적에 대한 해석으로 관점을 고른다(R6). 근거가 겹치면 책임 근거가 이긴다:
// 책임 근거면 기준, 그것이 없고 배경 지식이면 참고, 나머지는 변화 추적이다.
export function choosePerspective(
  reason: PerspectiveReason,
): Perspective | undefined {
  if (reason.responsible_evidence) return "basis";
  if (reason.background_knowledge) return "reference";
  if (reason.change_tracking) return "watch";
  return undefined;
}

// 범위 한 줄을 만든다. 이유를 한 줄로 접는다(R7). 같은 문서도 컨텍스트마다 다르게
// 판단하므로 관점 값은 입력 그대로 둔다.
export function scopeLine(
  target: ContextTarget,
  perspective: Perspective,
  reason: string,
): ScopeLine | undefined {
  const line = oneLine(reason);
  if (line === "") return undefined;
  return { target, perspective, reason: line };
}

// 설계 보고 조립(R7). 확정 용어를 상한으로 자르고 미정 후보와의 중복을 빼며
// 경계는 빈 항목을 뺀다. 정제되지 않은 이유는 범위에서 뺀다.
export function designReport(input: {
  context: string;
  purpose: string;
  scope: readonly (ScopeLine | undefined)[];
  confirmed: readonly string[];
  undecided: readonly string[];
  boundaries: readonly string[];
}): DesignReport {
  const scope = input.scope.flatMap((line) => line === undefined ? [] : [line]);
  const undecided = [...new Set(input.undecided)];
  const taken = new Set(undecided);
  const confirmed = input.confirmed
    .filter((name) => !taken.has(name))
    .slice(0, REPORT_TERM_LIMIT);
  return {
    context: input.context,
    purpose: oneLine(input.purpose),
    scope,
    terms: { confirmed, undecided },
    boundaries: input.boundaries
      .map(oneLine)
      .filter((boundary) => boundary !== ""),
  };
}

// 보고 하나를 검사한다(R7). 네 부분이 다 있는지, 확정 용어가 상한 안인지,
// 미정 후보가 확정에 섞이지 않았는지 본다.
export function checkReport(
  report: DesignReport,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (report.purpose.trim() === "") problems.push("purpose missing");
  if (report.terms.confirmed.length > REPORT_TERM_LIMIT) {
    problems.push("too many confirmed terms");
  }
  const mixed = report.terms.undecided.filter((name) =>
    report.terms.confirmed.includes(name)
  );
  if (mixed.length > 0) problems.push("undecided term kept in confirmed");
  if (report.boundaries.length === 0) problems.push("boundary missing");
  return { ok: problems.length === 0, problems };
}

// 한 용어의 출현 주소다. 실제 본문을 읽은 고정 판만 근거가 된다(R8). 주소는 section
// 또는 줄 범위로 좁힌다(소유 contract의 agent 근거 규약).
export type Occurrence = {
  document: string;
  version: string;
  section: string | null;
  start_line: number | null;
  end_line: number | null;
};

// 후보를 고른다(R8). 미등록 말인지는 context.terms의 candidates로 이미 결정된
// 사실이고, 여기는 본문 출현만 본다: 서로 다른 문서 CANDIDATE_DOCUMENT_MIN개 이상에
// 그대로 나타나는 말만 후보다. 주소는 후보당 최대 CANDIDATE_EVIDENCE_LIMIT개다.
export function candidateTerms(input: {
  registered: readonly string[];
  bodies: ReadonlyMap<string, string>;
  occurrences: ReadonlyMap<string, readonly Occurrence[]>;
}): {
  candidates: { name: string; places: Occurrence[] }[];
  skipped: string[];
} {
  const candidates: { name: string; places: Occurrence[] }[] = [];
  const skipped: string[] = [];
  for (const [name, all] of input.occurrences) {
    if (input.registered.includes(name)) {
      skipped.push(name);
      continue;
    }
    const seen = new Set<string>();
    const places: Occurrence[] = [];
    for (const place of all) {
      if (places.length >= CANDIDATE_EVIDENCE_LIMIT) break;
      // 본문에 그대로 나타나지 않는 주소는 근거가 아니다. 읽지 않은 판도 아니다.
      const body = input.bodies.get(`${place.document}@${place.version}`);
      if (body === undefined || !body.includes(name)) continue;
      seen.add(place.document);
      places.push(place);
    }
    if (seen.size >= CANDIDATE_DOCUMENT_MIN && places.length > 0) {
      candidates.push({ name, places });
    } else {
      skipped.push(name);
    }
  }
  return { candidates, skipped };
}

// 후보 근거를 질문의 고정 참조 모양으로 옮긴다. 주소는 최대 CANDIDATE_EVIDENCE_LIMIT개다
// (R8). 정의는 실지 않는다: 정의 확정은 사람의 답을 적용하는 경로(documents/terms)의 몫이다.
export function candidateEvidence(
  places: readonly Occurrence[],
): FixedVersionReference[] {
  return places.slice(0, CANDIDATE_EVIDENCE_LIMIT).map((place) => ({
    document: place.document,
    version: place.version,
    section: place.section,
  }));
}

// 대응 후보와 충돌이다(R9). 같은 뜻의 다른 말(corresponds)과 같은 말의 다른 뜻
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

// 용어 충돌을 lophn에 넘기는 handoff 초안이다(R9). 충돌의 기획 판단은 lophn의
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
      // 사람 뜻 없이 합치지 않는다(R9).
      excludes: ["정의 자동 적용", "용어 자동 병합"],
      expected_outputs: [input.question],
    },
    references: input.evidence.slice(0, CANDIDATE_EVIDENCE_LIMIT).map((
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

// 판단·정리의 용도다(R14). 목적·경계·관점·term 해석의 본문은 judgment, 이미 정한
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
