import { useEffect, useState } from "react";
import { StatusMark } from "@lophn/design/components";
import { t } from "@lophn/wording";

import {
  STEP_ACTION_LABEL,
  STEP_STATUS_LABEL,
  STEP_TARGET_LABEL,
  STEP_TONE,
} from "../labels.ts";
import { activityProblems, stepStatus, stepTarget } from "../model.ts";
import type {
  BodyKind,
  ReviewTrace,
  RolesSource,
  StoredBody,
  ToolStep,
} from "../source.ts";
import { Disclose } from "./disclose.tsx";
import styles from "../roles.module.css";

const PROBLEM_LABEL = {
  failed: "roles.label.review-problem-failed",
  denied: "roles.label.review-problem-denied",
  "not-run": "roles.label.review-problem-not-run",
  unclear: "roles.label.review-problem-unclear",
  unfinished: "roles.label.review-problem-unfinished",
} as const;

export interface ToolActivityProps {
  source: RolesSource;
  work: string;
  trace: ReviewTrace;
  names: Readonly<Record<string, string>>;
  onApp?: (app: string) => void;
}

// 도구 활동. 단계 수로 접어도 실패·거절·미실행·불명확은 요약에 남고, 끝났다는 사실만으로 성공이라
// 말하지 않는다. 펼치면 시작 순서로 대상·한 일·상태가 보이고 도구 이름·입력·원문 결과는 단계마다
// 한 번 더 펼친 자리에 있다(observability#R21).
export function ToolActivity(
  { source, work, trace, names, onApp }: ToolActivityProps,
) {
  const problems = activityProblems(trace);
  if (trace.tools.steps === 0) {
    return (
      <p className={styles.muted} data-tools="none">
        {t("roles.review.no-steps")}
      </p>
    );
  }
  return (
    <Disclose
      name="tools"
      label={t("roles.label.review-tool-activity")}
      summary={
        <div className={styles.activity} data-tools={trace.tools.steps}>
          <span>
            {t("roles.label.review-steps-summary", {
              steps: trace.tools.steps,
              done: trace.tools.succeeded,
            })}
          </span>
          {problems.map((item) => (
            <span
              key={item.status}
              className={styles.problemChip}
              data-problem-chip={item.status}
            >
              {t(PROBLEM_LABEL[item.status], { count: item.count })}
            </span>
          ))}
        </div>
      }
    >
      <Steps source={source} work={work} names={names} onApp={onApp} />
    </Disclose>
  );
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | { readonly kind: "ready"; readonly steps: readonly ToolStep[] };

function Steps(
  { source, work, names, onApp }: {
    source: RolesSource;
    work: string;
    names: Readonly<Record<string, string>>;
    onApp?: (app: string) => void;
  },
) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    void source.steps(work).then((result) => {
      if (live) {
        setLoaded(
          result.ok
            ? { kind: "ready", steps: result.value }
            : { kind: "failed" },
        );
      }
    });
    return () => {
      live = false;
    };
  }, [source, work]);
  if (loaded.kind === "failed") {
    return <p className={styles.problem}>{t("roles.review.steps-failed")}</p>;
  }
  if (loaded.kind === "loading") return null;
  return (
    <ol className={styles.steps}>
      {loaded.steps.map((step) => (
        <li key={step.id} className={styles.step} data-step={step.id}>
          <div className={styles.stepMain}>
            <StatusMark
              tone={STEP_TONE[stepStatus(step)]}
              label={t(STEP_STATUS_LABEL[stepStatus(step)])}
            />
            <span>
              {t("roles.label.review-step-line", {
                action: t(STEP_ACTION_LABEL[step.effect]),
                target: t(STEP_TARGET_LABEL[stepTarget(step)]),
              })}
            </span>
            {step.app !== null && onApp !== undefined
              ? (
                <button
                  type="button"
                  className={styles.link}
                  data-open-app={step.app}
                  onClick={() => onApp(step.app!)}
                >
                  {names[step.app] ?? t("roles.label.target-app")}
                </button>
              )
              : null}
          </div>
          <Disclose
            name={`step-${step.id}`}
            label={t("roles.label.review-more")}
          >
            <StepMore source={source} step={step} />
          </Disclose>
        </li>
      ))}
    </ol>
  );
}

function StepMore({ source, step }: { source: RolesSource; step: ToolStep }) {
  const decision = step.decision;
  return (
    <dl className={styles.facts}>
      <dt>{t("roles.label.review-tool-name")}</dt>
      <dd data-tool-name="">{step.tool}</dd>
      {step.server === null ? null : (
        <>
          <dt>{t("roles.label.review-outside-tool")}</dt>
          <dd>
            {t("roles.label.review-outside-tool-line", {
              server: step.server,
              tool: step.originalTool ?? "",
            })}
          </dd>
        </>
      )}
      {decision === null ? null : (
        <>
          <dt>{t("roles.label.review-decision")}</dt>
          <dd data-decision={decision.kind}>
            {decision.kind === "deny"
              ? t("roles.label.review-decision-denied")
              : decision.byPerson
              ? t("roles.label.review-decision-you")
              : t("roles.label.review-decision-automatic")}
          </dd>
          <dt>{t("roles.label.review-why")}</dt>
          <dd>{decision.reason}</dd>
        </>
      )}
      <dt>{t("roles.label.review-input")}</dt>
      <dd>
        <Body source={source} kind="tool_call_input" id={step.id} />
      </dd>
      <dt>{t("roles.label.review-result")}</dt>
      <dd>
        {step.hasOutput
          ? <Body source={source} kind="tool_call_output" id={step.id} />
          : <span className={styles.muted}>{t("roles.review.no-result")}</span>}
      </dd>
    </dl>
  );
}

type BodyLoaded =
  | { readonly kind: "loading" }
  | { readonly kind: "absent" }
  | { readonly kind: "unreadable" }
  | { readonly kind: "ready"; readonly body: StoredBody };

/** 저장된 본문 하나. 지금의 redaction을 거친 값이다. 없으면 없다고 말한다. */
export function Body(
  { source, kind, id }: { source: RolesSource; kind: BodyKind; id: string },
) {
  const [loaded, setLoaded] = useState<BodyLoaded>({ kind: "loading" });
  useEffect(() => {
    let live = true;
    void source.body(kind, id).then((result) => {
      if (!live) return;
      setLoaded(
        result.ok
          ? { kind: "ready", body: result.value }
          : result.code === "not_found"
          ? { kind: "absent" }
          : { kind: "unreadable" },
      );
    });
    return () => {
      live = false;
    };
  }, [source, kind, id]);
  if (loaded.kind === "loading") return null;
  if (loaded.kind !== "ready") {
    return (
      <span className={styles.muted} data-body={loaded.kind}>
        {loaded.kind === "absent"
          ? t("roles.review.body-absent")
          : t("roles.review.body-unreadable")}
      </span>
    );
  }
  const value = loaded.body.value;
  return (
    <>
      <pre className={styles.body} data-body="ready">
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
      {loaded.body.truncated
        ? (
          <span className={styles.muted} data-body-cut="">
            {t("roles.review.body-cut")}
          </span>
        )
        : null}
    </>
  );
}
