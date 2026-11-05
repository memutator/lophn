// composer 위 dock: 승인·질문 card 아래, composer 위의 한 자리다. Goal → Todo → Running → Queue card를 같은 규칙으로
// 쌓는다. 내용이 없는 card는 그리지 않고 card가 하나도 없으면 dock도 없다. card 하나만 펼쳐진다(다른 card를 펼치면 앞 card는 접힌다).
import { t } from "@lophn/i18n";
import { type ComponentProps, type ReactElement, useEffect } from "react";

import type {
  AcpGoal,
  AcpPlan,
  AcpTask,
} from "../../../../protocol/acp/mod.ts";
import { conversationIcons } from "../../icons/mod.ts";
import type { ThreadSubagent } from "../agent-tab-source.ts";
import { QueuedMessages } from "../queued/queued-messages.tsx";
import { DockCard } from "./dock-card.tsx";
import { GoalCard } from "./goal-card.tsx";
import { TodoCard } from "./plan-card.tsx";
import { RunningCard } from "./running-card.tsx";
import styles from "./composer-dock.module.css";

export type DockCardId = "goal" | "todo" | "running" | "queue";

interface ComposerDockProps {
  /** 펼쳐진 card. 명령(`/goal`, `/subagents`, `/tasks`)이 열 수 있게 부모가 쥔다. */
  open: DockCardId | null;
  onOpenChange: (open: DockCardId | null) => void;
  goal: AcpGoal | null;
  /** capability `goal`. */
  canSetGoal: boolean;
  onSetGoal: (input: { objective: string | null; paused: boolean }) => void;
  plan: AcpPlan | null;
  /** 도는 subagent만. */
  subagents: readonly ThreadSubagent[];
  /** 도는 background task만. */
  tasks: readonly AcpTask[];
  /** capability `stop_child`. */
  canStopChild: boolean;
  /** capability `tasks`. */
  canStopTask: boolean;
  onOpenChild: (child: string) => void;
  onStopChild: (child: string) => void;
  onStopTask: (task: string) => void;
  now: () => number;
  queue: ComponentProps<typeof QueuedMessages>;
}

export function ComposerDock(props: ComposerDockProps): ReactElement | null {
  const { open, onOpenChange } = props;
  const toggle = (id: DockCardId) => () =>
    onOpenChange(open === id ? null : id);
  const running = props.subagents.length + props.tasks.length > 0;
  const cards = [
    props.goal === null ? null : (
      <GoalCard
        key="goal"
        goal={props.goal}
        canSet={props.canSetGoal}
        open={open === "goal"}
        onToggle={toggle("goal")}
        onSet={props.onSetGoal}
      />
    ),
    props.plan === null || props.plan.entries.length === 0 ? null : (
      <TodoCard
        key="todo"
        plan={props.plan}
        open={open === "todo"}
        onToggle={toggle("todo")}
      />
    ),
    running ? (
      <RunningCard
        key="running"
        subagents={props.subagents}
        tasks={props.tasks}
        canStopChild={props.canStopChild}
        canStopTask={props.canStopTask}
        now={props.now}
        open={open === "running"}
        onToggle={toggle("running")}
        onOpenChild={props.onOpenChild}
        onStopChild={props.onStopChild}
        onStopTask={props.onStopTask}
      />
    ) : null,
    props.queue.items.length === 0 ? null : (
      <DockCard
        key="queue"
        id="queue"
        icon={conversationIcons.request}
        open={open === "queue"}
        onToggle={toggle("queue")}
        summary={t("conversation.label.dock-queued", {
          count: props.queue.items.length,
        })}
      >
        <QueuedMessages {...props.queue} />
      </DockCard>
    ),
  ].filter((card): card is ReactElement => card !== null);
  // 펼친 card가 사라지면(도는 일이 끝났다) 다음에 그 card가 다시 생겨도 저절로 펼쳐지지 않게 접는다.
  const shown = open !== null && cards.some((card) => card.key === open);
  useEffect(() => {
    if (open !== null && !shown) onOpenChange(null);
  }, [open, shown]);
  if (cards.length === 0) return null;
  return (
    <div
      className={styles.dock}
      aria-label={t("conversation.label.dock")}
      data-composer-dock=""
    >
      {cards}
    </div>
  );
}
