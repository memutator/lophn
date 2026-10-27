// project sidebar의 Scheduled jobs 탭. 이 project에 걸린 job만 줄로 보인다. 줄은 제목, 오른쪽 끝 고정 열의 switch,
// 아래 줄(주기 글과 상태 하나)이다. 줄과 맨 아래 단추는 Settings › Scheduled jobs를 연다(그 job을 펼치지는 않는다).
// 목록은 이 탭이 열릴 때와 job이 바뀔 때마다 `JobsSource`에서 다시 읽는다.
import { useCallback, useState } from "react";
import { ErrorState, StatusMark } from "@lophn/ui/feedback";
import { Switch } from "@lophn/ui/input";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/wording";

import { useJobChanges } from "../../desktop/connection/events/hooks.tsx";
import {
  jobsOfProject,
  nextText,
  scheduleText,
  STATE,
} from "../../desktop/settings/jobs/model.ts";
import type {
  JobsSource,
  JobView,
} from "../../desktop/settings/jobs/source.ts";
import { useReload } from "../../desktop/settings/use-reload.ts";
import sidebar from "./project-sidebar.module.css";
import styles from "./job-panel.module.css";

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly jobs: readonly JobView[] };

// 꺼짐 → 놓친 차례를 기다림 → 다음 차례 순서로 하나만 보인다.
const stateText = (job: JobView): string =>
  job.enabled && job.last_run?.state === "held"
    ? t("jobs.label.waiting-decision")
    : nextText(job, new Date());

export function JobPanel({
  project,
  source,
  onOpenSettings,
}: {
  project: string;
  source: JobsSource;
  /** Settings › System › Scheduled jobs를 연다. */
  onOpenSettings: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [notice, setNotice] = useState<string | null>(null);
  const load = useCallback(() => {
    void source.list().then((read) => {
      setLoaded(
        read.ok
          ? { state: "ready", jobs: jobsOfProject(read.value.jobs, project) }
          : { state: "failed" },
      );
    });
  }, [source, project]);
  useReload(source, load);
  useJobChanges(load);

  // 성공해도 실패해도 다시 읽는다. 실패하면 줄은 읽은 값 그대로라 switch가 제자리로 돌아온다.
  const setEnabled = async (job: string, enabled: boolean) => {
    const sent = await source.setEnabled(job, enabled);
    setNotice(
      sent.ok || sent.code === "not_found" ? null : t("jobs.error.save"),
    );
    load();
  };

  if (loaded.state === "failed") {
    return (
      <ErrorState
        target={t("jobs.label.target")}
        onRetry={() => {
          setLoaded({ state: "loading" });
          load();
        }}
      />
    );
  }
  if (loaded.state === "loading") return null;
  return (
    <>
      {notice === null ? null : (
        <p className={styles.notice} role="alert">
          {notice}
        </p>
      )}
      {loaded.jobs.length === 0 ? (
        <div data-jobs-empty="">
          <p className={sidebar.empty}>{t("jobs.empty.sidebar")}</p>
          <p className={sidebar.empty}>{t("jobs.empty.sidebar-ask")}</p>
        </div>
      ) : (
        <ul
          className={sidebar.list}
          role="list"
          aria-label={t("jobs.label.sidebar-tab")}
        >
          {loaded.jobs.map((job) => (
            <li key={job.id} className={styles.row} data-job={job.id}>
              <button
                type="button"
                className={styles.main}
                onClick={onOpenSettings}
              >
                <span className={styles.title}>{job.title}</span>
                <span className={styles.meta}>
                  <span>
                    {scheduleText(job.every, job.at)} · {stateText(job)}
                  </span>
                  {job.last_run?.state === "failed" ? (
                    <StatusMark
                      tone={STATE.failed.tone}
                      label={t(STATE.failed.label)}
                    />
                  ) : null}
                </span>
              </button>
              <div className={styles.switchSlot}>
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
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.footer}>
        <Button size="sm" variant="ghost" onClick={onOpenSettings}>
          {t("jobs.button.open-all")}
        </Button>
      </div>
    </>
  );
}
