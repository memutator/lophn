// run 하나의 화면. 머리(이름, 상태, [Stop]) 아래에 step이 위에서 아래로 선다. step마다 맡은 쪽과 상태가 있고, 그 step의
// session(상태, 마지막 말, 실패 이유, [Open session]), 마지막 report, 산출물 파일, Activity가 그 step에 붙는다.
// 지금 step은 펼쳐져 있고 지금 어디에 있는지 한 장([Open session], [Retry], [Resume])을 안에 가진다. 지난 step은 report 두 줄로 접혀 있다.
// 서로 대신하는 step은 한 단계에 묶이고 이 run이 지나가지 않은 쪽은 한 줄로만 남는다. 시작 입력과 checkpoint 같은 세부는 접혀 있다.

import { type MessageKey, t } from "@lophn/i18n";
import { Tooltip } from "@lophn/ui/overlay";
import { Button, CopyButton, Icon, IconButton } from "@lophn/ui/primitives";
import { iconPixels, systemClipboard } from "@lophn/ui/shared";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { actionIcons, commonIcons, editorIcons } from "../icons/mod.ts";
import type { SessionDot } from "../parts/agent-session/activity.ts";
import type {
  WorkflowCheckpointKind,
  WorkflowCheckpointState,
  WorkflowInstanceDetailView,
  WorkflowSessionNodeView,
} from "../workspace/source.ts";
import { Fold } from "./fold.tsx";
import { lineBy, textOf } from "./lines.ts";
import {
  assigneeText,
  buildSessionTree,
  cellsOfRun,
  type FaceOf,
  headLines,
  instanceTitle,
  type Now,
  nowOf,
  refsOf,
  refsOfStep,
  runInputsOf,
  STEP_KEY,
  type StepCell,
  type StepRow,
  sessionOfStep,
  sessionSummaryText,
  sessionsByStep,
  shownOfRun,
  stagesOf,
  stepRows,
  summarizeSessions,
  whenOf,
} from "./model.ts";
import { NowCard } from "./now-card.tsx";
import { Rail, RailStage, type RailTone } from "./rail.tsx";
import styles from "./run-view.module.css";
import { SessionRows } from "./session-rows.tsx";
import { StateMark } from "./state-mark.tsx";
import { WhoMark } from "./who.tsx";

type Detail = WorkflowInstanceDetailView;
type Workspace = NonNullable<WorkflowSessionNodeView["workspace"]>;

const CHECKPOINT_KIND_KEY: Record<WorkflowCheckpointKind, MessageKey> = {
  step: "workflow.label.checkpoint-kind-step",
  agent: "workflow.label.checkpoint-kind-agent",
  human: "workflow.label.checkpoint-kind-human",
  workflow: "workflow.label.checkpoint-kind-workflow",
  tool: "workflow.label.checkpoint-kind-tool",
};

const CHECKPOINT_STATE_KEY: Record<WorkflowCheckpointState, MessageKey> = {
  started: "workflow.label.checkpoint-state-started",
  completed: "workflow.label.checkpoint-state-completed",
  failed: "workflow.label.checkpoint-state-failed",
  interrupted: "workflow.label.checkpoint-state-interrupted",
};

/** 다른 화면도 같이 쓰는 묶음: step 화면이 넘겨받는 것. */
interface Shared {
  readonly detail: Detail;
  readonly faceOf: FaceOf | undefined;
  readonly dotOf: ((session: string) => SessionDot | null) | undefined;
  readonly openerOf: (session: string) => (() => void) | null;
  readonly workspaceNameOf: (workspace: Workspace) => string | undefined;
  readonly onOpenFile: ((path: string) => void) | null;
}

/** step의 상태 글. 넘기지 못했거나 stall된 step은 도는 중이 아니다. */
function statusText(row: StepRow, cell: StepCell): string {
  if (row.notice?.kind === "step_stalled") {
    return t("workflow.label.step-stalled");
  }
  if (row.notice?.kind === "not_handed") {
    return t("workflow.label.step-blocked");
  }
  if (cell.waitingOn !== undefined) {
    return t("workflow.label.step-remote-waiting", {
      computer: cell.waitingOn,
    });
  }
  return t(STEP_KEY[row.shown]);
}

function toneOf(row: StepRow, cell: StepCell): RailTone {
  if (row.notice !== null || row.shown === "stopped") return "serious";
  if (row.shown === "human" || cell.heldThere === true) return "warning";
  if (row.shown === "current") return "good";
  return row.shown === "reported" ? "done" : "idle";
}

const TONE_ICON = {
  idle: commonIcons.stateNotReached,
  start: commonIcons.stateNotReached,
  skipped: commonIcons.stateNotReached,
  good: commonIcons.stateRunning,
  warning: commonIcons.stateYourTurn,
  serious: editorIcons.problem,
  done: commonIcons.stateEnded,
} as const satisfies Record<RailTone, unknown>;

// 한 단계에 step이 여럿이면 가장 급한 것의 색을 단계가 쓴다.
const TONE_ORDER: readonly RailTone[] = [
  "serious",
  "warning",
  "good",
  "done",
  "idle",
];

function RefList({
  refs,
  onOpenFile,
}: {
  refs: readonly string[];
  onOpenFile: ((path: string) => void) | null;
}) {
  return (
    <ul className={styles.refs}>
      {refs.map((path) => (
        <li key={path} className={styles.refItem}>
          {onOpenFile !== null ? (
            <button
              type="button"
              className={styles.refButton}
              onClick={() => onOpenFile(path)}
              data-ref-path={path}
            >
              <Icon icon={commonIcons.documents} pixels={iconPixels("base")} />
              <span className={styles.refPath}>{path}</span>
              <span className={styles.refOpen} aria-hidden="true">
                <Icon icon={actionIcons.open} pixels={iconPixels("base")} />
              </span>
            </button>
          ) : (
            <span className={styles.refStatic} data-ref-path={path}>
              <Icon icon={commonIcons.documents} pixels={iconPixels("base")} />
              <span className={styles.refPath}>{path}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function SessionBlock({
  title,
  nodes,
  shared,
}: {
  title: string;
  nodes: readonly WorkflowSessionNodeView[];
  shared: Shared;
}) {
  const rows = buildSessionTree(nodes, shared.dotOf);
  if (rows.length === 0) return null;
  return (
    <div className={styles.block} data-sessions="">
      <div className={styles.blockHead}>
        <span className={styles.blockTitle}>{title}</span>
        <span className={styles.blockSummary} data-sessions-summary="">
          {sessionSummaryText(summarizeSessions(rows))}
        </span>
      </div>
      <SessionRows
        rows={rows}
        faceOf={shared.faceOf}
        openerOf={shared.openerOf}
        workspaceNameOf={shared.workspaceNameOf}
      />
    </div>
  );
}

/** step 하나. 머리 줄(맡은 쪽, 이름, 상태)은 늘 보이고, 그 아래는 지금 step만 처음부터 펼쳐져 있다. */
function StepCard({
  row,
  cell,
  sessions,
  now,
  nowSession,
  shared,
}: {
  row: StepRow;
  cell: StepCell;
  sessions: readonly WorkflowSessionNodeView[];
  /** 이 step에 서는 "지금 어디에 있는지" 한 장. */
  now: ReactNode;
  /** 그 한 장이 여는 session. 같은 session으로 가는 단추를 한 번 더 두지 않는다. */
  nowSession: string | null;
  shared: Shared;
}) {
  const { detail, faceOf } = shared;
  // 사람이 고르기 전에는 지금 일이 있는 step(한 장이 선 step, 막힌 step)만 펼쳐져 있다.
  const [opened, setOpened] = useState<boolean | null>(null);
  const open = opened ?? (now !== null || row.notice !== null);
  const refs = refsOfStep(detail.lines, row.step.name);
  const report = row.report;
  const hasMore =
    report !== undefined ||
    sessions.length > 0 ||
    refs.length > 0 ||
    row.lines.length > 0 ||
    now !== null;
  // session 목록을 받지 못한 run(옛 기록)에서도 step을 받은 대화로 갈 길을 둔다.
  const receiver =
    sessions.length === 0 ? sessionOfStep(detail.lines, row.step.name) : null;
  const openReceiver =
    receiver === null || receiver === nowSession
      ? null
      : shared.openerOf(receiver);
  const head = (
    <>
      <WhoMark who={cell.who} faceOf={faceOf} />
      <span className={styles.stepText}>
        <span className={styles.stepName}>{row.step.name}</span>
        {cell.who.kind === "program" ? null : (
          <span className={styles.stepWho}>{assigneeText(cell, faceOf)}</span>
        )}
      </span>
      <span className={styles.stepStatus}>
        {statusText(row, cell)}
        {report === undefined ? null : (
          <span className={styles.stepWhen}> · {whenOf(report.at)}</span>
        )}
      </span>
    </>
  );
  return (
    <div
      className={styles.step}
      data-step={row.step.name}
      data-shown={cell.heldThere === true ? "human" : row.shown}
      data-blocked={row.notice === null ? undefined : ""}
      data-open={open ? "" : undefined}
    >
      {hasMore ? (
        <button
          type="button"
          className={styles.stepHead}
          aria-expanded={open}
          onClick={() => setOpened(!open)}
        >
          {head}
          <span className={styles.stepChevron} aria-hidden="true">
            <Icon
              icon={open ? commonIcons.collapse : commonIcons.expand}
              pixels={iconPixels("base")}
            />
          </span>
        </button>
      ) : (
        <div className={styles.stepHead}>{head}</div>
      )}
      {!hasMore ? null : !open ? (
        report === undefined ? null : (
          <p className={styles.reportPreview}>
            {textOf(detail, report, faceOf)}
          </p>
        )
      ) : (
        <div className={styles.stepBody}>
          {now}
          {row.notice === null || now !== null ? null : (
            <p className={styles.notice} data-notice="">
              <Icon icon={editorIcons.problem} pixels={iconPixels("base")} />
              <span>{textOf(detail, row.notice, faceOf)}</span>
            </p>
          )}
          {openReceiver === null ? null : (
            <div className={styles.sessionLink}>
              <span className={styles.blockTitle}>
                {t("workflow.label.step-session")}
              </span>
              <span className={styles.actions}>
                <Button
                  size="sm"
                  variant="ghost"
                  trailingIcon={actionIcons.open}
                  onClick={openReceiver}
                  data-step-session=""
                >
                  {t("workflow.button.open-session")}
                </Button>
              </span>
            </div>
          )}
          <SessionBlock
            title={t("workflow.heading.sessions")}
            nodes={sessions}
            shared={shared}
          />
          {report === undefined ? null : (
            <div className={styles.block} data-report="">
              <div className={styles.blockHead}>
                <span className={styles.blockTitle}>
                  {t("workflow.label.last-report")}
                </span>
                <span className={styles.blockSummary}>
                  {t("workflow.label.report-by", {
                    who: lineBy(detail, report, faceOf),
                    when: whenOf(report.at),
                  })}
                </span>
              </div>
              <p className={styles.report}>{textOf(detail, report, faceOf)}</p>
            </div>
          )}
          {refs.length === 0 ? null : (
            <div className={styles.block} data-refs="">
              <span className={styles.blockTitle}>
                {t("workflow.heading.refs")}
              </span>
              <RefList refs={refs} onOpenFile={shared.onOpenFile} />
            </div>
          )}
          {row.lines.length === 0 ? null : (
            <Fold
              title={t("workflow.label.activity-title")}
              summary={String(row.lines.length)}
              data-activity=""
            >
              <ol className={styles.lines}>
                {row.lines.map((line) => (
                  <li key={line.seq} className={styles.line}>
                    <span className={styles.lineWho}>
                      {lineBy(detail, line, faceOf)}
                    </span>
                    <span className={styles.lineText}>
                      {textOf(detail, line, faceOf)}
                    </span>
                    <span className={styles.lineWhen}>{whenOf(line.at)}</span>
                  </li>
                ))}
              </ol>
            </Fold>
          )}
        </div>
      )}
    </div>
  );
}

const nowStepOf = (now: Now): string | null =>
  now.kind === "human" ||
  now.kind === "working" ||
  now.kind === "remote" ||
  now.kind === "program" ||
  now.kind === "escalated" ||
  now.kind === "blocked"
    ? now.step
    : null;

export function RunView({
  detail,
  hasArtifact,
  faceOf,
  dotOf,
  workspaceNameOf,
  onBack,
  onStop,
  onRetry,
  onResume,
  onRename,
  onSelectInstance,
  onOpenArtifact,
  onOpenSession,
  onOpenFile,
  canOpenSession,
}: {
  detail: Detail;
  /** workflow에 run artifact가 있다. */
  hasArtifact: boolean;
  faceOf: FaceOf | undefined;
  /** step을 받은 session의 지금 상태. 창이 모르면 undefined다. */
  dotOf: ((session: string) => SessionDot | null) | undefined;
  /** 다른 project에서 도는 session의 project 이름. 없으면 workspace를 적지 않는다. */
  workspaceNameOf?: (project: string) => string | undefined;
  onBack: () => void;
  onStop: () => void;
  /** 막힌 step을 같은 session에서 이어서 재시도한다. 없으면 [Retry]를 그리지 않는다. */
  onRetry?: ((step?: string) => void) | null;
  /** 멈춘 flow instance를 replay로 이어 간다. 없으면 [Resume] 단추를 그리지 않는다. */
  onResume?: ((useLatestCode: boolean) => void) | null;
  /** instance 제목을 바꾼다. 없으면 이름 바꾸기 단추를 그리지 않는다. */
  onRename?: ((title: string) => void) | null;
  /** 자식 sub-workflow나 부모 workflow instance로 이동한다. */
  onSelectInstance?: ((instance: string) => void) | null;
  onOpenArtifact: () => void;
  /** step을 받은 session의 대화를 연다. 없으면 단추를 그리지 않는다. */
  onOpenSession: ((session: string) => void) | null;
  /** 명시적 산출물 파일(`refs`)을 편집기로 연다. 없으면 읽기 전용 목록이다. */
  onOpenFile?: ((path: string) => void) | null;
  /** 이 창이 열 수 있는 session인가. 없으면 모두 연다. */
  canOpenSession: ((session: string) => boolean) | undefined;
}) {
  const { instance } = detail;
  const shared: Shared = {
    detail,
    faceOf,
    dotOf,
    // 열지 못하는 session의 단추는 눌러도 아무 일이 없으므로 그리지 않는다.
    openerOf: (session) =>
      onOpenSession === null || canOpenSession?.(session) === false
        ? null
        : () => onOpenSession(session),
    // run의 project에서 도는 session은 자리를 적지 않는다.
    workspaceNameOf: (workspace) =>
      workspace.kind !== "project" || workspace.id === instance.project
        ? undefined
        : workspaceNameOf?.(workspace.id),
    onOpenFile: onOpenFile ?? null,
  };
  const title = instanceTitle(instance);
  const [renaming, setRenaming] = useState(false);
  const now = nowOf(detail);
  const nowStep = nowStepOf(now);
  // 다음 step으로 넘기지 못하면 current는 report를 낸 앞 step에 남는다. 그 step은 끝난 것이고 지금 일은 넘기지 못한 step에 있다.
  const settled = (row: StepRow): StepRow =>
    row.current &&
    row.report !== undefined &&
    row.notice === null &&
    nowStep !== null &&
    nowStep !== row.step.name
      ? { ...row, shown: "reported", current: false }
      : row;
  const rows = stepRows(detail).map(settled);
  const cells = cellsOfRun(detail).map((cell, index) =>
    rows[index].shown === cell.shown
      ? cell
      : { ...cell, shown: rows[index].shown },
  );
  const stages = stagesOf(instance.steps);
  const { byStep, rest } = sessionsByStep(detail);
  const stepRefs = new Set(
    rows.flatMap((row) => refsOfStep(detail.lines, row.step.name)),
  );
  const looseRefs = refsOf(detail).filter((path) => !stepRefs.has(path));
  const runInputs = runInputsOf(detail);
  const checkpoints = detail.checkpoints ?? [];
  const children = detail.children ?? [];
  const parentInstance =
    instance.started_by.kind === "workflow"
      ? instance.started_by.instance
      : null;
  const nowRow = rows.findIndex((row) => row.step.name === nowStep);
  const nowSession =
    now.kind === "human" ||
    now.kind === "human_checkpoint" ||
    now.kind === "working" ||
    now.kind === "blocked" ||
    now.kind === "escalated"
      ? now.session
      : null;
  const nowCard = (
    <NowCard
      detail={detail}
      now={now}
      faceOf={faceOf}
      dotOf={dotOf}
      onRetry={onRetry ?? null}
      onResume={onResume ?? null}
      onOpenSession={shared.openerOf}
      listed={(session) =>
        detail.sessions?.some((node) => node.session === session) === true
      }
    />
  );
  // 머리 쪽 줄 가운데 한 장이 이미 말한 것(끝남, 멈춤, program 종료, 지금 막힘 줄)은 다시 적지 않는다.
  const nowBlockedSeq =
    now.kind === "blocked" && now.line !== null ? now.line.seq : null;
  const notes = headLines(detail).filter(
    (line) =>
      line.kind !== "ended" &&
      line.kind !== "stopped" &&
      line.kind !== "program_exited" &&
      line.seq !== nowBlockedSeq,
  );
  const hasLongInput =
    instance.input.trim() !== "" && instance.input.trim() !== title;
  const touched = (index: number) =>
    rows[index].current ||
    rows[index].report !== undefined ||
    rows[index].lines.length > 0;
  return (
    <section
      className={styles.run}
      aria-label={t("workflow.label.instance")}
      data-instance-view={instance.id}
    >
      <div className={styles.back}>
        <Button
          size="sm"
          variant="ghost"
          icon={commonIcons.back}
          onClick={onBack}
          data-back=""
        >
          {t("workflow.button.all-runs")}
        </Button>
      </div>
      <header className={styles.head}>
        <div className={styles.headText}>
          <div className={styles.titleRow}>
            {renaming && onRename != null ? (
              <TitleRenameInput
                value={title}
                onDone={(next) => {
                  setRenaming(false);
                  if (next !== undefined && next !== title) onRename(next);
                }}
              />
            ) : (
              <>
                <h1 className={styles.title}>{title}</h1>
                {onRename == null ? null : (
                  <span className={styles.titleEdit}>
                    <IconButton
                      icon={actionIcons.edit}
                      label={t("workflow.button.rename")}
                      size="sm"
                      onClick={() => setRenaming(true)}
                    />
                  </span>
                )}
              </>
            )}
          </div>
          <div className={styles.meta}>
            <StateMark
              shown={shownOfRun(
                instance.state,
                instance.current,
                detail.derived_status,
              )}
            />
            <span>
              {t("workflow.label.started-at", {
                when: whenOf(instance.created_at),
              })}
            </span>
            {instance.one_off === true ? (
              <span data-workflow-badge="one-off">
                {t("workflow.label.badge-one-off")}
              </span>
            ) : null}
            {instance.overridden === true ? (
              <span data-workflow-badge="overridden">
                {t("workflow.label.badge-overridden")}
              </span>
            ) : null}
            {instance.started_by.kind === "job" ? (
              <span data-started-by="job">
                {instance.started_by.title === null
                  ? t("workflow.label.started-by-job-untitled")
                  : t("workflow.label.started-by-job", {
                      title: instance.started_by.title,
                    })}
              </span>
            ) : instance.started_by.kind === "agent" ? (
              <span data-started-by="agent">
                {t("workflow.label.started-by-agent")}
              </span>
            ) : parentInstance !== null ? (
              onSelectInstance !== null && onSelectInstance !== undefined ? (
                <button
                  type="button"
                  className={styles.parentLink}
                  data-started-by="workflow"
                  onClick={() => onSelectInstance(parentInstance)}
                >
                  {t("workflow.label.started-by-workflow", {
                    instance: parentInstance,
                  })}
                </button>
              ) : (
                <span data-started-by="workflow">
                  {t("workflow.label.started-by-workflow", {
                    instance: parentInstance,
                  })}
                </span>
              )
            ) : null}
            <span className={styles.instanceId} data-instance-id={instance.id}>
              <code className={styles.instanceIdText}>{instance.id}</code>
              <Tooltip content={t("common.button.copy-id")} placement="beside">
                <span className={styles.copyWrap}>
                  <CopyButton
                    text={instance.id}
                    label={t("common.button.copy-id")}
                    clipboard={systemClipboard}
                  />
                </span>
              </Tooltip>
            </span>
          </div>
        </div>
        <span className={styles.actions}>
          {hasArtifact ? (
            <Button trailingIcon={actionIcons.open} onClick={onOpenArtifact}>
              {t("workflow.button.open-instance-artifact")}
            </Button>
          ) : null}
          {instance.state === "running" ? (
            <Button
              variant="danger"
              icon={actionIcons.stop}
              onClick={onStop}
              data-stop=""
            >
              {t("workflow.button.stop")}
            </Button>
          ) : null}
        </span>
      </header>
      {!hasLongInput && runInputs.length === 0 ? null : (
        <Fold
          title={t("workflow.heading.run-input")}
          summary={runInputs
            .map((item) =>
              t("workflow.label.setting-value", {
                label: item.key,
                value: item.value,
              }),
            )
            .join(" · ")}
          data-inputs=""
        >
          {hasLongInput ? (
            <p className={styles.inputText}>{instance.input}</p>
          ) : null}
          {runInputs.length === 0 ? null : (
            <dl className={styles.inputs}>
              {runInputs.map((item) => (
                <div
                  key={item.key}
                  className={styles.inputRow}
                  data-input-key={item.key}
                >
                  <dt className={styles.inputKey}>{item.key}</dt>
                  <dd className={styles.inputValue}>{item.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </Fold>
      )}
      {nowRow === -1 ? nowCard : null}
      {notes.length === 0 ? null : (
        <ul className={styles.notes} aria-label={t("workflow.label.notes")}>
          {notes.map((line) => (
            <li key={line.seq}>
              {t("workflow.label.note-line", {
                who: lineBy(detail, line, faceOf),
                text: textOf(detail, line, faceOf),
              })}{" "}
              · {whenOf(line.at)}
            </li>
          ))}
        </ul>
      )}
      {stages.length === 0 ? null : (
        <Rail label={t("workflow.label.steps")}>
          {stages.map((members) => {
            // 서로 대신하는 step 가운데 이 run이 지나간 것만 step으로 그린다. 아직 어느 쪽도 지나가지 않았으면 모두 그린다.
            const used = members.filter(touched);
            const shownMembers = used.length === 0 ? members : used;
            const unused = members.filter(
              (index) => !shownMembers.includes(index),
            );
            const tone =
              TONE_ORDER.find((one) =>
                shownMembers.some(
                  (index) => toneOf(rows[index], cells[index]) === one,
                ),
              ) ?? "idle";
            return (
              <RailStage
                key={rows[members[0]].step.name}
                tone={tone}
                bare
                marker={
                  <Icon icon={TONE_ICON[tone]} pixels={iconPixels("large")} />
                }
                data-stage={members
                  .map((index) => rows[index].step.name)
                  .join(" ")}
              >
                {shownMembers.map((index, position) => (
                  <div key={rows[index].step.name} className={styles.member}>
                    {position === 0 || used.length > 0 ? null : (
                      <span className={styles.or}>
                        {t("workflow.label.choice-or")}
                      </span>
                    )}
                    <StepCard
                      row={rows[index]}
                      cell={cells[index]}
                      sessions={byStep.get(rows[index].step.name) ?? []}
                      now={index === nowRow ? nowCard : null}
                      nowSession={index === nowRow ? nowSession : null}
                      shared={shared}
                    />
                  </div>
                ))}
                {unused.length === 0 ? null : (
                  <p className={styles.unused} data-unused="">
                    {t("workflow.label.choice-unused", {
                      steps: unused
                        .map((index) =>
                          t("workflow.label.step-of-who", {
                            step: rows[index].step.name,
                            who: assigneeText(cells[index], faceOf),
                          }),
                        )
                        .join(", "),
                    })}
                  </p>
                )}
              </RailStage>
            );
          })}
        </Rail>
      )}
      {rest.length === 0 ? null : (
        <SessionBlock
          title={t(
            stages.length === 0
              ? "workflow.heading.sessions"
              : "workflow.heading.other-sessions",
          )}
          nodes={rest}
          shared={shared}
        />
      )}
      {looseRefs.length === 0 ? null : (
        <div className={styles.block} data-refs="">
          <span className={styles.blockTitle}>
            {t("workflow.heading.refs")}
          </span>
          <RefList refs={looseRefs} onOpenFile={shared.onOpenFile} />
        </div>
      )}
      {children.length === 0 ? null : (
        <div className={styles.block} data-children="">
          <div className={styles.blockHead}>
            <span className={styles.blockTitle}>
              {t("workflow.heading.children")}
            </span>
            <span className={styles.blockSummary}>{children.length}</span>
          </div>
          <ul className={styles.children}>
            {children.map((child) => {
              const shown = shownOfRun(child.state, null, child.derived_status);
              const when =
                child.ended_at !== null
                  ? t("workflow.label.finished-at", {
                      when: whenOf(child.ended_at),
                    })
                  : t("workflow.label.started-at", {
                      when: whenOf(child.started_at),
                    });
              const body = (
                <>
                  <span className={styles.childMain}>
                    <span className={styles.childName}>
                      {child.title != null && child.title.trim() !== ""
                        ? `${child.title} / ${child.workflow}`
                        : child.workflow}
                    </span>
                    <span className={styles.childMeta}>
                      <StateMark shown={shown} />
                      <span>{when}</span>
                    </span>
                  </span>
                  {onSelectInstance !== null &&
                  onSelectInstance !== undefined ? (
                    <span className={styles.childGo} aria-hidden="true">
                      <Icon
                        icon={commonIcons.expand}
                        pixels={iconPixels("base")}
                      />
                    </span>
                  ) : null}
                </>
              );
              return (
                <li
                  key={child.instance}
                  data-child-instance={child.instance}
                  data-derived-status={child.derived_status}
                >
                  {onSelectInstance !== null &&
                  onSelectInstance !== undefined ? (
                    <button
                      type="button"
                      className={styles.childRow}
                      onClick={() => onSelectInstance(child.instance)}
                    >
                      {body}
                    </button>
                  ) : (
                    <div className={styles.childStatic}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {checkpoints.length === 0 ? null : (
        <Fold
          title={t("workflow.heading.checkpoints")}
          summary={String(checkpoints.length)}
          // 선언한 step이 없는 flow는 checkpoint가 진행을 보이는 유일한 줄이다.
          defaultOpen={stages.length === 0}
          data-checkpoints=""
        >
          <ul className={styles.checkpoints}>
            {checkpoints.map((checkpoint) => {
              const humanWaiting =
                checkpoint.kind === "human" && checkpoint.state === "started";
              const open =
                humanWaiting && checkpoint.handle_ref !== null
                  ? shared.openerOf(checkpoint.handle_ref)
                  : null;
              const failedError =
                (checkpoint.state === "failed" ||
                  checkpoint.state === "interrupted") &&
                checkpoint.error !== null
                  ? checkpoint.error
                  : null;
              return (
                <li
                  key={checkpoint.key}
                  className={styles.checkpointRow}
                  data-checkpoint={checkpoint.key}
                  data-checkpoint-kind={checkpoint.kind}
                  data-checkpoint-state={checkpoint.state}
                >
                  <div className={styles.checkpointMain}>
                    <div className={styles.checkpointHead}>
                      <span
                        className={styles.checkpointBadge}
                        data-state={checkpoint.state}
                        data-kind={checkpoint.kind}
                      >
                        {t(CHECKPOINT_STATE_KEY[checkpoint.state])}
                      </span>
                      <span className={styles.checkpointKey}>
                        {checkpoint.key}
                      </span>
                      <span className={styles.checkpointKind}>
                        {t(CHECKPOINT_KIND_KEY[checkpoint.kind])}
                      </span>
                      <span className={styles.checkpointWhen}>
                        {whenOf(
                          checkpoint.finished_at ?? checkpoint.started_at,
                        )}
                      </span>
                    </div>
                    {humanWaiting ? (
                      <p className={styles.checkpointHint}>
                        {t("workflow.note.checkpoint-human-waiting")}
                      </p>
                    ) : null}
                    {failedError === null ? null : (
                      <p
                        className={styles.checkpointError}
                        data-checkpoint-error=""
                      >
                        <Icon
                          icon={editorIcons.problem}
                          pixels={iconPixels("base")}
                        />
                        <span>
                          {failedError.message.trim() === ""
                            ? failedError.reason
                            : `${failedError.reason}: ${failedError.message}`}
                        </span>
                      </p>
                    )}
                  </div>
                  {open === null ? null : (
                    <span className={styles.actions}>
                      <Button
                        size="sm"
                        variant="ghost"
                        trailingIcon={actionIcons.open}
                        onClick={open}
                        data-checkpoint-session={checkpoint.handle_ref ?? ""}
                      >
                        {t("workflow.button.open-session")}
                      </Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Fold>
      )}
    </section>
  );
}

function TitleRenameInput({
  value,
  onDone,
}: {
  value: string;
  onDone: (next: string | undefined) => void;
}) {
  const done = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (next: string | undefined) => {
    if (done.current) return;
    done.current = true;
    onDone(next);
  };
  const typed = (el: HTMLInputElement) => el.value.trim() || value;
  return (
    <input
      ref={input}
      className={styles.titleInput}
      aria-label={t("workflow.button.rename")}
      defaultValue={value}
      onBlur={(event) => finish(typed(event.currentTarget))}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") finish(typed(event.currentTarget));
        else if (event.key === "Escape") finish(undefined);
      }}
    />
  );
}
