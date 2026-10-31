// desk의 x를 눌렀을 때 한 번 묻는 dialog. desk를 지우는 것은 그 일을 끝내는 것이라 tab·float·창을 모두 닫고 터미널을
// 멈춘다. 무엇이 닫히는지와 저장이 남은 파일을 보이고, 닫는 일은 부르는 쪽이 한다.
import { t } from "@lophn/i18n";
import { Button, FileIcon, Icon } from "@lophn/ui/primitives";
import { Dialog } from "@lophn/ui/overlay";

import { actionIcons, editorIcons } from "../icons/mod.ts";
import styles from "./desk-close-dialog.module.css";

export interface DeskCloseSummary {
  readonly tabs: number;
  /** 멈추는 터미널(shell과 coding agent). */
  readonly terminals: number;
  readonly floats: number;
  readonly detached: number;
  /** 저장 안 된 변경이 있는 파일. */
  readonly unsaved: readonly {
    readonly title: string;
    readonly path: string;
  }[];
}

export function DeskCloseDialog({
  label,
  summary,
  onCancel,
  onConfirm,
}: {
  label: string;
  summary: DeskCloseSummary;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { tabs, terminals, floats, detached, unsaved } = summary;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={t("shell.dialog.desk-close-title", { name: label })}
      actions={
        <>
          <Button onClick={onCancel}>{t("common.button.cancel")}</Button>
          <Button
            variant="danger"
            icon={actionIcons.remove}
            onClick={onConfirm}
          >
            {t("shell.button.desk-close")}
          </Button>
        </>
      }
    >
      <div className={styles.body} data-desk-close="">
        <p className={styles.text}>
          {t("shell.dialog.desk-close-tabs", { count: tabs })}
          {terminals > 0
            ? ` ${t("shell.dialog.desk-close-terminals", { count: terminals })}`
            : ""}
          {floats > 0
            ? ` ${t("shell.dialog.desk-close-floats", { count: floats })}`
            : ""}
          {detached > 0
            ? ` ${t("shell.dialog.desk-close-detached", { count: detached })}`
            : ""}
        </p>
        {unsaved.length === 0 ? null : (
          <div className={styles.unsaved} role="group">
            <p className={styles.warning}>
              <Icon icon={editorIcons.saveWarning} pixels={16} />
              {t("shell.dialog.desk-close-unsaved", { count: unsaved.length })}
            </p>
            <ul className={styles.list}>
              {unsaved.map((file) => (
                <li key={file.path} className={styles.file}>
                  <FileIcon name={file.title} size={16} />
                  <span className={styles.name}>{file.title}</span>
                  <span className={styles.path}>{file.path}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
}
