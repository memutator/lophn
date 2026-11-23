// 보관한 앱을 영구히 지우기 전에 한 번 묻는 dialog. 무엇이 사라지는지를 보이고, 지우는 일은 부르는 쪽이 한다.
// 되돌릴 수 없는 일을 실제로 하는 단추라 danger다. 이름을 따로 치게 하지 않는다.
import { t } from "@lophn/i18n";
import { Dialog } from "@lophn/ui/overlay";

import type { CleanUpMode } from "../../../protocol/base/follow-ups.ts";
import type { PublishedPackage } from "../apps/source.ts";
import {
  CascadeDeleteActions,
  CascadeImpactDetails,
  type ImpactReport,
} from "./cascade-delete-confirm.tsx";
import styles from "./delete-app-dialog.module.css";

export function DeleteAppDialog({
  name,
  packages = [],
  impact = null,
  impactLoading = false,
  busy = false,
  failure,
  onCancel,
  onConfirm,
}: {
  name: string;
  /** 앱이 주인인 공개 package. 지워도 남고 주인이 빈다. */
  packages?: readonly PublishedPackage[];
  /** `impact.read` 결과. declared가 1곳 이상이면 `[Delete & clean up now]` / `[Delete only]`를 보인다. */
  impact?: ImpactReport | null;
  impactLoading?: boolean;
  /** 지우는 중이면 단추를 막는다. */
  busy?: boolean;
  /** 지우지 못한 이유 글. */
  failure?: string;
  onCancel: () => void;
  onConfirm: (cleanUp: CleanUpMode) => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
      title={t("home.dialog.delete-app-title", { name })}
      actions={
        <CascadeDeleteActions
          report={impact}
          loading={impactLoading}
          busy={busy}
          confirmLabel={t("home.button.delete")}
          confirmAction="confirm-delete-app"
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
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
        <CascadeImpactDetails report={impact} loading={impactLoading} />
        {packages.length === 0 ? null : (
          <div className={styles.group} role="group" data-delete-packages="">
            <p className={styles.heading}>
              {t("home.dialog.delete-app-published")}
            </p>
            <ul className={styles.list}>
              {packages.map((pkg) => (
                <li key={pkg.name}>
                  {t("home.dialog.delete-app-package", {
                    name: pkg.name,
                    count: pkg.users,
                  })}
                </li>
              ))}
            </ul>
            <p className={styles.note}>
              {t("home.dialog.delete-app-published-note")}
            </p>
          </div>
        )}
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
