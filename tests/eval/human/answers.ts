import type {
  AskAnswer,
  AskQuestion,
} from "../../../packages/protocol/lophn-agent/ask-tool.ts";

export type EarlierAnswer = { question: string; answer: string[] };

// 카드가 답하지 않는 질문에 내는 자유 답. 제품의 ask에는 추천 표시가 없다.
export const ANSWER_DEFAULT = "추천대로 해 줘";

export function earlierText(earlier: EarlierAnswer[]): string {
  if (earlier.length === 0) return "(none)";
  return earlier.map((e) => `Q: ${e.question}\nA: ${e.answer.join(", ")}`)
    .join("\n\n");
}

export function questionsText(questions: AskQuestion[]): string {
  return questions.map((q, i) => {
    const lines = [`Q${i + 1} [${q.header}]: ${q.question}`];
    for (const o of q.options) lines.push(`- ${o.label}: ${o.description}`);
    if (q.multiSelect) lines.push("(multiple choices allowed)");
    return lines.join("\n");
  }).join("\n\n");
}

// 답은 agent 출력이 아니라 입력 질문에서 question을 복사한다. askAnswer가 글자 그대로 같은 것만 받는다.
export function buildAnswers(
  questions: AskQuestion[],
  selected: (string[] | undefined)[],
): AskAnswer[] {
  return questions.map((q, i) => {
    let values = (selected[i] ?? []).filter((s) =>
      typeof s === "string" && s.trim() !== ""
    );
    if (!q.multiSelect) values = values.slice(0, 1);
    if (values.length === 0) values = [ANSWER_DEFAULT];
    return { question: q.question, status: "answered", answer: values };
  });
}
