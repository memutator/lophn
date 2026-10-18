// 모델 목록이 없는 provider(사람이 붙인 custom provider)에서 model 이름을 직접 적어 고르는 줄이다.
// catalog가 그 model의 한계와 option을 모르므로 이름만 받는다.
import { useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Field, Input } from "@lophn/ui/input";
import { t } from "@lophn/wording";

import styles from "./model-picker.module.css";
import type { CustomModelView } from "./types.ts";

function CustomModelRow(
  { provider, onUse }: {
    provider: { readonly id: string; readonly name: string };
    onUse: CustomModelView["onUse"];
  },
) {
  const [name, setName] = useState("");
  const trimmed = name.trim();
  const use = () => {
    if (trimmed === "") return;
    onUse(provider.id, trimmed);
    setName("");
  };
  return (
    <div className={styles.custom} data-custom-provider={provider.id}>
      <Field
        label={t("conversation.label.custom-model", {
          provider: provider.name,
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
  );
}

export function CustomModelInput({ custom }: { custom: CustomModelView }) {
  if (custom.providers.length === 0) return null;
  return (
    <div className={styles.customList} data-picker-section="custom">
      <p className={styles.note}>{t("conversation.notice.custom-model")}</p>
      {custom.providers.map((provider) => (
        <CustomModelRow
          key={provider.id}
          provider={provider}
          onUse={custom.onUse}
        />
      ))}
    </div>
  );
}
