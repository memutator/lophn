// 대기 목록 toast. 모양은 design Toast와 같고(같은 token), 단추를 오른쪽 끝에 둔다.
// 시간이 가도 사라지지 않는 정적 화면이라 timer가 없다.
import { Button, IconButton } from "@lophn/design/components";

import { windowCloseIcon } from "../../../../../packages/shell/renderer/icons/mod.ts";
import type { ToastRow } from "./waiting-data.ts";
import styles from "./waiting.module.css";

export function WaitingToast(
  { toast, onAction, onClose }: {
    toast: ToastRow;
    onAction: () => void;
    onClose: () => void;
  },
) {
  return (
    <div className={styles.toast}>
      <div className={styles.toastText}>
        <p className={styles.toastTitle}>{toast.title}</p>
        <p className={styles.toastBody}>{toast.body}</p>
        <div className={styles.toastActions}>
          <Button size="sm" onClick={onAction}>{toast.action}</Button>
        </div>
      </div>
      <IconButton
        icon={windowCloseIcon}
        label="Close"
        size="sm"
        onClick={onClose}
      />
    </div>
  );
}
