// Issues 탭. 상태(Open, Resolved, Ignored)와 기간으로 거른 목록, 한 문제의 상세, 확인 없이 바로 바뀌는 상태 단추.
import { useState } from "react";
import { Button, Field, Select, StatusMark } from "@lophn/design/components";
import { lophnSpaceIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";

import { type Issue, ISSUES, type IssueStatus, STATUS_LABEL } from "./data.ts";
import { Facts, Mono, Note, Pill, Section } from "./parts.tsx";
import styles from "./app-space.module.css";

const TONE = {
  open: "warning",
  resolved: "good",
  ignored: "neutral",
} as const satisfies Record<IssueStatus, string>;

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "ignored", label: "Ignored" },
];

const PERIOD_OPTIONS = [
  { value: "day", label: "Last 24 hours" },
  { value: "week", label: "Last 7 days" },
  { value: "month", label: "Last 30 days" },
  { value: "all", label: "All time" },
];

type Statuses = Readonly<Record<string, IssueStatus>>;

function recurredNow(issue: Issue, status: IssueStatus): boolean {
  return issue.recurred !== undefined && status === "open";
}

function IssueList(
  { statuses, onOpen }: { statuses: Statuses; onOpen: (id: string) => void },
) {
  const [status, setStatus] = useState("all");
  const [period, setPeriod] = useState("week");
  const rows = ISSUES.filter((issue) =>
    status === "all" || statuses[issue.id] === status
  );
  return (
    <div className={styles.tab}>
      <div className={styles.filters}>
        <div className={styles.filterField}>
          <Field label="Status">
            <Select
              size="sm"
              value={status}
              onValueChange={setStatus}
              options={STATUS_OPTIONS}
            />
          </Field>
        </div>
        <div className={styles.filterField}>
          <Field label="Period">
            <Select
              size="sm"
              value={period}
              onValueChange={setPeriod}
              options={PERIOD_OPTIONS}
            />
          </Field>
        </div>
      </div>
      <ul className={styles.list}>
        {rows.map((issue) => {
          const now = statuses[issue.id];
          return (
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
                    {issue.count} {issue.count === 1 ? "report" : "reports"}
                    {" "}
                    · last {issue.last}
                  </span>
                </span>
                <span className={styles.issueMeta}>
                  {recurredNow(issue, now)
                    ? (
                      <Pill tone="critical">
                        Recurred in {issue.recurred?.release}
                      </Pill>
                    )
                    : null}
                  <StatusMark tone={TONE[now]} label={STATUS_LABEL[now]} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {rows.length === 0
        ? <p className={styles.muted}>No problems match these filters.</p>
        : null}
    </div>
  );
}

function IssueDetail(
  { issue, status, onStatus, onBack }: {
    issue: Issue;
    status: IssueStatus;
    onStatus: (status: IssueStatus) => void;
    onBack: () => void;
  },
) {
  return (
    <div className={styles.tab} data-issue-detail={issue.id}>
      <Button
        size="sm"
        variant="ghost"
        icon={lophnSpaceIcons.back}
        onClick={onBack}
      >
        All problems
      </Button>
      <h4 className={styles.issueTitle}>{issue.impact}</h4>
      <div className={styles.row}>
        <span className={styles.issueMeta}>
          <StatusMark tone={TONE[status]} label={STATUS_LABEL[status]} />
          {recurredNow(issue, status)
            ? <Pill tone="critical">Recurred</Pill>
            : null}
        </span>
        <div className={styles.actions}>
          {status === "open"
            ? (
              <>
                <Button size="sm" onClick={() => onStatus("resolved")}>
                  Mark resolved
                </Button>
                <Button size="sm" onClick={() => onStatus("ignored")}>
                  Ignore
                </Button>
              </>
            )
            : (
              <Button size="sm" onClick={() => onStatus("open")}>
                Reopen
              </Button>
            )}
        </div>
      </div>
      {issue.recurred !== undefined && status === "open"
        ? (
          <Note title="This problem came back">
            It was resolved on {issue.recurred.resolvedAt}{" "}
            and happened again in release{" "}
            {issue.recurred.release}, so it is open again.
          </Note>
        )
        : null}
      <Facts
        rows={[
          ["Reports", String(issue.count)],
          ["First report", issue.first],
          ["Last report", issue.last],
        ]}
      />
      <Section title="Occurrences">
        <ul className={styles.list}>
          {issue.occurrences.map((item) => (
            <li key={item.time} className={styles.occurrence}>
              <span>{item.time}</span>
              <span>{item.release}</span>
              <span className={styles.muted}>{item.kind}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Evidence">
        <span className={styles.strong}>Error at its source location</span>
        <pre className={styles.code}>{issue.stack}</pre>
        <span className={styles.strong}>Log</span>
        <pre className={styles.code}>{issue.log}</pre>
        <Facts
          rows={[
            [
              "Release",
              <span key="r">
                {issue.occurrences[0]?.release} ·{" "}
                <Mono>commit {issue.commit}</Mono>
              </span>,
            ],
          ]}
        />
        <span className={styles.strong}>Reports from people</span>
        {issue.reports.map((report) => (
          <blockquote key={report.text} className={styles.quote}>
            {report.text}
            <span className={styles.muted}>— {report.by}</span>
          </blockquote>
        ))}
      </Section>
    </div>
  );
}

export function IssuesTab(
  { open: initialOpen = null }: { open?: string | null },
) {
  const [open, setOpen] = useState<string | null>(initialOpen);
  const [statuses, setStatuses] = useState<Statuses>(
    Object.fromEntries(ISSUES.map((issue) => [issue.id, issue.status])),
  );
  const issue = ISSUES.find((item) => item.id === open);
  return issue === undefined
    ? <IssueList statuses={statuses} onOpen={setOpen} />
    : (
      <IssueDetail
        issue={issue}
        status={statuses[issue.id]}
        onStatus={(status) =>
          setStatuses((now) => ({ ...now, [issue.id]: status }))}
        onBack={() => setOpen(null)}
      />
    );
}
