// instance 하나의 기본 view. 목록과 글만 그린다(graph는 artifact의 일이다).
// 머리(상태, 시작 입력, 사람 차례, [Stop]) 아래에 step마다 담당, 마지막 report 글, 그 step의 줄 펼침이 온다.
import {
  Circle,
  CircleCheck,
  CirclePlay,
  CircleStop,
  ExternalLink,
  MessageCircleMore,
  MessageSquare,
  Square,
  TriangleAlert,
} from "lucide-react";
import { Button, Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";

import type {
  Participant,
  WorkflowInstance,
  WorkflowLine,
} from "../../../../packages/protocol/workflows/mod.ts";
import { whenOf, type WorkflowDetail } from "../../mock/workflow-data.ts";
import { shownOf, StateMark } from "./instance-list.tsx";
import styles from "./workflow.module.css";

const ROLE_NAME: Record<Participant["role"], string> = {
  lophn: "lophn",
  project_manager: "Project Manager",
  app_engineer: "App Engineer",
  operator: "Operator",
  human: "You",
  harness: "Coding agent",
};

const participantName = (instance: WorkflowInstance, key: string) => {
  const participant = instance.participants[key];
  return participant === undefined
    ? key
    : participant.name ?? ROLE_NAME[participant.role];
};

// step 담당 글. 사람 step은 "You, with Project Manager"다.
function assignee(
  instance: WorkflowInstance,
  step: WorkflowInstance["steps"][number],
) {
  const by = participantName(instance, step.by);
  return step.with === null
    ? by
    : `${by}, with ${participantName(instance, step.with)}`;
}

// agent가 낸 줄은 session으로 참가자를 찾는다. 그 session에 step을 넘긴 줄(handed)이 단서다.
function whoOf(detail: WorkflowDetail, line: WorkflowLine): string {
  if (line.by.kind === "user") return "You";
  if (line.by.kind === "lophn") return "lophn";
  const session = line.by.session;
  const handed = detail.lines.find((item) =>
    item.kind === "handed" && item.receiver === session
  );
  return handed?.kind === "handed"
    ? participantName(detail.instance, handed.participant)
    : "An agent";
}

function textOf(detail: WorkflowDetail, line: WorkflowLine): string {
  switch (line.kind) {
    case "started":
      return `Started with: ${line.text}`;
    case "report":
      return line.text;
    case "edit": {
      const step = line.step === null ? "" : ` ${line.step}`;
      switch (line.op) {
        case "add_step":
          return `Added step${step}`;
        case "update_step":
          return `Changed step${step}`;
        case "remove_step":
          return `Removed step${step}`;
        case "hand_now":
          return `Sent step${step} now`;
        case "end":
          return "Ended the workflow";
      }
      return "";
    }
    case "handed": {
      const turn = line.human_turn ? " · your turn" : "";
      const session = line.session === null
        ? ""
        : line.session === "new"
        ? " · new session"
        : " · same session";
      return `Sent to ${
        participantName(detail.instance, line.participant)
      }${turn}${session}`;
    }
    case "not_handed":
      return `Couldn't send it on: ${line.message}`;
    case "ended":
      return "Ended";
    case "stopped":
      return "Stopped";
    case "lophn_restarted":
      return "lophn restarted; this step may need to be sent again";
  }
}

// 머리 쪽 줄. 멈춤은 누가 멈췄는지가 곧 뜻이라 글에 담고, 고친 줄은 누가 고쳤는지를 앞에 둔다.
function noteOf(detail: WorkflowDetail, line: WorkflowLine): string {
  if (line.kind === "stopped") return "Stopped by you";
  if (line.kind === "ended") return "Ended";
  return `${whoOf(detail, line)}: ${textOf(detail, line)}`;
}

type StepShown = "human" | "current" | "stopped" | "reported" | "waiting";

const STEP_MARK = {
  human: { icon: MessageCircleMore, label: "Your turn" },
  current: { icon: CirclePlay, label: "In progress" },
  stopped: { icon: CircleStop, label: "Stopped here" },
  reported: { icon: CircleCheck, label: "Reported" },
  waiting: { icon: Circle, label: "Not reached" },
} as const;

/** step 줄 안에 이유 글로 보이는 줄: 그 step의 마지막 줄이 넘기지 못함이거나 lophn이 다시 켜진 것일 때다(다시 넘기면 마지막 줄이 바뀌어 사라진다). */
function noticeOf(stepLines: readonly WorkflowLine[]): string | null {
  const last = stepLines.at(-1);
  if (last?.kind === "not_handed") {
    return `Couldn't send it on: ${last.message}`;
  }
  if (last?.kind === "lophn_restarted") {
    return "lophn restarted; this step may need to be sent again";
  }
  return null;
}

export function InstanceView(
  { detail, hasArtifact, onStop, onOpenArtifact, onOpenConversation }: {
    detail: WorkflowDetail;
    /** workflow에 instance artifact가 있다. */
    hasArtifact: boolean;
    onStop: () => void;
    onOpenArtifact: () => void;
    /** 사람 차례일 때 그 step을 받은 agent의 session을 연다. */
    onOpenConversation: (session: string) => void;
  },
) {
  const { instance, last_reports, lines } = detail;
  const shown = shownOf(instance.state, instance.current);
  // step이 없는 줄(ended, stopped, step 없는 edit)은 머리 쪽에 둔다.
  const headLines = lines.filter((line) =>
    line.kind === "ended" || line.kind === "stopped" ||
    (line.kind === "edit" && line.step === null)
  );
  const turn = instance.current?.human_turn === true
    ? lines.findLast((line) =>
      line.kind === "handed" && line.step === instance.current?.step
    )
    : undefined;
  return (
    <section
      className={styles.instance}
      aria-label="Instance"
      data-instance-view={instance.id}
    >
      <div className={styles.instanceHead}>
        <StateMark shown={shown} />
        <span className={styles.when}>
          Started {whenOf(instance.created_at)}
        </span>
        <span className={styles.actions}>
          {hasArtifact
            ? (
              <Button size="sm" icon={ExternalLink} onClick={onOpenArtifact}>
                Open instance artifact
              </Button>
            )
            : null}
          {instance.state === "running"
            ? (
              <Button size="sm" icon={Square} onClick={onStop} data-stop="">
                Stop
              </Button>
            )
            : null}
        </span>
      </div>
      <div>
        <span className={styles.inputLabel}>Input</span>
        <p className={styles.inputText}>{instance.input}</p>
      </div>
      {turn?.kind === "handed"
        ? (
          <div className={styles.turn} data-turn="">
            <span className={styles.turnIcon}>
              <Icon icon={MessageCircleMore} pixels={iconPixels("base")} />
            </span>
            <span className={styles.turnText}>
              Your turn on {turn.step}.{" "}
              {participantName(instance, turn.participant)}{" "}
              is waiting to talk it through with you.
            </span>
            <Button
              size="sm"
              icon={MessageSquare}
              onClick={() => onOpenConversation(turn.receiver)}
            >
              Open conversation
            </Button>
          </div>
        )
        : null}
      {headLines.length === 0
        ? null
        : (
          <ul className={styles.notes} aria-label="Notes">
            {headLines.map((line) => (
              <li key={line.seq}>
                {noteOf(detail, line)} · {whenOf(line.at)}
              </li>
            ))}
          </ul>
        )}
      <ol className={styles.steps} aria-label="Steps">
        {instance.steps.map((step) => {
          const stepLines = lines.filter((line) =>
            "step" in line && line.step === step.name
          );
          const report = last_reports[step.name];
          const current = instance.current?.step === step.name;
          const kind: StepShown = current
            ? instance.current?.human_turn === true
              ? "human"
              : instance.state === "stopped"
              ? "stopped"
              : "current"
            : report === undefined
            ? "waiting"
            : "reported";
          const mark = STEP_MARK[kind];
          const notice = noticeOf(stepLines);
          return (
            <li
              key={step.name}
              className={styles.step}
              data-step={step.name}
              data-shown={kind}
            >
              <span className={styles.stepMark}>
                <Icon icon={mark.icon} pixels={iconPixels("base")} />
              </span>
              <div className={styles.stepMain}>
                <div className={styles.stepHead}>
                  <span className={styles.stepName}>{step.name}</span>
                  <span className={styles.stepWho}>
                    {assignee(instance, step)}
                  </span>
                  <span className={styles.stepStatus}>{mark.label}</span>
                </div>
                {report === undefined ? null : (
                  <>
                    <p className={styles.report}>{report.text}</p>
                    <span className={styles.reportWho}>
                      {whoOf(detail, report)} · {whenOf(report.at)}
                    </span>
                  </>
                )}
                {notice === null
                  ? null
                  : (
                    <p className={styles.notice} data-notice="">
                      <Icon icon={TriangleAlert} pixels={iconPixels("base")} />
                      <span>{notice}</span>
                    </p>
                  )}
                {stepLines.length === 0 ? null : (
                  <details open={current}>
                    <summary className={styles.lineToggle}>
                      Lines ({stepLines.length})
                    </summary>
                    <ol className={styles.lines}>
                      {stepLines.map((line) => (
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
          );
        })}
      </ol>
    </section>
  );
}
