// annotate mode의 조각. 모은 annotation 목록. 켰다는 안내는 앱 화면 위쪽 toast다. 고른 곳의 표시와 메모 칸은 앱 화면 위(orders-view.tsx)에 붙는다.
import { Button, IconButton } from "@lophn/design/components";
import { workspaceIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";

import styles from "./app-space.module.css";

export interface Annotation {
  readonly n: number;
  /** 고른 곳의 이름. */
  readonly target: string;
  readonly memo: string;
}

export function AnnotationPanel(
  { items, onRemove, onClear, onSend }: {
    items: readonly Annotation[];
    onRemove: (n: number) => void;
    onClear: () => void;
    onSend: () => void;
  },
) {
  return (
    <aside className={styles.annotations} aria-label="Annotations">
      <div className={styles.row}>
        <span className={styles.strong}>Annotations ({items.length})</span>
        <Button size="sm" variant="ghost" onClick={onClear}>
          Clear all
        </Button>
      </div>
      <ul className={styles.annotationList}>
        {items.map((item) => (
          <li key={item.n} className={styles.annotation}>
            <span className={`${styles.badge} ${styles.annotationBadge}`}>
              {item.n}
            </span>
            <span className={styles.annotationText}>
              <span className={styles.muted}>{item.target}</span>
              <span>{item.memo}</span>
            </span>
            <IconButton
              icon={workspaceIcons.close}
              label={`Remove annotation ${item.n}`}
              size="sm"
              onClick={() => onRemove(item.n)}
            />
          </li>
        ))}
      </ul>
      <p className={styles.muted}>
        They go to App Engineer as one message. They don't become problems.
      </p>
      <div className={styles.actions}>
        <Button
          variant="primary"
          disabled={items.length === 0}
          onClick={onSend}
        >
          Send to App Engineer
        </Button>
      </div>
    </aside>
  );
}
