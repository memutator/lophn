import type { z } from "zod";
import type {
  questionRead,
  questionText,
  waitRunInputSchema,
} from "../../packages/contracts/lophn-agent/mod.ts";

// 질문 tool이 이미 만든 질문 묶음을 WaitRun의 요청으로 되돌린다(lophn-agent/harness/waiting-and-recovery
// R1). 글은 저장된 redaction 글이고, 같은 내용이면 WaitRun이 그 묶음을 이어 대기에 연결한다.
// 질문은 저장된 position 순서 그대로 싣는다.
export function questionWaitRequest(
  stored: z.output<typeof questionRead.output>["group"],
  text: z.output<typeof questionText.output>,
): Extract<
  z.input<typeof waitRunInputSchema>["request"],
  { kind: "question" }
> {
  const texts = new Map(text.questions.map((one) => [one.question, one]));
  return {
    kind: "question",
    input: {
      id: stored.id,
      run: stored.run,
      session: stored.session,
      expires_at: stored.expires_at,
      questions: stored.questions.map((question) => {
        const written = texts.get(question.id);
        const descriptions = new Map(
          (written?.options ?? []).map(
            (option) => [option.key, option.description],
          ),
        );
        return {
          id: question.id,
          prompt: written?.prompt ?? "",
          reason: written?.reason ?? "",
          options: question.options.map((option) => ({
            key: option.key,
            label: option.label,
            evidence: option.evidence,
            adoption: option.adoption,
            // 저장된 action의 input은 만들 때 싣은 값 그대로다.
            action: option.action as never,
            description: descriptions.get(option.key) ?? "",
          })),
          recommendation: question.recommendation === null ? null : {
            option_key: question.recommendation.option_key,
            explanation: written?.recommendation?.explanation ?? "",
          },
        };
      }),
    },
  };
}
