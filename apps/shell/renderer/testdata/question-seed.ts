// question-core.ts가 실제 core에 심는 질문·approval의 id와 글. 실제 core 테스트와 headless
// 확인이 같은 값을 본다. 이 파일은 아무것도 import하지 않는다(renderer bundle에도 들어간다).

export const SEED_SESSION = "ses_01k6qs0000000000000000000a";
export const SEED_QUESTION = "qst_01k6qs0000000000000000000a";
export const SEED_APPROVAL = "apr_01k6qs0000000000000000000a";

export const SEED_PROMPT = "Which copy of the weekly notes should stay?";
export const SEED_REASON =
  "Both copies changed since Monday, and they disagree on the budget.";
export const SEED_OPTIONS = [
  {
    key: "newer",
    label: "Keep the newer copy",
    description: "It has this week's budget numbers.",
  },
  {
    key: "both",
    label: "Keep both copies",
    description: "The older one is renamed so nothing is lost.",
  },
] as const;
export const SEED_RECOMMENDED = "newer";
export const SEED_WHY = "The newer copy already includes the older edits.";
