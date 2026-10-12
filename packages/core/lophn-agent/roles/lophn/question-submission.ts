import type {
  CreateQuestionGroupInput,
  OptionAction,
  QuestionOption,
} from "@lophn/protocol/lophn-agent";
import { questionOptionSchema } from "@lophn/protocol/lophn-agent";
import { validateNewGroup } from "../../tools/questions/mod.ts";

// lophn이 만든 질문 draft를 `question.submit` tool 값으로 실는 길(roles/lophn#R5,
// T29에서 넘어온 것). `question.submit`의 입력은 선택지 action을 `null`로만 받는다:
// 모델은 대상·값 후보와 설명만 고르고, `recommendPlaces`·`settingChangeQuestion`이
// 만든 고정 action은 여기서 그대로 싣는다. hash·CAS는 draft 함수가 만든 것이라
// 이 모듈이 다시 만들지 않는다. 사람이 고르기 전에는 아무것도 바뀌지 않는다
// (questions#R13의 적용은 machine ApplyQuestionOption 몫이다). 제출은 질문 묶음 하나다:
// draft 1~4개를 한 묶음으로 싣고, 고정 action이 있는 draft는 혼자 묶음이 된다.

// 질문 하나의 draft(place-recommendation·setting-proposal이 만드는 모양). 목록의 순서가 묶음 안
// 질문 순서다.
type Draft = {
  prompt: string;
  reason: string;
  options: QuestionOption[];
  recommendation: { option_key: string; explanation: string } | null;
};

// draft에서 싣는 제출 질문 하나다. action은 draft 함수가 고정한 OptionAction 그대로거나
// null(유지·버림 선택지)이다.
export type DraftSubmissionQuestion = {
  prompt: string;
  reason: string;
  options: {
    key: string;
    label: string;
    description: string;
    evidence: QuestionOption["evidence"];
    adoption: QuestionOption["adoption"];
    action: OptionAction | null;
  }[];
  recommendation: { option_key: string; explanation: string } | null;
};

export type DraftSubmission = {
  questions: DraftSubmissionQuestion[];
  expires_at: string | null;
};

// draft의 선택지와 추천을 question.submit 입력 모양으로 옮긴다. 고정 action은
// 그대로 실린다. expires_at은 draft가 정하지 않으므로 호출자가 정한다.
export function draftSubmission(
  drafts: readonly Draft[],
  expires_at: string | null = null,
): DraftSubmission {
  return {
    questions: drafts.map((draft) => ({
      prompt: draft.prompt,
      reason: draft.reason,
      options: draft.options.map((option) => ({
        key: option.key,
        label: option.label,
        description: option.description,
        evidence: option.evidence,
        adoption: option.adoption,
        action: option.action,
      })),
      recommendation: draft.recommendation === null ? null : {
        option_key: draft.recommendation.option_key,
        explanation: draft.recommendation.explanation,
      },
    })),
    expires_at,
  };
}

// 제출 값이 question.submit이 받는 모양과 맞는지. 묶음 크기·선택지 key·추천·고정 action 질문의
// 하나짜리 규칙은 questions의 순수 검사(validateNewGroup)를 쓴다. 고정 action의 모양·hash는
// 적용 직전 questions의 checkOptionAction이 다시 검사하므로 여기서는 모양과 key 짝만 본다.
export function checkDraftSubmission(
  submission: DraftSubmission,
): { ok: true } | { ok: false; reason: string } {
  const group = validateNewGroup(
    submission.questions.map((question, index) => ({
      id: `draft-${index}`,
      options: question.options,
      recommendation: question.recommendation,
    })),
  );
  if (!group.ok) return { ok: false, reason: group.error.message };
  for (const question of submission.questions) {
    for (const option of question.options) {
      if (!questionOptionSchema.safeParse(option).success) {
        return { ok: false, reason: "option shape is not a question option" };
      }
    }
  }
  return { ok: true };
}

// 제출 값이 question.submit 입력 계약(CreateQuestionGroupInput)과 같은 모양인지
// 컴파일 때 본다. action은 이 계약에서 고정 OptionAction | null이다.
export type SubmissionLike =
  CreateQuestionGroupInput["questions"][number]["options"][number];

// lophn이 사람에게 묻는 의도·취향 질문 draft다. 목표·자료 용도·
// project/app 여부·재사용 우선순위를 결정하지 않고 묻는다. 선택지에는 action이
// 없어 답이 없어도 아무것도 바뀌지 않고 기획은 미결정으로 남는다.
export function intentQuestion(goal: string, reuse_order: readonly string[]): {
  prompt: string;
  reason: string;
  options: QuestionOption[];
  recommendation: null;
} {
  const options: QuestionOption[] = reuse_order.map((option, index) => ({
    key: `reuse-${index + 1}`,
    label: option,
    description: `Run the reuse order as: ${option}`,
    evidence: [],
    adoption: null,
    action: null,
  }));
  options.push({
    key: "decide-later",
    label: "Decide later",
    description: "Leave the plan undecided until you answer.",
    evidence: [],
    adoption: null,
    action: null,
  });
  return {
    prompt: `What should the plan for "${goal}" prefer?`,
    reason:
      "The goal is set; making a project or an app and which reuse comes first is your call.",
    options,
    recommendation: null,
  };
}
