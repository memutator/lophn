// 목록에 없는 model을 이름으로 쓰는 줄. 고르는 provider(후보가 하나면 숨김), 이름 입력, [Use]가 한 줄이다.
// catalog가 그 model의 한계와 option을 모르므로 이름만 받는다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Field, Input } from "@lophn/ui/input";
import { t } from "@lophn/wording";

import styles from "./model-picker.module.css";
import type { TypedModelView } from "./types.ts";

export function TypedModelRow(
  { typed, currentProvider }: {
    typed: TypedModelView;
    currentProvider: string;
  },
) {
  const [picked, setPicked] = useState<string | null>(null);
  const [name, setName] = useState("");
  const { providers } = typed;
  if (providers.length === 0) return null;
  const chosen = providers.find((item) => item.id === picked) ??
    providers.find((item) => item.id === currentProvider) ??
    providers[providers.length - 1];
  const trimmed = name.trim();
  const use = () => {
    if (trimmed === "") return;
    typed.onUse(chosen.id, trimmed);
    setName("");
  };
  return (
    <div className={styles.typed} data-picker-section="typed">
      <p className={styles.note}>{t("conversation.notice.custom-model")}</p>
      <div className={styles.typedRow}>
        {providers.length === 1 ? null : (
          <select
            className={styles.typedSelect}
            aria-label={t("conversation.label.typed-provider")}
            value={chosen.id}
            onChange={(event) => setPicked(event.currentTarget.value)}
          >
            {providers.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        )}
        <Field
          label={t("conversation.label.custom-model", {
            provider: chosen.name,
          })}
        >
          <Input
            value={name}
            autoComplete="off"
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") use();
            }}
          />
        </Field>
        <Button size="sm" disabled={trimmed === ""} onClick={use}>
          {t("conversation.button.custom-model-use")}
        </Button>
      </div>
    </div>
  );
}
