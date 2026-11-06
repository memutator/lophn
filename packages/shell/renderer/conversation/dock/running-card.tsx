// dock의 Running card: 도는 subagent와 background task. 줄은 hover·focus 때 경과 시간 자리에 [Stop]이 뜬다(OpenCode).
// subagent 줄을 누르면 자식 대화를 열고, task 줄을 누르면 출력을 펼친다.
import { t } from "@lophn/i18n";
import { IconButton, Icon, Button } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { type ReactElement, useState } from "react";

import type { AcpTask } from "../../../../protocol/acp/mod.ts";
import { elapsedText, useSecondTick } from "../activity/elapsed.ts";
import { SubagentMark } from "../activity/subagent-row.tsx";
import { conversationIcons } from "../../icons/mod.ts";
import type { ThreadSubagent } from "../agent-tab-source.ts";
import { DockCard } from "./dock-card.tsx";
import styles from "./composer-dock.module.css";

const SHOWN = 5;

interface RunningCardProps {
  /** 도는 subagent만. */
  subagents: readonly ThreadSubagent[];
  /** 도는 background task만. */
  tasks: readonly AcpTask[];
  /** capability `stop_child`. */
  canStopChild: boolean;
  /** capability `tasks`. */
  canStopTask: boolean;
  now: () => number;
  open: boolean;
  onToggle: () => void;
  onOpenChild: (child: string) => void;
  onStopChild: (child: string) => void;
  onStopTask: (task: string) => void;
}

/** 경과 시간과 그 자리를 덮는 [Stop]. Stop은 hover·focus 때만 보이지만 키보드로 늘 닿는다. */
function Trail({
  time,
  stop,
}: {
  time: string;
  stop: { label: string; onStop: () => void } | null;
}): ReactElement {
  return (
    <span className={styles.trail} data-stoppable={stop !== null || undefined}>
      <span className={styles.elapsed}>{time}</span>
      {stop === null ? null : (
        <span className={styles.stop}>
          <IconButton
            icon={conversationIcons.stop}
            label={stop.label}
            size="sm"
            onClick={stop.onStop}
          />
        </span>
      )}
    </span>
  );
}

function SubagentRun({
  entry,
  now,
  canStop,
  onOpen,
  onStop,
}: {
  entry: ThreadSubagent;
  now: () => number;
  canStop: boolean;
  onOpen: (child: string) => void;
  onStop: (child: string) => void;
}): ReactElement {
  const child = entry.child;
  return (
    <li className={styles.run} data-run-subagent={entry.id}>
      <button
        type="button"
        className={styles.runMain}
        disabled={child === null}
        onClick={() => child !== null && onOpen(child)}
      >
        <SubagentMark state={entry.state} />
        <span className={styles.runAgent}>{entry.agent}</span>
        {entry.last === null ? null : (
          <span className={styles.runLast}>{entry.last}</span>
        )}
      </button>
      <Trail
        time={elapsedText(true, entry.startedAt, null, now)}
        stop={
          canStop && child !== null
            ? {
                label: t("conversation.button.dock-stop"),
                onStop: () => onStop(child),
              }
            : null
        }
      />
    </li>
  );
}

function TaskRun({
  task,
  now,
  canStop,
  onStop,
}: {
  task: AcpTask;
  now: () => number;
  canStop: boolean;
  onStop: (task: string) => void;
}): ReactElement {
  const [shown, setShown] = useState(false);
  const output = task.output;
  const head = (
    <>
      <Icon
        icon={
          task.kind === "agent"
            ? conversationIcons.taskAgent
            : conversationIcons.taskShell
        }
        pixels={iconPixels("small")}
      />
      <span className={styles.runAgent}>{task.description}</span>
    </>
  );
  return (
    <li className={styles.run} data-run-task={task.id}>
      {output === null ? (
        <span className={styles.runMain}>{head}</span>
      ) : (
        <button
          type="button"
          className={styles.runMain}
          aria-expanded={shown}
          onClick={() => setShown(!shown)}
        >
          {head}
        </button>
      )}
      <Trail
        time={elapsedText(true, task.started_at, null, now)}
        stop={
          canStop
            ? {
                label: t("conversation.button.dock-stop"),
                onStop: () => onStop(task.id),
              }
            : null
        }
      />
      {shown && output !== null ? (
        <div className={styles.runOutput}>
          <pre className={styles.outputText}>{output}</pre>
        </div>
      ) : null}
    </li>
  );
}

export function RunningCard(props: RunningCardProps): ReactElement {
  const [all, setAll] = useState(false);
  useSecondTick(true);
  const rows: (
    | { key: string; entry: ThreadSubagent }
    | { key: string; task: AcpTask }
  )[] = [
    ...props.subagents.map((entry) => ({ key: entry.id, entry })),
    ...props.tasks.map((task) => ({ key: task.id, task })),
  ];
  const shown = all ? rows : rows.slice(0, SHOWN);
  return (
    <DockCard
      id="running"
      icon={conversationIcons.running}
      open={props.open}
      onToggle={props.onToggle}
      summary={t("conversation.label.dock-running", { count: rows.length })}
    >
      <ul className={styles.list}>
        {shown.map((row) =>
          "entry" in row ? (
            <SubagentRun
              key={row.key}
              entry={row.entry}
              now={props.now}
              canStop={props.canStopChild}
              onOpen={props.onOpenChild}
              onStop={props.onStopChild}
            />
          ) : (
            <TaskRun
              key={row.key}
              task={row.task}
              now={props.now}
              canStop={props.canStopTask}
              onStop={props.onStopTask}
            />
          ),
        )}
      </ul>
      {rows.length > shown.length ? (
        <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
          {t("conversation.button.dock-more", {
            count: rows.length - shown.length,
          })}
        </Button>
      ) : null}
    </DockCard>
  );
}
