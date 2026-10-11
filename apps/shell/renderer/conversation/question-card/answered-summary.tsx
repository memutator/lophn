import type { ReactElement } from "react";

import type {
  AnswerSummaryStatus,
  GroupAnswer,
  QuestionGroupView,
} from "./model.ts";

export interface AnsweredSummaryProps {
  group: QuestionGroupView;
  status: AnswerSummaryStatus;
  /** 받은 답. 자유 답은 글을 읽어 text로 넣는다. skipped·expired·cancelled이면 비어 있다. */
  answers: readonly GroupAnswer[];
}

// 카드가 그 자리에 접힌 한 줄 요약으로 남는다(shell/desktop#R46). 문구는 상태를 따른다:
// "Answered …"(답 접수), "Applying …", "Applied …", "Couldn't apply …", "Skipped", "Expired",
// "Cancelled". 답 접수와 적용 완료가 같아 보이지 않는다(lophn-agent/questions#R10).
export function AnsweredSummary(_props: AnsweredSummaryProps): ReactElement {
  throw new Error("not implemented: agent-I25");
}
