// run 하나의 화면. 머리(이름, 상태, [Stop]) 아래에 step 줄, 지금 어디에 있는지 한 장, session tree, 산출물 파일(refs), step마다 맡은 쪽과 마지막 report가 온다.
// step을 받은 session으로 가는 [Open session]과 막혔을 때 같은 session에서 이어가는 [Retry]가 있다.
import { Button, Icon } from "@lophn/ui/primitives";
import { CodeBlock } from "@lophn/ui/reading";
import { iconPixels } from "@lophn/ui/shared";
import { type MessageKey, t } from "@lophn/i18n";

import { actionIcons, commonIcons, editorIcons } from "../icons/mod.ts";
import type { SessionDot } from "../parts/agent-session/activity.ts";
import type {
  WorkflowInstanceDetailView,
  WorkflowLineView,
} from "../workspace/source.ts";
import {
  buildSessionTree,
  canRetry,
  type FaceOf,
  headLines,
  jobWho,
  type Now,
  notHandedKey,
  nowOf,
  participantText,
  previewText,
  refsOf,
  relayOfRun,
  runInputsOf,
  runTitle,
  type SessionNodeStatus,
  sessionOfStep,
  sessionSummaryText,
  shownOfRun,
  STEP_KEY,
  stepRows,
  summarizeSessions,
  whenOf,
  whoName,
  whoOf,
} from "./model.ts";
import { assigneeText, Relay } from "./relay.tsx";
import styles from "./run-view.module.css";
import { StateMark } from "./state-mark.tsx";
import { WhoMark } from "./who.tsx";

type Detail = WorkflowInstanceDetailView;

const participantName = (detail: Detail, key: string, faceOf?: FaceOf) => {
  const participant = detail.instance.participants[key];
  return participant === undefined
    ? key
    : faceOf === undefined
      ? participantText(participant)
      : whoName(whoOf(detail.instance.participants, key), faceOf);
};

// agent가 낸 줄은 session으로 참가자를 찾는다. 그 session에 step을 넘긴 줄(handed)이 단서다.
function lineBy(detail: Detail, line: WorkflowLineView, faceOf?: FaceOf) {
  if (line.by.kind === "user") return t("workflow.label.participant-human");
  if (line.by.kind === "lophn") return t("workflow.label.participant-lophn");
  if (line.by.kind === "program") {
    return t("workflow.label.participant-program");
  }
  if (line.by.kind === "job") {
    const by = detail.instance.started_by;
    return jobWho(by.kind === "job" ? by.title : null);
  }
  if (line.by.kind === "remote") {
    return t("workflow.label.participant-on", {
      who: line.by.name,
      computer: line.by.computer,
    });
  }
  if (line.by.kind === "remote_lophn") {
    return t("workflow.label.participant-on", {
      who: t("workflow.label.participant-lophn"),
      computer: line.by.computer,
    });
  }
  const session = line.by.session;
  const handed = detail.lines.find(
    (item) => item.kind === "handed" && item.receiver === session,
  );
  return handed?.kind === "handed"
    ? participantName(detail, handed.participant, faceOf)
    : t("workflow.label.participant-unknown");
}

// edit 줄. step이 필요한 op인데 step이 없으면 "고쳤다"로만 읽는다.
function editText(line: Extract<WorkflowLineView, { kind: "edit" }>): string {
  if (line.op === "end") return t("workflow.label.line-edit-end");
  const step = line.step;
  if (step === null) return t("workflow.label.line-edited");
  switch (line.op) {
    case "add_step":
      return t("workflow.label.line-edit-add-step", { step });
    case "update_step":
      return t("workflow.label.line-edit-update-step", { step });
    case "remove_step":
      return t("workflow.label.line-edit-remove-step", { step });
    case "hand_now":
      return t("workflow.label.line-edit-hand-now", { step });
    default:
      return t("workflow.label.line-edited");
  }
}

function textOf(detail: Detail, line: WorkflowLineView, faceOf?: FaceOf) {
  switch (line.kind) {
    case "started":
      return t("workflow.label.line-started", { text: line.text });
    case "report":
      return line.text;
    case "edit":
      return editText(line);
    case "handed":
      return t("workflow.label.line-handed", {
        participant: participantName(detail, line.participant, faceOf),
        turn: line.human_turn ? "yes" : "no",
        session: line.session ?? "none",
      });
    case "not_handed":
      // 다른 컴퓨터에서 돌지 못한 이유는 core가 경우마다 읽을 글로 적는다(건너뜀, 만료, 취소, report 없이 닫힘).
      return line.reason === "remote_failed"
        ? line.message
        : t(notHandedKey(line.reason));
    case "ended":
      return t("workflow.label.state-ended");
    case "stopped":
      return t("workflow.label.state-stopped");
    case "lophn_restarted":
      return t(
        line.step === null
          ? "workflow.note.restarted-flow"
          : "workflow.note.restarted",
      );
    case "program_exited":
      return line.code === null
        ? t("workflow.note.program-signal")
        : t("workflow.note.program-exited", { code: String(line.code) });
    case "step_stalled":
      return t("workflow.note.step-stalled", { step: line.step });
    case "retried":
      return line.step === null
        ? t("workflow.label.line-retried")
        : t("workflow.label.line-retried-step", { step: line.step });
    case "escalated":
      return t("workflow.label.line-escalated", { text: line.text });
    case "code_updated":
      return t("workflow.label.line-code-updated");
  }
}

const NOW_TONE = {
  human: "warning",
  escalated: "warning",
  working: "good",
  remote: "good",
  program: "good",
  blocked: "serious",
  ended: "neutral",
  stopped: "serious",
  waiting: "neutral",
} as const satisfies Record<Now["kind"], string>;

const NOW_ICON = {
  human: commonIcons.stateYourTurn,
  escalated: commonIcons.stateYourTurn,
  working: commonIcons.stateRunning,
  remote: commonIcons.stateRunning,
  program: commonIcons.stateRunning,
  blocked: editorIcons.problem,
  ended: commonIcons.stateEnded,
  stopped: commonIcons.stateStopped,
  waiting: commonIcons.stateNotReached,
} as const satisfies Record<Now["kind"], unknown>;

const SESSION_STATE_KEY: Record<SessionNodeStatus, MessageKey> = {
  running: "workflow.label.session-state-running",
  waiting: "workflow.label.session-state-waiting",
  idle: "workflow.label.session-state-idle",
  failed: "workflow.label.session-state-failed",
};

// 다른 컴퓨터로 넘긴 step의 전달 상태마다 한 장의 글, 색, 아이콘. 늦게 닿아 그 컴퓨터에서 사람을 기다리는 것만 사람 차례의 무게다.
const REMOTE_NOW = {
  pending: {
    key: "workflow.note.now-remote-pending",
    tone: "neutral",
    icon: commonIcons.stateNotReached,
  },
  unknown: {
    key: "workflow.note.now-remote-unknown",
    tone: "neutral",
    icon: commonIcons.stateNotReached,
  },
  held: {
    key: "workflow.note.now-remote-held",
    tone: "warning",
    icon: commonIcons.stateYourTurn,
  },
  running: {
    key: "workflow.note.now-remote-running",
    tone: "good",
    icon: commonIcons.stateRunning,
  },
} as const;

// 그 컴퓨터에서 step을 가져간 turn이 report 없이 끝났다. 사람이 그 컴퓨터의 session에서 이어야 해서 넘기지 못한 step과 같은 무게다.
const REMOTE_TURN_ENDED = {
  key: "workflow.note.now-remote-turn-ended",
  tone: "serious",
  icon: editorIcons.problem,
} as const;

/** 지금 어디에 있는지 한 장. 사람이 다음에 할 일이 있으면 그 단추가 오른쪽 끝에 온다. */
function NowCard({
  detail,
  now,
  faceOf,
  dotOf,
  onRetry,
  onOpenSession,
}: {
  detail: Detail;
  now: Now;
  faceOf: FaceOf | undefined;
  dotOf: ((session: string) => SessionDot | null) | undefined;
  onRetry: ((step?: string) => void) | null;
  /** 열 수 있는 session이면 여는 함수, 아니면 null. */
  onOpenSession: (session: string) => (() => void) | null;
}) {
  // agent가 맡은 step인데 그 session이 사람의 답을 기다리면 사람 차례와 같은 무게로 보인다.
  const asking =
    now.kind === "working" &&
    now.session !== null &&
    dotOf?.(now.session) === "waiting";
  // 끝난 call의 전달 상태는 없다. 그때는 도는 것으로 읽는다(다음 줄이 곧 온다).
  const remote =
    now.kind !== "remote"
      ? null
      : now.turnEnded
        ? REMOTE_TURN_ENDED
        : REMOTE_NOW[now.delivery ?? "running"];
  const tone = asking ? "warning" : (remote?.tone ?? NOW_TONE[now.kind]);
  const open =
    (now.kind === "human" ||
      now.kind === "working" ||
      now.kind === "blocked" ||
      now.kind === "escalated") &&
    now.session !== null
      ? onOpenSession(now.session)
      : null;
  const retryable = onRetry !== null && canRetry(detail, now);
  const retryStep =
    now.kind === "blocked" && now.step !== null ? now.step : undefined;
  const text = (() => {
    switch (now.kind) {
      case "human":
        return t("workflow.note.your-turn", {
          step: now.step,
          agent: whoName(now.who, faceOf),
        });
      case "escalated":
        return now.line.text;
      case "working":
        return t(
          asking ? "workflow.note.now-asking" : "workflow.note.now-working",
          { step: now.step, who: whoName(now.who, faceOf) },
        );
      case "remote":
        return t(remote!.key, {
          step: now.step,
          who: whoName(now.who, faceOf),
          computer: now.computer,
        });
      case "program":
        return t("workflow.note.now-program", { step: now.step });
      case "blocked":
        return now.line === null
          ? t("workflow.note.blocked")
          : textOf(detail, now.line, faceOf);
      case "ended":
        return t("workflow.note.now-ended", { when: whenOf(now.at) });
      case "stopped":
        return t("workflow.note.now-stopped", { when: whenOf(now.at) });
      case "waiting":
        return t("workflow.note.now-waiting");
    }
  })();
  return (
    <section
      className={styles.now}
      data-now={now.kind}
      data-delivery={now.kind === "remote" ? (now.delivery ?? "") : undefined}
      data-tone={tone}
      aria-label={t("workflow.label.now")}
    >
      <div className={styles.nowLine}>
        <span className={styles.nowIcon}>
          <Icon
            icon={remote?.icon ?? NOW_ICON[now.kind]}
            pixels={iconPixels("base")}
          />
        </span>
        <div className={styles.nowText}>
          <p className={styles.nowMain}>{text}</p>
          {now.kind === "blocked" ? (
            <p className={styles.nowHint}>
              {t(
                retryable
                  ? "workflow.note.blocked-retry-hint"
                  : "workflow.note.blocked-hint",
              )}
            </p>
          ) : null}
        </div>
        {open === null && !retryable ? null : (
          <span className={styles.actions}>
            {retryable ? (
              <Button
                size="sm"
                variant="primary"
                icon={actionIcons.retry}
                onClick={() => onRetry(retryStep)}
                data-retry=""
              >
                {t("workflow.button.retry")}
              </Button>
            ) : null}
            {open === null ? null : (
              <Button
                size="sm"
                variant={
                  !retryable &&
                  (now.kind === "human" || now.kind === "escalated" || asking)
                    ? "primary"
                    : "secondary"
                }
                trailingIcon={actionIcons.open}
                onClick={open}
                data-open-session=""
              >
                {t(
                  now.kind === "human"
                    ? "workflow.button.open-conversation"
                    : "workflow.button.open-session",
                )}
              </Button>
            )}
          </span>
        )}
      </div>
      {now.kind === "ended" && now.exit !== null ? (
        <div className={styles.nowMore}>
          <p className={styles.nowHint}>{textOf(detail, now.exit, faceOf)}</p>
          {now.exit.stderr_tail === "" ? null : (
            <CodeBlock code={now.exit.stderr_tail} />
          )}
        </div>
      ) : null}
      {now.kind === "ended" && now.report !== null ? (
        <div className={styles.nowMore}>
          <span className={styles.label}>
            {t("workflow.label.last-report")}
          </span>
          <p className={styles.reportFull}>{now.report.text}</p>
          <span className={styles.reportWho}>
            {t("workflow.label.report-by", {
              who: lineBy(detail, now.report, faceOf),
              when: whenOf(now.report.at),
            })}
          </span>
        </div>
      ) : null}
    </section>
  );
}

export function RunView({
  detail,
  hasArtifact,
  faceOf,
  dotOf,
  onBack,
  onStop,
  onRetry,
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
  onBack: () => void;
  onStop: () => void;
  /** 막힌 step을 같은 session에서 이어서 재시도한다. 없으면 [Retry]를 그리지 않는다. */
  onRetry?: ((step?: string) => void) | null;
  onOpenArtifact: () => void;
  /** step을 받은 session의 대화를 연다. 없으면 단추를 그리지 않는다. */
  onOpenSession: ((session: string) => void) | null;
  /** 명시적 산출물 파일(`refs`)을 편집기로 연다. 없으면 읽기 전용 목록이다. */
  onOpenFile?: ((path: string) => void) | null;
  /** 이 창이 열 수 있는 session인가. 없으면 모두 연다. */
  canOpenSession: ((session: string) => boolean) | undefined;
}) {
  const { instance } = detail;
  // 열지 못하는 session의 단추는 눌러도 아무 일이 없으므로 그리지 않는다.
  const openerOf = (session: string): (() => void) | null =>
    onOpenSession === null || canOpenSession?.(session) === false
      ? null
      : () => onOpenSession(session);
  const now = nowOf(detail);
  const title = runTitle(instance.input);
  const rows = stepRows(detail);
  const relay = relayOfRun(detail);
  const sessionRows = buildSessionTree(detail.sessions, dotOf);
  const sessionSummary = summarizeSessions(sessionRows);
  const refs = refsOf(detail);
  const runInputs = runInputsOf(detail);
  // 머리 쪽 줄 가운데 한 장이 이미 말한 것(끝남, 멈춤, program 종료)은 다시 적지 않는다.
  // 한 장이 이미 여는 session은 step 줄에서 다시 단추로 두지 않는다.
  const nowSession =
    now.kind === "human" ||
    now.kind === "working" ||
    now.kind === "blocked" ||
    now.kind === "escalated"
      ? now.session
      : null;
  const notes = headLines(detail).filter(
    (line) =>
      line.kind !== "ended" &&
      line.kind !== "stopped" &&
      line.kind !== "program_exited",
  );
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
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.meta}>
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
            {instance.started_by.kind === "job" ? (
              <span data-started-by="job">
                {instance.started_by.title === null
                  ? t("workflow.label.started-by-job-untitled")
                  : t("workflow.label.started-by-job", {
                      title: instance.started_by.title,
                    })}
              </span>
            ) : null}
          </p>
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
      {instance.input.trim() === title ? null : (
        <div>
          <span className={styles.label}>{t("workflow.label.input")}</span>
          <p className={styles.inputText}>{instance.input}</p>
        </div>
      )}
      {runInputs.length === 0 ? null : (
        <section
          className={styles.section}
          data-inputs=""
          aria-label={t("workflow.heading.inputs")}
        >
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>
              {t("workflow.heading.inputs")}
            </h2>
          </div>
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
        </section>
      )}
      <Relay steps={relay} faceOf={faceOf} />
      <NowCard
        detail={detail}
        now={now}
        faceOf={faceOf}
        dotOf={dotOf}
        onRetry={onRetry ?? null}
        onOpenSession={openerOf}
      />
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
      {sessionRows.length === 0 ? null : (
        <section
          className={styles.section}
          data-sessions=""
          aria-label={t("workflow.heading.sessions")}
        >
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>
              {t("workflow.heading.sessions")}
            </h2>
            <span className={styles.sectionSummary} data-sessions-summary="">
              {sessionSummaryText(sessionSummary)}
            </span>
          </div>
          <ul className={styles.sessions}>
            {sessionRows.map(({ node, depth, status }) => {
              const open = openerOf(node.session);
              const preview = previewText(node.last_assistant_preview);
              const agentLabel = faceOf?.(node.agent)?.name ?? node.agent;
              const waitingLabel =
                node.waiting_for === "approval"
                  ? t("workflow.label.session-waiting-approval")
                  : node.waiting_for === "question"
                    ? t("workflow.label.session-waiting-question")
                    : null;
              return (
                <li
                  key={node.session}
                  className={styles.sessionRow}
                  data-session-node={node.session}
                  data-session-state={status}
                  data-depth={Math.min(depth, 4)}
                >
                  <div className={styles.sessionMain}>
                    <div className={styles.sessionHead}>
                      <span
                        className={styles.sessionDot}
                        data-state={status}
                        aria-hidden="true"
                      />
                      <span className={styles.sessionAgent}>{agentLabel}</span>
                      <span className={styles.sessionState}>
                        {waitingLabel ?? t(SESSION_STATE_KEY[status])}
                      </span>
                      {node.workspace !== null &&
                      (node.workspace.kind !== "project" ||
                        node.workspace.id !== instance.project) ? (
                        <span className={styles.sessionWorkspace}>
                          {node.workspace.id}
                        </span>
                      ) : null}
                    </div>
                    {preview === null ? null : (
                      <p className={styles.sessionPreview}>{preview}</p>
                    )}
                    {node.last_error === null ? null : (
                      <p className={styles.sessionError} data-session-error="">
                        <Icon
                          icon={editorIcons.problem}
                          pixels={iconPixels("base")}
                        />
                        <span>{node.last_error}</span>
                      </p>
                    )}
                  </div>
                  {open === null ? null : (
                    <span className={styles.stepAction}>
                      <Button
                        size="sm"
                        variant="ghost"
                        trailingIcon={actionIcons.open}
                        onClick={open}
                        data-session-open={node.session}
                      >
                        {t("workflow.button.open-session")}
                      </Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {refs.length === 0 ? null : (
        <section
          className={styles.section}
          data-refs=""
          aria-label={t("workflow.heading.refs")}
        >
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>
              {t("workflow.heading.refs")}
            </h2>
          </div>
          <ul className={styles.refs}>
            {refs.map((path) => (
              <li key={path} className={styles.refItem}>
                {onOpenFile !== null && onOpenFile !== undefined ? (
                  <button
                    type="button"
                    className={styles.refButton}
                    onClick={() => onOpenFile(path)}
                    data-ref-path={path}
                  >
                    <Icon
                      icon={commonIcons.documents}
                      pixels={iconPixels("base")}
                    />
                    <span className={styles.refPath}>{path}</span>
                    <span className={styles.refOpen} aria-hidden="true">
                      <Icon
                        icon={actionIcons.open}
                        pixels={iconPixels("base")}
                      />
                    </span>
                  </button>
                ) : (
                  <span className={styles.refStatic} data-ref-path={path}>
                    <Icon
                      icon={commonIcons.documents}
                      pixels={iconPixels("base")}
                    />
                    <span className={styles.refPath}>{path}</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <ol className={styles.steps} aria-label={t("workflow.label.steps")}>
        {rows.map((row, index) => {
          const session = sessionOfStep(detail.lines, row.step.name);
          const open =
            session === null || session === nowSession
              ? null
              : openerOf(session);
          const step = relay[index];
          return (
            <li
              key={row.step.name}
              className={styles.step}
              data-step={row.step.name}
              data-shown={step.heldThere === true ? "human" : row.shown}
            >
              <span className={styles.stepMark}>
                <WhoMark who={step.who} faceOf={faceOf} />
              </span>
              <div className={styles.stepMain}>
                <div className={styles.stepHead}>
                  <span className={styles.stepName}>{row.step.name}</span>
                  {step.who.kind === "program" ? null : (
                    <span className={styles.stepWho}>
                      {assigneeText(step, faceOf)}
                    </span>
                  )}
                  <span className={styles.stepStatus}>
                    {/* step 줄의 칸과 같은 말을 쓴다: 넘기지 못했거나 stall된 step은 도는 중이 아니다. */}
                    {row.notice?.kind === "step_stalled"
                      ? t("workflow.label.step-stalled")
                      : row.notice?.kind === "not_handed"
                        ? t("workflow.label.step-blocked")
                        : step.waitingOn !== undefined
                          ? t("workflow.label.step-remote-waiting", {
                              computer: step.waitingOn,
                            })
                          : t(STEP_KEY[row.shown])}
                  </span>
                </div>
                {row.report === undefined ? null : (
                  <>
                    <p className={styles.report}>
                      {textOf(detail, row.report, faceOf)}
                    </p>
                    <span className={styles.reportWho}>
                      {t("workflow.label.report-by", {
                        who: lineBy(detail, row.report, faceOf),
                        when: whenOf(row.report.at),
                      })}
                    </span>
                  </>
                )}
                {row.notice === null ? null : (
                  <p className={styles.notice} data-notice="">
                    <Icon
                      icon={editorIcons.problem}
                      pixels={iconPixels("base")}
                    />
                    <span>{textOf(detail, row.notice, faceOf)}</span>
                  </p>
                )}
                {row.lines.length === 0 ? null : (
                  <details>
                    <summary className={styles.lineToggle}>
                      {t("workflow.label.activity", {
                        count: row.lines.length,
                      })}
                    </summary>
                    <ol className={styles.lines}>
                      {row.lines.map((line) => (
                        <li key={line.seq} className={styles.line}>
                          <span className={styles.lineWho}>
                            {lineBy(detail, line, faceOf)}
                          </span>
                          <span className={styles.lineText}>
                            {textOf(detail, line, faceOf)}
                          </span>
                          <span className={styles.lineWhen}>
                            {whenOf(line.at)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </div>
              {open === null ? null : (
                <span className={styles.stepAction}>
                  <Button
                    size="sm"
                    variant="ghost"
                    trailingIcon={actionIcons.open}
                    onClick={open}
                    data-step-session=""
                  >
                    {t("workflow.button.open-session")}
                  </Button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
