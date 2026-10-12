// 질문 묶음 카드가 받는 값. lophn-agent/questions의 묶음 읽기(ReadQuestionGroup)와 글 읽기
// (ReadQuestionText)를 합친 화면 값이고, 글은 이미 읽어 문자열로 들어온다. 값의 모양은 contract
// (packages/contracts/lophn-agent/questions.ts)를 따른다. renderer 설정으로는 contracts를 type
// check하지 않으므로 화면에 필요한 칸만 같은 이름으로 적는다.

export interface QuestionOptionView {
  /** 선택지 key. 답이 이 key를 싣는다. */
  key: string;
  label: string;
  /** 선택지 설명(선택 후 적용 동작 포함). */
  description: string;
}

export interface QuestionView {
  /** 질문 ID(qst_…). */
  id: string;
  prompt: string;
  /** 질문의 자세한 이유. 기본 화면에는 없고 카드 머리의 Details를 펼치면 보인다(questions#R4). */
  reason: string;
  options: readonly QuestionOptionView[];
  /** 추천: 선택지 하나와 이유. 선택지가 없으면 option_key가 null이다. 자동 선택하지 않는다. */
  recommendation: {
    option_key: string | null;
    explanation: string;
  } | null;
}

export interface QuestionGroupView {
  /** 묶음 ID(qgr_…). */
  id: string;
  /** 묻는 agent의 이름. 고정 글자가 아니라 그 agent의 이름이다(shell/desktop#R40). */
  agentName: string;
  /** 명시 기한(AT 문자열). 없으면 null이다. 있으면 기본 화면에 남은 시간을 보인다(questions#R4, R7). */
  expires_at: string | null;
  /** 질문 1~4개. 묶음 안 순서 그대로다. */
  questions: readonly QuestionView[];
}

/** 묶음의 답 하나. AnswerQuestionGroup 입력의 answers 칸(groupAnswerInputSchema)과 같은 모양이다. */
export type GroupAnswer = {
  question: string;
  answer:
    | { kind: "option"; option_key: string }
    | { kind: "text"; text: string };
};

/**
 * 접힌 요약의 상태(questions#R10). 답 접수(answered)와 고정 action 선택지의 적용(applying·applied·
 * apply_failed)을 구별하고, 답 없이 닫힌 묶음(skipped·expired·cancelled)은 답이 없다.
 */
export type AnswerSummaryStatus =
  | "answered"
  | "applying"
  | "applied"
  | "apply_failed"
  | "skipped"
  | "expired"
  | "cancelled";

/** 이 수 이하의 질문은 한 카드에 모두 펼치고 넘으면 하나씩 넘긴다(shell/desktop#R46). */
export const QUESTION_CARD_SPREAD_MAX = 3;

/** 한 질문에서 고른 것. Other는 쓴 글이 따로 있어야 답이 된다. */
export type Pick = { kind: "option"; key: string } | { kind: "other" };

/** 고른 것과 Other에 쓴 글에서 답을 만든다. 고르지 않았거나 Other의 글이 비면 아직 답이 아니다. */
export function answerOf(
  question: QuestionView,
  pick: Pick | undefined,
  otherText: string,
): GroupAnswer | null {
  if (pick === undefined) return null;
  if (pick.kind === "option") {
    return {
      question: question.id,
      answer: { kind: "option", option_key: pick.key },
    };
  }
  const text = otherText.trim();
  if (text === "") return null;
  return { question: question.id, answer: { kind: "text", text } };
}

/** 묶음의 질문 순서대로 답 전부. 하나라도 비면 null이다. */
export function completeAnswers(
  group: QuestionGroupView,
  picks: Readonly<Record<string, Pick | undefined>>,
  texts: Readonly<Record<string, string | undefined>>,
): GroupAnswer[] | null {
  const answers: GroupAnswer[] = [];
  for (const question of group.questions) {
    const answer = answerOf(
      question,
      picks[question.id],
      texts[question.id] ?? "",
    );
    if (answer === null) return null;
    answers.push(answer);
  }
  return answers;
}

export type Remaining =
  | { unit: "days-hours"; days: number; hours: number }
  | { unit: "hours-minutes"; hours: number; minutes: number }
  | { unit: "minutes"; minutes: number }
  | { unit: "now" };

const MINUTE = 60_000;

/** 기한까지 남은 시간. 분 단위로 올려 세므로 남아 있는 동안 0m으로 보이지 않는다. */
export function remainingOf(expiresAt: string, now: number): Remaining {
  const left = Date.parse(expiresAt) - now;
  if (!(left > 0)) return { unit: "now" };
  const total = Math.ceil(left / MINUTE);
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const minutes = total % 60;
  if (days > 0) return { unit: "days-hours", days, hours };
  if (hours > 0) return { unit: "hours-minutes", hours, minutes };
  return { unit: "minutes", minutes };
}
