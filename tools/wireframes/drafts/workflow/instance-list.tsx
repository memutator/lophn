// workflow 하나의 instance 목록. 새것이 앞이고, 줄마다 시작 입력 한 줄과 아래 줄(상태, 지금 step, 시각)이다.
import { useEffect, useRef } from "react";
import {
  CircleCheck,
  CirclePlay,
  CircleStop,
  MessageCircleMore,
} from "lucide-react";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";

import type {
  WorkflowInstanceSummary,
} from "../../../../packages/protocol/workflows/mod.ts";
import { whenOf } from "../../mock/workflow-data.ts";
import styles from "./workflow.module.css";

export type Shown = "running" | "human" | "ended" | "stopped";

export const shownOf = (
  state: WorkflowInstanceSummary["state"],
  current: WorkflowInstanceSummary["current"],
): Shown =>
  state !== "running" ? state : current?.human_turn ? "human" : "running";

const MARKS = {
  running: { icon: CirclePlay, label: "Running" },
  human: { icon: MessageCircleMore, label: "Your turn" },
  ended: { icon: CircleCheck, label: "Ended" },
  stopped: { icon: CircleStop, label: "Stopped" },
} as const;

/** 상태를 아이콘과 글로 보인다. 색은 거들 뿐이다. */
export function StateMark({ shown }: { shown: Shown }) {
  const mark = MARKS[shown];
  return (
    <span className={styles.stateMark} data-shown={shown}>
      <Icon icon={mark.icon} pixels={iconPixels("base")} />
      <span>{mark.label}</span>
    </span>
  );
}

export function InstanceList(
  { instances, selected, onSelect }: {
    instances: readonly WorkflowInstanceSummary[];
    selected: string | null;
    onSelect: (id: string) => void;
  },
) {
  // 고른 줄이 접힌 목록 밖이면 보이게 맞춘다.
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const row = list.current?.querySelector<HTMLElement>(
      '[aria-current="true"]',
    );
    if (list.current && row) {
      list.current.scrollTop = Math.max(0, row.offsetTop - row.offsetHeight);
    }
  }, [selected]);
  return (
    <ul ref={list} className={styles.instances} aria-label="Instances">
      {instances.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            className={styles.instanceRow}
            aria-current={item.id === selected}
            data-instance={item.id}
            onClick={() => onSelect(item.id)}
          >
            <span className={styles.instanceInput}>{item.input}</span>
            <span className={styles.instanceMeta}>
              <StateMark shown={shownOf(item.state, item.current)} />
              {item.current === null
                ? null
                : <span>at {item.current.step}</span>}
              <span>
                {item.state === "running" ? "Started" : "Finished"}{" "}
                {whenOf(item.finished_at ?? item.created_at)}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
