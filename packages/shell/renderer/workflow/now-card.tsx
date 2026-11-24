// run이 지금 어디에 있는지 한 장. 사람이 다음에 할 일이 있으면 그 단추가 오른쪽 끝에 온다.
// 지금 step이 있으면 그 step 안에, 없으면(끝남, 멈춤, 아직 아무도 받지 않음) step 줄 위에 선다.
import { Button, Icon } from "@lophn/ui/primitives";
import { CodeBlock } from "@lophn/ui/reading";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import { actionIcons, commonIcons, editorIcons } from "../icons/mod.ts";
import type { SessionDot } from "../parts/agent-session/activity.ts";
import type { WorkflowInstanceDetailView } from "../workspace/source.ts";
import { lineBy, textOf } from "./lines.ts";
import {
  canResume,
  canRetry,
  type FaceOf,
  type Now,
  whenOf,
  whoName,
} from "./model.ts";
import styles from "./now-card.module.css";

type Detail = WorkflowInstanceDetailView;

const NOW_TONE = {
  human: "warning",
  human_checkpoint: "warning",
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
  human_checkpoint: commonIcons.stateYourTurn,
  escalated: commonIcons.stateYourTurn,
  working: commonIcons.stateRunning,
  remote: commonIcons.stateRunning,
  program: commonIcons.stateRunning,
  blocked: editorIcons.problem,
  ended: commonIcons.stateEnded,
  stopped: commonIcons.stateStopped,
  waiting: commonIcons.stateNotReached,
} as const satisfies Record<Now["kind"], unknown>;

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
export function NowCard({
  detail,
  now,
  faceOf,
  dotOf,
  onRetry,
  onResume,
  onOpenSession,
  listed,
}: {
  detail: Detail;
  now: Now;
  faceOf: FaceOf | undefined;
  dotOf: ((session: string) => SessionDot | null) | undefined;
  onRetry: ((step?: string) => void) | null;
  onResume: ((useLatestCode: boolean) => void) | null;
  /** 열 수 있는 session이면 여는 함수, 아니면 null. */
  onOpenSession: (session: string) => (() => void) | null;
  /** 그 session이 바로 아래 session 줄에 있어 거기서 열 수 있다. 그러면 주 단추가 아닌 [Open session]은 그리지 않는다. */
  listed: (session: string) => boolean;
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
  const session =
    now.kind === "human" ||
    now.kind === "human_checkpoint" ||
    now.kind === "working" ||
    now.kind === "blocked" ||
    now.kind === "escalated"
      ? now.session
      : null;
  // 사람이 지금 할 일이 그 대화에 가는 것일 때만 [Open session]이 주 단추다.
  const openIsPrimary =
    now.kind === "human" ||
    now.kind === "human_checkpoint" ||
    now.kind === "escalated" ||
    asking;
  const open =
    session === null || (!openIsPrimary && listed(session))
      ? null
      : onOpenSession(session);
  const resumable = onResume !== null && canResume(detail, now);
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
      case "human_checkpoint":
        return t("workflow.note.human-checkpoint-waiting", { key: now.key });
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
  const blockedExit =
    now.kind === "blocked" && now.line?.kind === "program_exited"
      ? now.line
      : null;
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
                resumable
                  ? "workflow.note.blocked-resume-hint"
                  : retryable
                    ? "workflow.note.blocked-retry-hint"
                    : "workflow.note.blocked-hint",
              )}
            </p>
          ) : now.kind === "human_checkpoint" ? (
            <p className={styles.nowHint}>
              {t("workflow.note.human-checkpoint-hint")}
            </p>
          ) : null}
        </div>
        {open === null && !retryable && !resumable ? null : (
          <span className={styles.actions}>
            {resumable ? (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  icon={actionIcons.run}
                  onClick={() => onResume(false)}
                  data-resume=""
                >
                  {t("workflow.button.resume")}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  icon={actionIcons.refresh}
                  onClick={() => onResume(true)}
                  data-resume-latest=""
                >
                  {t("workflow.button.resume-latest")}
                </Button>
              </>
            ) : null}
            {retryable ? (
              <Button
                size="sm"
                variant={resumable ? "secondary" : "primary"}
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
                  !resumable && !retryable && openIsPrimary
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
      {blockedExit !== null && blockedExit.stderr_tail !== "" ? (
        <div className={styles.nowMore}>
          <CodeBlock code={blockedExit.stderr_tail} />
        </div>
      ) : null}
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
