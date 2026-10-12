// 질문 묶음과 approval 카드가 같이 쓰는 보내기 결과. 결과를 사람이 겪는 일로 바꿔 한 줄로 말한다.
import { t } from "@lophn/wording";

import type { SourceResult } from "./source.ts";
import styles from "./request-card.module.css";

export type CardProblem =
  | "send-failed"
  | "changed"
  | "not-allowed"
  | "review-unavailable"
  | "later-failed"
  | "cancel-failed";

const PROBLEM_TEXT: Record<
  CardProblem,
  | "things-to-confirm.error.send-failed"
  | "things-to-confirm.error.changed"
  | "things-to-confirm.error.not-allowed"
  | "things-to-confirm.error.review-unavailable"
  | "things-to-confirm.error.later-failed"
  | "things-to-confirm.error.cancel-failed"
> = {
  "send-failed": "things-to-confirm.error.send-failed",
  changed: "things-to-confirm.error.changed",
  "not-allowed": "things-to-confirm.error.not-allowed",
  "review-unavailable": "things-to-confirm.error.review-unavailable",
  "later-failed": "things-to-confirm.error.later-failed",
  "cancel-failed": "things-to-confirm.error.cancel-failed",
};

/** 보낸 결과를 사람이 겪는 일로 바꾼다. 결과를 모르는 것은 다시 해 보게 한다. */
export function problemOf(
  result: SourceResult<void>,
  otherwise: CardProblem,
): CardProblem | null {
  if (result.ok) return null;
  if (result.code === "conflict" || result.code === "not_found") {
    return "changed";
  }
  if (result.code === "forbidden" || result.code === "invalid_input") {
    return otherwise === "send-failed" ? "not-allowed" : otherwise;
  }
  return otherwise;
}

export function ProblemLine({ problem }: { problem: CardProblem | null }) {
  if (problem === null) return null;
  return (
    <p className={styles.problem} data-problem={problem}>
      {t(PROBLEM_TEXT[problem])}
    </p>
  );
}
