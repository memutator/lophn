// job 줄 목록. project sidebar는 이 project에 걸린 job만, Home과 Jobs overlay는 모든 job을 보인다. 줄은 제목, 오른쪽 끝
// 고정 열의 switch, 아래 줄(주기 글과 상태 하나)이다. 줄을 누르면 `onOpen`(Jobs 탭을 연다, 그 job을 펼치지는 않는다).
// 목록은 열릴 때와 job이 바뀔 때마다(`jobs` 변경) `JobsSource`에서 다시 읽는다.

import { t } from "@lophn/i18n";
import { ErrorState, StatusMark } from "@lophn/ui/feedback";
import { Switch } from "@lophn/ui/input";
import { useState } from "react";

import { shellIcons } from "../../icons/mod.ts";
import {
  PanelEmpty,
  PanelRow,
  PanelRows,
  TileIcon,
} from "../../shell/panel-rows.tsx";
import { useFollowedRead } from "../connection/core-read.ts";
import styles from "./jobs.module.css";
import { useMachineNameOf } from "./machine-names.ts";
import {
  jobsOfProject,
  nextText,
  STATE,
  sourceGoneText,
  whenOf,
} from "./model.ts";
import type { JobsSource, JobView } from "./source.ts";

// 꺼짐 → 재승인 필요(권한 상승) → 대상 보관·없음 → 놓친 차례를 기다림 → 다음 차례 순서로 하나만 보인다.
const stateText = (job: JobView): string =>
  job.runs_here && job.approval_paused_reason === "mode_escalated"
    ? t("jobs.label.paused-mode-escalated")
    : job.runs_here && job.enabled && job.target_unavailable === true
      ? t("jobs.label.paused-target-unavailable")
      : job.runs_here && job.enabled && job.last_run?.state === "held"
        ? t("jobs.label.waiting-decision")
        : ((job.runs_here && job.enabled ? sourceGoneText(job) : null) ??
          nextText(job, new Date()));

export function JobRows({
  project,
  source,
  onOpen,
}: {
  /** null이면 모든 job(Home, overlay). */
  project: string | null;
  source: JobsSource;
  onOpen: () => void;
}) {
  const machineNameOf = useMachineNameOf();
  const [notice, setNotice] = useState<string | null>(null);
  const { loaded, reload: load } = useFollowedRead(
    async () => {
      const read = await source.list();
      if (!read.ok) return read;
      const jobs: readonly JobView[] = read.value.jobs;
      return {
        ok: true as const,
        value: project === null ? jobs : jobsOfProject(jobs, project),
      };
    },
    ["jobs"],
    project ?? "",
  );

  // 성공해도 실패해도 다시 읽는다. 실패하면 줄은 읽은 값 그대로라 switch가 제자리로 돌아온다.
  const setEnabled = async (job: string, enabled: boolean) => {
    const sent = await source.setEnabled(job, enabled);
    setNotice(
      sent.ok || sent.code === "not_found" ? null : t("jobs.error.save"),
    );
    load();
  };

  if (loaded.state === "failed") {
    return <ErrorState target={t("jobs.label.target")} onRetry={load} />;
  }
  if (loaded.state === "loading") return null;
  return (
    <>
      {notice === null ? null : (
        <p className={styles.notice} role="alert">
          {notice}
        </p>
      )}
      {loaded.value.length === 0 ? (
        <div data-jobs-empty="">
          <PanelEmpty>
            {t(project === null ? "jobs.empty.all" : "jobs.empty.sidebar")}
          </PanelEmpty>
          <PanelEmpty>{t("jobs.empty.sidebar-ask")}</PanelEmpty>
        </div>
      ) : (
        <PanelRows label={t("jobs.label.sidebar-tab")}>
          {loaded.value.map((job) => (
            <PanelRow
              key={job.id}
              data-job={job.id}
              leading={<TileIcon icon={shellIcons.jobs} />}
              title={job.title}
              wrapMeta={job.trigger === null ? true : 6}
              meta={
                <>
                  {whenOf(job, machineNameOf)}
                  {job.trigger === null ? (
                    ` · ${stateText(job)}`
                  ) : (
                    // event job은 때와 기록(연 수·건너뛴 수)을 각자 줄로 보인다. 좁은 panel에서 잘리지 않게 줄 수를 넉넉히 준다.
                    <>
                      <br />
                      {stateText(job)}
                    </>
                  )}
                  {job.approval_paused_reason === "mode_escalated" ? (
                    <>
                      {" "}
                      <StatusMark
                        tone="warning"
                        label={t("jobs.label.paused-mode-escalated-badge")}
                      />
                    </>
                  ) : null}
                  {job.target_unavailable === true ? (
                    <>
                      {" "}
                      <StatusMark
                        tone="warning"
                        label={t("jobs.label.paused-target-badge")}
                      />
                    </>
                  ) : null}
                  {job.last_run?.state === "failed" ? (
                    <>
                      {" "}
                      <StatusMark
                        tone={STATE.failed.tone}
                        label={t(STATE.failed.label)}
                      />
                    </>
                  ) : null}
                </>
              }
              trailing={
                <Switch
                  size="sm"
                  label={
                    job.enabled
                      ? t("settings.label.value-on")
                      : t("settings.label.value-off")
                  }
                  checked={job.enabled}
                  onCheckedChange={(enabled) =>
                    void setEnabled(job.id, enabled)
                  }
                />
              }
              onClick={onOpen}
            />
          ))}
        </PanelRows>
      )}
    </>
  );
}
