import { z } from "zod";
import { defineMemory } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";

// 사람에게 묻는 tool `ask`의 입력과 결과. 질문 내용은 event에 싣지 않고 아래 read route가 준다.
// 자유 답("Other")은 화면이 늘 붙이므로 schema에 없다. 기한도 Skip도 없다.

const ASK_QUESTION_MAX = 4;
const ASK_HEADER_MAX = 24;
const ASK_OPTION_MIN = 2;
const ASK_OPTION_MAX = 4;

// tool 설명에 넣는 규칙 문구다.
export const ASK_TOOL_RULES =
  "Ask only for a decision that the human has to make and that the request, the files or a sensible default cannot settle. Never use it to confirm a permission; permissions are the Gate's job.";

const nonblank = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});

const askOptionSchema = z.strictObject({
  label: nonblank,
  // 짧은 한 줄.
  description: nonblank.refine((value) => !/[\r\n]/.test(value), {
    message: "expected one line",
  }),
});

const askQuestionSchema = z.strictObject({
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

const ASK_ANSWER_STATUSES = ["answered", "unanswered"] as const;

// 질문 순서대로 하나씩. 고른 label이나 자유 답이 answer에 들어간다.
const askAnswerSchema = z.object({
  question: z.string(),
  status: z.enum(ASK_ANSWER_STATUSES),
  answer: z.array(z.string()),
});
export type AskAnswer = z.infer<typeof askAnswerSchema>;

const answers = z.array(askAnswerSchema).max(ASK_QUESTION_MAX);

// submitted: 사람이 답을 냈다. cancelled: 꺼졌다 켜지거나 turn이 끊겼다.
// human_message: 기다리는 중 사람이 보낸 메시지가 답을 대신한다(답인지는 LLM이 읽는다).
// parent_reply: 팀 자식의 질문에 부모가 call reply로 답했다(답인지는 LLM이 읽는다).
// unattended: 사람이 없는 turn이라 묻지 않았다.
const askResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("submitted"), answers }),
  z.object({ outcome: z.literal("cancelled"), answers }),
  z.object({
    outcome: z.literal("human_message"),
    message: z.string(),
    answers,
  }),
  z.object({ outcome: z.literal("parent_reply"), message: z.string() }),
  z.object({ outcome: z.literal("unattended") }),
]);
export type AskResult = z.infer<typeof askResultSchema>;

const askErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
] as const;

const askTarget = {
  session: idSchema("ses"),
  tool_call: idSchema("tcl"),
};

// 대기 중인 질문 묶음을 session과 `ask` tool call로 찾아 질문 목록을 준다. 메모리 route라 답하거나
// turn이 끝나 묶음이 풀리면 not_found다.
export const askRead = defineMemory({
  resource: "ask",
  method: "read",
  name: "ReadAskQuestions",
  input: z.strictObject(askTarget),
  output: z.object({
    group: idSchema("qgr"),
    questions: z.array(askQuestionSchema).min(1).max(ASK_QUESTION_MAX),
  }),
  actors: ["user"],
  errors: [...askErrors],
});

// 사람이 낸 답이다. 질문 순서대로 하나씩이고 Skip은 없다. 이미 풀린 묶음은 conflict다.
// 결과는 tool이 받는 askResultSchema와 같다(outcome은 submitted).
export const askAnswer = defineMemory({
  resource: "ask",
  method: "answer",
  name: "AnswerAskQuestions",
  input: z.strictObject({
    ...askTarget,
    answers: z.array(askAnswerSchema).min(1).max(ASK_QUESTION_MAX),
  }),
  output: askResultSchema,
  actors: ["user"],
  errors: [...askErrors],
});

// runtime이 `ask`의 질문 묶음을 올리고 풀릴 때까지 기다린다. 사람이 답하거나 그 session에 메시지를 보내면
// 결과가 돌아오고, turn이 끝나거나 session이 닫히면 cancelled다. credential의 session·turn과 입력이
// 다르면 forbidden이다.
export const askWait = defineMemory({
  resource: "ask",
  method: "wait",
  name: "WaitAskQuestions",
  input: z.strictObject({
    ...askTarget,
    turn: idSchema("trn"),
    questions: askInputSchema.shape.questions,
  }),
  output: askResultSchema,
  actors: ["agent"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

export const ASK_ROUTES = [askRead, askAnswer] as const;
