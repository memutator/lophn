// Task 하나의 상세(flow manage-tickets 5·6, start-coding-agent). Task 상태, coding TUI 상태, 완료 주장과 실제
// 검사는 서로 다른 줄이다. 하나가 다른 하나를 채우지 않는다. 기본 화면에는 claim·기한·연결 ID·조건 원문이 없고
// 펼친 자리에만 있다. 한 줄 사유로 취소하는 것은 사람의 결정이지만 확인 창 없이 이 화면의 입력으로 한다.
import { useState } from "react";
import {
  Button,
  type Clipboard,
  Field,
  Input,
  StatusMark,
} from "@lophn/design/components";
import { formatRelativeTime, t } from "@lophn/wording";

import { Loadable } from "../loadable.tsx";
import { useRead } from "../use-read.ts";
import styles from "../app-detail.module.css";
import {
  cancellable,
  checkResultText,
  checkTone,
  conditionText,
  nextText,
  promptText,
  requestSentence,
  stateText,
  stateTone,
  tuiText,
  tuiTone,
  validReason,
} from "./model.ts";
import { StartPanel } from "./start-panel.tsx";
import type { TaskDetail, TasksSource, TuiSession } from "./source.ts";

const POLL_MS = 4000;

export interface TaskDetailViewProps {
  app: string;
  ticket: string;
  source: TasksSource;
  now: () => Date;
  clipboard: Clipboard;
  onBack: () => void;
}

export function TaskDetailView(
  { app, ticket, source, now, clipboard, onBack }: TaskDetailViewProps,
) {
  const detail = useRead(() => source.get(ticket), [ticket, source], { now });
  // TUI 상태는 관측으로 바뀌므로 열려 있는 동안 다시 읽는다.
  const sessions = useRead(() => source.sessions(), [source], {
    pollMs: POLL_MS,
    now,
  });
  return (
    <>
      <div className={styles.actions}>
        <Button size="sm" data-task-back="" onClick={onBack}>
          {t("app-detail.button.task-back")}
        </Button>
      </div>
      <Loadable
        read={detail}
        target={t("app-detail.label.tasks-target")}
        now={now}
      >
        {(task) => (
          <TaskBody
            app={app}
            task={task}
            source={source}
            now={now}
            clipboard={clipboard}
            sessions={sessions.loaded.state === "ready"
              ? sessions.loaded.value.filter((item) => item.ticket === task.id)
              : []}
            onChanged={() => {
              detail.reload();
              sessions.reload();
            }}
          />
        )}
      </Loadable>
    </>
  );
}

function TaskBody(
  { app, task, source, now, clipboard, sessions, onChanged }: {
    app: string;
    task: TaskDetail;
    source: TasksSource;
    now: () => Date;
    clipboard: Clipboard;
    sessions: readonly TuiSession[];
    onChanged: () => void;
  },
) {
  // 가장 최근에 연 TUI가 지금 보는 것이다. 같은 Task에 여러 번 시작했을 수 있다.
  const tui = sessions.at(-1) ?? null;
  const stopped = tui !== null &&
    (tui.tui === "ended" || tui.tui === "unknown");
  return (
    <div className={styles.section} data-task-detail={task.state}>
      <div className={styles.rowHead}>
        <p className={styles.title} data-task-title="">{task.title}</p>
        <StatusMark
          tone={stateTone(task.state)}
          label={stateText(task.state)}
        />
      </div>
      <p className={styles.text} data-task-request="">{task.request}</p>
      {task.next === null
        ? null
        : (
          <p className={styles.text} data-task-next={task.next}>
            {nextText(task.next)}
          </p>
        )}

      {task.next === "needs_confirmation" && task.needs.length > 0
        ? (
          <section className={styles.section} data-section="needs">
            <h5 className={styles.heading}>
              {t("app-detail.heading.task-needs")}
            </h5>
            <ul className={styles.detailList}>
              {task.needs.map((need, index) => (
                <li key={index} className={styles.detailItem}>{need}</li>
              ))}
            </ul>
          </section>
        )
        : null}

      {task.next === "start"
        ? (
          <>
            {stopped && task.state === "ready"
              ? (
                <p className={styles.muted} data-task-start-again="">
                  {t("app-detail.note.task-start-again")}
                </p>
              )
              : null}
            <StartPanel
              app={app}
              task={task}
              source={source}
              now={now}
              onStarted={onChanged}
            />
            <OwnTerminal task={task} clipboard={clipboard} />
          </>
        )
        : null}

      {tui === null ? null : <TuiSection tui={tui} />}

      <Checks task={task} />

      {cancellable(task.state)
        ? <CancelSection task={task} source={source} onChanged={onChanged} />
        : null}

      <Folded task={task} now={now} />
    </div>
  );
}

// 자기 터미널 방식: 사람이 이 문장을 자기 coding agent에 붙여 넣는다. lophn은 그 process를 시작하거나 소유하지
// 않는다.
function OwnTerminal(
  { task, clipboard }: { task: TaskDetail; clipboard: Clipboard },
) {
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  async function copy(): Promise<void> {
    try {
      await clipboard.writeText(requestSentence(task));
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
  }
  return (
    <details className={styles.details} data-section="own-terminal">
      <summary>{t("app-detail.label.own-terminal")}</summary>
      <p className={styles.text}>{t("app-detail.note.own-terminal")}</p>
      <p className={styles.mono} data-request-sentence="">
        {requestSentence(task)}
      </p>
      <div className={styles.actions}>
        <Button
          size="sm"
          data-action="copy-request"
          onClick={() => void copy()}
        >
          {t("app-detail.button.copy-request")}
        </Button>
      </div>
      {copied === "copied"
        ? (
          <p className={styles.muted} role="status" data-copy-result="copied">
            {t("app-detail.note.request-copied")}
          </p>
        )
        : null}
      {copied === "failed"
        ? (
          <p className={styles.warning} role="alert" data-copy-result="failed">
            {t("app-detail.error.copy-failed")}
          </p>
        )
        : null}
    </details>
  );
}

// TUI 상태는 lophn이 연 터미널의 관측이고 Task 상태가 아니다. 관측이 없으면 모른다고 말한다.
function TuiSection({ tui }: { tui: TuiSession }) {
  const prompt = promptText(tui.promptDelivery);
  return (
    <section className={styles.section} data-section="tui" data-tui={tui.tui}>
      <h5 className={styles.heading}>
        {t("app-detail.heading.task-terminal")}
      </h5>
      <p className={styles.text}>
        <StatusMark tone={tuiTone(tui.tui)} label={tuiText(tui.tui)} />
      </p>
      {prompt === null
        ? null
        : (
          <p className={styles.muted} data-prompt={tui.promptDelivery}>
            {prompt}
          </p>
        )}
      <p className={styles.muted}>{t("app-detail.note.tui-separate")}</p>
    </section>
  );
}

// 완료 주장·실제 검사·남은 확인은 서로 다른 줄이다. 보고가 있다고 확인됨이 되지 않는다.
function Checks({ task }: { task: TaskDetail }) {
  if (!task.reported && task.checks.length === 0) return null;
  const kindAt = (position: number) =>
    task.conditions.find((condition) => condition.position === position)?.kind;
  const label = (position: number) => {
    const kind = kindAt(position);
    return kind === undefined
      ? t("app-detail.label.condition-number", { number: position + 1 })
      : conditionText(kind);
  };
  return (
    <section className={styles.section} data-section="checks">
      <h5 className={styles.heading}>{t("app-detail.heading.task-checks")}</h5>
      <dl className={styles.facts}>
        <dt>{t("app-detail.label.task-claim")}</dt>
        <dd data-check="claim" data-reported={task.reported}>
          {task.reported
            ? t("app-detail.note.task-reported")
            : t("app-detail.note.task-not-reported")}
        </dd>
        <dt>{t("app-detail.label.task-checked")}</dt>
        <dd data-check="results">
          {task.checks.length === 0
            ? t("app-detail.note.task-not-checked")
            : (
              <ul className={styles.detailList}>
                {task.checks.map((check) => (
                  <li
                    key={check.condition}
                    className={styles.detailItem}
                    data-check-result={check.result}
                  >
                    <StatusMark
                      tone={checkTone(check.result)}
                      label={t("app-detail.label.check-line", {
                        condition: label(check.condition),
                        result: checkResultText(check.result),
                      })}
                    />
                  </li>
                ))}
              </ul>
            )}
        </dd>
        {task.reported
          ? (
            <>
              <dt>{t("app-detail.label.task-remaining")}</dt>
              <dd data-check="remaining">
                {task.remaining.length === 0
                  ? t("app-detail.note.task-nothing-remaining")
                  : task.remaining.map(label).join(", ")}
              </dd>
            </>
          )
          : null}
      </dl>
    </section>
  );
}

// 한 줄 사유로 취소한다. 이미 남은 결과와 문제는 그대로이고 외부 프로세스·파일 편집을 멈춘다는 말은 없다.
function CancelSection(
  { task, source, onChanged }: {
    task: TaskDetail;
    source: TasksSource;
    onChanged: () => void;
  },
) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "changed" | "failed">(
    "idle",
  );

  async function cancel(): Promise<void> {
    if (!validReason(reason)) return;
    setState("busy");
    const result = await source.cancel(task.id, task.revision, reason.trim());
    if (result.ok) {
      setAsking(false);
      setReason("");
      setState("idle");
      onChanged();
    } else setState(result.code === "conflict" ? "changed" : "failed");
  }

  return (
    <section className={styles.section} data-section="cancel">
      {asking
        ? (
          <form
            className={styles.section}
            data-cancel-form=""
            onSubmit={(event) => {
              event.preventDefault();
              void cancel();
            }}
          >
            <Field
              label={t("app-detail.label.cancel-reason")}
              help={t("app-detail.note.cancel-reason")}
            >
              <Input
                value={reason}
                autoComplete="off"
                data-cancel-reason=""
                onChange={(event) => setReason(event.currentTarget.value)}
              />
            </Field>
            <div className={styles.actions}>
              <Button
                size="sm"
                type="submit"
                variant="danger"
                data-action="cancel-task"
                disabled={state === "busy" || !validReason(reason)}
              >
                {t("app-detail.button.cancel-task")}
              </Button>
              <Button
                size="sm"
                type="button"
                variant="ghost"
                data-action="keep-task"
                onClick={() => {
                  setAsking(false);
                  setState("idle");
                }}
              >
                {t("app-detail.button.keep-task")}
              </Button>
            </div>
          </form>
        )
        : (
          <div className={styles.actions}>
            <Button
              size="sm"
              variant="secondary"
              data-action="ask-cancel"
              onClick={() => setAsking(true)}
            >
              {t("app-detail.button.cancel-task")}
            </Button>
          </div>
        )}
      {state === "changed"
        ? (
          <p
            className={styles.warning}
            role="alert"
            data-cancel-result="changed"
          >
            {t("app-detail.error.cancel-changed")}
          </p>
        )
        : null}
      {state === "failed"
        ? (
          <p
            className={styles.warning}
            role="alert"
            data-cancel-result="failed"
          >
            {t("app-detail.error.cancel-failed")}
          </p>
        )
        : null}
    </section>
  );
}

// 기한·조건 목록은 기본 화면이 아니라 펼친 자리에만 있다.
function Folded({ task, now }: { task: TaskDetail; now: () => Date }) {
  if (task.heldUntil === null && task.conditions.length === 0) return null;
  return (
    <details className={styles.details} data-task-details="">
      <summary>{t("app-detail.label.task-details")}</summary>
      <dl className={styles.facts}>
        {task.heldUntil === null ? null : (
          <>
            <dt>{t("app-detail.label.task-held-until")}</dt>
            <dd>{formatRelativeTime(new Date(task.heldUntil), now())}</dd>
          </>
        )}
        {task.conditions.length === 0 ? null : (
          <>
            <dt>{t("app-detail.label.task-conditions")}</dt>
            <dd>
              <ul className={styles.detailList}>
                {task.conditions.map((condition) => (
                  <li key={condition.position} className={styles.detailItem}>
                    {conditionText(condition.kind)}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
    </details>
  );
}
