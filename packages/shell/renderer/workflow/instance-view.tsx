// instance 하나의 기본 view. 목록과 글만 그린다(graph는 artifact의 일이다).
// 머리(상태, 시작 입력, 사람 차례, [Stop]) 아래에 step마다 담당, 마지막 report 글, 그 step의 줄 펼침이 온다.
import { Button, Icon } from "@lophn/ui/primitives";
import { CodeBlock } from "@lophn/ui/reading";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import { FLOW_STEP_BY } from "../../../protocol/workflows/values.ts";
import { actionIcons, commonIcons, editorIcons } from "../icons/mod.ts";
import type {
  WorkflowInstanceDetailView,
  WorkflowInstanceView,
  WorkflowLineView,
} from "../workspace/source.ts";
import { StateMark } from "./instance-list.tsx";
import {
  headLines,
  jobWho,
  notHandedKey,
  participantText,
  shownOf,
  STEP_KEY,
  stepRows,
  type StepShown,
  turnOf,
  whenOf,
} from "./model.ts";
import styles from "./instance-view.module.css";

const STEP_ICON = {
  human: commonIcons.stateYourTurn,
  current: commonIcons.stateRunning,
  stopped: commonIcons.stateStopped,
  reported: commonIcons.stateEnded,
  waiting: commonIcons.stateNotReached,
} as const satisfies Record<StepShown, unknown>;

const participantName = (instance: WorkflowInstanceView, key: string) => {
  const participant = instance.participants[key];
  return participant === undefined ? key : participantText(participant);
};

// step 담당 글. 사람 step은 "You, with lophn"다.
function assignee(
  instance: WorkflowInstanceView,
  step: WorkflowInstanceView["steps"][number],
) {
  const by = participantName(instance, step.by);
  return step.with === null
    ? by
    : t("workflow.label.assignee-with", {
        by,
        with: participantName(instance, step.with),
      });
}

// agent가 낸 줄은 session으로 참가자를 찾는다. 그 session에 step을 넘긴 줄(handed)이 단서다.
function whoOf(
  detail: WorkflowInstanceDetailView,
  line: WorkflowLineView,
): string {
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
    ? participantName(detail.instance, handed.participant)
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

function textOf(
  detail: WorkflowInstanceDetailView,
  line: WorkflowLineView,
): string {
  switch (line.kind) {
    case "started":
      return t("workflow.label.line-started", { text: line.text });
    case "report":
      return line.text;
    case "edit":
      return editText(line);
    case "handed":
      return t("workflow.label.line-handed", {
        participant: participantName(detail.instance, line.participant),
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

// 머리 쪽 줄. 멈춤은 누가 멈췄는지가 곧 뜻이라 글에 담고, 고친 줄은 누가 고쳤는지를 앞에 둔다.
function noteOf(
  detail: WorkflowInstanceDetailView,
  line: WorkflowLineView,
): string {
  if (line.kind === "stopped") return t("workflow.label.note-stopped");
  if (line.kind === "ended") return t("workflow.label.state-ended");
  return t("workflow.label.note-line", {
    who: whoOf(detail, line),
    text: textOf(detail, line),
  });
}

export function InstanceView({
  detail,
  hasArtifact,
  onStop,
  onOpenArtifact,
  onOpenConversation,
}: {
  detail: WorkflowInstanceDetailView;
  /** workflow에 instance artifact가 있다. */
  hasArtifact: boolean;
  onStop: () => void;
  onOpenArtifact: () => void;
  /** 사람 차례일 때 그 step을 받은 agent의 session을 연다. 없으면 단추를 그리지 않는다. */
  onOpenConversation: ((session: string) => void) | null;
}) {
  const { instance } = detail;
  const turn = turnOf(detail);
  const notes = headLines(detail);
  return (
    <section
      className={styles.instance}
      aria-label={t("workflow.label.instance")}
      data-instance-view={instance.id}
    >
      <div className={styles.instanceHead}>
        <StateMark shown={shownOf(instance.state, instance.current)} />
        <span className={styles.when}>
          {t("workflow.label.started-at", {
            when: whenOf(instance.created_at),
          })}
        </span>
        {instance.started_by.kind === "job" ? (
          <span className={styles.when} data-started-by="job">
            {instance.started_by.title === null
              ? t("workflow.label.started-by-job-untitled")
              : t("workflow.label.started-by-job", {
                  title: instance.started_by.title,
                })}
          </span>
        ) : null}
        <span className={styles.actions}>
          {hasArtifact ? (
            <Button
              size="sm"
              trailingIcon={actionIcons.open}
              onClick={onOpenArtifact}
            >
              {t("workflow.button.open-instance-artifact")}
            </Button>
          ) : null}
          {instance.state === "running" ? (
            <Button
              size="sm"
              variant="danger"
              icon={actionIcons.stop}
              onClick={onStop}
              data-stop=""
            >
              {t("workflow.button.stop")}
            </Button>
          ) : null}
        </span>
      </div>
      <div>
        <span className={styles.inputLabel}>{t("workflow.label.input")}</span>
        <p className={styles.inputText}>{instance.input}</p>
      </div>
      {turn === null ? null : (
        <div className={styles.turn} data-turn="">
          <span className={styles.turnIcon}>
            <Icon
              icon={commonIcons.stateYourTurn}
              pixels={iconPixels("base")}
            />
          </span>
          <span className={styles.turnText}>
            {t("workflow.note.your-turn", {
              step: turn.step,
              agent: participantName(instance, turn.participant),
            })}
          </span>
          {onOpenConversation === null ? null : (
            <Button
              size="sm"
              trailingIcon={actionIcons.open}
              onClick={() => onOpenConversation(turn.receiver)}
            >
              {t("workflow.button.open-conversation")}
            </Button>
          )}
        </div>
      )}
      {notes.length === 0 ? null : (
        <ul className={styles.notes} aria-label={t("workflow.label.notes")}>
          {notes.map((line) => (
            <li key={line.seq}>
              {noteOf(detail, line)} · {whenOf(line.at)}
              {line.kind === "program_exited" && line.stderr_tail !== "" ? (
                <CodeBlock code={line.stderr_tail} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <ol className={styles.steps} aria-label={t("workflow.label.steps")}>
        {stepRows(detail).map((row) => (
          <li
            key={row.step.name}
            className={styles.step}
            data-step={row.step.name}
            data-shown={row.shown}
          >
            <span className={styles.stepMark}>
              <Icon icon={STEP_ICON[row.shown]} pixels={iconPixels("base")} />
            </span>
            <div className={styles.stepMain}>
              <div className={styles.stepHead}>
                <span className={styles.stepName}>{row.step.name}</span>
                {
                  // flow의 step은 program이 맡는다. 참가자가 아니라 담당 글이 없다.
                  row.step.by === FLOW_STEP_BY &&
                  instance.participants[row.step.by] === undefined ? null : (
                    <span className={styles.stepWho}>
                      {assignee(instance, row.step)}
                    </span>
                  )
                }
                <span className={styles.stepStatus}>
                  {t(STEP_KEY[row.shown])}
                </span>
              </div>
              {row.report === undefined ? null : (
                <>
                  <p className={styles.report}>{textOf(detail, row.report)}</p>
                  <span className={styles.reportWho}>
                    {t("workflow.label.report-by", {
                      who: whoOf(detail, row.report),
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
                  <span>{textOf(detail, row.notice)}</span>
                </p>
              )}
              {row.lines.length === 0 ? null : (
                <details open={row.current}>
                  <summary className={styles.lineToggle}>
                    {t("workflow.label.lines", { count: row.lines.length })}
                  </summary>
                  <ol className={styles.lines}>
                    {row.lines.map((line) => (
                      <li key={line.seq} className={styles.line}>
                        <span className={styles.lineWho}>
                          {whoOf(detail, line)}
                        </span>
                        <span className={styles.lineText}>
                          {textOf(detail, line)}
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
          </li>
        ))}
      </ol>
    </section>
  );
}
