import { z } from "zod";

// 사람에게 묻는 tool `ask`의 입력과 결과. `QuestionAsked` payload는 `askQuestionSchema`를 쓴다.
// 자유 답("Other")은 화면이 늘 붙이므로 schema에 없다. 기한도 Skip도 없다.

export const ASK_QUESTION_MAX = 4;
export const ASK_HEADER_MAX = 24;
export const ASK_OPTION_MIN = 2;
export const ASK_OPTION_MAX = 4;

// tool 설명에 넣는 규칙 문구다.
export const ASK_TOOL_RULES =
  "Ask only for a decision that the human has to make and that the request, the files or a sensible default cannot settle. Never use it to confirm a permission; permissions are the Gate's job.";

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});

export const askOptionSchema = z.strictObject({
  label: nonblank,
  // 짧은 한 줄.
  description: nonblank.refine((value) => !/[\r\n]/.test(value), {
    message: "expected one line",
  }),
});
export type AskOption = z.infer<typeof askOptionSchema>;

export const askQuestionSchema = z.strictObject({
  question: nonblank,
  header: nonblank.max(ASK_HEADER_MAX),
  options: z.array(askOptionSchema).min(ASK_OPTION_MIN).max(ASK_OPTION_MAX),
  multiSelect: z.boolean(),
});
export type AskQuestion = z.infer<typeof askQuestionSchema>;

export const askInputSchema = z.strictObject({
  questions: z.array(askQuestionSchema).min(1).max(ASK_QUESTION_MAX),
});
export type AskInput = z.infer<typeof askInputSchema>;

export const ASK_ANSWER_STATUSES = ["answered", "unanswered"] as const;

// 질문 순서대로 하나씩. 고른 label이나 자유 답이 answer에 들어간다.
export const askAnswerSchema = z.object({
  question: z.string(),
  status: z.enum(ASK_ANSWER_STATUSES),
  answer: z.array(z.string()),
});
export type AskAnswer = z.infer<typeof askAnswerSchema>;

const answers = z.array(askAnswerSchema).max(ASK_QUESTION_MAX);

// submitted: 사람이 답을 냈다. cancelled: 꺼졌다 켜지거나 turn이 끊겼다.
// human_message: 기다리는 중 사람이 보낸 메시지가 답을 대신한다(답인지는 LLM이 읽는다).
export const askResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("submitted"), answers }),
  z.object({ outcome: z.literal("cancelled"), answers }),
  z.object({
    outcome: z.literal("human_message"),
    message: z.string(),
    answers,
  }),
]);
export type AskResult = z.infer<typeof askResultSchema>;
