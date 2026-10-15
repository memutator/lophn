// pane 위쪽에 뜨는 toast. 그 pane의 알림은 색 다른 띠나 상자가 아니라 이 toast로 띄운다. 가장 가까운 position 조상(pane)의 위쪽 가운데에 놓인다.
// design Toast의 단추는 왼쪽에 놓여 오른쪽 끝에 두려고, 같은 CSS Module로 짠 look-alike다.
import type { ReactNode } from "react";
import { Button, IconButton } from "@lophn/design/components";
import { workspaceIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";

import toastStyles from "../../../../../packages/design/components/toast/toast.module.css";
import styles from "./app-space.module.css";

export function PaneToast(
  { title, body, lead, action, below = false, onClose }: {
    title: string;
    body?: string;
    /** 제목 앞의 작은 그림(VendorIcon 같은). */
    lead?: ReactNode;
    /** 오른쪽 끝에 놓이는 단추 하나. */
    action?: { readonly label: string; readonly onClick: () => void };
    /** pane 머리가 있으면 머리 바로 아래에 띄워 머리를 가리지 않는다. */
    below?: boolean;
    onClose: () => void;
  },
) {
  return (
    <div
      className={`${styles.paneToast} ${below ? styles.paneToastBelow : ""}`}
    >
      <div className={toastStyles.toast} role="status">
        <div className={toastStyles.text}>
          <p className={`${toastStyles.title} ${styles.toastTitle}`}>
            {lead}
            <span>{title}</span>
          </p>
          {body === undefined
            ? null
            : <p className={toastStyles.body}>{body}</p>}
          {action === undefined
            ? null
            : (
              <div className={`${toastStyles.actions} ${styles.toastEnd}`}>
                <Button size="sm" onClick={action.onClick}>
                  {action.label}
                </Button>
              </div>
            )}
        </div>
        <IconButton
          icon={workspaceIcons.close}
          label="Close"
          size="sm"
          onClick={onClose}
        />
      </div>
    </div>
  );
}
