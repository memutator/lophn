// workflow 탭의 `InstanceList` 줄과 `InstanceView` 머리의 복사본. 시작한 쪽이 job이면 목록 줄 meta에
// "Scheduled job · {제목}", instance 머리에 "Started by Scheduled job {제목}"을 보인다. 지워진 job은 제목 없이
// 각각 "Scheduled job"과 "Started by a scheduled job"이다. 새 CSS 없이 기존 class만 쓴다.
import { t } from "@lophn/wording";

import { StateMark } from "../../../../packages/shell/renderer/workflow/instance-list.tsx";
import {
  shownOf,
  whenOf,
} from "../../../../packages/shell/renderer/workflow/model.ts";
import list from "../../../../packages/shell/renderer/workflow/instance-list.module.css";
import view from "../../../../packages/shell/renderer/workflow/instance-view.module.css";
import {
  type InstanceSummaryView,
  JOB_TITLES,
} from "../../mock/jobs-origin-data.ts";

function jobTitle(item: InstanceSummaryView): string | null | undefined {
  // undefined: 사람이 시작했다. null: job이 시작했는데 지워졌다.
  return item.started_by.kind === "user"
    ? undefined
    : JOB_TITLES[item.started_by.job] ?? null;
}

export function InstanceRows(
  { instances, selected }: {
    instances: readonly InstanceSummaryView[];
    selected: string;
  },
) {
  return (
    <ul className={list.instances} aria-label={t("workflow.heading.instances")}>
      {instances.map((item) => {
        const title = jobTitle(item);
        return (
          <li key={item.id}>
            <button
              type="button"
              className={list.instanceRow}
              aria-current={item.id === selected}
              data-instance={item.id}
            >
              <span className={list.instanceInput}>{item.input}</span>
              <span className={list.instanceMeta}>
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
                {title === undefined ? null : (
                  <span data-started-by="job">
                    {title === null
                      ? "Scheduled job"
                      : `Scheduled job · ${title}`}
                  </span>
                )}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** instance 하나의 머리: 상태, 시작한 때, 시작한 쪽(job일 때), 시작 입력. */
export function InstanceHead({ item }: { item: InstanceSummaryView }) {
  const title = jobTitle(item);
  return (
    <section className={view.instance} data-instance-view={item.id}>
      <div className={view.instanceHead}>
        <StateMark shown={shownOf(item.state, item.current)} />
        <span className={view.when}>
          {t("workflow.label.started-at", { when: whenOf(item.created_at) })}
        </span>
        {title === undefined
          ? null
          : (
            <span className={view.when} data-started-by="job">
              {title === null
                ? "Started by a scheduled job"
                : `Started by Scheduled job ${title}`}
            </span>
          )}
      </div>
      <div>
        <span className={view.inputLabel}>{t("workflow.label.input")}</span>
        <p className={view.inputText}>{item.input}</p>
      </div>
    </section>
  );
}
