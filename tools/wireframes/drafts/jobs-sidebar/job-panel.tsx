// project sidebar의 Scheduled jobs panel 본문. 줄은 제목, 오른쪽 끝 고정 열의 switch, 아래 줄(주기 글과 상태 하나)이다.
// 줄을 누르면 Settings › System › Scheduled jobs를 열고(그 job을 펼치지는 않는다) 맨 아래 단추도 같은 곳으로 간다.
// 이 파일을 `sj-shell-jobs-sidebar`가 옮긴다. data는 props로 받고, 이 project에 걸린 job만 거른다.
import { StatusMark } from "@lophn/ui/feedback";
import { Switch } from "@lophn/ui/input";
import { Button } from "@lophn/ui/primitives";

import sidebar from "../../../../packages/shell/renderer/workspace/sidebar/project-sidebar.module.css";
import type { JobView } from "../../mock/jobs-sidebar-data.ts";
import { everyText, failed, isProjectJob, stateText } from "./jobs-text.ts";
import styles from "./jobs-sidebar.module.css";

export interface JobPanelProps {
  jobs: readonly JobView[];
  /** 창이 열려 있는 project의 id. */
  project: string;
  onEnabled: (job: string, enabled: boolean) => void;
  /** Settings › System › Scheduled jobs를 연다. */
  onOpenSettings: () => void;
}

export function JobPanel(
  { jobs, project, onEnabled, onOpenSettings }: JobPanelProps,
) {
  const mine = jobs.filter((job) => isProjectJob(job, project));
  return (
    <>
      {mine.length === 0
        ? (
          <div data-jobs-empty="">
            <p className={sidebar.empty}>No scheduled jobs for this project.</p>
            <p className={sidebar.empty}>Ask an agent to schedule one.</p>
          </div>
        )
        : (
          <ul
            className={sidebar.list}
            role="list"
            aria-label="Scheduled jobs"
          >
            {mine.map((job) => (
              <li key={job.id} className={styles.row} data-job={job.id}>
                <button
                  type="button"
                  className={styles.main}
                  onClick={onOpenSettings}
                >
                  <span className={styles.title}>{job.title}</span>
                  <span className={styles.meta}>
                    <span>
                      {everyText(job.every, job.at)} · {stateText(job)}
                    </span>
                    {failed(job)
                      ? <StatusMark tone="critical" label="Failed" />
                      : null}
                  </span>
                </button>
                <div className={styles.switchSlot}>
                  <Switch
                    size="sm"
                    label={job.enabled ? "On" : "Off"}
                    checked={job.enabled}
                    onCheckedChange={(enabled) =>
                      onEnabled(job.id, enabled)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      <div className={styles.footer}>
        <Button size="sm" variant="ghost" onClick={onOpenSettings}>
          Open all jobs
        </Button>
      </div>
    </>
  );
}
