import { err, internalError, ok, type Result } from "../../../../base/mod.ts";
import {
  groupAgreesWithFixedActions,
  QUESTION_GROUP_MAX_QUESTIONS,
  QUESTION_GROUP_MIN_QUESTIONS,
} from "../../../../protocol/lophn-agent/mod.ts";

// 질문 묶음의 순수 검사. 저장·blob·event·
// confirmation은 command가 하고 이 파일은 값만 검사한다. 오류는 공통 code다.

// 묶음 크기의 정본은 contract 한 곳이다. 여기서 숫자를 다시 쓰지 않는다.
const GROUP_MIN_QUESTIONS = QUESTION_GROUP_MIN_QUESTIONS;
const GROUP_MAX_QUESTIONS = QUESTION_GROUP_MAX_QUESTIONS;

// 묶음 안 질문 하나의 검사에 필요한 모양. action은 고정 action이 있는 선택지에만 있다.
type GroupQuestionShape = {
  id: string;
  options: readonly { key: string; action: unknown | null }[];
  recommendation: { option_key: string | null } | null;
};

export type GroupStatus = "pending" | "answered" | "expired" | "cancelled";

// 저장된 묶음의 상태. questions는 position 순서다.
export type GroupState = {
  status: GroupStatus;
  created_seq: string;
  // UTC ISO 8601 밀리초 문자열. 없으면 기한 없음.
  expires_at: string | null;
  questions: readonly GroupQuestionShape[];
};

// 사람이 낸 질문 하나의 답. text는 Other(별도 자유 입력)다: 선택지가 있는 질문에도, 고정 action이
// 있는 질문에도, 선택지가 없는 질문에도 낼 수 있다.
export type GroupAnswerInput = {
  question: string;
  answer:
    | { kind: "option"; option_key: string }
    | { kind: "text"; text: string };
};

// 묶음을 만들 때의 검사(create_question_group).
//
// - 질문은 1~4개다(0개·5개 이상 `invalid_input`).
// - 질문 ID는 묶음 안에서 겹치지 않고, 질문 안 선택지 key도 겹치지 않는다.
// - 추천은 선택지가 있으면 실제 선택지 key를, 선택지가 없으면 null을 가리킨다.
// - 고정 action이 있는 선택지를 가진 질문이 있으면 묶음은 질문 1개뿐이다(`invalid_input`).
export function validateNewGroup(
  questions: readonly GroupQuestionShape[],
): Result<void> {
  if (
    questions.length < GROUP_MIN_QUESTIONS ||
    questions.length > GROUP_MAX_QUESTIONS
  ) {
    return err({
      code: "invalid_input",
      message: "a question group has 1 to 4 questions",
    });
  }
  const ids = questions.map((question) => question.id);
  if (new Set(ids).size !== ids.length) {
    return err({
      code: "invalid_input",
      message: "duplicate question id in the group",
    });
  }
  for (const question of questions) {
    const keys = question.options.map((option) => option.key);
    if (new Set(keys).size !== keys.length) {
      return err({
        code: "invalid_input",
        message: "duplicate option key in the question",
      });
    }
    if (!recommendationPointsAtOption(question)) {
      return err({
        code: "invalid_input",
        message: "recommendation must point at an option of the question",
      });
    }
  }
  // 고정 action 질문의 1개 규칙은 contract와 같은 검사를 쓴다(질문 수 검사는 위에서 끝났다).
  if (!groupAgreesWithFixedActions(questions)) {
    return err({
      code: "invalid_input",
      message: "a question with a fixed action must be a group of one",
    });
  }
  return ok(undefined);
}

// 추천 선택지는 실제 선택지여야 한다. 선택지가 없는 질문은 추천 key도 없어야 한다.
function recommendationPointsAtOption(question: GroupQuestionShape): boolean {
  if (question.recommendation === null) return true;
  const target = question.recommendation.option_key;
  if (question.options.length === 0) return target === null;
  return target !== null &&
    question.options.some((option) => option.key === target);
}

// 답이나 Skip이 지금 가능한지(answer_question_group·defer_question_group의 공통 전제).
//
// - 묶음이 pending이 아니면(답함·만료·취소·미룸) `conflict`다. 늦은 답·중복 답은 새 결정이 아니다.
// - 기한이 있고 now가 기한 이상이면 `conflict`다(경계 시각부터 거절). 기한 1ms 전은 가능하다.
// - 기한이 없으면 시간이 지나도 가능하다.
export function checkGroupOpen(
  group: Pick<GroupState, "status" | "expires_at">,
  now: string,
): Result<void> {
  if (group.status !== "pending") {
    return err({ code: "conflict", message: "question group is not pending" });
  }
  if (group.expires_at === null) return ok(undefined);
  const expiresMs = Date.parse(group.expires_at);
  const nowMs = Date.parse(now);
  // 시각을 못 읽으면 기한을 확인할 수 없다. 열려 있다고 보지 않고 결함으로 거절한다.
  if (Number.isNaN(expiresMs) || Number.isNaN(nowMs)) {
    return err(internalError());
  }
  if (nowMs >= expiresMs) {
    return err({ code: "conflict", message: "question group deadline passed" });
  }
  return ok(undefined);
}

// 묶음 Submit의 답 검사. 통과하면 묶음의 질문 순서(position)대로 정리한 답을 돌려준다.
//
// - 묶음의 모든 질문에 답이 하나씩 있어야 한다. 빠진 질문·묶음에 없는 질문·같은 질문의 중복 답은
//   `invalid_input`이다(일부만 답한 저장은 없다).
// - 선택지 답은 그 질문의 실제 선택지 key여야 한다(`invalid_input`).
// - 고정 action이 있는 선택지를 고른 답은 이 경로로 받지 않는다(`forbidden`, answer_question_action).
// - 자유 답(Other)은 비었거나 공백뿐이면 `invalid_input`이고, 나머지는 글 그대로 받는다
//   (선택지 유무·action 유무와 상관없이). 자유 답은 동작으로 해석하지 않는다.
// - 추천은 답이 아니다: 추천 선택지로 빠진 답을 채우지 않고, 추천만 있고 답이 없으면 빠진 것이다.
export function collectGroupAnswers(
  group: Pick<GroupState, "questions">,
  answers: readonly GroupAnswerInput[],
): Result<readonly GroupAnswerInput[]> {
  const questions = new Map<string, GroupQuestionShape>(
    group.questions.map((question) => [question.id, question]),
  );
  const byQuestion = new Map<string, GroupAnswerInput>();
  for (const entry of answers) {
    const question = questions.get(entry.question);
    if (question === undefined) {
      return err({
        code: "invalid_input",
        message: "answer for a question outside the group",
      });
    }
    if (byQuestion.has(entry.question)) {
      return err({
        code: "invalid_input",
        message: "duplicate answer for a question",
      });
    }
    const verdict = checkAnswer(question, entry.answer);
    if (!verdict.ok) return err(verdict.error);
    byQuestion.set(entry.question, entry);
  }
  const ordered: GroupAnswerInput[] = [];
  for (const question of group.questions) {
    const entry = byQuestion.get(question.id);
    if (entry === undefined) {
      return err({
        code: "invalid_input",
        message: "every question in the group needs one answer",
      });
    }
    ordered.push(entry);
  }
  return ok(ordered);
}

// 질문 하나의 답이 그 질문에 맞는지 본다. 추천이나 다른 답으로 채우지 않는다.
function checkAnswer(
  question: GroupQuestionShape,
  answer: GroupAnswerInput["answer"],
): Result<void> {
  if (answer.kind === "text") {
    if (answer.text.trim().length === 0) {
      return err({ code: "invalid_input", message: "free answer is blank" });
    }
    return ok(undefined);
  }
  const option = question.options.find((candidate) =>
    candidate.key === answer.option_key
  );
  if (option === undefined) {
    return err({
      code: "invalid_input",
      message: "answer is not an option of the question",
    });
  }
  // 고정 action은 사람 결정 확인을 따로 받아야 적용되므로 Submit 답으로는 받지 않는다.
  if (option.action !== null) {
    return err({
      code: "forbidden",
      message: "an option with a fixed action is confirmed separately",
    });
  }
  return ok(undefined);
}

// Skip(미루기)로 묶음 전체를 답 없이 닫은 결과. 답·채택·동작 적용이 하나도 없다.
type GroupDeferral = {
  status: "cancelled";
  closed_reason: "deferred";
  answers: null;
};

// Skip. 묶음이 아직 열려 있고(checkGroupOpen) 사람이 본 내용(created_seq)과 같을 때만 닫는다.
// created_seq가 다르면 `conflict`다. Skip은 답이 아니라서 질문마다의 답을 받지 않는다.
export function deferGroup(
  group: GroupState,
  created_seq: string,
  now: string,
): Result<GroupDeferral> {
  const open = checkGroupOpen(group, now);
  if (!open.ok) return err(open.error);
  if (group.created_seq !== created_seq) {
    return err({
      code: "conflict",
      message: "question group changed after it was shown",
    });
  }
  const deferral: GroupDeferral = {
    status: "cancelled",
    closed_reason: "deferred",
    answers: null,
  };
  return ok(deferral);
}
