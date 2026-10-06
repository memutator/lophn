import { t } from "@lophn/wording";

import type { Display } from "../../display.ts";
import { ApprovalDecision } from "../approval/approval.tsx";
import {
  appLabel,
  type ExactRow,
  ExactRows,
  facts,
  FoldedExact,
  type KindProps,
  obj,
  str,
} from "../exact.tsx";
import styles from "../kinds.module.css";
import { effectText } from "../release-activation/release-activation.tsx";

const MINUTE_MS = 60_000;

/** 주기 문장. 분으로 나누어떨어지면 분, 아니면 초로 보인다(주기 하한은 60000ms다). */
function subject(
  when: Record<string, unknown>,
  app: string,
  command: string,
): string {
  if (when.kind !== "interval") {
    return t("confirmation-window.automation.subject-start", { app, command });
  }
  const ms = Number(when.interval_ms);
  return ms % MINUTE_MS === 0
    ? t("confirmation-window.automation.subject-minutes", {
      app,
      command,
      minutes: ms / MINUTE_MS,
    })
    : t("confirmation-window.automation.subject-seconds", {
      app,
      command,
      seconds: ms / 1000,
    });
}

/**
 * automation 켜기. command·고정 입력(지문)·주기를 한 번 승인하면 그 범위에서만 앱이 스스로 부른다.
 * 값은 apps가 지금 고정 blueprint의 선언에서 읽은 것이고, 승인 범위와 어긋나면 apps 읽기가 거절한다.
 * 끄기는 사람의 grant.revoke이고 확인 창이 없다.
 */
export function AutomationKind(props: KindProps) {
  const shown = obj(props.view.view);
  const automation = obj(shown.automation);
  const command = obj(shown.app_command);
  const app = appLabel(shown.app);
  const name = str(command.label) ?? str(command.key) ?? "";
  const rows: ExactRow[] = [
    {
      key: "automation",
      label: t("confirmation-window.label.automation"),
      value: str(automation.key) ?? "",
    },
    {
      key: "command",
      label: t("confirmation-window.label.command"),
      value: str(command.key) ?? "",
    },
    {
      key: "schedule",
      label: t("confirmation-window.label.schedule"),
      value: JSON.stringify(automation.when),
    },
    {
      key: "input",
      label: t("confirmation-window.label.input-fingerprint"),
      value: str(automation.input_hash) ?? "",
      note: t("confirmation-window.confirm.input-note"),
    },
  ];
  const display: Display = {
    title: t("confirmation-window.title.automation", {
      automation: str(automation.label) ?? str(automation.key) ?? "",
      app,
    }),
    subject: subject(obj(automation.when), app, name),
    effect: automation.external === true
      ? t("confirmation-window.automation.effect-external")
      : t("confirmation-window.automation.effect"),
    reversible: shown.reversible === true,
    revertNote: str(shown.reversibility),
    action: t("confirmation-window.button.turn-on"),
    details: facts([
      [t("confirmation-window.label.requested-by"), str(shown.requester)],
      [t("confirmation-window.label.reason"), str(shown.reason)],
      [t("confirmation-window.label.expires"), str(shown.expires_at)],
      [
        t("confirmation-window.label.change-effect"),
        effectText(command.effect),
      ],
    ]),
    change: {
      kind: "description",
      before: t("confirmation-window.automation.now"),
      after: str(command.description) ?? null,
    },
  };
  return (
    <ApprovalDecision
      {...props}
      display={display}
      exact={
        <>
          <ExactRows rows={rows} />
          {automation.runnable === false
            ? (
              <p className={styles.message} data-automation="not-ready">
                {t("confirmation-window.automation.not-ready")}
              </p>
            )
            : null}
          <FoldedExact view={shown} />
        </>
      }
    />
  );
}
