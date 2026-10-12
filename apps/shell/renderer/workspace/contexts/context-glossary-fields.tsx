// 용어 칸과 뜻 칸 두 개. 추가 form과 고치기 줄이 같이 쓴다. 용어는 한 줄 Input, 뜻은 여러 줄 Textarea다.
import type { ReactNode } from "react";
import { Field, Input, Textarea } from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { TermDraft } from "./context-glossary-model.ts";
import styles from "./context-glossary.module.css";

export interface GlossaryFieldsProps {
  readonly value: TermDraft;
  readonly onChange: (next: TermDraft) => void;
  readonly disabled: boolean;
}

export function GlossaryFields(
  { value, onChange, disabled }: GlossaryFieldsProps,
): ReactNode {
  return (
    <div className={styles.fields}>
      <Field label={t("contexts.label.glossary-term")}>
        <Input
          value={value.term}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, term: event.currentTarget.value })}
        />
      </Field>
      <Field label={t("contexts.label.glossary-meaning")}>
        <Textarea
          rows={3}
          value={value.meaning}
          disabled={disabled}
          onChange={(event) =>
            onChange({ ...value, meaning: event.currentTarget.value })}
        />
      </Field>
    </div>
  );
}
