// Jobs 탭 본문. 모든 workspace의 job을 한곳에 모아 보이고, 켜고 끄기, 제목·주기·놓친 차례 정책
// 고치기, 지우기, 줄마다 기록 펴기를 한다. job을 만드는 단추는 없다(agent가 만든다).
// 쓰기는 바로 보내고, 성공해도 실패해도 목록을 다시 읽는다. 저장하지 못하면 탭 위쪽 toast로 알린다.
import { type ReactNode, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { Dialog, Toast } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";
import { actionIcons } from "../../icons/mod.ts";

import { useFollowedRead } from "../connection/core-read.ts";
import { EditDialog } from "./edit-dialog.tsx";
import { type History, JobLine } from "./job-line.tsx";
import styles from "./jobs.module.css";
import type { JobsSource, JobView, SourceResult } from "./source.ts";

interface JobsPageProps {
  source: JobsSource;
  onOpenSession: (session: string) => void;
  onOpenProject: (project: string) => void;
}

/** 펼친 job의 기록. 그 job이 바뀌면(`jobs` 변경의 그 id) 다시 읽는다. */
function OpenHistory({
  source,
  job,
  children,
}: {
  source: JobsSource;
  job: string;
  children: (history: History) => ReactNode;
}) {
  const { loaded } = useFollowedRead(
    () => source.runs(job),
    [{ name: "jobs", id: job }],
    job,
  );
  return children(loaded.state === "ready" ? loaded.value : loaded.state);
}

export function JobsPage({
  source,
  onOpenSession,
  onOpenProject,
}: JobsPageProps) {
  // 이름은 project·앱·agent 목록에서 푼다.
  const { loaded, reload: load } = useFollowedRead(
    () => source.list(),
    ["jobs", "projects", "apps", "agents"],
    "",
  );
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<JobView | null>(null);
  const [deleting, setDeleting] = useState<JobView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const toggle = (job: string) =>
    setOpen((now) => {
      const next = new Set(now);
      if (!next.delete(job)) next.add(job);
      return next;
    });

  // 성공해도 실패해도 다시 읽는다. not_found는 agent가 먼저 지운 것이라 알리지 않고 줄이 사라지게 둔다.
  async function write(sending: Promise<SourceResult<null>>, failure: string) {
    const sent = await sending;
    if (!sent.ok && sent.code !== "not_found") setNotice(failure);
    load();
  }

  if (loaded.state === "failed") {
    return <ErrorState target={t("jobs.label.target")} onRetry={load} />;
  }
  const jobs = loaded.state === "ready" ? loaded.value.jobs : [];
  const names = loaded.state === "ready" ? loaded.value.names : null;
  const line = (job: JobView, history: History | undefined) => (
    <JobLine
      key={job.id}
      job={job}
      names={names!}
      history={history}
      onToggle={() => toggle(job.id)}
      onEnabled={(enabled) =>
        void write(source.setEnabled(job.id, enabled), t("jobs.error.save"))
      }
      onEdit={() => setEditing(job)}
      onDelete={() => setDeleting(job)}
      onOpenSession={onOpenSession}
      onOpenProject={onOpenProject}
    />
  );
  return (
    <div className={styles.page} data-jobs="">
      <h1 className={styles.pageTitle}>{t("jobs.label.sidebar-tab")}</h1>
      <p className={styles.lead}>{t("jobs.note.intro")}</p>
      {notice === null ? null : (
        <div className={styles.toastSlot} data-jobs-notice="">
          <Toast title={notice} tone="error" onClose={() => setNotice(null)} />
        </div>
      )}
      <Loading loading={names === null} placeholder={<Skeleton lines={4} />}>
        <ul className={styles.list}>
          {jobs.length === 0 ? (
            <li className={styles.emptyLine} data-jobs-empty="">
              {t("jobs.empty.list")}
            </li>
          ) : (
            jobs.map((job) =>
              open.has(job.id) ? (
                <OpenHistory key={job.id} source={source} job={job.id}>
                  {(history) => line(job, history)}
                </OpenHistory>
              ) : (
                line(job, undefined)
              ),
            )
          )}
        </ul>
      </Loading>
      {editing === null ? null : (
        <EditDialog
          job={editing}
          names={names ?? { apps: {}, projects: {}, agents: {} }}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            const job = editing.id;
            setEditing(null);
            void write(source.update(job, patch), t("jobs.error.save"));
          }}
        />
      )}
      <Dialog
        open={deleting !== null}
        onOpenChange={(next) => next || setDeleting(null)}
        title={t("jobs.heading.delete", { title: deleting?.title ?? "" })}
        actions={
          <>
            <Button onClick={() => setDeleting(null)}>
              {t("settings.button.cancel")}
            </Button>
            <Button
              variant="danger"
              icon={actionIcons.delete}
              data-job-delete-confirm=""
              onClick={() => {
                const job = deleting!.id;
                setDeleting(null);
                void write(source.remove(job), t("jobs.error.delete"));
              }}
            >
              {t("jobs.button.delete")}
            </Button>
          </>
        }
      >
        {t("jobs.note.delete")}
      </Dialog>
    </div>
  );
}
