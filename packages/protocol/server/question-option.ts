import type { Result } from "../../base/mod.ts";
import { definePort } from "../base/ports.ts";

// 사람이 질문에서 실제로 고른 option과 그 고정 action이 내는 소유 command 호출.
// lophn-agent의 question 정본 read가 채운다. platform은 질문 상태를 직접 읽지 않고 이 값만
// 대조한다(identity R14). 답이 없거나 option이 아니거나 action이 없으면 오류다.
export type ChosenOptionCall = {
  option: string;
  route: string;
  input: unknown;
  compare: unknown;
};

export type QuestionOptionRead = {
  chosen(question: string): Result<ChosenOptionCall>;
};

export const questionOption = definePort<QuestionOptionRead>(
  "lophn-agent.question-option",
);
