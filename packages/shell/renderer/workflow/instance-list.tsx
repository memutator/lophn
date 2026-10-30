// workflow 하나의 instance 목록. 새것이 앞이고, 줄마다 시작 입력 한 줄과 아래 줄(상태, 지금 step, 시각)이다.
import { useEffect, useRef } from "react";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import { commonIcons } from "../icons/mod.ts";
import type { WorkflowInstanceSummaryView } from "../workspace/source.ts";
import { type Shown, shownOf, STATE_KEY, whenOf } from "./model.ts";
import styles from "./instance-list.module.css";

const STATE_ICON = {
  running: commonIcons.stateRunning,
  human: commonIcons.stateYourTurn,
  ended: commonIcons.stateEnded,
  stopped: commonIcons.stateStopped,
} as const;

/** 상태를 아이콘과 글로 보인다. 색은 거들 뿐이다. */
export function StateMark({ shown }: { shown: Shown }) {
  return (
    <span className={styles.stateMark} data-shown={shown}>
      <Icon icon={STATE_ICON[shown]} pixels={iconPixels("base")} />
      <span>{t(STATE_KEY[shown])}</span>
    </span>
  );
}

export function InstanceList({
  instances,
  selected,
  onSelect,
}: {
  instances: readonly WorkflowInstanceSummaryView[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
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
    <ul
      ref={list}
      className={styles.instances}
      aria-label={t("workflow.heading.instances")}
    >
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
              {item.current === null ? null : (
                <span>
                  {t("workflow.label.at-step", { step: item.current.step })}
                </span>
              )}
              <span>
                {item.state === "running"
                  ? t("workflow.label.started-at", {
                      when: whenOf(item.created_at),
                    })
                  : t("workflow.label.finished-at", {
                      when: whenOf(item.finished_at ?? item.created_at),
                    })}
              </span>
              {item.started_by.kind === "job" ? (
                <span data-started-by="job">
                  {item.started_by.title === null
                    ? t("workflow.label.job-meta-untitled")
                    : t("workflow.label.job-meta", {
                        title: item.started_by.title,
                      })}
                </span>
              ) : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
