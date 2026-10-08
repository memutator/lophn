import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Icon,
  iconPixels,
  lophnSpaceIcons,
  StatusMark,
} from "@lophn/design/components";
import { formatDate, t } from "@lophn/wording";

import { ResultLinks } from "../../../../conversation/result-links.tsx";
import type { ResultLink } from "../../../../conversation/source.ts";
import {
  REASON_LABEL,
  roleTitle,
  STATUS_LABEL,
  STATUS_TONE,
} from "../labels.ts";
import { basisOf, nextAction, statusOf } from "../model.ts";
import type {
  BasisSummary,
  MadeLink,
  ReviewTrace,
  RoleRow,
  RolesSource,
  WorkRow,
} from "../source.ts";
import { Disclose } from "./disclose.tsx";
import { ExportSection } from "./export-section.tsx";
import { ToolActivity } from "./tool-activity.tsx";
import { UsageSection } from "./usage-section.tsx";
import styles from "../roles.module.css";

export interface ReviewPanelProps {
  source: RolesSource;
  role: RoleRow;
  work: WorkRow;
  names: Readonly<Record<string, string>>;
  onBack: () => void;
  onRead: (document: string, version: string | null) => void;
  onApp?: (app: string) => void;
  onConfirm?: () => void;
  onAskAgain?: (work: WorkRow) => void;
  onRestart: () => void;
}

type Loaded =
  | { readonly kind: "loading" }
  | { readonly kind: "failed" }
  | {
    readonly kind: "ready";
    readonly trace: ReviewTrace;
    readonly request: string | null;
    readonly results: readonly MadeLink[];
  };

const MISSING_LABEL = {
  body: "roles.review.missing-body",
  record: "roles.review.missing-record",
  source: "roles.review.missing-source",
} as const;

function linkOf(made: MadeLink): ResultLink {
  return made.version === null
    ? { kind: "document", document: made.document }
    : { kind: "version", document: made.document, version: made.version };
}

function when(at: string | null): string {
  return at === null ? "" : formatDate(new Date(at), "en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// 작업 검토. 기본은 대상·결과·필요한 다음 행동만이고 시각·역할·이유·근거·영향 링크는 상세에, 도구 활동·
// 사용량·내보내기는 그 안에서 한 번 더 펼친다(observability#R20). 판단은 요약으로만 보이고 model의 내부
// 사고는 요구하지 않는다(R22).
export function ReviewPanel(
  {
    source,
    role,
    work,
    names,
    onBack,
    onRead,
    onApp,
    onConfirm,
    onAskAgain,
    onRestart,
  }: ReviewPanelProps,
) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: "loading" });
  const [undo, setUndo] = useState<"idle" | "opened" | "failed">("idle");

  useEffect(() => {
    let live = true;
    void Promise.all([source.trace(work.id), source.workMessages(role, work)])
      .then(([trace, messages]) => {
        if (!live) return;
        setLoaded(
          trace.ok
            ? {
              kind: "ready",
              trace: trace.value,
              request: messages.ok ? messages.value.request : null,
              results: messages.ok ? messages.value.results : [],
            }
            : { kind: "failed" },
        );
      });
    return () => {
      live = false;
    };
  }, [source, role, work]);

  const titles = useMemo(
    () => ({ documentTitle: source.documentTitle }),
    [source],
  );
  const status = statusOf(work);
  const outcome = work.outcome;

  const header = (
    <div className={styles.reviewHead}>
      <Button
        size="sm"
        variant="ghost"
        data-action="back"
        icon={lophnSpaceIcons.back}
        onClick={onBack}
      >
        {t("roles.button.back-to-work")}
      </Button>
    </div>
  );
  if (loaded.kind !== "ready") {
    return (
      <div className={styles.panel} data-review={work.id}>
        {header}
        {loaded.kind === "failed"
          ? (
            <p className={styles.problem} data-review-failed="">
              {t("roles.review.failed")}
            </p>
          )
          : null}
      </div>
    );
  }
  const { trace, request, results } = loaded;
  const next = nextAction(role, work, results);
  const unconfirmed = trace.missing.some((item) =>
    item.reference === "end_not_confirmed"
  );

  const runUndo = async () => {
    const opened = await source.undo(work.id);
    setUndo(opened.ok ? "opened" : "failed");
  };

  return (
    <div className={styles.panel} data-review={work.id}>
      {header}

      <section className={styles.reviewBasic} data-review-basic="">
        <div className={styles.fact}>
          <h3 className={styles.factHead}>{t("roles.label.review-target")}</h3>
          <p className={styles.text} data-review-target="">
            {request !== null
              ? request
              : work.origin === "schedule"
              ? t("roles.label.origin-schedule")
              : work.origin === "handoff"
              ? t("roles.label.origin-handoff")
              : t("roles.review.request-unavailable")}
          </p>
        </div>
        <div className={styles.fact}>
          <h3 className={styles.factHead}>{t("roles.label.review-outcome")}</h3>
          <StatusMark
            tone={STATUS_TONE[status]}
            label={t(STATUS_LABEL[status])}
          />
          {outcome === null
            ? null
            : (
              <p className={styles.text} data-review-reason="">
                {t(REASON_LABEL[outcome.reason] ?? "roles.reason.unknown")}
              </p>
            )}
          {unconfirmed
            ? (
              <p className={styles.muted} data-review-unconfirmed="">
                {t("roles.review.end-unconfirmed")}
              </p>
            )
            : null}
          {results.length > 0
            ? (
              <ResultLinks
                links={results.map(linkOf)}
                source={titles}
                onOpen={onRead}
              />
            )
            : outcome?.kind === "completed"
            ? (
              <p className={styles.muted} data-review-no-results="">
                {t("roles.review.no-results")}
              </p>
            )
            : null}
        </div>
        {next === "none" ? null : (
          <div className={styles.fact}>
            <h3 className={styles.factHead}>{t("roles.label.review-next")}</h3>
            <div className={styles.actions}>
              {next === "restart"
                ? (
                  <Button
                    size="sm"
                    variant="primary"
                    data-action="restart"
                    onClick={onRestart}
                  >
                    {t("roles.button.restart")}
                  </Button>
                )
                : null}
              {next === "ask-again" && onAskAgain !== undefined
                ? (
                  <Button
                    size="sm"
                    variant="primary"
                    data-action="ask-again"
                    onClick={() => onAskAgain(work)}
                  >
                    {t("roles.button.ask-again")}
                  </Button>
                )
                : null}
              {next === "answer" && onConfirm !== undefined
                ? (
                  <Button
                    size="sm"
                    variant="primary"
                    data-action="answer"
                    onClick={onConfirm}
                  >
                    {t("roles.button.answer")}
                  </Button>
                )
                : null}
              {next === "undo"
                ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    data-action="undo"
                    onClick={() => void runUndo()}
                  >
                    {t("roles.button.undo")}
                  </Button>
                )
                : null}
            </div>
            {undo === "opened"
              ? (
                <p className={styles.muted} data-undo="opened">
                  {t("roles.review.undo-opened")}
                </p>
              )
              : null}
            {undo === "failed"
              ? (
                <p className={styles.problem} data-undo="failed">
                  {t("roles.review.undo-failed")}
                </p>
              )
              : null}
          </div>
        )}
      </section>

      <Disclose name="details" label={t("roles.label.review-details")}>
        <Details
          source={source}
          role={role}
          work={work}
          trace={trace}
          results={results}
          names={names}
          onApp={onApp}
        />
      </Disclose>
    </div>
  );
}

function Details(
  { source, role, work, trace, results, names, onApp }: {
    source: RolesSource;
    role: RoleRow;
    work: WorkRow;
    trace: ReviewTrace;
    results: readonly MadeLink[];
    names: Readonly<Record<string, string>>;
    onApp?: (app: string) => void;
  },
) {
  const [basis, setBasis] = useState<
    | { readonly kind: "loading" }
    | { readonly kind: "none" }
    | { readonly kind: "absent" }
    | { readonly kind: "ready"; readonly summary: BasisSummary }
  >(trace.basis === null ? { kind: "none" } : { kind: "loading" });
  const [apps, setApps] = useState<readonly string[]>([]);

  useEffect(() => {
    if (trace.basis === null) return;
    let live = true;
    void source.body("run_basis", work.id).then((result) => {
      if (!live) return;
      setBasis(
        result.ok
          ? { kind: "ready", summary: basisOf(result.value.value) }
          : { kind: "absent" },
      );
    });
    return () => {
      live = false;
    };
  }, [source, work.id, trace.basis]);

  useEffect(() => {
    let live = true;
    void source.steps(work.id).then((result) => {
      if (!live || !result.ok) return;
      setApps([
        ...new Set(result.value.flatMap((step) => step.app ?? [])),
      ]);
    });
    return () => {
      live = false;
    };
  }, [source, work.id]);

  return (
    <div className={styles.details} data-review-details="">
      <dl className={styles.facts}>
        <dt>{t("roles.label.review-started")}</dt>
        <dd data-started="">
          {trace.startedAt === null
            ? t("roles.label.not-started")
            : when(trace.startedAt)}
        </dd>
        {trace.finishedAt === null ? null : (
          <>
            <dt>{t("roles.label.review-finished")}</dt>
            <dd data-finished="">{when(trace.finishedAt)}</dd>
          </>
        )}
        <dt>{t("roles.label.review-done-by")}</dt>
        <dd data-done-by="">
          {roleTitle(role, names)}
          {trace.handoffs.length > 0
            ? ` · ${t("roles.label.review-handed-over")}`
            : ""}
        </dd>
        <dt>{t("roles.label.review-basis")}</dt>
        <dd data-basis={basis.kind}>
          {basis.kind === "ready"
            ? (
              <span>
                {[
                  basis.summary.presetRevision === null
                    ? null
                    : t("roles.label.review-basis-preset", {
                      version: basis.summary.presetRevision,
                    }),
                  basis.summary.judgmentModel === null
                    ? null
                    : t("roles.label.review-basis-decisions", {
                      model: basis.summary.judgmentModel,
                    }),
                  basis.summary.organizingModel === null
                    ? null
                    : t("roles.label.review-basis-summaries", {
                      model: basis.summary.organizingModel,
                    }),
                ].filter((item) => item !== null).join(" · ")}
              </span>
            )
            : basis.kind === "loading"
            ? null
            : (
              <span className={styles.muted}>
                {basis.kind === "none"
                  ? t("roles.review.basis-none")
                  : t("roles.review.basis-absent")}
              </span>
            )}
        </dd>
        <dt>{t("roles.label.review-affected")}</dt>
        <dd data-affected="">
          {results.length === 0 && apps.length === 0
            ? (
              <span className={styles.muted}>
                {t("roles.review.no-affected")}
              </span>
            )
            : null}
          {results.length > 0
            ? (
              <span>
                {t("roles.label.review-affected-documents", {
                  count: results.length,
                })}
              </span>
            )
            : null}
          {apps.map((app) => (
            <button
              key={app}
              type="button"
              className={styles.link}
              data-affected-app={app}
              disabled={onApp === undefined}
              onClick={() => onApp?.(app)}
            >
              <Icon
                icon={lophnSpaceIcons.openLink}
                pixels={iconPixels("base")}
              />
              {names[app] ?? t("roles.label.target-app")}
            </button>
          ))}
        </dd>
      </dl>
      <p className={styles.muted} data-judgment="">
        {t("roles.review.judgment-note")}
      </p>
      {trace.missing.length === 0
        ? null
        : (
          <div className={styles.missing} data-missing={trace.missing.length}>
            <span className={styles.itemText}>
              {t("roles.review.missing", { count: trace.missing.length })}
            </span>
            <ul>
              {trace.missing.map((item) => (
                <li
                  key={`${item.kind}-${item.reference}`}
                  className={styles.muted}
                >
                  {t(MISSING_LABEL[item.kind])}
                </li>
              ))}
            </ul>
          </div>
        )}
      <p className={styles.muted} data-readable="">
        {t("roles.review.readable", {
          steps: trace.tools.steps,
          calls: trace.models.attempts,
          messages: trace.messages.length,
        })}
      </p>
      <ToolActivity
        source={source}
        work={work.id}
        trace={trace}
        names={names}
        onApp={onApp}
      />
      <UsageSection source={source} work={work.id} />
      <ExportSection source={source} work={work.id} />
    </div>
  );
}
