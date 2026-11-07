// 보관한 앱을 영구히 지우기 전에 한 번 묻는 dialog. 무엇이 사라지는지를 보이고, 지우는 일은 부르는 쪽이 한다.
// 되돌릴 수 없는 일을 실제로 하는 단추라 danger다. 이름을 따로 치게 하지 않는다.
import { t } from "@lophn/i18n";
import { Button } from "@lophn/ui/primitives";
import { Dialog } from "@lophn/ui/overlay";

import { actionIcons } from "../icons/mod.ts";
import styles from "./delete-app-dialog.module.css";

export function DeleteAppDialog({
  name,
  busy = false,
  failure,
  onCancel,
  onConfirm,
}: {
  name: string;
  /** 지우는 중이면 단추를 막는다. */
  busy?: boolean;
  /** 지우지 못한 이유 글. */
  failure?: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
      title={t("home.dialog.delete-app-title", { name })}
      actions={
        <>
          <Button disabled={busy} onClick={onCancel}>
            {t("common.button.cancel")}
          </Button>
          <Button
            variant="danger"
            icon={actionIcons.delete}
            disabled={busy}
            data-action="confirm-delete-app"
            onClick={onConfirm}
          >
            {t("home.button.delete")}
          </Button>
        </>
      }
    >
      <div className={styles.body} data-delete-app="">
        <p className={styles.text}>{t("home.dialog.delete-app-intro")}</p>
        <div className={styles.group} role="group">
          <p className={styles.heading}>{t("home.dialog.delete-app-will")}</p>
          <ul className={styles.list}>
            <li>{t("home.dialog.delete-app-source")}</li>
            <li>{t("home.dialog.delete-app-conversations")}</li>
            <li>{t("home.dialog.delete-app-releases")}</li>
          </ul>
        </div>
        <p className={styles.note}>{t("home.dialog.delete-app-kept")}</p>
        {failure === undefined ? null : (
          <p className={styles.failure} role="alert" data-delete-failure="">
            {failure}
          </p>
        )}
      </div>
    </Dialog>
  );
}
