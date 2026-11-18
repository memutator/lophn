// 펼친 Inbox. Now(답할 것 묶음들, 그 아래 휘발 알림, 결정한 직후 남는 줄)와 History(영구 기록) 두 탭이다.
import { useState } from "react";
import { StatusMark } from "@lophn/ui/feedback";
import { Button, IconButton } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { Tab, TabList, TabPanel, Tabs } from "@lophn/ui/navigation";
import { t } from "@lophn/i18n";
import type { NoticeTarget } from "../../../../ipc/notice.ts";
import { Avatar } from "../../../parts/avatar/avatar.tsx";
import { actionIcons } from "../../../icons/mod.ts";
import {
  harnessVendorOf,
  VendorIcon,
} from "../../../parts/vendor-icon/vendor-icon.tsx";
import { MachineScope, useMachineHub } from "../../machines/scope.tsx";
import { ActivationCard } from "./cards/activation-card.tsx";
import { JobApprovalCard } from "./cards/job-approval-card.tsx";
import { JobHoldCard } from "./cards/job-hold-card.tsx";
import type { OnDecide } from "./cards/decision.tsx";
import {
  type DecideCardProps,
  PermissionCard,
} from "./cards/permission-card.tsx";
import { ShareCard } from "./cards/share-card.tsx";
import { QuestionCard } from "./cards/question-card.tsx";
import type { FinishedRow } from "./finished.ts";
import { decideWaiting, dismissNotice, type SettledState } from "./decide.ts";
import { HistoryView } from "./history-view.tsx";
import type { Inbox, InboxEntry, InboxNotice } from "./inbox.ts";
import { cardOf } from "./model.ts";
import { useInboxNamesOf } from "./names.ts";
import { NoticeRow } from "./notice-row.tsx";
import type { Settled, SettledRow } from "./settled.ts";
import styles from "./waiting.module.css";

const GROUPS = [
  {
    title: "waiting.label.group-permission",
    kinds: ["permission"],
  },
  { title: "waiting.label.group-question", kinds: ["question"] },
  { title: "waiting.label.group-activation", kinds: ["activation"] },
  { title: "waiting.label.group-share", kinds: ["share"] },
  { title: "waiting.label.group-job", kinds: ["job_approval", "job_hold"] },
] as const;

const SETTLED_MARK = {
  allowed: {
    tone: "good",
    label: "waiting.label.settled-allowed",
    note: "waiting.notice.settled-allowed",
  },
  denied: {
    tone: "warning",
    label: "waiting.label.settled-denied",
    note: "waiting.notice.settled-denied",
  },
  cancelled: {
    tone: "neutral",
    label: "waiting.label.settled-cancelled",
    note: "waiting.notice.settled-cancelled",
  },
} as const satisfies Record<
  SettledState,
  { tone: string; label: string; note: string }
>;

/** 방금 결정한 줄. 허락, 거절, cancelled를 구별한다. */
function SettledList({ rows }: { rows: readonly SettledRow[] }) {
  return (
    <section className={styles.group} aria-label={t("waiting.label.settled")}>
      <div className={styles.groupHead}>
        <span>{t("waiting.label.settled")}</span>
      </div>
      {rows.map((row) => {
        const mark = SETTLED_MARK[row.state];
        return (
          <div key={row.id} className={styles.settled}>
            <p className={styles.title}>{row.title}</p>
            <span className={styles.meta}>{row.who}</span>
            <StatusMark tone={mark.tone} label={t(mark.label)} />
            <span className={styles.settledNote}>
              {row.state === "denied" && row.agent !== undefined
                ? t("waiting.notice.settled-denied-reason", {
                    agent: row.agent,
                  })
                : t(mark.note)}
            </span>
          </div>
        );
      })}
    </section>
  );
}

/** 알림(휘발): turn이 끝난 탭과 앱·program이 한 휘발 알림. 답할 것이 아니라 지우면 끝이다. */
function NotificationList({
  finished,
  notices,
  onShow,
  onDismissFinished,
  onOpenApp,
  onDismissNotice,
}: {
  finished: readonly FinishedRow[];
  notices: readonly InboxNotice[];
  onShow: (target: NoticeTarget) => void;
  onDismissFinished: (target: NoticeTarget) => void;
  onOpenApp: (app: string, machine: string | null) => void;
  onDismissNotice: (notice: InboxNotice) => void;
}) {
  return (
    <section
      className={styles.group}
      aria-label={t("waiting.label.group-notifications")}
    >
      <div className={styles.groupHead}>
        <span>{t("waiting.label.group-notifications")}</span>
        <span>{finished.length + notices.length}</span>
      </div>
      {finished.map((row) => {
        const vendor =
          row.face.kind === "vendor"
            ? harnessVendorOf(row.face.harness)
            : undefined;
        return (
          <div
            key={row.id}
            className={`${styles.request} ${styles.finished}`}
            data-kind="finished"
            onClick={() => onShow(row.target)}
          >
            <div className={styles.who}>
              <span className={styles.face}>
                {row.face.kind === "avatar" ? (
                  <Avatar profile={row.face.profile} size="sm" />
                ) : vendor === undefined ? null : (
                  <VendorIcon vendor={vendor} />
                )}
              </span>
              <div className={styles.whoText}>
                <p className={styles.title}>{row.label}</p>
                <span className={styles.meta}>{row.title}</span>
              </div>
              {row.machineName === undefined ? null : (
                <span className={styles.machine} data-machine-tag="">
                  {row.machineName}
                </span>
              )}
              <Button size="sm" trailingIcon={actionIcons.open}>
                {t("waiting.button.show-finished")}
              </Button>
              <IconButton
                size="sm"
                icon={actionIcons.remove}
                label={t("waiting.button.dismiss-finished")}
                data-dismiss-finished=""
                onClick={(event) => {
                  // 줄을 누른 것(열기)으로 올라가지 않게 한다.
                  event.stopPropagation();
                  onDismissFinished(row.target);
                }}
              />
            </div>
          </div>
        );
      })}
      {notices.map((row) => (
        <NoticeRow
          key={row.key}
          row={row}
          machineName={row.machineName}
          onOpen={(app) => onOpenApp(app, row.machine)}
          onDismiss={() => onDismissNotice(row)}
        />
      ))}
    </section>
  );
}

export interface PanelInitial {
  /** 처음 보일 탭. 기본은 Now다. */
  readonly view?: "now" | "history";
  /** 세부를 펼친 채 시작할 요청. 나머지는 접혀 있다. */
  readonly expanded?: readonly string[];
  /** 거절 이유 칸을 연 채 시작할 요청. */
  readonly denying?: { readonly id: string; readonly reason?: string };
}

export function WaitingPanel({
  inbox,
  settled,
  finished,
  initial,
  page = false,
  onOpenTab,
  onOpenSession,
  onShowFinished,
  onDismissFinished,
  onOpenApp,
}: {
  /** 모든 기계의 대기 목록. 결정은 항목의 기계 core로 간다. */
  inbox: Inbox;
  settled: Settled;
  finished: readonly FinishedRow[];
  initial?: PanelInitial;
  /** true면 탭 본문으로 그린다(떠 있는 panel의 폭·그림자·높이 제한이 없다). */
  page?: boolean;
  /** 머리의 [Open in tab]. 탭 안에서는 주지 않는다. */
  onOpenTab?: () => void;
  /** 질문 카드의 [Open session]. 다른 기계의 session이면 그 기계(null이 이 컴퓨터)를 준다. */
  onOpenSession: (session: string, machine: string | null) => void;
  onShowFinished: (target: NoticeTarget) => void;
  onDismissFinished: (target: NoticeTarget) => void;
  /** 앱 알림 줄을 누르면 그 앱 공간을 연다. 다른 기계의 앱이면 그 기계(null이 이 컴퓨터)를 준다. */
  onOpenApp: (app: string, machine: string | null) => void;
}) {
  const { entries, notices, historyUnread } = inbox;
  const namesOf = useInboxNamesOf();
  const hub = useMachineHub();
  const history = <HistoryView onOpenApp={(app) => onOpenApp(app, null)} />;
  const [view, setView] = useState(initial?.view ?? "now");

  function decider(entry: InboxEntry): OnDecide {
    return async (choice, reason) => {
      const result = await decideWaiting(
        inbox.coreOf(entry.machine),
        entry,
        choice,
        reason,
      );
      if (!result.ok) return false;
      // 항목은 TurnRequestClosed·ActivationConsentClosed가 목록에서 뺀다.
      settled.add(entry, result.state);
      return true;
    };
  }

  function cardBody(entry: InboxEntry) {
    const view = cardOf(entry, namesOf(entry.machine));
    const core = inbox.coreOf(entry.machine);
    const props: DecideCardProps = {
      entry,
      view,
      onDecide: decider(entry),
      denying: initial?.denying?.id === entry.id,
      reason:
        initial?.denying?.id === entry.id ? initial.denying.reason : undefined,
      expanded: initial?.expanded?.includes(entry.id) ?? false,
    };
    switch (entry.kind) {
      case "permission":
        return <PermissionCard key={entry.key} {...props} />;
      case "question":
        return (
          <QuestionCard
            key={entry.key}
            entry={entry}
            view={view}
            core={core}
            onOpenSession={(session) => onOpenSession(session, entry.machine)}
          />
        );
      case "activation":
        return <ActivationCard key={entry.key} {...props} />;
      case "share":
        return (
          <ShareCard key={entry.key} entry={entry} view={view} core={core} />
        );
      case "job_hold":
        return (
          <JobHoldCard key={entry.key} entry={entry} view={view} core={core} />
        );
      case "job_approval":
        return (
          <JobApprovalCard
            key={entry.key}
            entry={entry}
            view={view}
            core={core}
          />
        );
    }
  }

  // 꺼진 기계의 항목은 마지막으로 본 채 흐리게 남고 결정 단추가 없다.
  function card(entry: InboxEntry) {
    const body = cardBody(entry);
    return entry.offline ? (
      <div key={entry.key} className={styles.offline} data-offline="">
        {body}
        <p className={styles.offlineNote}>
          {t("waiting.notice.machine-off", { name: entry.machineName ?? "" })}
        </p>
      </div>
    ) : (
      body
    );
  }

  return (
    <section
      className={styles.panel}
      data-page={page || undefined}
      aria-label={t("waiting.label.panel")}
    >
      <header className={styles.panelHead}>
        <h2 className={styles.panelTitle}>{t("waiting.label.panel")}</h2>
        <span className={styles.panelSub}>
          {t("waiting.label.panel-scope")}
        </span>
        {onOpenTab === undefined ? null : (
          <Tooltip content={t("waiting.button.open-tab")}>
            <IconButton
              size="sm"
              icon={actionIcons.openInTab}
              label={t("waiting.button.open-tab")}
              data-open-tab=""
              onClick={onOpenTab}
            />
          </Tooltip>
        )}
      </header>
      <div className={styles.panelBody}>
        <Tabs
          value={view}
          onValueChange={(next) => setView(next as "now" | "history")}
        >
          <div className={styles.tabBar}>
            <TabList>
              <Tab value="now">{t("waiting.label.tab-now")}</Tab>
              <Tab value="history">
                {historyUnread > 0
                  ? t("waiting.label.tab-history-unread", {
                      count: historyUnread,
                    })
                  : t("waiting.label.tab-history")}
              </Tab>
            </TabList>
          </div>
          <TabPanel value="now">
            {entries.length === 0 &&
            settled.rows.length === 0 &&
            finished.length === 0 &&
            notices.length === 0 ? (
              <p className={styles.empty}>{t("waiting.notice.empty")}</p>
            ) : null}
            {GROUPS.map((group) => {
              const rows = entries.filter((entry) =>
                (group.kinds as readonly string[]).includes(entry.kind),
              );
              if (rows.length === 0) {
                return null;
              }
              return (
                <section
                  key={group.title}
                  className={styles.group}
                  aria-label={t(group.title)}
                >
                  <div className={styles.groupHead}>
                    <span>{t(group.title)}</span>
                    <span>{rows.length}</span>
                  </div>
                  {rows.map(card)}
                </section>
              );
            })}
            {finished.length + notices.length > 0 ? (
              <NotificationList
                finished={finished}
                notices={notices}
                onShow={onShowFinished}
                onDismissFinished={onDismissFinished}
                onOpenApp={onOpenApp}
                onDismissNotice={(notice) =>
                  void dismissNotice(inbox.coreOf(notice.machine), notice.id)
                }
              />
            ) : null}
            {settled.rows.length > 0 ? (
              <SettledList rows={settled.rows} />
            ) : null}
          </TabPanel>
          <TabPanel value="history">
            {/* History는 이 컴퓨터의 기록이다. */}
            {hub === null ? (
              history
            ) : (
              <MachineScope machine={null}>{history}</MachineScope>
            )}
          </TabPanel>
        </Tabs>
      </div>
    </section>
  );
}
