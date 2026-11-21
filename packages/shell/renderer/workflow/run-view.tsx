// run 하나의 화면. 머리(이름, 상태, [Stop]) 아래에 step 줄, 지금 어디에 있는지 한 장, step마다 맡은 쪽과 마지막 report가 온다.
// step을 받은 session으로 가는 [Open session]이 step마다 있다. 순서를 바꾸는 단추는 없다: 사람은 그 agent에게 말한다.
import { Button, Icon } from "@lophn/ui/primitives";
import { CodeBlock } from "@lophn/ui/reading";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import { actionIcons, commonIcons, editorIcons } from "../icons/mod.ts";
import type { SessionDot } from "../parts/agent-session/activity.ts";
import type {
  WorkflowInstanceDetailView,
  WorkflowLineView,
} from "../workspace/source.ts";
import {
  type FaceOf,
  headLines,
  jobWho,
  type Now,
  notHandedKey,
  nowOf,
  participantText,
  relayOfRun,
  runTitle,
  sessionOfStep,
  shownOf,
  STEP_KEY,
  stepRows,
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
      return t(notHandedKey(line.reason));
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
  }
}

const NOW_TONE = {
  human: "warning",
  working: "good",
  program: "good",
  blocked: "serious",
  ended: "neutral",
  stopped: "serious",
  waiting: "neutral",
} as const satisfies Record<Now["kind"], string>;

const NOW_ICON = {
  human: commonIcons.stateYourTurn,
  working: commonIcons.stateRunning,
  program: commonIcons.stateRunning,
  blocked: editorIcons.problem,
  ended: commonIcons.stateEnded,
  stopped: commonIcons.stateStopped,
  waiting: commonIcons.stateNotReached,
} as const satisfies Record<Now["kind"], unknown>;

/** 지금 어디에 있는지 한 장. 사람이 다음에 할 일이 있으면 그 단추가 오른쪽 끝에 온다. */
function NowCard({
  detail,
  now,
  faceOf,
  dotOf,
  onOpenSession,
}: {
  detail: Detail;
  now: Now;
  faceOf: FaceOf | undefined;
  dotOf: ((session: string) => SessionDot | null) | undefined;
  /** 열 수 있는 session이면 여는 함수, 아니면 null. */
  onOpenSession: (session: string) => (() => void) | null;
}) {
  // agent가 맡은 step인데 그 session이 사람의 답을 기다리면 사람 차례와 같은 무게로 보인다.
  const asking =
    now.kind === "working" &&
    now.session !== null &&
    dotOf?.(now.session) === "waiting";
  const tone = asking ? "warning" : NOW_TONE[now.kind];
  const open =
    (now.kind === "human" ||
      now.kind === "working" ||
      now.kind === "blocked") &&
    now.session !== null
      ? onOpenSession(now.session)
      : null;
  const text = (() => {
    switch (now.kind) {
      case "human":
        return t("workflow.note.your-turn", {
          step: now.step,
          agent: whoName(now.who, faceOf),
        });
      case "working":
        return t(
          asking ? "workflow.note.now-asking" : "workflow.note.now-working",
          { step: now.step, who: whoName(now.who, faceOf) },
        );
      case "program":
        return t("workflow.note.now-program", { step: now.step });
      case "blocked":
        return textOf(detail, now.line, faceOf);
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
      data-tone={tone}
      aria-label={t("workflow.label.now")}
    >
      <div className={styles.nowLine}>
        <span className={styles.nowIcon}>
          <Icon icon={NOW_ICON[now.kind]} pixels={iconPixels("base")} />
        </span>
        <div className={styles.nowText}>
          <p className={styles.nowMain}>{text}</p>
          {now.kind === "blocked" ? (
            <p className={styles.nowHint}>{t("workflow.note.blocked-hint")}</p>
          ) : null}
        </div>
        {open === null ? null : (
          <span className={styles.actions}>
            <Button
              size="sm"
              variant={now.kind === "human" || asking ? "primary" : "secondary"}
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
  onOpenArtifact,
  onOpenSession,
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
  onOpenArtifact: () => void;
  /** step을 받은 session의 대화를 연다. 없으면 단추를 그리지 않는다. */
  onOpenSession: ((session: string) => void) | null;
  /** 이 창이 열 수 있는 session인가(다른 workspace의 agent는 열지 못한다). 없으면 모두 연다. */
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
  // 머리 쪽 줄 가운데 한 장이 이미 말한 것(끝남, 멈춤, program 종료)은 다시 적지 않는다.
  // 한 장이 이미 여는 session은 step 줄에서 다시 단추로 두지 않는다.
  const nowSession =
    now.kind === "human" || now.kind === "working" || now.kind === "blocked"
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
            <StateMark shown={shownOf(instance.state, instance.current)} />
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
      <Relay steps={relay} faceOf={faceOf} />
      <NowCard
        detail={detail}
        now={now}
        faceOf={faceOf}
        dotOf={dotOf}
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
              data-shown={row.shown}
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
                    {t(STEP_KEY[row.shown])}
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
