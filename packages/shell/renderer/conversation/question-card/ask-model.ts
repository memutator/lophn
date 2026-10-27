// 질문 카드가 쥐는 답의 상태와 그 답을 contract의 답으로 바꾸는 순수 함수.
import type { AskedQuestion, QuestionAnswer } from "../agent-tab-source.ts";

/** Other에 적을 수 있는 글자 수. */
export const OTHER_MAX = 500;

/** 한 질문에서 고른 것. Other는 글이 있어야 답이 된다. */
export interface Pick {
  readonly labels: readonly string[];
  readonly other: boolean;
  readonly text: string;
}

export const NO_PICK: Pick = { labels: [], other: false, text: "" };

/** 선택지 하나(label)나 Other(null)를 누른다. multiSelect가 아니면 하나만 남는다. */
export function togglePick(
  question: AskedQuestion,
  pick: Pick,
  label: string | null,
): Pick {
  if (!question.multiSelect) {
    return label === null
      ? { ...pick, labels: [], other: true }
      : { ...pick, labels: [label], other: false };
  }
  if (label === null) return { ...pick, other: !pick.other };
  return {
    ...pick,
    labels: pick.labels.includes(label)
      ? pick.labels.filter((item) => item !== label)
      : [...pick.labels, label],
  };
}

/** Other에 글을 쓰면 Other를 고른 것이다. */
export function typeOther(
  question: AskedQuestion,
  pick: Pick,
  text: string,
): Pick {
  return {
    ...(pick.other ? pick : togglePick(question, pick, null)),
    text,
  };
}

/** 고른 label(선택지 순서)과 Other의 글. 아직 답이 아니면 null이다. */
export function answerOf(
  question: AskedQuestion,
  pick: Pick,
): QuestionAnswer | null {
  const text = pick.text.trim();
  if (pick.other && text === "") return null;
  const answer = [
    ...question.options
      .map((option) => option.label)
      .filter((label) => pick.labels.includes(label)),
    ...(pick.other ? [text] : []),
  ];
  if (answer.length === 0) return null;
  return { question: question.question, status: "answered", answer };
}

/** 질문 순서대로 답 전부. 하나라도 비면 null이다. */
export function answersOf(
  questions: readonly AskedQuestion[],
  picks: Readonly<Record<string, Pick>>,
): QuestionAnswer[] | null {
  const answers: QuestionAnswer[] = [];
  for (const question of questions) {
    const answer = answerOf(question, picks[question.id] ?? NO_PICK);
    if (answer === null) return null;
    answers.push(answer);
  }
  return answers;
}
