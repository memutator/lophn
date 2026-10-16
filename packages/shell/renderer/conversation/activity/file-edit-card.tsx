import type { ReactElement } from "react";
import { Button, Card } from "@lophn/design/components";
import { t } from "@lophn/wording";

import styles from "./activity.module.css";

interface EditCardProps {
  /** 보이는 경로. */
  path: string;
  added: number;
  removed: number;
  /** [Open]: 그 파일의 탭을 연다. */
  onOpen: () => void;
}

// 파일을 바꾼 편집 카드 "Edited <경로> +n −m"와 [Open]. 되돌리는 길은 rewind뿐이라 Undo는 없다.
export function EditCard(
  { path, added, removed, onOpen }: EditCardProps,
): ReactElement {
  return (
    <Card>
      <div className={styles.editCard} data-edit-card="">
        <span className={styles.editText} data-edit-summary="">
          {t("conversation.label.edit-made")}{" "}
          <span className={styles.mono}>{path}</span>{" "}
          <span className={styles.added}>+{added}</span>{" "}
          <span className={styles.removed}>−{removed}</span>
        </span>
        <span className={styles.editActions}>
          <Button size="sm" onClick={onOpen}>
            {t("conversation.button.edit-open")}
          </Button>
        </span>
      </div>
    </Card>
  );
}
