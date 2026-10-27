import type { AskInput } from "../../../packages/protocol/lophn-agent/ask-tool.ts";

// judge가 받는 입력은 program이 고른 글 조각이다. transcript 전체를 주지 않는다.
export function joinInput(sections: { label: string; text: string }[]): string {
  return sections.map((s) => `[${s.label}]\n${s.text}`).join("\n\n");
}

export function relayCompleteInput(
  humanText: string,
  callBody: string,
): string {
  return joinInput([
    { label: "HUMAN_REQUEST", text: humanText },
    { label: "CALL_BODY", text: callBody },
  ]);
}

export function asksGapInput(
  humanText: string,
  questions: AskInput["questions"],
): string {
  const text = questions
    .map((q, i) =>
      [
        `Q${i + 1}: ${q.question}`,
        ...q.options.map((o) => `- ${o.label}: ${o.description}`),
      ].join("\n"),
    )
    .join("\n");
  return joinInput([
    { label: "HUMAN_REQUEST", text: humanText },
    { label: "QUESTIONS", text },
  ]);
}
