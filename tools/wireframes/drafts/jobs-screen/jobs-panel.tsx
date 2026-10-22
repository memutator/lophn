// Settings › Scheduled jobs 본문. 모든 place의 job을 한곳에 모아 보이고, 켜고 끄기, 제목·주기·놓친 차례 정책 고치기,
// 지우기, 줄마다 기록 펴기를 한다. job을 만드는 단추는 없다(agent가 만든다). data는 props로 받고 읽지 않는다.
// 이 파일을 `sj-shell-jobs-screen`이 그대로 옮긴다. 자리(Settings 항목)는 frame.tsx가 정한다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Dialog, Toast } from "@lophn/ui/overlay";

import settings from "../../../../packages/shell/renderer/desktop/settings/settings.module.css";
import type {
  JobRunView,
  JobView,
  NAMES,
} from "../../mock/jobs-screen-data.ts";
import { EditDialog, type JobChange } from "./edit-dialog.tsx";
import { JobLine } from "./job-line.tsx";

export interface JobsPanelProps {
  jobs: readonly JobView[];
  /** job id → 그 job의 기록(새것이 앞). 줄을 펼칠 때 읽는다고 가정한다. */
  histories: Readonly<Record<string, readonly JobRunView[]>>;
  /** 앱·project·Operator id를 이름으로 푸는 표. 화면이 목록을 따로 읽어 만든다. */
  names: typeof NAMES;
  onEnabled: (job: string, enabled: boolean) => void;
  /** 저장하지 못하면 false. 화면은 탭 위쪽 toast로 알린다. */
  onSave: (job: string, change: JobChange) => Promise<boolean>;
  onDelete: (job: string) => Promise<boolean>;
  onOpenSession: (session: string) => void;
  onOpenProject: (project: string) => void;
}

// 알림이 화면에 남은 채로 보이도록 시간이 가지 않는 timer를 준다.
const NO_TIMER = { set: () => 0, clear: () => {} };

const CREATOR = {
  lophn: "lophn",
  project_manager: "the Project Manager",
  app_engineer: "the App Engineer",
  operator: "that agent",
} as const;

export function JobsPanel(
  {
    jobs,
    histories,
    names,
    onEnabled,
    onSave,
    onDelete,
    onOpenSession,
    onOpenProject,
  }: JobsPanelProps,
) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [editing, setEditing] = useState<JobView | null>(null);
  const [deleting, setDeleting] = useState<JobView | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const toggle = (id: string) =>
    setOpen((now) => {
      const next = new Set(now);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div data-jobs="">
      <h1 className={settings.paneTitle}>Scheduled jobs</h1>
      <p className={settings.lead}>
        Jobs that your agents set up to start work on a schedule. They only run
        while lophn is on.
      </p>
      {notice === null
        ? null
        : (
          <div className={settings.toastSlot} data-jobs-notice="">
            <Toast
              title={notice}
              tone="error"
              onClose={() => setNotice(null)}
              timer={NO_TIMER}
            />
          </div>
        )}
      <ul className={settings.lines}>
        {jobs.length === 0
          ? (
            <li
              className={`${settings.line} ${settings.lineHelp}`}
              data-jobs-empty=""
            >
              No scheduled jobs yet. Ask an agent to set one up, for example
              “Every morning at 9, summarize what changed.”
            </li>
          )
          : jobs.map((job) => (
            <JobLine
              key={job.id}
              job={job}
              names={names}
              history={open.has(job.id) ? histories[job.id] ?? [] : undefined}
              onToggle={() => toggle(job.id)}
              onEnabled={(enabled) => onEnabled(job.id, enabled)}
              onEdit={() => setEditing(job)}
              onDelete={() => setDeleting(job)}
              onOpenSession={onOpenSession}
              onOpenProject={onOpenProject}
            />
          ))}
      </ul>
      {editing === null ? null : (
        <EditDialog
          job={editing}
          creator={CREATOR[editing.creator.role]}
          onClose={() => setEditing(null)}
          onSave={async (change) => {
            const done = await onSave(editing.id, change);
            setEditing(null);
            if (!done) setNotice("Could not save the changes.");
          }}
        />
      )}
      <Dialog
        open={deleting !== null}
        onOpenChange={(next) => next || setDeleting(null)}
        title={`Delete ${deleting?.title ?? ""}?`}
        actions={
          <>
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              variant="danger"
              data-job-delete-confirm=""
              onClick={async () => {
                const job = deleting!;
                setDeleting(null);
                if (!(await onDelete(job.id))) {
                  setNotice("Could not delete the job.");
                }
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        This deletes the job and its history. Anything that is running keeps
        going until it finishes.
      </Dialog>
    </div>
  );
}
