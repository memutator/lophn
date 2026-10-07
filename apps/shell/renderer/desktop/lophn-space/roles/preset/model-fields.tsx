import { useEffect, useState } from "react";
import { Button, Field, Select } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { moveAccount } from "../model.ts";
import type { ModelPick, PresetChoices, RolesSource } from "../source.ts";
import styles from "../roles.module.css";

export interface ModelFieldsProps {
  source: RolesSource;
  choices: PresetChoices;
  /** 어디에 쓰는 model인지. For decisions·For summaries(shell/wording#R13). */
  use: "decisions" | "summaries";
  pick: ModelPick | null;
  onPick: (pick: ModelPick | null) => void;
}

const DEFAULT = "default";

// model 선택. 연결을 고르고, 그 연결에서 쓸 계정을 쓸 순서대로 정하고, model을 고른다. 고치지 않는
// 값(추론 단계·옵션)은 원본 그대로 돌려보낸다.
export function ModelFields(
  { source, choices, use, pick, onPick }: ModelFieldsProps,
) {
  const connection = choices.connections.find((item) =>
    item.id === pick?.provider
  );
  const [models, setModels] = useState<readonly string[] | null>(null);

  useEffect(() => {
    if (connection === undefined) return;
    let live = true;
    void source.models(connection.definition).then((result) => {
      if (live) setModels(result.ok ? result.value : []);
    });
    return () => {
      live = false;
    };
  }, [source, connection]);

  const label = use === "decisions"
    ? t("roles.label.preset-for-decisions")
    : t("roles.label.preset-for-summaries");
  const accounts = pick === null ? [] : pick.accounts;
  const unused = connection === undefined
    ? []
    : connection.accounts.filter((account) => !accounts.includes(account.key));
  const nameOf = (key: string) =>
    connection?.accounts.find((account) => account.key === key)?.label ?? key;

  const modelOptions = [
    ...new Set([
      ...(models ?? []),
      ...(pick === null || pick.model === "" ? [] : [pick.model]),
    ]),
  ];

  return (
    <section className={styles.group} data-editor={`model-${use}`}>
      <h3 className={styles.groupHead}>{label}</h3>
      <Field label={t("roles.label.preset-connection")}>
        <Select
          value={pick?.provider ?? DEFAULT}
          options={[
            { value: DEFAULT, label: t("roles.label.preset-use-default") },
            ...choices.connections.map((item) => ({
              value: item.id,
              label: item.name,
            })),
          ]}
          onValueChange={(value) =>
            onPick(
              value === DEFAULT ? null : value === pick?.provider ? pick : {
                provider: value,
                accounts: [],
                model: "",
                raw: pick?.raw ?? null,
              },
            )}
        />
      </Field>
      {pick === null || connection === undefined ? null : (
        <>
          <Field label={t("roles.label.preset-model")}>
            <Select
              value={pick.model}
              options={modelOptions.map((name) => ({
                value: name,
                label: name,
              }))}
              placeholder={t("roles.label.preset-pick-model")}
              onValueChange={(model) => onPick({ ...pick, model })}
            />
          </Field>
          <div className={styles.fact}>
            <span className={styles.factHead}>
              {t("roles.label.preset-accounts")}
            </span>
            <ol className={styles.items} data-accounts={use}>
              {accounts.map((key, index) => (
                <li key={key} className={styles.itemMain} data-account={key}>
                  <span>{nameOf(key)}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    data-action="account-up"
                    disabled={index === 0}
                    aria-label={t("roles.label.preset-account-up", {
                      name: nameOf(key),
                    })}
                    onClick={() =>
                      onPick({
                        ...pick,
                        accounts: moveAccount(accounts, key, -1),
                      })}
                  >
                    {t("roles.button.preset-up")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    data-action="account-down"
                    disabled={index === accounts.length - 1}
                    aria-label={t("roles.label.preset-account-down", {
                      name: nameOf(key),
                    })}
                    onClick={() =>
                      onPick({
                        ...pick,
                        accounts: moveAccount(accounts, key, 1),
                      })}
                  >
                    {t("roles.button.preset-down")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    data-action="account-remove"
                    onClick={() =>
                      onPick({
                        ...pick,
                        accounts: accounts.filter((other) =>
                          other !== key
                        ),
                      })}
                  >
                    {t("roles.button.preset-remove")}
                  </Button>
                </li>
              ))}
            </ol>
            {accounts.length === 0
              ? <p className={styles.muted}>{t("roles.preset.no-accounts")}</p>
              : null}
            <div className={styles.actions}>
              {unused.map((account) => (
                <Button
                  key={account.key}
                  size="sm"
                  variant="secondary"
                  data-action="account-add"
                  data-key={account.key}
                  onClick={() =>
                    onPick({ ...pick, accounts: [...accounts, account.key] })}
                >
                  {t("roles.button.preset-add-account", {
                    name: account.label,
                  })}
                </Button>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
