import type { Result } from "../../base/mod.ts";

// 질문 묶음의 순수 검사(domain model lophn-agent/questions QuestionGroup·answer_question_group·
// defer_question_group, requirements questions#R1·R3·R4·R6·R7·R8·R13·R15). 저장·blob·event·
// confirmation은 command(agent-I13)가 하고 이 파일은 값만 검사한다. 오류는 공통 code다.

export const GROUP_MIN_QUESTIONS = 1;
export const GROUP_MAX_QUESTIONS = 4;

// 묶음 안 질문 하나의 검사에 필요한 모양. action은 고정 action이 있는 선택지에만 있다.
export type GroupQuestionShape = {
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
  void questions;
  throw new Error("not implemented: agent-I7");
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
  void group;
  void now;
  throw new Error("not implemented: agent-I7");
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
  void group;
  void answers;
  throw new Error("not implemented: agent-I7");
}

// Skip(미루기)로 묶음 전체를 답 없이 닫은 결과. 답·채택·동작 적용이 하나도 없다.
export type GroupDeferral = {
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
  void group;
  void created_seq;
  void now;
  throw new Error("not implemented: agent-I7");
}
