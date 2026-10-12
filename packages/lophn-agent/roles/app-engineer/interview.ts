import type {
  HandoffContent,
  HandoffReference,
  QuestionOption,
} from "@lophn/protocol/lophn-agent";
import { handoffAllowed } from "@lophn/protocol/lophn-agent";
import { err, ok, type Result } from "../../../base/mod.ts";

// App Engineer 인터뷰 규칙(roles/app-engineer R4, R7, R8). 순수 함수다: IO·시계·model
// 호출이 없다. 질문 생성·저장은 question.submit이, 답의 설계상 해석과 선택지 문장은 model이
// 맡는다. 이 모듈은 상한과 보류의 모양만 정한다.

// 인터뷰 하나의 추가 결정 질문 상한(R7).
export const INTERVIEW_QUESTION_MAX = 12;
// 선택형 질문의 선택지 수(R7).
export const OPTION_MIN = 2;
export const OPTION_MAX = 3;
// 명세 하나가 드러내는 가정 상한(R8).
export const ASSUMPTION_MAX = 3;

// 앱 목적과 SDK는 lophn의 기획에서 시작한다(R4). 기획이 없으면 목적을 비워 두고 기획을
// 요청해야 한다고 알린다: 앱 목적도 SDK 후보도 App Engineer가 지어내지 않는다.
export type PlanBasis = {
  purpose: string;
  sdk: string[];
};

export type InterviewBasis = {
  origin: "plan" | "human" | "none";
  purpose: string | null;
  sdk: string[];
  // 기획이 없어 lophn에 먼저 묻고 시작해야 한다.
  needs_planning: boolean;
};

export function interviewBasis(input: {
  plan: PlanBasis | null;
  humanWords: string | null;
}): InterviewBasis {
  if (input.plan !== null) {
    return {
      origin: "plan",
      purpose: input.plan.purpose,
      sdk: [...input.plan.sdk],
      needs_planning: false,
    };
  }
  const words = input.humanWords?.trim() ?? "";
  return {
    origin: words === "" ? "none" : "human",
    purpose: null,
    sdk: [],
    needs_planning: true,
  };
}

// 결정의 주인이다(R4). 앱 통합·공용 SDK 판단은 lophn, 용어집 초안과 context 경계 설계는
// Context Engineer, 나머지 앱 설계는 App Engineer다.
export type DecisionOwner = "lophn" | "context_engineer" | "app_engineer";

const LOPHN_TOPICS = ["app_integration", "shared_sdk", "sdk_reuse_order"];
const CONTEXT_TOPICS = [
  "glossary_draft",
  "context_boundary",
  "criteria_application",
];

export function decisionOwner(topic: string): DecisionOwner {
  if (LOPHN_TOPICS.includes(topic)) return "lophn";
  if (CONTEXT_TOPICS.includes(topic)) return "context_engineer";
  return "app_engineer";
}

// 다른 역할이 맡은 결정을 handoff로 넘기는 초안이다(R4). SDK 재사용 변경과 용어집 초안에는
// 고정 근거를 붙이고, 방향은 lophn-agent/handoff의 허용 방향을 따른다. 담당 밖이 아니면
// 넘기지 않는다.
export function routeDecision(input: {
  topic: string;
  what: string;
  why: string;
  evidence: readonly HandoffReference[];
  expected: string;
}): Result<{
  to_role: "lophn" | "context_engineer";
  content: HandoffContent;
  references: HandoffReference[];
}> {
  const owner = decisionOwner(input.topic);
  if (owner === "app_engineer") {
    return err({
      code: "invalid_input",
      message: "this decision belongs to the app engineer",
    });
  }
  if (!handoffAllowed("app_engineer", owner)) {
    return err({ code: "forbidden", message: "handoff direction not allowed" });
  }
  if (input.evidence.length === 0) {
    return err({
      code: "invalid_input",
      message: "a handoff needs fixed evidence",
    });
  }
  return ok({
    to_role: owner,
    content: {
      what: input.what,
      why: input.why,
      excludes: ["앱 안 설계 결정", "정의·기획 자동 적용"],
      expected_outputs: [input.expected],
    },
    references: input.evidence.map((reference) => ({ ...reference })),
  });
}

// 다음 인터뷰 단계다(R7). 충분히 답한 결정은 다시 묻지 않고, 열세 번째 결정 질문 대신 남은
// 결정을 정리해 사람에게 보인다.
export type InterviewStep =
  | { kind: "ask"; topic: string }
  | { kind: "summarize"; remaining: string[] }
  | { kind: "done" };

export function nextInterviewStep(input: {
  asked: number;
  // 아직 정하지 못한 결정을 묻는 순서대로 담는다.
  open: readonly string[];
  // 충분한 답을 이미 받은 결정이다.
  answered: readonly string[];
}): InterviewStep {
  const answered = new Set(input.answered);
  const remaining = input.open.filter((topic) => !answered.has(topic));
  if (remaining.length === 0) return { kind: "done" };
  if (input.asked >= INTERVIEW_QUESTION_MAX) {
    return { kind: "summarize", remaining };
  }
  return { kind: "ask", topic: remaining[0]! };
}

// 선택형 질문 초안이다(R7). 선택지는 설명이 있는 2~3개이고 추천은 근거가 있는 하나다.
export type ChoiceQuestion = {
  prompt: string;
  options: QuestionOption[];
  recommendation: { option_key: string; explanation: string } | null;
};

export function checkChoiceQuestion(
  question: ChoiceQuestion,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const count = question.options.length;
  if (count < OPTION_MIN || count > OPTION_MAX) {
    problems.push("option count outside 2..3");
  }
  for (const option of question.options) {
    if (option.description.trim() === "") {
      problems.push(`option without description: ${option.key}`);
    }
  }
  const recommendation = question.recommendation;
  if (recommendation === null) {
    problems.push("recommendation missing");
  } else {
    const chosen = question.options.find((option) =>
      option.key === recommendation.option_key
    );
    if (chosen === undefined) {
      problems.push("recommendation names no offered option");
    } else if (chosen.evidence.length === 0) {
      problems.push("recommendation has no evidence");
    }
    if (recommendation.explanation.trim() === "") {
      problems.push("recommendation without explanation");
    }
  }
  return { ok: problems.length === 0, problems };
}

// 답의 설계상 해석을 사람의 말로 되읽는 글이다(R8). 내부 id와 계약 용어를 싣지 않는다.
const INTERNAL = /\b(?:doc|ver|qst|run|app|tck|prb)_[0-9a-z]{26}\b|\bR\d+\b/;

export function checkReadBack(
  text: string,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (text.trim() === "") problems.push("read back is empty");
  if (INTERNAL.test(text)) problems.push("read back uses internal names");
  return { ok: problems.length === 0, problems };
}

// 티켓 작성 가능 여부(R8). 범위·사용 동작·acceptance check의 답이 없으면 관련 티켓은 보류하고
// 필요한 답을 설명한다. 가정이 상한을 넘으면 숨겨 넣지 않고 보류한다.
export const REQUIRED_ANSWERS = ["scope", "behavior", "acceptance"] as const;
export type RequiredAnswer = (typeof REQUIRED_ANSWERS)[number];

const ANSWER_WORDS: Readonly<Record<RequiredAnswer, string>> = {
  scope: "범위",
  behavior: "사용 동작",
  acceptance: "acceptance check",
};

export type TicketDecision =
  | { status: "ready" }
  | {
    status: "held";
    missing: RequiredAnswer[];
    over_assumed: boolean;
    explanation: string[];
  };

export function ticketDecision(input: {
  answered: readonly RequiredAnswer[];
  assumptions: readonly string[];
}): TicketDecision {
  const answered = new Set(input.answered);
  const missing = REQUIRED_ANSWERS.filter((answer) => !answered.has(answer));
  const overAssumed = input.assumptions.length > ASSUMPTION_MAX;
  if (missing.length === 0 && !overAssumed) return { status: "ready" };
  const explanation = missing.map((answer) =>
    `${ANSWER_WORDS[answer]}의 답이 있어야 티켓을 쓸 수 있다`
  );
  if (overAssumed) {
    explanation.push(
      `가정이 ${input.assumptions.length}개라 최대 ${ASSUMPTION_MAX}개를 넘는다. 사람에게 물어 정한 뒤 쓴다`,
    );
  }
  return { status: "held", missing, over_assumed: overAssumed, explanation };
}
