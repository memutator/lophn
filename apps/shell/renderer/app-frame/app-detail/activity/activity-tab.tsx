// Activity 탭. 앱 action·automation 한 번의 기록(안쪽 이름 invocation)은 기본에서 숨기고 사람이
// 펼치면 Activity로 보인다. 요약은 마지막 하나, 목록은 펼친 뒤. 호출 성공은 업무가 맞다는 뜻이
// 아니다. 접수·시작·결과 모름은 서로 다르게 보인다.
import { useState } from "react";
import { Button, StatusMark } from "@lophn/design/components";
import { formatRelativeTime, t } from "@lophn/wording";

import { Loadable } from "../loadable.tsx";
import { activityStatusText, activityTone } from "../model.ts";
import type { ActivityRow, AppDetailSource, BlueprintView } from "../source.ts";
import { useRead } from "../use-read.ts";
import styles from "../app-detail.module.css";

export interface ActivityTabProps {
  app: string;
  source: AppDetailSource;
  now: () => Date;
}

function whatText(row: ActivityRow, blueprint: BlueprintView | null): string {
  if (row.operation.kind === "start") return t("app-detail.label.did-start");
  if (row.operation.kind === "data_change") {
    return t("app-detail.label.did-data-change");
  }
  const key = row.operation.command;
  const label = blueprint?.commands.find((command) => command.key === key)
    ?.label;
  return label === undefined
    ? t("app-detail.label.did-action-unnamed")
    : t("app-detail.label.did-action", { action: label });
}

function whoText(row: ActivityRow): string {
  if (row.caller === "agent") return t("app-detail.label.by-agent");
  if (row.caller === "app") return t("app-detail.label.by-app");
  if (row.trigger.kind === "automation") {
    return t("app-detail.label.by-automation");
  }
  if (row.trigger.kind === "activation") {
    return t("app-detail.label.by-applying");
  }
  if (row.trigger.kind === "restart") return t("app-detail.label.by-restart");
  return t("app-detail.label.by-direct");
}

export function ActivityTab({ app, source, now }: ActivityTabProps) {
  const [open, setOpen] = useState(false);
  const blueprint = useRead(() => source.blueprint(app), [app, source], {
    now,
  });
  const activity = useRead(() => source.activity(app), [app, source], { now });
  const view = blueprint.loaded.state === "ready"
    ? blueprint.loaded.value
    : null;
  return (
    <div className={styles.tab} data-tab-body="activity">
      <Loadable
        read={activity}
        target={t("app-detail.label.activity-target")}
        now={now}
      >
        {(rows) => {
          if (rows.length === 0) {
            return (
              <p className={styles.state} data-activity-empty="">
                {t("app-detail.note.no-activity")}
              </p>
            );
          }
          const last = rows[0];
          return (
            <section className={styles.section}>
              <p className={styles.text} data-activity-summary="">
                {t("app-detail.label.last-activity", {
                  status: activityStatusText(last.status),
                  age: last.at === null
                    ? t("app-detail.label.time-unknown")
                    : formatRelativeTime(new Date(last.at), now()),
                })}
              </p>
              <div className={styles.actions}>
                <Button
                  size="sm"
                  aria-expanded={open}
                  onClick={() => setOpen(!open)}
                  data-activity-toggle=""
                >
                  {open
                    ? t("app-detail.button.hide-activity")
                    : t("app-detail.button.show-activity")}
                </Button>
              </div>
              {open
                ? (
                  <ul className={styles.list} data-activity-list="">
                    {rows.map((row) => (
                      <li
                        key={row.id}
                        className={styles.row}
                        data-activity={row.status}
                      >
                        <div className={styles.rowHead}>
                          <span className={styles.title}>
                            {whatText(row, view)}
                          </span>
                          <StatusMark
                            tone={activityTone(row.status)}
                            label={activityStatusText(row.status)}
                          />
                        </div>
                        <p className={styles.text}>
                          {whoText(row)}
                          {row.mode === "live" ? null : (
                            <>
                              {" · "}
                              {row.mode === "preview"
                                ? t("app-detail.label.mode-preview")
                                : t("app-detail.label.mode-test")}
                            </>
                          )}
                          {" · "}
                          {row.at === null
                            ? t("app-detail.label.time-unknown")
                            : formatRelativeTime(new Date(row.at), now())}
                        </p>
                      </li>
                    ))}
                  </ul>
                )
                : null}
              <p className={styles.muted}>
                {t("app-detail.note.activity-scope")}
              </p>
            </section>
          );
        }}
      </Loadable>
    </div>
  );
}
