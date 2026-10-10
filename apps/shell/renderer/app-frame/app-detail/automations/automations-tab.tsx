// Automations 탭(flow run-app-automation 7). 앱이 선언한 일(command·고정 입력·주기), 지금 시작할 수
// 있는지, 실제로 확인된 활동을 따로 보인다. 켜기는 사람 결정이라 confirmation window로 가고(승인되면
// grant `automation.run`), 끄기는 확인 창 없이 grant 회수다. external이 아닌 일은 앱 실행 허용을
// 따라 별도 승인이 없다.
import { useState } from "react";
import { Button, StatusMark } from "@lophn/design/components";
import { formatRelativeTime, t } from "@lophn/wording";

import { Loadable } from "../loadable.tsx";
import {
  activityStatusText,
  activityTone,
  isAutomationActivity,
  scheduleText,
} from "../model.ts";
import type {
  ActivityRow,
  AppDetailSource,
  AutomationObservation,
  BlueprintAutomation,
  BlueprintView,
  GrantRow,
} from "../source.ts";
import { useRead } from "../use-read.ts";
import styles from "../app-detail.module.css";

export interface AutomationsTabProps {
  app: string;
  source: AppDetailSource;
  now: () => Date;
}

const POLL_MS = 4000;
const RECENT = 3;

type Problem = { automation: string; kind: "decide" | "off" };

export function AutomationsTab({ app, source, now }: AutomationsTabProps) {
  const [asked, setAsked] = useState<ReadonlySet<string>>(new Set());
  const [problem, setProblem] = useState<Problem | null>(null);

  const blueprint = useRead(() => source.blueprint(app), [app, source], {
    now,
  });
  const access = useRead(() => source.access(app), [app, source], {
    pollMs: asked.size > 0 ? POLL_MS : undefined,
    now,
  });
  const seen = useRead(() => source.automations(app), [app, source], { now });
  const activity = useRead(() => source.activity(app), [app, source], { now });

  async function turnOn(automation: BlueprintAutomation): Promise<void> {
    setProblem(null);
    // 확인 창이 거절·닫힘 등으로 확정 없이 끝나면 기다림을 푼다.
    const reply = await source.decide({
      kind: "turn_on_automation",
      app,
      automation: automation.key,
    }, () =>
      setAsked((now) => {
        const next = new Set(now);
        next.delete(automation.key);
        return next;
      }));
    if (reply.ok) setAsked((now) => new Set(now).add(automation.key));
    else setProblem({ automation: automation.key, kind: "decide" });
  }

  async function turnOff(
    automation: BlueprintAutomation,
    grant: GrantRow,
  ): Promise<void> {
    setProblem(null);
    const reply = await source.turnOffAutomation(grant.id);
    if (reply.ok) access.reload();
    else setProblem({ automation: automation.key, kind: "off" });
  }

  const grants = access.loaded.state === "ready"
    ? access.loaded.value.grants
    : [];
  const observations: readonly AutomationObservation[] =
    seen.loaded.state === "ready" ? seen.loaded.value.automations : [];
  const rows: readonly ActivityRow[] = activity.loaded.state === "ready"
    ? activity.loaded.value
    : [];

  return (
    <div className={styles.tab} data-tab-body="automations">
      <Loadable
        read={blueprint}
        target={t("app-detail.label.automations-target")}
        now={now}
      >
        {(view: BlueprintView | null) =>
          view === null || view.automations.length === 0
            ? (
              <p className={styles.state} data-automations-empty="">
                {t("app-detail.note.automations-empty")}
              </p>
            )
            : (
              <ul className={styles.list}>
                {view.automations.map((automation) => {
                  const grant = grants.find((entry) =>
                    entry.active && entry.kind === "automation.run" &&
                    entry.automation === automation.key &&
                    entry.inputHash === automation.inputHash
                  );
                  return (
                    <AutomationCard
                      key={automation.key}
                      automation={automation}
                      actionLabel={view.commands.find((command) =>
                        command.key === automation.command
                      )?.label ?? t("app-detail.label.an-action")}
                      grant={grant ?? null}
                      observation={observations.find((entry) =>
                        entry.key === automation.key
                      ) ?? null}
                      observedAt={seen.loaded.state === "ready"
                        ? seen.loaded.value.observedAt
                        : null}
                      activity={rows.filter((row) =>
                        isAutomationActivity(row, automation.key)
                      )}
                      now={now}
                      waiting={asked.has(automation.key) && grant === undefined}
                      problem={problem?.automation === automation.key
                        ? problem.kind
                        : null}
                      onTurnOn={() => void turnOn(automation)}
                      onTurnOff={() => grant && void turnOff(automation, grant)}
                    />
                  );
                })}
              </ul>
            )}
      </Loadable>
    </div>
  );
}

function AutomationCard(
  {
    automation,
    actionLabel,
    grant,
    observation,
    observedAt,
    activity,
    now,
    waiting,
    problem,
    onTurnOn,
    onTurnOff,
  }: {
    automation: BlueprintAutomation;
    actionLabel: string;
    grant: GrantRow | null;
    observation: AutomationObservation | null;
    observedAt: string | null;
    activity: readonly ActivityRow[];
    now: () => Date;
    waiting: boolean;
    problem: "decide" | "off" | null;
    onTurnOn(): void;
    onTurnOff(): void;
  },
) {
  const on = !automation.external || grant !== null;
  const last = activity[0] ?? null;
  return (
    <li
      className={styles.row}
      data-automation={automation.key}
      data-on={on ? "on" : "off"}
    >
      <div className={styles.rowHead}>
        <span className={styles.title}>{automation.label}</span>
        <StatusMark
          tone={on ? "good" : "neutral"}
          label={on
            ? t("app-detail.label.automation-on")
            : t("app-detail.label.automation-off")}
        />
      </div>
      <dl className={styles.facts}>
        <dt>{t("app-detail.label.fact-action")}</dt>
        <dd data-fact="action">{actionLabel}</dd>
        <dt>{t("app-detail.label.fact-schedule")}</dt>
        <dd data-fact="schedule">{scheduleText(automation.when)}</dd>
        <dt>{t("app-detail.label.fact-input")}</dt>
        <dd data-fact="input">{t("app-detail.label.input-saved")}</dd>
        {observation
          ? (
            <>
              <dt>{t("app-detail.label.fact-can-start")}</dt>
              <dd data-fact="can-start">
                {observation.runnable
                  ? t("app-detail.label.yes")
                  : t("app-detail.label.no")}
              </dd>
              <dt>{t("app-detail.label.fact-seen")}</dt>
              <dd data-fact="seen">
                {observation.observed
                  ? t("app-detail.label.yes")
                  : t("app-detail.label.not-yet")}
              </dd>
            </>
          )
          : null}
      </dl>
      {observedAt !== null
        ? (
          <p className={styles.muted} data-observed-at="">
            {t("app-detail.label.checked-at", {
              age: formatRelativeTime(new Date(observedAt), now()),
            })}
          </p>
        )
        : null}
      {!automation.external
        ? (
          <p className={styles.text} data-follows-app="">
            {t("app-detail.note.automation-follows-app")}
          </p>
        )
        : null}
      {waiting
        ? (
          <p className={styles.text} role="status" data-decision-waiting="">
            {t("app-detail.note.decision-waiting")}
          </p>
        )
        : null}
      {problem === "decide"
        ? (
          <p className={styles.warning} role="alert" data-decision-failed="">
            {t("app-detail.error.decision-failed")}
          </p>
        )
        : null}
      {problem === "off"
        ? (
          <p className={styles.warning} role="alert" data-turn-off-failed="">
            {t("app-detail.error.turn-off-failed", { name: automation.label })}
          </p>
        )
        : null}
      <p className={styles.text} data-last-activity="">
        {last
          ? t("app-detail.label.last-activity", {
            status: activityStatusText(last.status),
            age: last.at === null
              ? t("app-detail.label.time-unknown")
              : formatRelativeTime(new Date(last.at), now()),
          })
          : t("app-detail.note.no-activity")}
      </p>
      {automation.external
        ? (
          <div className={styles.actions}>
            {on
              ? (
                <Button size="sm" onClick={onTurnOff} data-turn-off="">
                  {t("app-detail.button.turn-off")}
                </Button>
              )
              : (
                <Button
                  size="sm"
                  variant="primary"
                  disabled={waiting}
                  onClick={onTurnOn}
                  data-turn-on=""
                >
                  {t("app-detail.button.turn-on")}
                </Button>
              )}
          </div>
        )
        : null}
      {activity.length > 0 || automation.inputHash !== ""
        ? (
          <details className={styles.details} data-automation-details="">
            <summary>{t("app-detail.label.details")}</summary>
            {activity.slice(0, RECENT).map((row) => (
              <div key={row.id} className={styles.text} data-recent="">
                <StatusMark
                  tone={activityTone(row.status)}
                  label={activityStatusText(row.status)}
                />{" "}
                {row.at === null
                  ? t("app-detail.label.time-unknown")
                  : formatRelativeTime(new Date(row.at), now())}
              </div>
            ))}
            {automation.inputHash !== ""
              ? (
                <p className={styles.mono} data-input-hash="">
                  {automation.inputHash}
                </p>
              )
              : null}
          </details>
        )
        : null}
    </li>
  );
}
