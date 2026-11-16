// job 한 줄과 펼친 기록. data는 props로 받는다. 줄 오른쪽 끝 고정 열에 switch, Edit, Delete, 기록 토글이 있다.
import { Button, IconButton } from "@lophn/ui/primitives";
import { Skeleton, StatusMark } from "@lophn/ui/feedback";
import { Switch } from "@lophn/ui/input";
import { t } from "@lophn/i18n";

import { actionIcons, commonIcons } from "../../icons/mod.ts";
import {
  actionText,
  creatorText,
  missedText,
  nextText,
  runText,
  runWhen,
  sourceGoneText,
  whenOf,
  STATE,
  whenText,
} from "./model.ts";
import type { JobNames, JobRunView, JobView } from "./source.ts";
import styles from "./jobs.module.css";

/** 펼친 줄의 기록. 읽는 중이면 loading, 읽지 못했으면 failed. 펴지 않았으면 undefined. */
export type History = readonly JobRunView[] | "loading" | "failed";

export interface JobLineProps {
  job: JobView;
  names: JobNames;
  history: History | undefined;
  /** 주인 기계의 이름. 모르면 null. */
  machineName: string | null;
  onToggle: () => void;
  onEnabled: (enabled: boolean) => void;
  /** 셋 다 없으면 그 단추가 없다(다른 기계의 창). */
  onEdit?: () => void;
  onDelete?: () => void;
  onTakeOver?: () => void;
  onOpenSession: (session: string) => void;
  onOpenProject: (project: string) => void;
}

export function JobLine({
  job,
  names,
  history,
  machineName,
  onToggle,
  onEnabled,
  onEdit,
  onDelete,
  onTakeOver,
  onOpenSession,
  onOpenProject,
}: JobLineProps) {
  const now = new Date();
  const action = actionText(job.action, names);
  const last = job.last_run;
  const open = history !== undefined;
  const project =
    job.action.kind === "workflow_start" ? job.action.project : null;
  return (
    <li className={styles.job} data-job={job.id} data-enabled={job.enabled}>
      <div className={styles.head}>
        <div className={styles.main}>
          <span className={styles.title}>{job.title}</span>
          <span className={styles.line}>
            {whenOf(job)} · {nextText(job, now, machineName)}
          </span>
          <span className={styles.line}>
            <span className={styles.summary}>{action.summary}</span>
            <span className={styles.detail}>{action.detail}</span>
          </span>
          <span className={styles.meta}>
            {creatorText(job.creator, names)}
            {job.trigger === null ? ` · ${missedText(job.missed_policy)}` : ""}
          </span>
          {job.runs_here ? null : (
            <span className={styles.meta} data-belongs-elsewhere="">
              {t("jobs.note.belongs-elsewhere")}
            </span>
          )}
          {sourceGoneText(job) === null ? null : (
            <span className={styles.meta} data-source-gone="">
              {sourceGoneText(job)}
            </span>
          )}
          <span className={styles.last}>
            {last === null ? (
              <span className={styles.meta}>{t("jobs.label.not-yet")}</span>
            ) : (
              <>
                <StatusMark
                  tone={STATE[last.state].tone}
                  label={t(STATE[last.state].label)}
                />
                <span className={styles.meta}>
                  {whenText(last.started_at ?? last.due_at, now)}
                </span>
              </>
            )}
          </span>
        </div>
        <div className={styles.controls}>
          <div className={styles.switchSlot}>
            <Switch
              label={
                job.enabled
                  ? t("settings.label.value-on")
                  : t("settings.label.value-off")
              }
              checked={job.enabled}
              onCheckedChange={onEnabled}
            />
          </div>
          {job.runs_here || onTakeOver === undefined ? null : (
            <Button size="sm" data-job-take-over="" onClick={onTakeOver}>
              {t("jobs.button.take-over")}
            </Button>
          )}
          {onEdit === undefined ? null : (
            <Button
              size="sm"
              icon={actionIcons.edit}
              data-job-edit=""
              onClick={onEdit}
            >
              {t("settings.button.edit")}
            </Button>
          )}
          {onDelete === undefined ? null : (
            <Button
              size="sm"
              icon={actionIcons.delete}
              data-job-delete=""
              onClick={onDelete}
            >
              {t("jobs.button.delete")}
            </Button>
          )}
          <IconButton
            icon={open ? commonIcons.collapse : commonIcons.expand}
            label={
              open
                ? t("jobs.button.hide-history")
                : t("jobs.button.show-history")
            }
            size="sm"
            data-job-toggle=""
            aria-expanded={open}
            onClick={onToggle}
          />
        </div>
      </div>
      {history === undefined ? null : history === "loading" ? (
        <Skeleton lines={2} />
      ) : history === "failed" ? (
        <p className={styles.noHistory}>{t("jobs.error.history")}</p>
      ) : history.length === 0 ? (
        <p className={styles.noHistory}>{t("jobs.note.no-history")}</p>
      ) : (
        <ul className={styles.history} aria-label={t("jobs.label.history")}>
          {history.map((row) => (
            <li
              key={row.id}
              className={styles.run}
              data-job-run={row.id}
              data-state={row.state}
            >
              <StatusMark
                tone={STATE[row.state].tone}
                label={t(STATE[row.state].label)}
              />
              <span className={styles.runText}>{runText(row)}</span>
              <span className={styles.runWhen}>{runWhen(row, now)}</span>
              <span className={styles.runAction}>
                {row.session === null ? null : (
                  <Button
                    size="sm"
                    variant="ghost"
                    trailingIcon={actionIcons.open}
                    onClick={() => onOpenSession(row.session!)}
                  >
                    {t("waiting.button.open-session")}
                  </Button>
                )}
                {row.instance !== null && project !== null ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    trailingIcon={actionIcons.open}
                    onClick={() => onOpenProject(project)}
                  >
                    {t("jobs.button.open-project")}
                  </Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
