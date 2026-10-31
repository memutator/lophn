// Settings › Scheduled jobs 본문. 모든 place의 job을 한곳에 모아 보이고, 켜고 끄기, 제목·주기·놓친 차례 정책
// 고치기, 지우기, 줄마다 기록 펴기를 한다. job을 만드는 단추는 없다(agent가 만든다).
// 쓰기는 바로 보내고, 성공해도 실패해도 목록을 다시 읽는다. 저장하지 못하면 탭 위쪽 toast로 알린다.
import { useCallback, useRef, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { Dialog, Toast } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";
import { actionIcons } from "../../../icons/mod.ts";

import { useJobChanges } from "../../connection/events/hooks.tsx";
import { useReload } from "../use-reload.ts";
import settings from "../settings.module.css";
import { EditDialog } from "./edit-dialog.tsx";
import { type History, JobLine } from "./job-line.tsx";
import type { JobNames, JobsSource, JobView, SourceResult } from "./source.ts";

interface JobsPanelProps {
  source: JobsSource;
  onOpenSession: (session: string) => void;
  onOpenProject: (project: string) => void;
}

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | {
      readonly state: "ready";
      readonly jobs: readonly JobView[];
      readonly names: JobNames;
    };

export function JobsPanel({
  source,
  onOpenSession,
  onOpenProject,
}: JobsPanelProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [histories, setHistories] = useState<Readonly<Record<string, History>>>(
    {},
  );
  const [editing, setEditing] = useState<JobView | null>(null);
  const [deleting, setDeleting] = useState<JobView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadRuns = useCallback(
    (job: string) => {
      void source.runs(job).then((read) => {
        setHistories((now) =>
          job in now ? { ...now, [job]: read.ok ? read.value : "failed" } : now,
        );
      });
    },
    [source],
  );

  const load = useCallback(() => {
    void source.list().then((read) => {
      setLoaded(
        read.ok ? { state: "ready", ...read.value } : { state: "failed" },
      );
    });
  }, [source]);
  useReload(source, load);

  // 열려 있는 job의 기록도 같이 다시 읽는다. 끊긴 사이 놓친 것은 처음 읽을 때와 다시 열 때 맞춘다.
  const openJobs = useRef<string[]>([]);
  openJobs.current = Object.keys(histories);
  useJobChanges(() => {
    load();
    openJobs.current.forEach(loadRuns);
  });

  const toggle = (job: string) => {
    if (job in histories) {
      setHistories(({ [job]: _closed, ...rest }) => rest);
      return;
    }
    setHistories((now) => ({ ...now, [job]: "loading" }));
    loadRuns(job);
  };

  // 성공해도 실패해도 다시 읽는다. not_found는 agent가 먼저 지운 것이라 알리지 않고 줄이 사라지게 둔다.
  async function write(sending: Promise<SourceResult<null>>, failure: string) {
    const sent = await sending;
    if (!sent.ok && sent.code !== "not_found") setNotice(failure);
    load();
  }

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
  const jobs = loaded.state === "ready" ? loaded.jobs : [];
  const names = loaded.state === "ready" ? loaded.names : null;
  return (
    <div data-jobs="">
      <h1 className={settings.paneTitle}>{t("settings.label.tab-jobs")}</h1>
      <p className={settings.lead}>{t("jobs.note.intro")}</p>
      {notice === null ? null : (
        <div className={settings.toastSlot} data-jobs-notice="">
          <Toast title={notice} tone="error" onClose={() => setNotice(null)} />
        </div>
      )}
      <Loading loading={names === null} placeholder={<Skeleton lines={4} />}>
        <ul className={settings.lines}>
          {jobs.length === 0 ? (
            <li
              className={`${settings.line} ${settings.lineHelp}`}
              data-jobs-empty=""
            >
              {t("jobs.empty.list")}
            </li>
          ) : (
            jobs.map((job) => (
              <JobLine
                key={job.id}
                job={job}
                names={names!}
                history={histories[job.id]}
                onToggle={() => toggle(job.id)}
                onEnabled={(enabled) =>
                  void write(
                    source.setEnabled(job.id, enabled),
                    t("jobs.error.save"),
                  )
                }
                onEdit={() => setEditing(job)}
                onDelete={() => setDeleting(job)}
                onOpenSession={onOpenSession}
                onOpenProject={onOpenProject}
              />
            ))
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
