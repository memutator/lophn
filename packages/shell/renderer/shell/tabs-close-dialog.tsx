// tab 메뉴로 여러 tab을 닫을 때 한 번 묻는 dialog. 멈출 터미널과 저장하지 못해 변경을 잃을 파일을 줄마다 보이고, 닫는
// 일은 부르는 쪽이 한다. 물을 것이 없으면 부르는 쪽이 열지 않고 바로 닫는다.
import type { ReactNode } from "react";
import { t } from "@lophn/i18n";
import { Button } from "@lophn/ui/primitives";
import { Dialog } from "@lophn/ui/overlay";

import { actionIcons } from "../icons/mod.ts";
import styles from "./tabs-close-dialog.module.css";

export interface TabsCloseRow {
  readonly key: string;
  readonly title: string;
  readonly icon: ReactNode;
  /** 파일이면 경로. */
  readonly path?: string;
}

export function TabsCloseDialog({
  count,
  terminals,
  lost,
  onCancel,
  onConfirm,
}: {
  /** 닫을 tab 수. */
  count: number;
  /** 멈출 터미널(shell과 coding agent). */
  terminals: readonly TabsCloseRow[];
  /** 저장하지 못해 닫으면 변경을 잃을 파일. */
  lost: readonly TabsCloseRow[];
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={t("shell.dialog.tabs-close-title", { count })}
      actions={
        <>
          <Button onClick={onCancel}>{t("common.button.cancel")}</Button>
          <Button
            variant="danger"
            icon={actionIcons.remove}
            onClick={onConfirm}
          >
            {t("shell.button.tabs-close", { count })}
          </Button>
        </>
      }
    >
      <div className={styles.body} data-tabs-close="">
        <Rows
          text={t("shell.dialog.tabs-close-terminals", {
            count: terminals.length,
          })}
          rows={terminals}
        />
        <Rows
          text={t("shell.dialog.tabs-close-lost", { count: lost.length })}
          rows={lost}
        />
      </div>
    </Dialog>
  );
}

function Rows({ text, rows }: { text: string; rows: readonly TabsCloseRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className={styles.group} role="group" aria-label={text}>
      <p className={styles.text}>{text}</p>
      <ul className={styles.list}>
        {rows.map((row) => (
          <li key={row.key} className={styles.row}>
            <span className={styles.icon}>{row.icon}</span>
            <span className={styles.name}>{row.title}</span>
            {row.path === undefined ? null : (
              <span className={styles.path}>{row.path}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
