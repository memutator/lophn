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
import { effectText } from "../release-activation/release-activation.tsx";
import styles from "../kinds.module.css";

/**
 * 앱 command 한 번 확인. label·설명·effect는 apps가 지금 고정 blueprint에서 읽은 값이다. 정확한
 * 입력은 접수 입력에 묶인 지문으로만 확인하고(요청에 입력 본문은 없다), diff로 못 보이는 동작은
 * 현재·바뀐 뒤 설명을 세로로 둔다. 안전 preview는 apps/preview 결과가 없으면 없다고 한다.
 */
export function ConfirmCommandKind(props: KindProps) {
  const shown = obj(props.view.view);
  const command = obj(shown.app_command);
  const caller = obj(shown.caller);
  const app = appLabel(shown.app);
  const name = str(command.label) ?? str(command.key) ?? "";
  const rows: ExactRow[] = [
    {
      key: "command",
      label: t("confirmation-window.label.command"),
      value: str(command.key) ?? "",
    },
    {
      key: "input",
      label: t("confirmation-window.label.input-fingerprint"),
      value: str(shown.input_hash) ?? "",
      note: t("confirmation-window.confirm.input-note"),
    },
  ];
  if (command.input !== null && command.input !== undefined) {
    rows.push({
      key: "shape",
      label: t("confirmation-window.label.input-shape"),
      value: JSON.stringify(command.input, null, 2),
    });
  }
  const display: Display = {
    title: t("confirmation-window.title.confirm-command", {
      command: name,
      app,
    }),
    subject: t("confirmation-window.confirm.subject", {
      caller: str(caller.kind) ?? "agent",
      name: appLabel(caller.app),
      app,
      command: name,
    }),
    effect: effectText(command.effect),
    reversible: shown.reversible === true,
    revertNote: str(shown.reversibility),
    action: t("confirmation-window.button.allow-once"),
    details: facts([
      [t("confirmation-window.label.requested-by"), str(shown.requester)],
      [t("confirmation-window.label.reason"), str(shown.reason)],
      [t("confirmation-window.label.expires"), str(shown.expires_at)],
    ]),
    change: {
      kind: "description",
      before: t("confirmation-window.confirm.now"),
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
          <section className={styles.part} data-change="preview">
            <h3 className={styles.partHead}>
              {t("confirmation-window.heading.preview")}
            </h3>
            <p className={styles.item}>
              {t("confirmation-window.confirm.preview-none")}
            </p>
          </section>
          <FoldedExact view={shown} />
        </>
      }
    />
  );
}
