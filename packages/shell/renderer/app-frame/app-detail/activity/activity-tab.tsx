// Activity 탭. 호출 기록 목록, 한 호출을 펼친 세부, project로 거르기, 그리고 rewind panel로 가는 단추.
// 성공한 읽기는 기록하지 않는다. 호출 성공은 업무가 맞다는 뜻이 아니다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Field, Select } from "@lophn/ui/input";
import { t } from "@lophn/wording";

import { Loadable } from "../loadable.tsx";
import {
  callerText,
  callName,
  callStateText,
  callTime,
  canRewind,
  releaseName,
} from "../model.ts";
import { EffectPill, Facts, Mono, Pill } from "../parts.tsx";
import type {
  ActivityRow,
  ActivityView,
  AppDetailSource,
  Caller,
} from "../source.ts";
import { useRead } from "../use-read.ts";
import styles from "../app-detail.module.css";
import { RewindPanel } from "./rewind-panel.tsx";

interface ActivityTabProps {
  app: string;
  /** 앱 이름. rewind panel이 쓴다. */
  name: string;
  source: AppDetailSource;
  now: () => Date;
  /** agent session을 연다. 없으면 session 이름만 보인다. */
  onOpenSession?: (session: string) => void;
}

const ALL_PROJECTS = "all";

export function ActivityTab(
  { app, name, source, now, onOpenSession }: ActivityTabProps,
) {
  const [open, setOpen] = useState<string | null>(null);
  const [project, setProject] = useState(ALL_PROJECTS);
  const [rewind, setRewind] = useState<string | null>(null);
  if (rewind !== null) {
    return (
      <RewindPanel
        app={app}
        name={name}
        from={rewind}
        source={source}
        now={now}
        onBack={() => setRewind(null)}
      />
    );
  }
  return (
    <div className={styles.tab} data-tab-body="activity">
      <ActivityList
        app={app}
        source={source}
        now={now}
        open={open}
        onOpen={setOpen}
        project={project}
        onProject={setProject}
        onRewind={setRewind}
        onOpenSession={onOpenSession}
      />
    </div>
  );
}

function SessionLink(
  { caller, onOpenSession }: {
    caller: Extract<Caller, { kind: "agent" }>;
    onOpenSession?: (session: string) => void;
  },
) {
  const label = caller.title ?? t("app-detail.label.session-unnamed");
  return onOpenSession === undefined
    ? <span className={styles.muted}>{label}</span>
    : (
      <button
        type="button"
        className={styles.link}
        data-open-session={caller.session}
        onClick={() => onOpenSession(caller.session)}
      >
        {label}
      </button>
    );
}

function StateCell({ row }: { row: ActivityRow }) {
  const text = callStateText(row);
  if (row.undone || row.state === "waiting" || row.state === "running") {
    return <Pill tone="neutral">{text}</Pill>;
  }
  if (row.state === "failed" || row.state === "unknown") {
    return <Pill tone="critical">{text}</Pill>;
  }
  return <span className={styles.muted}>{text}</span>;
}

function CalledBy(
  { row, onOpenSession }: {
    row: ActivityRow;
    onOpenSession?: (session: string) => void;
  },
) {
  const caller = row.caller;
  switch (caller.kind) {
    case "agent":
      return (
        <span>
          {callerText(caller)} ·{" "}
          <SessionLink
            caller={caller}
            onOpenSession={onOpenSession}
          />{" "}
          · {t("app-detail.label.turn")} <Mono>{caller.turn}</Mono> ·{" "}
          {t("app-detail.label.tool-call")} <Mono>{caller.toolCall}</Mono>
        </span>
      );
    case "app":
      return (
        <span>
          {caller.releaseNumber === null
            ? (caller.appName ?? t("app-detail.label.caller-app-unnamed"))
            : t("app-detail.label.called-by-app", {
              name: caller.appName ?? t("app-detail.label.caller-app-unnamed"),
              release: releaseName(caller.releaseNumber),
            })}
        </span>
      );
    case "start":
      return (
        <span>
          {caller.reason === "activation"
            ? t("app-detail.label.called-by-activation")
            : t("app-detail.label.called-by-restart")}
        </span>
      );
    case "person":
      return <span>{t("app-detail.label.called-by-person")}</span>;
  }
}

function Detail(
  { row, projectName, onOpenSession }: {
    row: ActivityRow;
    projectName: string | null;
    onOpenSession?: (session: string) => void;
  },
) {
  return (
    <div className={styles.detail} data-invocation-detail={row.id}>
      <Facts
        rows={[
          [
            t("app-detail.label.fact-called-by"),
            <CalledBy
              key="by"
              row={row}
              onOpenSession={onOpenSession}
            />,
          ],
          [
            t("app-detail.label.fact-project"),
            row.project === null
              ? t("app-detail.label.no-project-level")
              : (projectName ?? row.project),
          ],
          [
            t("app-detail.label.fact-input-fingerprint"),
            row.inputHash === null
              ? t("app-detail.label.input-none")
              : (
                <span key="in">
                  <Mono>{row.inputHash}</Mono>{" "}
                  <span className={styles.muted}>
                    {t("app-detail.note.input-fingerprint")}
                  </span>
                </span>
              ),
          ],
          [
            t("app-detail.label.fact-result"),
            row.result === "" ? t("app-detail.label.result-none") : row.result,
          ],
          [
            t("app-detail.label.fact-undo"),
            row.undone
              ? t("app-detail.note.undo-recorded")
              : t("app-detail.label.undo-none"),
          ],
        ]}
      />
    </div>
  );
}

function ActivityList(
  {
    app,
    source,
    now,
    open,
    onOpen,
    project,
    onProject,
    onRewind,
    onOpenSession,
  }: {
    app: string;
    source: AppDetailSource;
    now: () => Date;
    open: string | null;
    onOpen: (id: string | null) => void;
    project: string;
    onProject: (project: string) => void;
    onRewind: (id: string) => void;
    onOpenSession?: (session: string) => void;
  },
) {
  const read = useRead(() => source.activity(app), [app, source], { now });
  return (
    <Loadable
      read={read}
      target={t("app-detail.label.activity-target")}
      now={now}
    >
      {(view) => (
        <ActivityRows
          view={view}
          now={now}
          open={open}
          onOpen={onOpen}
          project={project}
          onProject={onProject}
          onRewind={onRewind}
          onOpenSession={onOpenSession}
        />
      )}
    </Loadable>
  );
}

function ActivityRows(
  { view, now, open, onOpen, project, onProject, onRewind, onOpenSession }: {
    view: ActivityView;
    now: () => Date;
    open: string | null;
    onOpen: (id: string | null) => void;
    project: string;
    onProject: (project: string) => void;
    onRewind: (id: string) => void;
    onOpenSession?: (session: string) => void;
  },
) {
  const names = new Map(view.projects.map((item) => [item.id, item.name]));
  // 앱 단위(project가 없는) 호출은 어느 project를 골라도 보인다.
  const rows = view.rows.filter((row) =>
    project === ALL_PROJECTS || row.project === project || row.project === null
  );
  return (
    <>
      <div className={styles.filters}>
        <div className={styles.filterField}>
          <Field label={t("app-detail.label.filter-project")}>
            <Select
              size="sm"
              value={project}
              onValueChange={onProject}
              options={[
                {
                  value: ALL_PROJECTS,
                  label: t("app-detail.label.all-projects"),
                },
                ...view.projects.map((item) => ({
                  value: item.id,
                  label: item.name,
                })),
              ]}
            />
          </Field>
        </div>
        <p className={styles.muted}>{t("app-detail.note.activity-scope")}</p>
      </div>
      {rows.length === 0
        ? (
          <p className={styles.state} data-activity-empty="">
            {t("app-detail.note.no-activity")}
          </p>
        )
        : (
          <div
            className={styles.table}
            role="table"
            aria-label={t("app-detail.label.tab-activity")}
          >
            <div className={styles.tableHead} role="row">
              <span>{t("app-detail.label.col-time")}</span>
              <span>{t("app-detail.label.col-caller")}</span>
              <span>{t("app-detail.label.col-call")}</span>
              <span>{t("app-detail.label.col-effect")}</span>
              <span>{t("app-detail.label.col-result")}</span>
              <span />
            </div>
            {rows.map((row) => (
              <div key={row.id} className={styles.tableBlock}>
                <div
                  className={`${styles.tableRow} ${
                    row.earlier ? styles.tableRowOld : ""
                  } ${open === row.id ? styles.tableRowOpen : ""}`}
                  role="row"
                  data-invocation={row.id}
                >
                  <span>{callTime(row.at, now())}</span>
                  <span className={styles.cell}>
                    <span>{callerText(row.caller)}</span>
                    {row.caller.kind === "agent"
                      ? (
                        <SessionLink
                          caller={row.caller}
                          onOpenSession={onOpenSession}
                        />
                      )
                      : null}
                  </span>
                  <span className={styles.cell}>
                    <button
                      type="button"
                      className={styles.linkPlain}
                      aria-expanded={open === row.id}
                      onClick={() => onOpen(open === row.id ? null : row.id)}
                    >
                      <Mono>{callName(row)}</Mono>
                    </button>
                    <span className={styles.muted}>
                      {row.project === null
                        ? t("app-detail.label.no-project")
                        : (names.get(row.project) ?? row.project)}
                      {row.earlier && row.releaseNumber !== null
                        ? ` · ${
                          t("app-detail.label.from-release", {
                            release: releaseName(row.releaseNumber),
                          })
                        }`
                        : ""}
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
                          data-rewind-start={row.id}
                          onClick={() => onRewind(row.id)}
                        >
                          {t("app-detail.button.rewind-from-here")}
                        </Button>
                      )
                      : null}
                  </span>
                </div>
                {open === row.id
                  ? (
                    <Detail
                      row={row}
                      projectName={row.project === null
                        ? null
                        : (names.get(row.project) ?? null)}
                      onOpenSession={onOpenSession}
                    />
                  )
                  : null}
              </div>
            ))}
          </div>
        )}
    </>
  );
}
