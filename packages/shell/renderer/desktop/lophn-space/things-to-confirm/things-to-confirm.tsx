import { useCallback, useEffect, useRef, useState } from "react";
import {
  Field,
  Icon,
  IconButton,
  iconPixels,
  List,
  ListItem,
  Select,
  Tab,
  TabList,
  Tabs,
  Tooltip,
} from "@lophn/design/components";
import { confirmIcons, retryIcon } from "../../../icons/mod.ts";
import { formatRelativeTime, t } from "@lophn/wording";

import type { ConnectionState } from "../../connection/connection.ts";
import { intervalTicks, type RequestDeps } from "./context.tsx";
import { requestTitle, roleLabel, statusOf } from "./labels.ts";
import {
  ALL,
  type Filter,
  passes,
  pastOrder,
  type PeriodFilter,
  type RoleFilter,
  stripOrder,
  waitingCounts,
} from "./model.ts";
import { RequestCard } from "./request-card.tsx";
import type { Overview, Request, Role } from "./source.ts";
import styles from "./things-to-confirm.module.css";

export type ConfirmTab = "waiting" | "past";

export interface ThingsToConfirmProps {
  deps: RequestDeps;
  /** 처음 고른 탭. 테스트가 고른다. */
  initialTab?: ConfirmTab;
  /** 처음 고른 요청. 링크로 열 때 쓴다. 고르기만 하고 결정 창은 열지 않는다. */
  initialSelected?: string;
}

interface Loaded {
  readonly overview: Overview | null;
  readonly checkedAt: number | null;
  readonly failed: boolean;
}

const ROLES: readonly Role[] = [
  "lophn",
  "app_engineer",
  "context_engineer",
  "operator",
];

const PERIODS: readonly PeriodFilter[] = ["all", "day", "week", "month"];

function periodLabel(period: PeriodFilter): string {
  switch (period) {
    case "all":
      return t("things-to-confirm.label.period-all");
    case "day":
      return t("things-to-confirm.label.period-day");
    case "week":
      return t("things-to-confirm.label.period-week");
    case "month":
      return t("things-to-confirm.label.period-month");
  }
}

// things-to-confirm. 기다리는 것(종류별 개수와 다음 행동)과 지난 일(최신순 링크)을 나누고
// 역할·기간으로 거른다. 목록을 읽거나 고르는 것만으로는 아무것도 보내지
// 않는다. 세션 없는 요청도 여기서 열어 답한다.
export function ThingsToConfirm(
  { deps, initialTab = "waiting", initialSelected }: ThingsToConfirmProps,
) {
  const { source, drafts, ticks = intervalTicks, now = Date.now } = deps;
  const [tab, setTab] = useState<ConfirmTab>(initialTab);
  const [filter, setFilter] = useState<Filter>(ALL);
  const [selected, setSelected] = useState<string | null>(
    initialSelected ?? null,
  );
  const [loaded, setLoaded] = useState<Loaded>({
    overview: null,
    checkedAt: null,
    failed: false,
  });
  const [connection, setConnection] = useState<ConnectionState["state"]>(
    "starting",
  );
  const [, setVersion] = useState(0);

  // 읽는 중에 또 부르면(처음 열기와 연결 ready가 겹칠 때) 한꺼번에 읽지 않고 끝난 뒤 한 번
  // 더 읽는다. core reader는 한 사람의 동시 읽기를 많이 받지 않는다.
  const reading = useRef(false);
  const again = useRef(false);
  const refresh = useCallback(async () => {
    if (reading.current) {
      again.current = true;
      return;
    }
    reading.current = true;
    try {
      do {
        again.current = false;
        const read = await source.overview();
        setLoaded((state) =>
          read.ok
            ? { overview: read.value, checkedAt: now(), failed: false }
            : { ...state, failed: true }
        );
      } while (again.current);
    } finally {
      reading.current = false;
    }
  }, [source, now]);

  useEffect(() => {
    let previous: ConnectionState["state"] | null = null;
    return source.watch((state) => {
      setConnection(state.state);
      // 다시 붙으면 놓친 것을 하나씩 다시 보이지 않고 현재 기록으로 맞춘다.
      if (state.state === "ready" && previous !== "ready") void refresh();
      previous = state.state;
    });
  }, [source, refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(
    () =>
      ticks(() => {
        if (connection === "ready") void refresh();
      }),
    [ticks, refresh, connection],
  );

  const offline = connection !== "ready";
  const overview = loaded.overview;
  const requests = overview?.requests ?? [];
  const at = now();
  const shown = requests.filter((request) => passes(request, filter, at));
  const waiting = stripOrder(shown);
  const past = pastOrder(shown);
  const counts = waitingCounts(shown);
  const current = requests.find((request) => request.id === selected) ?? null;

  const nextOf = (kind: Request["kind"]) => {
    const next = waiting.find((request) => request.kind === kind);
    if (next) setSelected(next.id);
  };

  const meta = (request: Request) => {
    const when = request.closedAt ?? request.createdAt;
    const parts: string[] = [statusOf(request).label];
    if (request.session === null) {
      parts.push(t("things-to-confirm.label.not-in-conversation"));
    }
    if (when !== null) {
      parts.push(formatRelativeTime(new Date(when), new Date(at)));
    }
    return (
      <span className={styles.meta}>
        {parts.map((part) => <span key={part}>{part}</span>)}
      </span>
    );
  };

  const requestList = (list: readonly Request[], empty: string) =>
    list.length === 0
      ? (
        <p className={styles.empty} data-empty="">
          {requests.length === 0
            ? empty
            : t("things-to-confirm.empty.filtered")}
        </p>
      )
      : (
        <List>
          {list.map((request) => (
            <ListItem
              key={request.id}
              title={requestTitle(request)}
              meta={meta(request)}
              selected={request.id === selected}
              onSelect={() => setSelected(request.id)}
            />
          ))}
        </List>
      );

  const stale = (offline || loaded.failed) && overview !== null
    ? (
      <p className={styles.stale} data-stale="">
        {loaded.checkedAt === null
          ? t("things-to-confirm.notice.stale-never")
          : t("things-to-confirm.notice.stale", {
            age: formatRelativeTime(
              new Date(loaded.checkedAt),
              new Date(at),
            ),
          })}
      </p>
    )
    : null;

  const listBody = (() => {
    if (overview === null) {
      return loaded.failed
        ? (
          <div className={styles.failed} data-load-failed="">
            <p>{t("things-to-confirm.error.load-failed")}</p>
            <Tooltip content={t("common.button.retry")}>
              <IconButton
                icon={retryIcon}
                label={t("common.button.retry")}
                variant="secondary"
                size="sm"
                onClick={() => void refresh()}
              />
            </Tooltip>
          </div>
        )
        : null;
    }
    if (tab === "waiting") {
      return (
        <>
          <ul className={styles.counts} data-counts="">
            <li className={styles.count} data-count="questions">
              <Icon icon={confirmIcons.question} pixels={iconPixels("base")} />
              <span className={styles.countLabel}>
                {t("things-to-confirm.label.count-questions", {
                  count: counts.questions,
                })}
              </span>
              <Tooltip content={t("things-to-confirm.button.answer-next")}>
                <IconButton
                  icon={confirmIcons.answer}
                  label={t("things-to-confirm.button.answer-next")}
                  size="sm"
                  data-next="question"
                  disabled={counts.questions === 0}
                  onClick={() => nextOf("question")}
                />
              </Tooltip>
            </li>
            <li className={styles.count} data-count="decisions">
              <Icon icon={confirmIcons.decision} pixels={iconPixels("base")} />
              <span className={styles.countLabel}>
                {overview.approvalsRead
                  ? t("things-to-confirm.label.count-decisions", {
                    count: counts.decisions,
                  })
                  : t("things-to-confirm.error.decisions-unavailable")}
              </span>
              <Tooltip content={t("things-to-confirm.button.review-next")}>
                <IconButton
                  icon={confirmIcons.review}
                  label={t("things-to-confirm.button.review-next")}
                  size="sm"
                  data-next="approval"
                  disabled={counts.decisions === 0}
                  onClick={() => nextOf("approval")}
                />
              </Tooltip>
            </li>
          </ul>
          {/* approval을 못 읽었으면 "기다리는 것 없음"이라고 말하지 않는다. */}
          {waiting.length === 0 && !overview.approvalsRead
            ? null
            : requestList(waiting, t("things-to-confirm.empty.waiting"))}
        </>
      );
    }
    return requestList(past, t("things-to-confirm.empty.past"));
  })();

  return (
    <div className={styles.screen} data-screen-body="things-to-confirm">
      <div className={styles.listColumn} data-list-column="">
        <div className={styles.filters} data-filters="">
          <Field label={t("things-to-confirm.label.role")}>
            <Select
              size="sm"
              value={filter.role}
              onValueChange={(value) =>
                setFilter((state) => ({ ...state, role: value as RoleFilter }))}
              options={[
                {
                  value: "all",
                  label: t("things-to-confirm.label.role-all"),
                },
                ...ROLES.map((role) => ({
                  value: role,
                  label: roleLabel(role),
                })),
              ]}
            />
          </Field>
          <Field label={t("things-to-confirm.label.period")}>
            <Select
              size="sm"
              value={filter.period}
              onValueChange={(value) =>
                setFilter((state) => ({
                  ...state,
                  period: value as PeriodFilter,
                }))}
              options={PERIODS.map((period) => ({
                value: period,
                label: periodLabel(period),
              }))}
            />
          </Field>
        </div>
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as ConfirmTab)}
        >
          <TabList>
            <Tab value="waiting">
              {t("things-to-confirm.label.tab-waiting")}
            </Tab>
            <Tab value="past">{t("things-to-confirm.label.tab-past")}</Tab>
          </TabList>
        </Tabs>
        {stale}
        <div className={styles.panel} data-tab-panel={tab}>{listBody}</div>
      </div>
      <div className={styles.detailColumn} data-detail-column="">
        {current === null
          ? (
            <p className={styles.placeholder} data-detail="none">
              {t("things-to-confirm.empty.pick")}
            </p>
          )
          : (
            <div className={styles.detail} data-detail={current.id}>
              <RequestCard
                key={current.id}
                request={current}
                source={source}
                draft={drafts.get(current.id)}
                onDraft={(patch) => {
                  drafts.save(current.id, patch);
                  setVersion((value) => value + 1);
                }}
                onChanged={() => {
                  drafts.drop(current.id);
                  void refresh();
                }}
                offline={offline}
                now={now}
              />
            </div>
          )}
      </div>
    </div>
  );
}
