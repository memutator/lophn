// activation 동의. 이전보다 늘어난 선언과 손실 단계만 보인다. 첫 activation이면 선언 전부가 늘어난 것이다.
import { useState } from "react";
import { StatusMark } from "@lophn/ui/feedback";
import { DiffMark } from "@lophn/ui/reading";
import { t } from "@lophn/i18n";
import type { Line } from "../model.ts";
import styles from "../waiting.module.css";
import { Decision } from "./decision.tsx";
import { Head } from "./head.tsx";
import type { DecideCardProps } from "./permission-card.tsx";

function Declared({ line }: { line: Line }) {
  return (
    <li className={styles.line}>
      <DiffMark kind="add" />
      <span className={styles.lineLabel}>{line.label}</span>
      <span className={styles.lineValue}>
        <span className={styles.code}>{line.value}</span>
      </span>
    </li>
  );
}

export function ActivationCard({
  entry,
  view,
  onDecide,
  denying,
  reason,
  expanded = false,
}: DecideCardProps) {
  const [open, setOpen] = useState(expanded);
  return (
    <article className={styles.request} data-kind="activation">
      <Head
        view={view}
        agent={entry.agent}
        toggle={{ open, onToggle: () => setOpen(!open) }}
      />
      {open ? (
        <div className={styles.detail}>
          <p className={styles.detailHead}>
            {view.first
              ? t("waiting.label.activation-first")
              : t("waiting.label.activation-new")}
          </p>
          <ul className={styles.lines}>
            {view.added.map((line) => (
              <Declared key={`${line.label}:${line.value}`} line={line} />
            ))}
          </ul>
          {view.loss.length > 0 ? (
            <>
              <p className={styles.detailHead}>
                <StatusMark
                  tone="warning"
                  label={t("waiting.label.loss-heading")}
                />
              </p>
              <ul className={styles.lines}>
                {view.loss.map((step) => (
                  <li
                    key={`${step.label}:${step.value}`}
                    className={styles.line}
                  >
                    <span />
                    <span className={styles.lineLabel}>{step.label}</span>
                    <span className={`${styles.lineValue} ${styles.code}`}>
                      {step.value}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          {view.removed.length > 0 || view.receiversUnreadable > 0 ? (
            <>
              <p className={styles.detailHead}>
                <StatusMark
                  tone="warning"
                  label={t("waiting.label.removed-heading")}
                />
              </p>
              <ul className={styles.lines}>
                {view.removed.map((line) => (
                  <li
                    key={`${line.label}:${line.value}`}
                    className={styles.line}
                  >
                    <span />
                    <span className={styles.lineLabel}>{line.label}</span>
                    <span className={styles.lineValue}>{line.value}</span>
                  </li>
                ))}
              </ul>
              {view.receiversUnreadable > 0 ? (
                <p className={styles.fine} role="status">
                  {t("waiting.notice.receivers-unreadable", {
                    count: view.receiversUnreadable,
                  })}
                </p>
              ) : null}
            </>
          ) : null}
          <p className={styles.fine}>{t("waiting.notice.activation-fine")}</p>
        </div>
      ) : null}
      <Decision
        choices={view.choices}
        requester={view.requester}
        denying={denying}
        reason={reason}
        onDecide={onDecide}
      />
    </article>
  );
}
