// composer 위의 agent 계획. 항목마다 상태 표시와 글 한 줄이다.
import { t } from "@lophn/i18n";
import { StatusMark } from "@lophn/ui/feedback";
import type { ReactElement } from "react";

import type { AcpPlan } from "../../../../protocol/acp/mod.ts";
import styles from "./agent-composer.module.css";

const STATUS = {
  pending: { tone: "neutral", label: "conversation.label.plan-pending" },
  in_progress: {
    tone: "warning",
    label: "conversation.label.plan-in-progress",
  },
  completed: { tone: "good", label: "conversation.label.plan-completed" },
} as const;

export function PlanList({ plan }: { plan: AcpPlan }): ReactElement | null {
  if (plan.entries.length === 0) return null;
  return (
    <section
      className={styles.plan}
      aria-label={t("conversation.label.plan")}
      data-plan=""
    >
      <ul className={styles.planList}>
        {plan.entries.map((entry, index) => (
          <li
            key={index}
            className={styles.planItem}
            data-status={entry.status}
          >
            <StatusMark
              tone={STATUS[entry.status].tone}
              label={t(STATUS[entry.status].label)}
            />
            <span className={styles.planText}>{entry.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
