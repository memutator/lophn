// job 한 줄과 펼친 기록. data는 props로 받는다. 줄 오른쪽 끝 고정 열에 switch, Edit, Delete, 기록 토글이 있다.
import { Button, IconButton } from "@lophn/ui/primitives";
import { StatusMark } from "@lophn/ui/feedback";
import { Switch } from "@lophn/ui/input";

import { commonIcons } from "../../../../packages/shell/renderer/icons/mod.ts";
import type {
  JobRunView,
  JobView,
  NAMES,
} from "../../mock/jobs-screen-data.ts";
import {
  actionText,
  creatorText,
  everyText,
  missedText,
  nextText,
  runText,
  runWhen,
  STATE,
  whenText,
} from "./jobs-text.ts";
import styles from "./jobs.module.css";

export interface JobLineProps {
  job: JobView;
  names: typeof NAMES;
  /** 펼쳤을 때만 읽은 기록. 펴지 않았으면 undefined. */
  history: readonly JobRunView[] | undefined;
  onToggle: () => void;
  onEnabled: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  onOpenSession: (session: string) => void;
  onOpenProject: (project: string) => void;
}

export function JobLine(
  {
    job,
    names,
    history,
    onToggle,
    onEnabled,
    onEdit,
    onDelete,
    onOpenSession,
    onOpenProject,
  }: JobLineProps,
) {
  const action = actionText(job.action, names);
  const last = job.last_run;
  const open = history !== undefined;
  const project = job.action.kind === "workflow_start"
    ? job.action.project
    : null;
  return (
    <li className={styles.job} data-job={job.id} data-enabled={job.enabled}>
      <div className={styles.head}>
        <div className={styles.main}>
          <span className={styles.title}>{job.title}</span>
          <span className={styles.line}>
            {everyText(job.every, job.at)} · {nextText(job)}
          </span>
          <span className={styles.line}>
            <span className={styles.summary}>{action.summary}</span>
            <span className={styles.detail}>{action.detail}</span>
          </span>
          <span className={styles.meta}>
            {creatorText(job.creator, names)} · {missedText(job.missed_policy)}
          </span>
          <span className={styles.last}>
            {last === null
              ? <span className={styles.meta}>Has not run yet</span>
              : (
                <>
                  <StatusMark
                    tone={STATE[last.state].tone}
                    label={STATE[last.state].label}
                  />
                  <span className={styles.meta}>
                    {whenText(last.started_at ?? last.due_at)}
                  </span>
                </>
              )}
          </span>
        </div>
        <div className={styles.controls}>
          <div className={styles.switchSlot}>
            <Switch
              label={job.enabled ? "On" : "Off"}
              checked={job.enabled}
              onCheckedChange={onEnabled}
            />
          </div>
          <Button size="sm" data-job-edit="" onClick={onEdit}>Edit</Button>
          <Button size="sm" data-job-delete="" onClick={onDelete}>
            Delete
          </Button>
          <IconButton
            icon={open ? commonIcons.collapse : commonIcons.expand}
            label={open ? "Hide history" : "Show history"}
            size="sm"
            data-job-toggle=""
            aria-expanded={open}
            onClick={onToggle}
          />
        </div>
      </div>
      {history === undefined
        ? null
        : history.length === 0
        ? <p className={styles.noHistory}>It has not run yet.</p>
        : (
          <ul className={styles.history} aria-label="History">
            {history.map((row) => (
              <li
                key={row.id}
                className={styles.run}
                data-job-run={row.id}
                data-state={row.state}
              >
                <StatusMark
                  tone={STATE[row.state].tone}
                  label={STATE[row.state].label}
                />
                <span className={styles.runText}>{runText(row)}</span>
                <span className={styles.runWhen}>{runWhen(row)}</span>
                <span className={styles.runAction}>
                  {row.session === null ? null : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onOpenSession(row.session!)}
                    >
                      Open session
                    </Button>
                  )}
                  {row.instance !== null && project !== null
                    ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onOpenProject(project)}
                      >
                        Open project
                      </Button>
                    )
                    : null}
                </span>
              </li>
            ))}
          </ul>
        )}
    </li>
  );
}
