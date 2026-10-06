import type { ReactNode } from "react";
import { t } from "@lophn/wording";
import { Button } from "@lophn/design/components";

import { BeforeAfter } from "../before-after/before-after.tsx";
import { Details } from "../details/details.tsx";
import type { Display } from "../display.ts";
import styles from "./layout.module.css";

export interface LayoutProps {
  display: Display;
  /** 결정 버튼 자리. 주 행동은 오른쪽 끝 하나다. */
  actions: ReactNode;
  /** 대상·변경 칸 안에서 경로 뒤에 두는 정확한 동작·목록. */
  exact?: ReactNode;
  /** 결정 바로 앞의 입력(거절 이유, 보호 입력칸). */
  input?: ReactNode;
}

/**
 * 최대 640px, 좁으면 창 안에 맞춘다.
 * 순서: 대상·변경 → 영향·위험 → revert 가능 → 결정(confirmation-window#R2).
 * 제목은 결정 자체를 문장으로 말한다.
 */
export function ConfirmationLayout(
  { display, actions, exact, input }: LayoutProps,
) {
  return (
    <article className={styles.layout} data-layout="confirmation">
      <header className={styles.header}>
        <h1 className={styles.title} tabIndex={-1}>
          {display.title}
        </h1>
      </header>
      <section className={styles.section} data-section="subject">
        <h2 className={styles.heading}>
          {t("confirmation-window.heading.subject")}
        </h2>
        <p className={styles.body} tabIndex={0} data-focus="first">
          {display.subject}
        </p>
        {display.path !== undefined
          ? <p className={styles.path}>{display.path}</p>
          : null}
        {exact}
        {display.noChange ? null : <BeforeAfter change={display.change} />}
      </section>
      <section className={styles.section} data-section="effect">
        <h2 className={styles.heading}>
          {t("confirmation-window.heading.effect")}
        </h2>
        <p className={styles.body}>{display.effect}</p>
      </section>
      <section className={styles.section} data-section="revert">
        <h2 className={styles.heading}>
          {t("confirmation-window.heading.revert")}
        </h2>
        <p className={styles.body}>
          {display.reversible === null
            ? t("confirmation-window.revert.unknown")
            : display.reversible
            ? t("confirmation-window.revert.possible")
            : t("confirmation-window.revert.impossible")}
        </p>
        {display.revertNote !== undefined
          ? <p className={styles.body}>{display.revertNote}</p>
          : null}
      </section>
      <Details facts={display.details} />
      {input}
      <div className={styles.actions} role="group">{actions}</div>
    </article>
  );
}

export interface DecisionActionsProps {
  action: string;
  onDecide: () => void;
  onCancel: () => void;
}

// 주 행동은 오른쪽 끝 하나. 위험 결정은 danger, 닫기는 결정이 아니다.
export function DecisionActions(
  { action, onDecide, onCancel }: DecisionActionsProps,
) {
  return (
    <>
      <Button variant="ghost" data-action="cancel" onClick={onCancel}>
        {t("confirmation-window.button.cancel")}
      </Button>
      <Button variant="danger" data-decision="confirm" onClick={onDecide}>
        {action}
      </Button>
    </>
  );
}
