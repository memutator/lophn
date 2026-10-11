// 용어집의 한 줄. 보기에서는 용어·뜻·누가·언제와 [Edit]·[Delete]를 보이고, [Edit]을 누르면 같은 줄이
// 용어·뜻 칸과 [Save]·[Cancel]로 바뀐다. 저장과 지우기는 부른 쪽(화면)이 source로 보낸다.
import { useState } from "react";
import type { ReactNode } from "react";
import { Button } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { GlossaryFields } from "./context-glossary-fields.tsx";
import {
  changesOf,
  type GlossaryChanges,
  isBlank,
  setByLabel,
  type TermDraft,
  whenLabel,
} from "./context-glossary-model.ts";
import styles from "./context-glossary.module.css";
import type { GlossaryEntry } from "./source.ts";

export interface GlossaryRowProps {
  readonly entry: GlossaryEntry;
  /** "2 days ago"를 잴 지금. */
  readonly now: Date;
  /** 명령이 가는 동안은 단추를 막는다. */
  readonly busy: boolean;
  /** 바뀐 field만 넘긴다. 성공하면 true로 끝나 보기로 돌아간다. */
  readonly onSave: (changes: GlossaryChanges) => Promise<boolean>;
  readonly onDelete: () => void;
}

export function GlossaryRow(
  { entry, now, busy, onSave, onDelete }: GlossaryRowProps,
): ReactNode {
  // null이면 보기, 값이 있으면 고치기 중이다.
  const [draft, setDraft] = useState<TermDraft | null>(null);

  if (draft !== null) {
    const save = async (): Promise<void> => {
      const changes = changesOf(entry, draft);
      if (changes === null) {
        setDraft(null);
        return;
      }
      if (await onSave(changes)) setDraft(null);
    };
    return (
      <li className={styles.row} data-term data-entry={entry.id}>
        <GlossaryFields value={draft} onChange={setDraft} disabled={busy} />
        <div className={styles.actions}>
          <Button
            variant="primary"
            disabled={busy || isBlank(draft)}
            onClick={() => void save()}
          >
            {t("contexts.button.glossary-save")}
          </Button>
          <Button disabled={busy} onClick={() => setDraft(null)}>
            {t("contexts.button.glossary-cancel")}
          </Button>
        </div>
      </li>
    );
  }

  return (
    <li className={styles.row} data-term data-entry={entry.id}>
      <span className={styles.term} data-term-name>{entry.term}</span>
      <p className={styles.meaning} data-term-meaning>{entry.meaning}</p>
      <div className={styles.meta}>
        <span data-term-by>{setByLabel(entry.set_by)}</span>
        <span aria-hidden="true">·</span>
        <time dateTime={entry.updated_at} data-term-when>
          {whenLabel(entry.updated_at, now)}
        </time>
      </div>
      <div className={styles.actions}>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => setDraft({ term: entry.term, meaning: entry.meaning })}
        >
          {t("contexts.button.glossary-edit")}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => onDelete()}>
          {t("contexts.button.glossary-delete")}
        </Button>
      </div>
    </li>
  );
}
