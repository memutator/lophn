// 펼친 대기 목록. 종류를 나눠 한 목록에 보이고, 결정한 직후 남는 줄이 그 아래 붙는다.
import { StatusMark } from "@lophn/ui/feedback";
import { t } from "@lophn/wording";
import { useEventClient } from "../events/hooks.tsx";
import type { WaitingEntry } from "../events/waiting-store.ts";
import { ActivationCard } from "./cards/activation-card.tsx";
import { CodingCard } from "./cards/coding-card.tsx";
import type { OnDecide } from "./cards/decision.tsx";
import {
  type DecideCardProps,
  PermissionCard,
} from "./cards/permission-card.tsx";
import { QuestionCard } from "./cards/question-card.tsx";
import { decideWaiting, type SettledState } from "./decide.ts";
import { cardOf } from "./model.ts";
import type { Settled, SettledRow } from "./settled.ts";
import styles from "./waiting.module.css";

const GROUPS = [
  {
    title: "waiting.label.group-permission",
    kinds: ["permission", "coding", "coding_start"],
  },
  { title: "waiting.label.group-question", kinds: ["question"] },
  { title: "waiting.label.group-activation", kinds: ["activation"] },
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
    <section
      className={styles.group}
      aria-label={t("waiting.label.settled")}
    >
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

export interface PanelInitial {
  /** 세부를 펼친 채 시작할 요청. 나머지는 접혀 있다. */
  readonly expanded?: readonly string[];
  /** 거절 이유 칸을 연 채 시작할 요청. */
  readonly denying?: { readonly id: string; readonly reason?: string };
}

export function WaitingPanel(
  { entries, settled, initial, onOpenSession, onAnswerInTerminal }: {
    entries: readonly WaitingEntry[];
    settled: Settled;
    initial?: PanelInitial;
    onOpenSession: (session: string) => void;
    onAnswerInTerminal: (session: string) => void;
  },
) {
  const core = useEventClient().core;

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
    const view = cardOf(entry);
    const props: DecideCardProps = {
      entry,
      view,
      onDecide: decider(entry),
      denying: initial?.denying?.id === entry.id,
      reason: initial?.denying?.id === entry.id
        ? initial.denying.reason
        : undefined,
      expanded: initial?.expanded?.includes(entry.id) ?? false,
    };
    switch (entry.kind) {
      case "permission":
        return <PermissionCard key={entry.id} {...props} />;
      case "coding":
      case "coding_start":
        return (
          <CodingCard
            key={entry.id}
            entry={entry}
            view={view}
            onAnswerInTerminal={onAnswerInTerminal}
          />
        );
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
    }
  }

  return (
    <section className={styles.panel} aria-label={t("waiting.label.panel")}>
      <header className={styles.panelHead}>
        <h2 className={styles.panelTitle}>{t("waiting.label.panel")}</h2>
        <span className={styles.panelSub}>
          {t("waiting.label.panel-scope")}
        </span>
      </header>
      <div className={styles.panelBody}>
        {entries.length === 0 && settled.rows.length === 0
          ? <p className={styles.empty}>{t("waiting.notice.empty")}</p>
          : null}
        {GROUPS.map((group) => {
          const rows = entries.filter((entry) =>
            (group.kinds as readonly string[]).includes(entry.kind)
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
        {settled.rows.length > 0 ? <SettledList rows={settled.rows} /> : null}
      </div>
    </section>
  );
}
