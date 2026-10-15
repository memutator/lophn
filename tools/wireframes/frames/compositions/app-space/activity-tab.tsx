// Activity 탭. 호출 기록 목록, 한 호출을 펼친 세부, project로 거르기, 그리고 rewind panel로 가는 단추.
import { useState } from "react";
import { Button, Field, Select } from "@lophn/design/components";

import { type Invocation, INVOCATIONS, PROJECTS } from "./data.ts";
import { EffectPill, Facts, Mono, Pill } from "./parts.tsx";
import { RewindPanel, type RewindStage } from "./rewind-panel.tsx";
import styles from "./app-space.module.css";

/** 지금 release의 live write, external, 앱 시작 행에만 rewind를 시작할 수 있다. */
function canRewind(row: Invocation): boolean {
  return row.earlier === undefined && row.effect !== "read" &&
    row.state === "done" && row.undone === undefined;
}

function StateCell({ row }: { row: Invocation }) {
  if (row.undone !== undefined) return <Pill tone="neutral">Undone</Pill>;
  if (row.state === "waiting") return <Pill tone="neutral">Waiting</Pill>;
  if (row.state === "failed") return <Pill tone="critical">Failed</Pill>;
  if (row.state === "unknown") return <Pill tone="critical">Unknown</Pill>;
  return <span className={styles.muted}>Done</span>;
}

function CallerCell({ row }: { row: Invocation }) {
  const { caller } = row;
  return (
    <span className={styles.cell}>
      <span>{caller.label}</span>
      {caller.session === undefined
        ? null
        : (
          <button type="button" className={styles.link}>
            {caller.session}
          </button>
        )}
    </span>
  );
}

function Detail({ row }: { row: Invocation }) {
  const { caller } = row;
  return (
    <div className={styles.detail} data-invocation-detail={row.id}>
      <Facts
        rows={[
          [
            "Called by",
            caller.kind === "agent"
              ? (
                <span key="by">
                  {caller.label} ·{" "}
                  <button type="button" className={styles.link}>
                    session “{caller.session}”
                  </button>{" "}
                  · turn 3 · tool call <Mono>call_7f3a</Mono>
                </span>
              )
              : caller.kind === "app"
              ? "Customers, release r12, from invocation customers.syncNotes"
              : caller.kind === "start"
              ? "lophn, when r7 started"
              : "You, from the Orders screen",
          ],
          ["Project", row.project ?? "None (app level)"],
          [
            "Input",
            <span key="in">
              <Mono>sha256:41c9…e07b</Mono>{" "}
              <span className={styles.muted}>
                (a fingerprint; the input itself is not kept)
              </span>
            </span>,
          ],
          ["Result", row.result],
          [
            "Undo record",
            row.undone === undefined
              ? "None"
              : `Undone ${row.undone} by you, rewind from 14:20. The record stays.`,
          ],
        ]}
      />
    </div>
  );
}

function ActivityList(
  { open, onOpen, onRewind, project, onProject }: {
    open: string | null;
    onOpen: (id: string | null) => void;
    onRewind: (id: string) => void;
    project: string;
    onProject: (project: string) => void;
  },
) {
  const rows = INVOCATIONS.filter((row) =>
    project === PROJECTS[0] || row.project === project || row.project === null
  );
  return (
    <div className={styles.tab}>
      <div className={styles.filters}>
        <div className={styles.filterField}>
          <Field label="Project">
            <Select
              size="sm"
              value={project}
              onValueChange={onProject}
              options={PROJECTS.map((item) => ({ value: item, label: item }))}
            />
          </Field>
        </div>
        <p className={styles.muted}>
          Writes, external calls, app starts and failed reads. Successful reads
          are not listed.
        </p>
      </div>
      <div className={styles.table} role="table" aria-label="Activity">
        <div className={styles.tableHead} role="row">
          <span>Time</span>
          <span>Caller</span>
          <span>Call · project</span>
          <span>Effect</span>
          <span>Result</span>
          <span />
        </div>
        {rows.map((row) => (
          <div key={row.id} className={styles.tableBlock}>
            <div
              className={`${styles.tableRow} ${
                row.earlier === undefined ? "" : styles.tableRowOld
              } ${open === row.id ? styles.tableRowOpen : ""}`}
              role="row"
            >
              <span>{row.time}</span>
              <CallerCell row={row} />
              <span className={styles.cell}>
                <button
                  type="button"
                  className={styles.linkPlain}
                  aria-expanded={open === row.id}
                  onClick={() => onOpen(open === row.id ? null : row.id)}
                >
                  <Mono>{row.api}</Mono>
                </button>
                <span className={styles.muted}>
                  {row.project ?? "no project"}
                  {row.earlier === undefined ? "" : ` · release ${row.earlier}`}
                </span>
              </span>
              <EffectPill effect={row.effect} />
              <StateCell row={row} />
              <span className={styles.cellEnd}>
                {canRewind(row)
                  ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onRewind(row.id)}
                    >
                      Rewind from here
                    </Button>
                  )
                  : null}
              </span>
            </div>
            {open === row.id ? <Detail row={row} /> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ActivityTab(
  { open: initialOpen = null, rewind: initialRewind = null }: {
    open?: string | null;
    rewind?: RewindStage | null;
  },
) {
  const [open, setOpen] = useState<string | null>(initialOpen);
  const [rewind, setRewind] = useState<RewindStage | null>(initialRewind);
  const [project, setProject] = useState<string>(PROJECTS[0]);
  if (rewind !== null) {
    return (
      <RewindPanel
        stage={rewind}
        onStart={() => setRewind("running")}
        onBack={() => setRewind(null)}
      />
    );
  }
  return (
    <ActivityList
      open={open}
      onOpen={setOpen}
      onRewind={() => setRewind("confirm")}
      project={project}
      onProject={setProject}
    />
  );
}
