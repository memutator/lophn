// Issues 탭. 상태(열림, 해결됨, 무시)와 기간으로 거른 목록, 한 문제의 상세, 확인 없이 바로 바뀌는 상태
// 단추. 목록의 한 줄은 영향 한 문장과 상태다. 재발한 문제는 해결됨이던 것이 다시 열렸다는 것을 이전
// 해결 시각과 다시 난 release와 함께 보인다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Field, Select } from "@lophn/ui/input";
import { StatusMark } from "@lophn/ui/feedback";
import { t } from "@lophn/wording";

import { commonIcons } from "../../../icons/mod.ts";
import { Loadable } from "../loadable.tsx";
import { dateTime, releaseName } from "../model.ts";
import { Facts, Mono, Note, PaneToast, Pill, Section } from "../parts.tsx";
import { useRead } from "../use-read.ts";
import styles from "../app-detail.module.css";
import {
  occurrenceKindText,
  PERIODS,
  periodSince,
  periodText,
  STATUS_FILTERS,
  statusText,
  statusTone,
} from "./model.ts";
import type {
  IssueRow,
  IssuesSource,
  IssueStatus,
  IssueView,
} from "./source.ts";
import type { Period } from "./model.ts";

interface IssuesTabProps {
  app: string;
  source: IssuesSource;
  now: () => Date;
  /** 열 때 고를 문제(report-problem dialog의 [View issue]). */
  initialProblem?: string | null;
}

export function IssuesTab(
  { app, source, now, initialProblem = null }: IssuesTabProps,
) {
  const [selected, setSelected] = useState<string | null>(initialProblem);
  return (
    <div className={styles.tab} data-tab-body="issues">
      {selected === null
        ? <IssueList app={app} source={source} now={now} onOpen={setSelected} />
        : (
          <IssueDetail
            problem={selected}
            source={source}
            now={now}
            onBack={() => setSelected(null)}
          />
        )}
    </div>
  );
}

function IssueList(
  { app, source, now, onOpen }: {
    app: string;
    source: IssuesSource;
    now: () => Date;
    onOpen: (id: string) => void;
  },
) {
  const [status, setStatus] = useState<IssueStatus | "all">("all");
  const [period, setPeriod] = useState<Period>("week");
  const read = useRead(
    () =>
      source.list(app, {
        status: status === "all" ? null : status,
        since: periodSince(period, now()),
      }),
    [app, source, status, period],
    { now },
  );
  return (
    <>
      <div className={styles.filters}>
        <div className={styles.filterField}>
          <Field label={t("app-detail.label.filter-status")}>
            <Select
              size="sm"
              value={status}
              onValueChange={(value) => setStatus(value as IssueStatus | "all")}
              options={STATUS_FILTERS.map((value) => ({
                value,
                label: value === "all"
                  ? t("app-detail.label.all-statuses")
                  : statusText(value),
              }))}
            />
          </Field>
        </div>
        <div className={styles.filterField}>
          <Field label={t("app-detail.label.filter-period")}>
            <Select
              size="sm"
              value={period}
              onValueChange={(value) => setPeriod(value as Period)}
              options={PERIODS.map((value) => ({
                value,
                label: periodText(value),
              }))}
            />
          </Field>
        </div>
      </div>
      <Loadable
        read={read}
        target={t("app-detail.label.issues-target")}
        now={now}
      >
        {(rows) => <Rows rows={rows} onOpen={onOpen} />}
      </Loadable>
    </>
  );
}

function Rows(
  { rows, onOpen }: {
    rows: readonly IssueRow[];
    onOpen: (id: string) => void;
  },
) {
  if (rows.length === 0) {
    return (
      <p className={styles.state} data-issues-empty="">
        {t("app-detail.note.no-issues")}
      </p>
    );
  }
  return (
    <ul className={styles.list} data-issues="">
      {rows.map((issue) => (
        <li key={issue.id}>
          <button
            type="button"
            className={styles.issueRow}
            data-issue={issue.id}
            onClick={() => onOpen(issue.id)}
          >
            <span className={styles.rowText}>
              <span className={styles.rowTitle}>{issue.impact}</span>
              <span className={styles.muted}>
                {t("app-detail.label.issue-reports", { count: issue.count })}
                {" · "}
                {t("app-detail.label.issue-last", {
                  when: dateTime(issue.lastAt),
                })}
              </span>
            </span>
            <span className={styles.issueMeta}>
              {issue.status === "open" && issue.recurredRelease !== null
                ? (
                  <Pill tone="critical">
                    {t("app-detail.label.recurred-in", {
                      release: releaseName(issue.recurredRelease),
                    })}
                  </Pill>
                )
                : null}
              <StatusMark
                tone={statusTone(issue.status)}
                label={statusText(issue.status)}
              />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function IssueDetail(
  { problem, source, now, onBack }: {
    problem: string;
    source: IssuesSource;
    now: () => Date;
    onBack: () => void;
  },
) {
  const read = useRead(() => source.get(problem), [problem, source], { now });
  const [failed, setFailed] = useState(false);

  async function change(state: IssueStatus): Promise<void> {
    setFailed(false);
    const reply = await source.setState(problem, state);
    if (reply.ok) read.reload();
    else setFailed(true);
  }

  return (
    <>
      {failed
        ? (
          <PaneToast
            title={t("app-detail.error.issue-state-failed")}
            error
            onClose={() => setFailed(false)}
          />
        )
        : null}
      <Button
        size="sm"
        variant="ghost"
        icon={commonIcons.back}
        data-issue-back=""
        onClick={onBack}
      >
        {t("app-detail.button.all-issues")}
      </Button>
      <Loadable
        read={read}
        target={t("app-detail.label.issues-target")}
        now={now}
      >
        {(issue) => <Body issue={issue} onChange={(s) => void change(s)} />}
      </Loadable>
    </>
  );
}

function Body(
  { issue, onChange }: {
    issue: IssueView;
    onChange: (state: IssueStatus) => void;
  },
) {
  const recurred = issue.status === "open" && issue.recurred !== null;
  return (
    <div className={styles.stack} data-issue-detail={issue.id}>
      <h4 className={styles.issueTitle}>{issue.impact}</h4>
      <div className={styles.row}>
        <span className={styles.issueMeta}>
          <StatusMark
            tone={statusTone(issue.status)}
            label={statusText(issue.status)}
          />
          {recurred
            ? <Pill tone="critical">{t("app-detail.label.recurred")}</Pill>
            : null}
        </span>
        <div className={styles.actions}>
          {issue.status === "open"
            ? (
              <>
                <Button
                  size="sm"
                  data-issue-state="resolved"
                  onClick={() => onChange("resolved")}
                >
                  {t("app-detail.button.issue-resolved")}
                </Button>
                <Button
                  size="sm"
                  data-issue-state="ignored"
                  onClick={() => onChange("ignored")}
                >
                  {t("app-detail.button.issue-ignored")}
                </Button>
              </>
            )
            : (
              <Button
                size="sm"
                data-issue-state="open"
                onClick={() => onChange("open")}
              >
                {t("app-detail.button.issue-reopen")}
              </Button>
            )}
        </div>
      </div>
      {recurred && issue.recurred !== null
        ? (
          <Note title={t("app-detail.label.came-back")}>
            {t("app-detail.note.came-back", {
              resolved: dateTime(issue.recurred.resolvedAt),
              release: releaseName(issue.recurred.releaseNumber),
            })}
          </Note>
        )
        : null}
      <Facts
        rows={[
          [t("app-detail.label.fact-reports"), String(issue.count)],
          [t("app-detail.label.fact-first"), dateTime(issue.firstAt)],
          [t("app-detail.label.fact-last"), dateTime(issue.lastAt)],
        ]}
      />
      <Section title={t("app-detail.heading.occurrences")}>
        <ul className={styles.list} data-occurrences="">
          {issue.occurrences.map((item) => (
            <li key={item.report} className={styles.occurrence}>
              <span>{dateTime(item.at)}</span>
              <span>
                {item.releaseNumber === null
                  ? ""
                  : releaseName(item.releaseNumber)}
              </span>
              <span className={styles.muted}>
                {occurrenceKindText(item.kind)}
              </span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title={t("app-detail.heading.evidence")}>
        <span className={styles.strong}>
          {t("app-detail.label.evidence-error")}
        </span>
        <pre className={styles.code}>
          {issue.evidence.stack ?? t("app-detail.note.no-stack")}
        </pre>
        <span className={styles.strong}>
          {t("app-detail.label.evidence-log")}
        </span>
        <pre className={styles.code}>
          {issue.evidence.log ?? t("app-detail.note.no-log")}
        </pre>
        {issue.evidence.release === null ? null : (
          <Facts
            rows={[[
              t("app-detail.label.fact-release"),
              <span key="release">
                {releaseName(issue.evidence.release.number)} ·{" "}
                <Mono>
                  {t("app-detail.label.commit", {
                    commit: issue.evidence.release.commit,
                  })}
                </Mono>
              </span>,
            ]]}
          />
        )}
        <span className={styles.strong}>
          {t("app-detail.label.evidence-reports")}
        </span>
        {issue.evidence.reports.length === 0
          ? <p className={styles.muted}>{t("app-detail.note.no-reports")}</p>
          : issue.evidence.reports.map((text, index) => (
            <blockquote key={index} className={styles.quote}>{text}</blockquote>
          ))}
      </Section>
    </div>
  );
}
