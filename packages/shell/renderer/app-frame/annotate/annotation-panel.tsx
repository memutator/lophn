// 모은 annotation 목록. 앱 화면 왼쪽 아래에 떠서 번호, 대상 이름, 메모를 보이고 하나씩 지우거나 모두 지우고 App Engineer에게 보낸다.
// 고른 곳의 윤곽과 번호 표지, 메모 칸은 앱 view 안 preload가 그리므로 여기 없다.
import { Button, IconButton } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { AnnotateState } from "../../../ipc/annotation.ts";
import { workspaceIcons } from "../../icons/mod.ts";
import type { SendFailure } from "./use-annotate.ts";
import styles from "./annotation-panel.module.css";

export interface AnnotationPanelProps {
  items: AnnotateState["items"];
  sending: boolean;
  /** 보내기가 거절된 이유. 목록은 그대로 남는다. */
  failure: SendFailure | null;
  onRemove: (n: number) => void;
  onClear: () => void;
  onSend: () => void;
}

export function AnnotationPanel(
  { items, sending, failure, onRemove, onClear, onSend }: AnnotationPanelProps,
) {
  return (
    <aside
      className={styles.panel}
      aria-label={t("app-space.label.annotations")}
      data-annotations=""
    >
      <div className={styles.head}>
        <span className={styles.strong}>
          {t("app-space.heading.annotations", { count: items.length })}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={sending}
          data-annotations-clear=""
          onClick={onClear}
        >
          {t("app-space.button.clear-annotations")}
        </Button>
      </div>
      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.n} className={styles.item} data-annotation={item.n}>
            <span className={styles.badge}>{item.n}</span>
            <span className={styles.text}>
              <span className={styles.muted}>{item.label}</span>
              <span>{item.note}</span>
            </span>
            <IconButton
              icon={workspaceIcons.close}
              label={t("app-space.label.remove-annotation", {
                number: String(item.n),
              })}
              size="sm"
              disabled={sending}
              onClick={() =>
                onRemove(item.n)}
            />
          </li>
        ))}
      </ul>
      <p className={styles.muted}>{t("app-space.text.annotations-note")}</p>
      {failure === null ? null : (
        <p
          className={styles.failure}
          role="alert"
          data-annotations-failure=""
        >
          {failure === "archived"
            ? t("app-space.error.annotations-archived")
            : t("app-space.error.annotations-failed")}
        </p>
      )}
      <div className={styles.actions}>
        <Button
          variant="primary"
          disabled={items.length === 0 || sending}
          data-annotations-send=""
          onClick={onSend}
        >
          {sending
            ? t("app-space.label.sending-annotations")
            : t("app-space.button.send-annotations")}
        </Button>
      </div>
    </aside>
  );
}
