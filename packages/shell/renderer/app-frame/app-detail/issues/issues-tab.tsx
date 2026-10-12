// Issues 탭(flow app-broken 3·9, verify-app-repair 1·4·6·7). 목록은 사람이 겪는 영향 한 문장과
// 진행이고, 상세는 영향·접수 수·지금 누가 무엇을 하는지·"고쳤다는 주장 / 실제 테스트 / 내가 확인함 /
// 미확인" 네 줄을 서로 다른 줄로 보인다. 닫힌 이유와 지금 필요한 주의가 먼저이고 확인 범위·근거는
// "Details we collected" 아래 접는다. 결정(고쳐짐·아직 안 고쳐짐·안 보임·더 다루지 않음)은 확인 창의
// owner decision이고 이 화면은 창을 열 뿐 결정을 받지 않는다. 문구는 problems가 정한 값 그대로다.
import { useState } from "react";
import { Button, Field, Input, StatusMark } from "@lophn/design/components";
import { formatRelativeTime, t } from "@lophn/wording";

import { Loadable } from "../loadable.tsx";
import { useRead } from "../use-read.ts";
import styles from "../app-detail.module.css";
import {
  choiceOptions,
  choiceText,
  isOneLine,
  statusText,
  statusTone,
  testTone,
} from "./model.ts";
import type {
  IssueChoice,
  IssueRow,
  IssuesSource,
  IssueView,
} from "./source.ts";

export interface IssuesTabProps {
  app: string;
  source: IssuesSource;
  now: () => Date;
  /** 열 때 고를 문제(report-problem dialog의 [View issue]). */
  initialProblem?: string | null;
}

const POLL_MS = 4000;

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
            app={app}
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
    onOpen: (problem: string) => void;
  },
) {
  const issues = useRead(() => source.list(app), [app, source], { now });
  return (
    <Loadable
      read={issues}
      target={t("app-detail.label.issues-target")}
      now={now}
    >
      {(rows) =>
        rows.length === 0
          ? (
            <p className={styles.state} data-issues-empty="">
              {t("app-detail.note.issues-empty")}
            </p>
          )
          : (
            <ul className={styles.list} data-issues-list="">
              {rows.map((row) => (
                <IssueItem key={row.id} row={row} onOpen={onOpen} />
              ))}
            </ul>
          )}
    </Loadable>
  );
}

function IssueItem(
  { row, onOpen }: { row: IssueRow; onOpen: (problem: string) => void },
) {
  return (
    <li className={styles.row} data-issue={row.status}>
      <div className={styles.rowHead}>
        <button
          type="button"
          className={`${styles.title} ${styles.link}`}
          data-issue-open=""
          onClick={() => onOpen(row.id)}
        >
          {row.impact}
        </button>
        <StatusMark
          tone={statusTone(row.status)}
          label={statusText(row.status)}
        />
      </div>
      {row.nextAction === null
        ? null
        : <p className={styles.text}>{row.nextAction}</p>}
    </li>
  );
}

function IssueDetail(
  { app, problem, source, now, onBack }: {
    app: string;
    problem: string;
    source: IssuesSource;
    now: () => Date;
    onBack: () => void;
  },
) {
  const [asked, setAsked] = useState(false);
  const issue = useRead(() => source.get(problem), [problem, source], {
    // 결정 창을 연 동안은 답이 반영됐는지 다시 읽는다.
    pollMs: asked ? POLL_MS : undefined,
    now,
  });
  return (
    <>
      <div className={styles.actions}>
        <Button size="sm" data-issue-back="" onClick={onBack}>
          {t("app-detail.button.issue-back")}
        </Button>
      </div>
      <Loadable
        read={issue}
        target={t("app-detail.label.issues-target")}
        now={now}
      >
        {(view) => (
          <IssueBody
            app={app}
            view={view}
            source={source}
            now={now}
            asked={asked}
            onAsked={setAsked}
          />
        )}
      </Loadable>
    </>
  );
}

function age(at: string | null, now: () => Date): string {
  return at === null
    ? t("app-detail.label.time-unknown")
    : formatRelativeTime(new Date(at), now());
}

function IssueBody(
  { app, view, source, now, asked, onAsked }: {
    app: string;
    view: IssueView;
    source: IssuesSource;
    now: () => Date;
    asked: boolean;
    onAsked: (asked: boolean) => void;
  },
) {
  const [failed, setFailed] = useState<"decision" | "tried" | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const [note, setNote] = useState("");
  const options = choiceOptions(view);

  async function choose(choice: IssueChoice): Promise<void> {
    if (choice === "dismiss" && !dismissing) {
      setDismissing(true);
      return;
    }
    setFailed(null);
    // 확인 창이 거절·닫힘 등으로 확정 없이 끝나면 기다림을 푼다.
    const reply = await source.decide({
      problem: view.id,
      choice,
      note: choice === "dismiss" ? note.trim() : null,
    }, () => onAsked(false));
    if (reply.ok) onAsked(true);
    else setFailed("decision");
  }

  async function tried(): Promise<void> {
    setFailed(null);
    const reply = await source.reportAgain(app, view.id);
    if (!reply.ok) setFailed("tried");
  }

  return (
    <div className={styles.section} data-issue-detail={view.status}>
      <div className={styles.rowHead}>
        <p className={styles.title} data-issue-impact="">{view.impact}</p>
        <StatusMark
          tone={statusTone(view.status)}
          label={statusText(view.status)}
        />
      </div>
      <p className={styles.text} data-issue-seen="">
        {t("app-detail.label.issue-seen", { count: view.seen })}
        {" · "}
        {t("app-detail.label.issue-first-seen", {
          age: age(view.firstSeenAt, now),
        })}
        {" · "}
        {t("app-detail.label.issue-last-seen", {
          age: age(view.lastSeenAt, now),
        })}
      </p>

      {view.closed !== null ? null : (
        <>
          <dl className={styles.facts} data-issue-now="">
            <dt>{t("app-detail.label.issue-owner")}</dt>
            <dd>{view.owner}</dd>
            <dt>{t("app-detail.label.issue-repair")}</dt>
            <dd>
              {view.progress}
              {" · "}
              {view.repair.label}
            </dd>
            {view.neededAction === null ? null : (
              <>
                <dt>{t("app-detail.label.issue-needed")}</dt>
                <dd data-issue-needed="">{view.neededAction}</dd>
              </>
            )}
            {view.repair.needs.length === 0 ? null : (
              <>
                <dt>{t("app-detail.label.issue-needs")}</dt>
                <dd>{view.repair.needs.join(" ")}</dd>
              </>
            )}
          </dl>
          {view.repair.lastCheckFailed
            ? (
              <p className={styles.warning} data-issue-check-failed="">
                {t("app-detail.note.issue-check-failed")}
              </p>
            )
            : null}
        </>
      )}

      {view.closed === null ? null : (
        <section
          className={styles.section}
          data-issue-closed={view.closed.reason}
        >
          <h5 className={styles.heading}>
            {t("app-detail.label.issue-closed")}
          </h5>
          <p className={styles.text}>{view.closed.label}</p>
          <p className={styles.text} data-issue-attention="">
            {view.closed.attention}
          </p>
        </section>
      )}

      <Checks view={view} now={now} />

      {view.closed === null
        ? null
        : <Collected closed={view.closed} now={now} />}

      <section className={styles.section} data-section="decide">
        <h5 className={styles.heading}>
          {t("app-detail.heading.issue-decide")}
        </h5>
        <div className={styles.actions}>
          {options.map((option) => (
            <Button
              key={option.choice}
              size="sm"
              data-issue-choice={option.choice}
              disabled={!option.enabled ||
                (option.choice === "dismiss" && dismissing &&
                  !isOneLine(note))}
              onClick={() => void choose(option.choice)}
            >
              {choiceText(option.choice)}
            </Button>
          ))}
        </div>
        {dismissing && view.closed === null
          ? (
            <Field label={t("app-detail.label.issue-dismiss-reason")}>
              <Input
                value={note}
                data-issue-reason=""
                onChange={(event) => setNote(event.currentTarget.value)}
              />
            </Field>
          )
          : null}
        {options.some((option) => option.blocked !== null)
          ? (
            <p className={styles.muted} data-issue-blocked="">
              {t("app-detail.note.issue-choice-blocked")}
            </p>
          )
          : null}
        {asked
          ? (
            <p className={styles.muted} data-issue-waiting="">
              {t("app-detail.note.decision-waiting")}
            </p>
          )
          : null}
        <div className={styles.actions}>
          <Button
            size="sm"
            data-issue-tried=""
            onClick={() => void tried()}
          >
            {t("app-detail.button.issue-tried")}
          </Button>
        </div>
        <p className={styles.muted}>{t("app-detail.note.issue-tried")}</p>
        {failed === null ? null : (
          <p
            className={styles.warning}
            role="alert"
            data-issue-failed={failed}
          >
            {failed === "decision"
              ? t("app-detail.error.decision-failed")
              : t("app-detail.error.issue-tried-failed")}
          </p>
        )}
      </section>
    </div>
  );
}

function endedMark(at: string | null, now: () => Date) {
  if (at === null) return null;
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return (
    <time dateTime={at} data-ended-at="">
      {formatRelativeTime(date, now())}
    </time>
  );
}

// 고쳤다는 주장, 실제 테스트, 사람의 확인은 서로 다른 줄이다. 하나가 다른 하나를 채우지 않는다.
function Checks({ view, now }: { view: IssueView; now: () => Date }) {
  const human = view.closed?.reason === "user_confirmed";
  const recorded = view.result.recorded ?? [];
  return (
    <section className={styles.section} data-section="checks">
      <h5 className={styles.heading}>{t("app-detail.heading.issue-checks")}</h5>
      <dl className={styles.facts}>
        <dt>{t("app-detail.label.issue-claim")}</dt>
        <dd data-check="claim" data-claimed={view.result.claimed}>
          {view.result.claimLabel}
        </dd>
        <dt>{t("app-detail.label.issue-tests")}</dt>
        <dd data-check="tests" data-test-state={view.result.tests.state}>
          <StatusMark
            tone={testTone(view.result.tests.state)}
            label={view.result.tests.label}
          />
          {view.result.tests.items.length === 0
            ? null
            : (
              <ul className={styles.detailList}>
                {view.result.tests.items.map((item, index) => (
                  <li
                    key={index}
                    className={styles.detailItem}
                    data-test-item={item.state}
                  >
                    <StatusMark
                      tone={testTone(item.state)}
                      label={item.label}
                    />
                    {endedMark(item.endedAt, now)}
                  </li>
                ))}
              </ul>
            )}
          {recorded.length === 0
            ? null
            : (
              <ul className={styles.detailList} data-recorded="">
                {recorded.map((item, index) => (
                  <li
                    key={index}
                    className={styles.detailItem}
                    data-recorded-item={item.state}
                    data-recorded-kind={item.kind}
                  >
                    <StatusMark
                      tone={testTone(item.state)}
                      label={item.label}
                    />
                    {endedMark(item.endedAt, now)}
                  </li>
                ))}
              </ul>
            )}
        </dd>
        {view.result.remaining
          ? (
            <>
              <dt>{t("app-detail.label.issue-remaining")}</dt>
              <dd data-check="remaining">{view.result.remaining}</dd>
            </>
          )
          : null}
        <dt>{t("app-detail.label.issue-human")}</dt>
        <dd data-check="human" data-checked={human}>
          {human
            ? t("app-detail.note.issue-human-yes")
            : t("app-detail.note.issue-human-no")}
        </dd>
        {view.closed === null ? null : (
          <>
            <dt>{t("app-detail.label.issue-unconfirmed")}</dt>
            <dd data-check="unconfirmed">
              {view.closed.unconfirmed.join(" ")}
            </dd>
          </>
        )}
      </dl>
      <p className={styles.muted}>{t("app-detail.note.issue-checks-scope")}</p>
    </section>
  );
}

// 확인 범위·Version·근거(미확인 부분은 위 확인 줄에 있다). 모은 자료는 이름 그대로 부르지 않고 접어 둔다.
function Collected(
  { closed, now }: {
    closed: NonNullable<IssueView["closed"]>;
    now: () => Date;
  },
) {
  return (
    <details className={styles.details} data-issue-details="">
      <summary>{t("app-detail.label.issue-collected")}</summary>
      <dl className={styles.facts}>
        <dt>{t("app-detail.label.issue-scope")}</dt>
        <dd>{closed.scope}</dd>
        {closed.version === null ? null : (
          <>
            <dt>{t("app-detail.label.issue-version")}</dt>
            <dd>{closed.version}</dd>
          </>
        )}
        <dt>{t("app-detail.label.issue-basis")}</dt>
        <dd>
          <ul className={styles.detailList}>
            {closed.evidence.map((item, index) => (
              <li key={index} className={styles.detailItem}>
                {item.text}
                {item.at === null
                  ? null
                  : ` · ${formatRelativeTime(new Date(item.at), now())}`}
              </li>
            ))}
          </ul>
        </dd>
      </dl>
    </details>
  );
}
