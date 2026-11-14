// 앱 rewind panel. Activity 탭 안에서 같은 탭 본문을 갈아 끼우고 확인 창이 아니다. 고른 호출부터
// 최신까지 함께 되돌아갈 목록을 보이고, 사람이 [Rewind <앱 이름>]을 눌러야 시작한다. 진행과 결과도
// 같은 panel에서 본다. 그 앱을 쓴 모두의 변경이 함께 사라지고 다시 되돌릴 수 없다. 진행(어느 호출을 기다리는지)은
// 계획 읽기의 running이고, 도는 호출이 끝나면 app_activity 변경으로 다시 읽는다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { StatusMark } from "@lophn/ui/feedback";
import { t } from "@lophn/i18n";

import { Loadable } from "../loadable.tsx";
import { callerText, callName, callTime, outcomeText } from "../model.ts";
import { EffectPill, Mono, Note, PaneToast, Section } from "../parts.tsx";
import type { ReadHandle } from "../../../desktop/connection/core-read.ts";
import { useRewindPlan } from "../reads.ts";
import type {
  AppDetailSource,
  RewindItem,
  RewindOutcome,
  RewindPlanView,
} from "../source.ts";
import styles from "../app-detail.module.css";
import { actionIcons } from "../../../icons/mod.ts";

type RewindStage = "confirm" | "running" | "done" | "conflict";

interface RewindPanelProps {
  app: string;
  name: string;
  /** 이 호출 직전으로 돌아간다. */
  from: string;
  source: AppDetailSource;
  now: () => Date;
  onBack: () => void;
}

/** 읽기 호출은 목록에 없다. */
const changing = (items: readonly RewindItem[]) =>
  items.filter((item) => item.effect !== "read");

function counts(items: readonly RewindItem[]) {
  const count = (outcome: RewindOutcome) =>
    items.filter((item) => item.outcome === outcome).length;
  return {
    undone: count("undone"),
    stays: count("stays"),
    cannot: count("cannot"),
  };
}

export function RewindPanel({
  app,
  name,
  from,
  source,
  now,
  onBack,
}: RewindPanelProps) {
  const live = useRewindPlan(app, from);
  const [stage, setStage] = useState<RewindStage>("confirm");
  const [reason, setReason] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // 끝난 rewind는 고른 호출을 되돌려 계획을 더 읽을 수 없다. 끝날 때의 목록을 그대로 둔다.
  const [ended, setEnded] = useState<RewindPlanView | null>(null);
  const plan: ReadHandle<RewindPlanView> =
    ended === null
      ? live
      : {
          loaded: { state: "ready", value: ended, staleSince: null },
          reload: live.reload,
        };

  function start(): void {
    setFailed(false);
    setStage("running");
    const before = live.loaded.state === "ready" ? live.loaded.value : null;
    void source.rewind(app, from).then((reply) => {
      if (reply.ok || reply.code === "conflict") setEnded(before);
      if (reply.ok) {
        setReason(reply.value.reason);
        setStage(reply.value.status === "applied" ? "done" : "conflict");
      } else if (reply.code === "conflict") {
        setReason(null);
        setStage("conflict");
      } else {
        setFailed(true);
        setStage("confirm");
      }
    });
  }

  return (
    <div className={styles.tab} data-tab-body="activity" data-rewind={stage}>
      {failed ? (
        <PaneToast
          title={t("app-detail.error.rewind-failed")}
          error
          onClose={() => setFailed(false)}
        />
      ) : null}
      <Loadable
        read={plan}
        target={t("app-detail.label.rewind-target")}
        now={now}
      >
        {(view) => (
          <PanelBody
            view={view}
            name={name}
            from={from}
            now={now}
            stage={stage}
            reason={reason}
            onStart={start}
            onBack={onBack}
          />
        )}
      </Loadable>
    </div>
  );
}

function PanelBody({
  view,
  name,
  from,
  now,
  stage,
  reason,
  onStart,
  onBack,
}: {
  view: RewindPlanView;
  name: string;
  from: string;
  now: () => Date;
  stage: RewindStage;
  reason: string | null;
  onStart: () => void;
  onBack: () => void;
}) {
  const items = changing(view.items);
  // 목록은 최신부터이고 고른 호출이 마지막이다.
  const origin =
    view.items.find((item) => item.invocation === from) ?? view.items.at(-1);
  const time = origin === undefined ? "" : callTime(origin.at, now());
  const total = counts(items);
  const blockedAt =
    view.blocked === null
      ? undefined
      : view.items.find((item) => item.invocation === view.blocked?.invocation);
  return (
    <>
      <div className={styles.row}>
        <h4 className={styles.issueTitle}>
          {stage === "confirm" || stage === "running"
            ? t("app-detail.heading.rewind-before", { name, time })
            : stage === "done"
              ? t("app-detail.heading.rewound")
              : t("app-detail.heading.rewind-cancelled")}
        </h4>
        {stage === "running" ? (
          <StatusMark
            tone="warning"
            label={t("app-detail.label.in-progress")}
          />
        ) : stage === "done" ? (
          <StatusMark tone="good" label={t("app-detail.label.done")} />
        ) : stage === "conflict" ? (
          <StatusMark tone="critical" label={t("app-detail.label.cancelled")} />
        ) : null}
      </div>

      {stage === "confirm" ? (
        <Note title={t("app-detail.label.everyone-together")}>
          {t("app-detail.note.rewind-confirm", { name, time })}
        </Note>
      ) : null}

      {stage === "confirm" && view.blocked !== null ? (
        <Note title={t("app-detail.label.rewind-blocked")}>
          {t("app-detail.note.rewind-blocked", {
            time: blockedAt === undefined ? "" : callTime(blockedAt.at, now()),
          })}
        </Note>
      ) : null}

      {stage === "running" ? (
        <Progress items={view.items} name={name} now={now} />
      ) : null}

      {stage === "done" ? (
        <Note title={t("app-detail.label.rewound-title", { name, time })}>
          {t("app-detail.note.rewound", { undone: total.undone })}
        </Note>
      ) : null}

      {stage === "conflict" ? (
        <Note title={t("app-detail.label.nothing-changed")}>
          {reason === null
            ? t("app-detail.note.conflict-unknown")
            : t("app-detail.note.conflict", { reason })}
        </Note>
      ) : null}

      <Section
        title={
          stage === "done"
            ? t("app-detail.heading.what-was-rewound")
            : t("app-detail.heading.rewinds-together")
        }
      >
        <ul className={styles.list} data-rewind-list="">
          {items.map((item) => (
            <li
              key={item.invocation}
              className={`${styles.rewindRow} ${
                item.outcome === "undone" ? "" : styles.rewindRowMuted
              }`}
              data-outcome={item.outcome}
            >
              <span>{callTime(item.at, now())}</span>
              <EffectPill effect={item.effect} />
              <span className={styles.cell}>
                <Mono>{callName(item)}</Mono>
                <span className={styles.muted}>
                  {item.caller === null ? "" : callerText(item.caller)}
                </span>
              </span>
              <span
                className={
                  item.outcome === "undone" ? styles.strong : undefined
                }
              >
                {item.outcome !== "undone"
                  ? outcomeText(item.outcome)
                  : stage === "done"
                    ? t("app-detail.label.outcome-done")
                    : stage === "conflict"
                      ? t("app-detail.label.outcome-not-changed")
                      : outcomeText(item.outcome)}
              </span>
            </li>
          ))}
        </ul>
        {stage === "confirm" ? (
          <p className={styles.text}>
            {t("app-detail.note.rewind-counts", total)}
          </p>
        ) : null}
      </Section>

      <div className={styles.actions}>
        {stage === "confirm" ? (
          <>
            <Button variant="ghost" onClick={onBack}>
              {t("app-detail.button.cancel")}
            </Button>
            <Button
              variant="danger"
              icon={actionIcons.rewind}
              disabled={view.blocked !== null}
              data-rewind-confirm=""
              onClick={onStart}
            >
              {t("app-detail.button.rewind-app", { name })}
            </Button>
          </>
        ) : stage === "running" ? null : (
          <Button data-rewind-back="" onClick={onBack}>
            {t("app-detail.button.back-to-activity")}
          </Button>
        )}
      </div>
    </>
  );
}

/** 도는 동안: 새 호출 멈춤, 도는 호출 기다림(어느 호출인지), 한 번에 되돌림. */
function Progress({
  items,
  name,
  now,
}: {
  items: readonly RewindItem[];
  name: string;
  now: () => Date;
}) {
  const running = items.filter((item) => item.running);
  const draining = running.length > 0;
  return (
    <Section title={t("app-detail.heading.progress")}>
      <ol className={styles.steps} data-rewind-progress="">
        <li className={`${styles.step} ${styles.stepDone}`}>
          <span aria-hidden="true">✓</span>
          <span>{t("app-detail.label.rewind-stopped")}</span>
        </li>
        <li className={`${styles.step} ${draining ? "" : styles.stepDone}`}>
          <span aria-hidden="true">{draining ? "…" : "✓"}</span>
          <span>
            {running.length === 0
              ? t("app-detail.label.rewind-drain")
              : t("app-detail.label.rewind-drain-calls", {
                  count: running.length,
                  calls: running
                    .map(
                      (item) =>
                        `${item.tool ?? t("app-detail.label.call-start")}, ${callTime(
                          item.at,
                          now(),
                        )}`,
                    )
                    .join("; "),
                })}
          </span>
        </li>
        <li className={`${styles.step} ${draining ? styles.stepWait : ""}`}>
          <span aria-hidden="true">{draining ? "·" : "…"}</span>
          <span>{t("app-detail.label.rewind-undo")}</span>
        </li>
      </ol>
      <Note title={t("app-detail.label.calls-held")}>
        {t("app-detail.note.calls-held", { name })}
      </Note>
    </Section>
  );
}
