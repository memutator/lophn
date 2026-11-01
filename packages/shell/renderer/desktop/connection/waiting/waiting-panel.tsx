// 펼친 대기 목록. 종류를 나눠 한 목록에 보이고, 결정한 직후 남는 줄이 그 아래 붙는다.
import { StatusMark } from "@lophn/ui/feedback";
import { Button, IconButton } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";
import type { NoticeTarget } from "../../../../ipc/notice.ts";
import { Avatar } from "../../../parts/avatar/avatar.tsx";
import { actionIcons } from "../../../icons/mod.ts";
import {
  harnessVendorOf,
  VendorIcon,
} from "../../../parts/vendor-icon/vendor-icon.tsx";
import { useEventClient } from "../events/hooks.tsx";
import type { WaitingEntry } from "../events/waiting-store.ts";
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
import { decideWaiting, type SettledState } from "./decide.ts";
import { cardOf } from "./model.ts";
import { useInboxNames } from "./names.ts";
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

/** turn이 끝난 탭 한 줄. 줄 어디를 눌러도 그 탭이 열린다. [x]는 열지 않고 줄만 지운다. */
function FinishedList({
  rows,
  onShow,
  onDismiss,
}: {
  rows: readonly FinishedRow[];
  onShow: (target: NoticeTarget) => void;
  onDismiss: (target: NoticeTarget) => void;
}) {
  return (
    <section
      className={styles.group}
      aria-label={t("waiting.label.group-finished")}
    >
      <div className={styles.groupHead}>
        <span>{t("waiting.label.group-finished")}</span>
        <span>{rows.length}</span>
      </div>
      {rows.map((row) => {
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
                  onDismiss(row.target);
                }}
              />
            </div>
          </div>
        );
      })}
    </section>
  );
}

export interface PanelInitial {
  /** 세부를 펼친 채 시작할 요청. 나머지는 접혀 있다. */
  readonly expanded?: readonly string[];
  /** 거절 이유 칸을 연 채 시작할 요청. */
  readonly denying?: { readonly id: string; readonly reason?: string };
}

export function WaitingPanel({
  entries,
  settled,
  finished,
  initial,
  page = false,
  onOpenTab,
  onOpenSession,
  onShowFinished,
  onDismissFinished,
}: {
  entries: readonly WaitingEntry[];
  settled: Settled;
  finished: readonly FinishedRow[];
  initial?: PanelInitial;
  /** true면 탭 본문으로 그린다(떠 있는 panel의 폭·그림자·높이 제한이 없다). */
  page?: boolean;
  /** 머리의 [Open in tab]. 탭 안에서는 주지 않는다. */
  onOpenTab?: () => void;
  onOpenSession: (session: string) => void;
  onShowFinished: (target: NoticeTarget) => void;
  onDismissFinished: (target: NoticeTarget) => void;
}) {
  const core = useEventClient().core;
  const names = useInboxNames();

  function decider(entry: WaitingEntry): OnDecide {
    return async (choice, reason) => {
      const result = await decideWaiting(core, entry, choice, reason);
      if (!result.ok) return false;
      // 항목은 TurnRequestClosed·ActivationConsentClosed가 목록에서 뺀다.
      settled.add(entry, result.state);
      return true;
    };
  }

  function card(entry: WaitingEntry) {
    const view = cardOf(entry, names);
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
        return <PermissionCard key={entry.id} {...props} />;
      case "question":
        return (
          <QuestionCard
            key={entry.id}
            entry={entry}
            view={view}
            core={core}
            onOpenSession={onOpenSession}
          />
        );
      case "activation":
        return <ActivationCard key={entry.id} {...props} />;
      case "share":
        return (
          <ShareCard key={entry.id} entry={entry} view={view} core={core} />
        );
      case "job_hold":
        return (
          <JobHoldCard key={entry.id} entry={entry} view={view} core={core} />
        );
      case "job_approval":
        return (
          <JobApprovalCard
            key={entry.id}
            entry={entry}
            view={view}
            core={core}
          />
        );
    }
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
        {entries.length === 0 &&
        settled.rows.length === 0 &&
        finished.length === 0 ? (
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
        {finished.length > 0 ? (
          <FinishedList
            rows={finished}
            onShow={onShowFinished}
            onDismiss={onDismissFinished}
          />
        ) : null}
        {settled.rows.length > 0 ? <SettledList rows={settled.rows} /> : null}
      </div>
    </section>
  );
}
