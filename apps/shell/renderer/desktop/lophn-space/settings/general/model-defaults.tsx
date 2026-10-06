// For decisions / For summaries(shell/wording#R13). 새 Preset이 처음 고르는 model이다. 기존 Preset과 이미
// 진행하는 일의 선택은 바꾸지 않는다. 고르는 연결은 쓸 수 있는 계정이 있는 것만이다.
import { useEffect, useState } from "react";
import { Button, Field, Select } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { choiceOf, sortAccounts, useHelp, useLabel } from "../model.ts";
import type {
  ModelDefaults,
  ModelUse,
  ProviderRow,
  SettingsSource,
} from "../source.ts";
import styles from "../settings.module.css";

export interface ModelDefaultsProps {
  source: SettingsSource;
  providers: readonly ProviderRow[];
  defaults: ModelDefaults;
  /** 바꾼 값을 받는다. 낡은 기준이면 부르지 않고 다시 읽게 한다. */
  onSaved: (defaults: ModelDefaults) => void;
  onStale: () => void;
}

type Notice = "saved" | "failed" | "stale";

/** 이 연결에서 쓸 수 있는 계정(사람이 정한 순서). 없으면 고를 수 없다. */
function usable(provider: ProviderRow): string[] {
  return sortAccounts(provider.accounts)
    .filter((account) => account.enabled && account.state === "available")
    .map((account) => account.key);
}

export function ModelDefaultsPanel(
  { source, providers, defaults, onSaved, onStale }: ModelDefaultsProps,
) {
  return (
    <section className={styles.section} data-models="">
      <h2 className={styles.heading}>{t("settings.heading.models")}</h2>
      <p className={styles.text}>{t("settings.defaults.intro")}</p>
      {(["decisions", "summaries"] as const).map((use) => (
        <ModelDefaultRow
          key={use}
          use={use}
          source={source}
          providers={providers}
          defaults={defaults}
          onSaved={onSaved}
          onStale={onStale}
        />
      ))}
    </section>
  );
}

function ModelDefaultRow(
  { use, source, providers, defaults, onSaved, onStale }: ModelDefaultsProps & {
    use: ModelUse;
  },
) {
  const current = choiceOf(defaults, use);
  const choices = providers.filter((provider) => usable(provider).length > 0);
  const [provider, setProvider] = useState(
    current?.provider ?? choices[0]?.id ?? "",
  );
  const [models, setModels] = useState<readonly string[] | null>(null);
  const [model, setModel] = useState(current?.model ?? "");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState(false);
  const picked = providers.find((row) => row.id === provider);

  useEffect(() => {
    if (picked === undefined) return;
    let live = true;
    setModels(null);
    void source.models(picked.definition).then((loaded) => {
      if (!live) return;
      const names = loaded.ok ? loaded.value : [];
      setModels(names);
      setModel((was) => names.includes(was) ? was : names[0] ?? "");
    });
    return () => {
      live = false;
    };
  }, [source, picked?.definition]);

  async function save(): Promise<void> {
    if (picked === undefined || model === "") return;
    setBusy(true);
    const saved = await source.setModelDefault(use, {
      provider: picked.id,
      model,
      accounts: usable(picked),
    }, defaults);
    setBusy(false);
    if (saved.ok) {
      setNotice("saved");
      onSaved(saved.value);
    } else if (saved.code === "conflict") {
      setNotice("stale");
      onStale();
    } else setNotice("failed");
  }

  const nameOf = (id: string) =>
    providers.find((row) => row.id === id)?.name ??
      t("settings.label.unavailable-connection");
  return (
    <div className={styles.section} data-model-use={use}>
      <h3 className={styles.subheading}>{useLabel(use)}</h3>
      <p className={styles.muted}>{useHelp(use)}</p>
      <p className={styles.text} data-model-current="">
        {current === null
          ? t("settings.defaults.not-chosen")
          : t("settings.defaults.current", {
            model: current.model,
            name: nameOf(current.provider),
          })}
      </p>
      {choices.length === 0
        ? <p className={styles.muted}>{t("settings.defaults.no-connection")}</p>
        : (
          <div className={styles.inline}>
            <Field label={t("settings.label.model-connection")}>
              <Select
                options={choices.map((row) => ({
                  value: row.id,
                  label: row.name,
                }))}
                value={provider}
                onValueChange={setProvider}
              />
            </Field>
            <Field label={t("settings.label.model-name")}>
              <Select
                options={(models ?? []).map((name) => ({
                  value: name,
                  label: name,
                }))}
                value={model}
                disabled={models === null || models.length === 0}
                placeholder={models !== null && models.length === 0
                  ? t("settings.label.no-models")
                  : undefined}
                onValueChange={setModel}
              />
            </Field>
            <Button
              size="sm"
              variant="secondary"
              data-action="save-model"
              disabled={busy || model === ""}
              onClick={() => void save()}
            >
              {t("settings.button.save")}
            </Button>
          </div>
        )}
      {notice === null
        ? null
        : (
          <p className={styles.notice} role="status" data-notice={notice}>
            {notice === "saved"
              ? t("settings.defaults.saved")
              : notice === "stale"
              ? t("settings.error.changed")
              : t("settings.defaults.failed")}
          </p>
        )}
    </div>
  );
}
