// workflow 하나의 run 목록. 사람 차례, 도는 것, 끝났거나 멈춘 것 순으로 묶어 보인다. 줄을 누르면 그 run 화면으로 간다.
import { useState } from "react";
import { Button, Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import { commonIcons } from "../icons/mod.ts";
import type { WorkflowInstanceSummaryView } from "../workspace/source.ts";
import { groupRuns, runTitle, shownOf, whenOf } from "./model.ts";
import styles from "./run-list.module.css";
import { StateMark } from "./state-mark.tsx";

/** 끝난 run은 이만큼만 보이고 나머지는 [Show all]로 편다. */
const EARLIER_SHOWN = 5;

function RunRow({
  item,
  onSelect,
}: {
  item: WorkflowInstanceSummaryView;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className={styles.row}
        data-instance={item.id}
        onClick={() => onSelect(item.id)}
      >
        <span className={styles.main}>
          <span className={styles.title}>{runTitle(item.input)}</span>
          <span className={styles.meta}>
            <StateMark shown={shownOf(item.state, item.current)} />
            {item.current === null || item.state !== "running" ? null : (
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
        </span>
        <span className={styles.go} aria-hidden="true">
          <Icon icon={commonIcons.expand} pixels={iconPixels("base")} />
        </span>
      </button>
    </li>
  );
}

function Group({
  id,
  title,
  items,
  onSelect,
}: {
  id: string;
  title: string;
  items: readonly WorkflowInstanceSummaryView[];
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className={styles.group} data-run-group={id}>
      <h3 className={styles.groupTitle}>
        {title}
        <span className={styles.count}>{items.length}</span>
      </h3>
      <ul className={styles.rows} aria-label={title}>
        {items.map((item) => (
          <RunRow key={item.id} item={item} onSelect={onSelect} />
        ))}
      </ul>
    </section>
  );
}

export function RunList({
  instances,
  onSelect,
}: {
  instances: readonly WorkflowInstanceSummaryView[];
  onSelect: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  const groups = groupRuns(instances);
  const earlier = all ? groups.earlier : groups.earlier.slice(0, EARLIER_SHOWN);
  return (
    <div className={styles.list}>
      <Group
        id="needs-you"
        title={t("workflow.heading.runs-needs-you")}
        items={groups.needsYou}
        onSelect={onSelect}
      />
      <Group
        id="running"
        title={t("workflow.heading.runs-running")}
        items={groups.running}
        onSelect={onSelect}
      />
      <Group
        id="earlier"
        title={t("workflow.heading.runs-earlier")}
        items={earlier}
        onSelect={onSelect}
      />
      {groups.earlier.length > EARLIER_SHOWN && !all ? (
        <span className={styles.more}>
          <Button
            size="sm"
            variant="ghost"
            icon={commonIcons.collapse}
            onClick={() => setAll(true)}
          >
            {t("workflow.button.show-all-runs", {
              count: groups.earlier.length,
            })}
          </Button>
        </span>
      ) : null}
    </div>
  );
}
