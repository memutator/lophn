// dock의 Todo card. 접힌 요약은 "지금 하는 항목 · 끝난 수/전체"이고 펼치면 목록이다. 10개가 넘으면 남은 것은 다 보이고 끝난
// 것은 최근 3개만 보인다.
import { t } from "@lophn/i18n";
import { StatusMark } from "@lophn/ui/feedback";
import { Button } from "@lophn/ui/primitives";
import { type ReactElement, useState } from "react";

import type { AcpPlan } from "../../../../protocol/acp/mod.ts";
import { conversationIcons } from "../../icons/mod.ts";
import { DockCard } from "./dock-card.tsx";
import styles from "./composer-dock.module.css";

const LONG = 10;
const KEPT_DONE = 3;

const STATUS = {
  pending: { tone: "neutral", label: "conversation.label.plan-pending" },
  in_progress: {
    tone: "warning",
    label: "conversation.label.plan-in-progress",
  },
  completed: { tone: "good", label: "conversation.label.plan-completed" },
  cancelled: { tone: "neutral", label: "conversation.label.plan-cancelled" },
} as const;

type Entry = AcpPlan["entries"][number];

/** 끝난 항목(완료, 취소) 중 최근 3개를 뺀 앞쪽은 접는다. 짧은 목록은 접지 않는다. */
function foldedAway(entries: readonly Entry[]): ReadonlySet<Entry> {
  if (entries.length <= LONG) return new Set();
  const finished = entries.filter(
    (entry) => entry.status === "completed" || entry.status === "cancelled",
  );
  return new Set(finished.slice(0, Math.max(0, finished.length - KEPT_DONE)));
}

export function TodoCard({
  plan,
  open,
  onToggle,
}: {
  plan: AcpPlan;
  open: boolean;
  onToggle: () => void;
}): ReactElement {
  const [all, setAll] = useState(false);
  const { entries } = plan;
  const done = entries.filter((entry) => entry.status === "completed").length;
  const current =
    entries.find((entry) => entry.status === "in_progress") ??
    entries.find((entry) => entry.status === "pending");
  const hidden = all ? new Set<Entry>() : foldedAway(entries);
  return (
    <DockCard
      id="todo"
      icon={conversationIcons.todo}
      open={open}
      onToggle={onToggle}
      summary={
        <>
          <span>{current?.text ?? t("conversation.label.dock-todo")}</span>
          <span className={styles.count}>
            {t("conversation.label.dock-todo-count", {
              done,
              total: entries.length,
            })}
          </span>
        </>
      }
    >
      <ul className={styles.list} aria-label={t("conversation.label.plan")}>
        {entries
          .filter((entry) => !hidden.has(entry))
          .map((entry, index) => (
            <li key={index} className={styles.plan} data-status={entry.status}>
              <StatusMark
                tone={STATUS[entry.status].tone}
                label={t(STATUS[entry.status].label)}
              />
              <span className={styles.planText}>{entry.text}</span>
            </li>
          ))}
      </ul>
      {hidden.size === 0 ? null : (
        <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
          {t("conversation.button.dock-more", { count: hidden.size })}
        </Button>
      )}
    </DockCard>
  );
}
