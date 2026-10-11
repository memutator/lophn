import type { ReactElement } from "react";
import { Button, Popover } from "@lophn/design/components";

import type { TaskState, TaskView } from "./model.ts";
import styles from "./activity.module.css";

export interface ProgressChipProps {
  /** 일하는 중의 할 일 목록. 비어 있으면 chip을 그리지 않는다. */
  tasks: readonly TaskView[];
}

const MARK: Record<TaskState, string> = { done: "✓", now: "●", later: "○" };

// header의 진행 chip("2/4" = 끝낸 수/전체). 누르면 Tasks popover가 열리고 줄마다
// ✓ 끝남, ● 지금, ○ 남음을 보인다(shell/desktop#R42).
export function ProgressChip(
  { tasks }: ProgressChipProps,
): ReactElement | null {
  if (tasks.length === 0) return null;
  const done = tasks.filter((task) => task.state === "done").length;
  return (
    <Popover
      placement="beside"
      trigger={
        <Button size="sm" variant="secondary" aria-label="Tasks">
          {`${done}/${tasks.length}`}
        </Button>
      }
    >
      <div className={styles.tasks}>
        <p className={styles.tasksHead}>Tasks · {done} of {tasks.length}</p>
        <ol className={styles.taskList}>
          {tasks.map((task) => (
            <li
              key={task.id}
              className={styles.task}
              data-task={task.id}
              data-state={task.state}
            >
              <span className={styles.taskMark}>{MARK[task.state]}</span>{" "}
              {task.text}
            </li>
          ))}
        </ol>
      </div>
    </Popover>
  );
}
