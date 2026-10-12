import type { ReactElement } from "react";
import { Icon, iconPixels } from "@lophn/design/components";
import { confirmIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import type {
  AnswerSummaryStatus,
  GroupAnswer,
  QuestionGroupView,
} from "./model.ts";
import styles from "./answered-summary.module.css";

export interface AnsweredSummaryProps {
  group: QuestionGroupView;
  status: AnswerSummaryStatus;
  /** 받은 답. 자유 답은 글을 읽어 text로 넣는다. skipped·expired·cancelled이면 비어 있다. */
  answers: readonly GroupAnswer[];
}

// 질문 순서대로 고른 선택지 이름이나 쓴 글. 답이 없는 질문은 건너뛴다.
function answerLabels(
  group: QuestionGroupView,
  answers: readonly GroupAnswer[],
): string {
  const labels: string[] = [];
  for (const question of group.questions) {
    const given = answers.find((answer) => answer.question === question.id);
    if (given === undefined) continue;
    const answer = given.answer;
    labels.push(
      answer.kind === "text"
        ? answer.text
        : question.options.find((option) => option.key === answer.option_key)
          ?.label ?? answer.option_key,
    );
  }
  return labels.join(" · ");
}

// 카드가 그 자리에 접힌 한 줄 요약으로 남는다(shell/desktop#R46). 문구는 상태를 따른다:
// "Answered …"(답 접수), "Applying …", "Applied …", "Couldn't apply …", "Skipped", "Expired",
// "Cancelled". 답 접수와 적용 완료가 같아 보이지 않는다(lophn-agent/questions#R10).
export function AnsweredSummary(
  { group, status, answers }: AnsweredSummaryProps,
): ReactElement {
  const labels = answerLabels(group, answers);
  const line = {
    answered: () =>
      t("conversation.label.question-answered", {
        count: group.questions.length,
        answers: labels,
      }),
    applying: () =>
      t("conversation.label.question-applying", { answers: labels }),
    applied: () =>
      t("conversation.label.question-applied", { answers: labels }),
    apply_failed: () =>
      t("conversation.label.question-apply-failed", { answers: labels }),
    skipped: () => t("conversation.label.question-skipped"),
    expired: () => t("conversation.label.question-expired"),
    cancelled: () => t("conversation.label.question-cancelled"),
  }[status]();
  return (
    <p
      className={styles.summary}
      data-answered-summary=""
      data-status={status}
    >
      <Icon icon={confirmIcons.confirmCancel} pixels={iconPixels("base")} />
      <span>{line}</span>
    </p>
  );
}
