// 용어 줄을 바로 고치는 칸. 읽을 때와 같은 칸 배치에 글자 칸 둘과 ✓·×가 놓인다.
// 추가하는 줄과 고치는 줄이 같이 쓴다. Enter·✓는 저장, Esc·×는 취소.
import { type KeyboardEvent, type ReactNode, useState } from "react";
import { IconButton } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { conversationIcons } from "../../icons/mod.ts";
import { isBlank, type TermDraft } from "./context-glossary-model.ts";
import styles from "./context-glossary.module.css";

export interface GlossaryFieldsProps {
  readonly initial: TermDraft;
  readonly busy: boolean;
  readonly onSave: (draft: TermDraft) => void;
  readonly onCancel: () => void;
}

export function GlossaryFields(
  { initial, busy, onSave, onCancel }: GlossaryFieldsProps,
): ReactNode {
  const [draft, setDraft] = useState(initial);
  const ready = !busy && !isBlank(draft);
  const save = () => {
    if (ready) onSave(draft);
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key === "Enter") save();
    if (event.key === "Escape") onCancel();
  };
  return (
    <li className={styles.row} data-term data-editing="">
      <input
        className={`${styles.input} ${styles.termInput}`}
        aria-label={t("contexts.label.glossary-term")}
        placeholder={t("contexts.label.glossary-term")}
        value={draft.term}
        disabled={busy}
        autoFocus={initial.term === ""}
        onChange={(event) =>
          setDraft({ ...draft, term: event.currentTarget.value })}
        onKeyDown={keys}
      />
      <input
        className={styles.input}
        aria-label={t("contexts.label.glossary-meaning")}
        placeholder={t("contexts.label.glossary-meaning")}
        value={draft.meaning}
        disabled={busy}
        autoFocus={initial.term !== ""}
        onChange={(event) =>
          setDraft({ ...draft, meaning: event.currentTarget.value })}
        onKeyDown={keys}
      />
      <div className={styles.actions}>
        <IconButton
          icon={conversationIcons.current}
          label={t("contexts.button.glossary-save")}
          disabled={!ready}
          onClick={save}
        />
        <IconButton
          icon={conversationIcons.removeContext}
          label={t("contexts.button.glossary-cancel")}
          disabled={busy}
          onClick={onCancel}
        />
      </div>
    </li>
  );
}
