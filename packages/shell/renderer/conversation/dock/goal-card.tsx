// dock의 Goal card. 접힌 요약은 목표 한 줄과 상태이고, 펼치면 상세와 [Pause]/[Resume], [Clear]가 있다. 단추는 capability `goal`일 때만이다.
import { t } from "@lophn/i18n";
import { Button } from "@lophn/ui/primitives";
import type { ReactElement } from "react";

import type { AcpGoal } from "../../../../protocol/acp/mod.ts";
import { actionIcons, conversationIcons } from "../../icons/mod.ts";
import { DockCard } from "./dock-card.tsx";
import styles from "./composer-dock.module.css";

const STATUS = {
  active: "conversation.label.goal-active",
  paused: "conversation.label.goal-paused",
  blocked: "conversation.label.goal-blocked",
  done: "conversation.label.goal-done",
} as const;

export function GoalCard({
  goal,
  canSet,
  open,
  onToggle,
  onSet,
}: {
  goal: AcpGoal;
  /** capability `goal`. */
  canSet: boolean;
  open: boolean;
  onToggle: () => void;
  /** `set_goal`. objective가 null이면 지운다. */
  onSet: (input: { objective: string | null; paused: boolean }) => void;
}): ReactElement {
  const paused = goal.status === "paused";
  const switchable = goal.status === "active" || paused;
  return (
    <DockCard
      id="goal"
      icon={conversationIcons.goal}
      open={open}
      onToggle={onToggle}
      summary={
        <>
          <span>{goal.objective}</span>
          <span className={styles.count}>{t(STATUS[goal.status])}</span>
        </>
      }
    >
      <p className={styles.goalObjective}>{goal.objective}</p>
      {goal.detail === null ? null : (
        <p className={styles.note}>{goal.detail}</p>
      )}
      {canSet ? (
        <div className={styles.actions}>
          <Button
            size="sm"
            variant="ghost"
            icon={actionIcons.remove}
            onClick={() => onSet({ objective: null, paused: false })}
          >
            {t("conversation.button.goal-clear")}
          </Button>
          {switchable ? (
            <Button
              size="sm"
              variant="secondary"
              icon={paused ? actionIcons.run : conversationIcons.pause}
              onClick={() =>
                onSet({ objective: goal.objective, paused: !paused })
              }
            >
              {t(
                paused
                  ? "conversation.button.goal-resume"
                  : "conversation.button.goal-pause",
              )}
            </Button>
          ) : null}
        </div>
      ) : null}
    </DockCard>
  );
}
