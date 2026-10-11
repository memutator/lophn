import type { ReactElement } from "react";

import type { GroupAnswer, QuestionGroupView } from "./model.ts";

export interface QuestionCardProps {
  group: QuestionGroupView;
  /** 지금 시각(epoch ms). 기한의 남은 시간을 이 값으로 센다. 시각은 주입한다. */
  now: number;
  /** true이면 보내기·Skip을 막는다(연결이 끊겼거나 접수 중). */
  disabled?: boolean;
  /**
   * 모든 질문에 답한 뒤 [Submit]을 누르면 질문 순서대로 답 전부를 한 번에 넘긴다.
   * 선택만으로는 부르지 않는다(lophn-agent/questions#R4).
   */
  onSubmit: (answers: readonly GroupAnswer[]) => void;
  /** [Skip]: 묶음 전체를 답 없이 미룬다(DeferQuestionGroup). */
  onSkip: () => void;
}

// 대화 안 질문 묶음 카드. 질문이 QUESTION_CARD_SPREAD_MAX 이하이면 모두 펼치고 넘으면 "1 of N"으로
// 하나씩 넘긴다. 선택지에 번호 키와 추천 표시, 마지막에 Other, 아래에 "Work is paused until you
// answer"와 Skip·Submit을 둔다(shell/desktop#R46). 기한이 있으면 남은 시간을 보이고 머리의 Details를
// 펼치면 질문의 자세한 이유(reason)를 보인다(lophn-agent/questions#R4).
export function QuestionCard(_props: QuestionCardProps): ReactElement {
  throw new Error("not implemented: agent-I25");
}
