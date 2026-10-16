// 용어집의 읽는 줄: 용어 · 뜻(아래에 누가·언제) · [Edit]·[Delete]. 두 단추는 hover나 focus가 들어왔을 때만
// 보이고 칸은 그대로다.
import type { ReactNode } from "react";
import { Button } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { setByLabel, whenLabel } from "./context-glossary-model.ts";
import styles from "./context-glossary.module.css";
import type { GlossaryEntry } from "./source.ts";

interface GlossaryRowProps {
  readonly entry: GlossaryEntry;
  /** "2 days ago"를 잴 지금. */
  readonly now: Date;
  /** 명령이 가는 동안은 단추를 막는다. */
  readonly busy: boolean;
  readonly onEdit: () => void;
  readonly onDelete: () => void;
}

export function GlossaryRow(
  { entry, now, busy, onEdit, onDelete }: GlossaryRowProps,
): ReactNode {
  return (
    <li className={styles.row} data-term data-entry={entry.id}>
      <span className={styles.term} data-term-name>{entry.term}</span>
      <div>
        <p className={styles.meaning} data-term-meaning>{entry.meaning}</p>
        <p className={styles.meta}>
          <span data-term-by>{setByLabel(entry.set_by)}</span>
          {" · "}
          <time dateTime={entry.updated_at} data-term-when>
            {whenLabel(entry.updated_at, now)}
          </time>
        </p>
      </div>
      <div className={`${styles.actions} ${styles.hover}`}>
        <Button
          size="sm"
          variant="ghost"
          data-glossary-edit
          disabled={busy}
          onClick={onEdit}
        >
          {t("contexts.button.glossary-edit")}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          data-glossary-delete
          disabled={busy}
          onClick={onDelete}
        >
          {t("contexts.button.glossary-delete")}
        </Button>
      </div>
    </li>
  );
}
