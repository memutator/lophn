// settings의 일반 자리. model 기본값(For decisions·For summaries), 전역 [Instructions] 진입, 설정 값을 보인다.
// 설정 값은 정의(이름)·현재 적용값을 기본으로 보이고 효력 시점·기본값·바뀐 출처는 펼친 곳에 둔다
// (shell/wording#R13, ui-ux G2). 값을 지어내지 않는다: 정해지지 않은 값은 정해지지 않았다고 말한다.
import { useCallback, useState } from "react";
import { ErrorState, Loading, Skeleton } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { InstructionsButton } from "../../../../editor/instructions-entry.tsx";
import { applyText, generalRows, valueText } from "../model.ts";
import type {
  ModelDefaults,
  ProviderRow,
  SettingRow,
  SettingsSource,
} from "../source.ts";
import { useReload } from "../use-reload.ts";
import styles from "../settings.module.css";
import { ModelDefaultsPanel } from "./model-defaults.tsx";

export interface GeneralPanelProps {
  source: SettingsSource;
  /** 전역 [Instructions] 편집기를 연다. 없으면 단추를 두지 않는다. */
  onInstructions?: () => void;
}

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | {
    readonly state: "ready";
    readonly rows: readonly SettingRow[];
    /** model 기본값을 못 읽었으면 그 자리만 비운다. */
    readonly models: {
      readonly providers: readonly ProviderRow[];
      readonly defaults: ModelDefaults;
    } | null;
  };

export function GeneralPanel({ source, onInstructions }: GeneralPanelProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });

  const load = useCallback(() => {
    void (async () => {
      const settings = await source.settings();
      if (!settings.ok) {
        setLoaded({ state: "failed" });
        return;
      }
      // core reader는 한 사람의 동시 읽기 수를 제한하므로 하나씩 읽는다.
      const providers = await source.providers();
      const defaults = await source.modelDefaults();
      setLoaded({
        state: "ready",
        rows: generalRows(settings.value.rows),
        models: providers.ok && defaults.ok
          ? { providers: providers.value, defaults: defaults.value }
          : null,
      });
    })();
  }, [source]);
  useReload(source, load);

  if (loaded.state === "failed") {
    return (
      <ErrorState
        target={t("settings.label.general-target")}
        onRetry={() => {
          setLoaded({ state: "loading" });
          load();
        }}
      />
    );
  }
  return (
    <Loading
      loading={loaded.state === "loading"}
      placeholder={<Skeleton lines={5} />}
    >
      <div className={styles.groups} data-general="">
        {loaded.state === "ready" && loaded.models !== null
          ? (
            <ModelDefaultsPanel
              source={source}
              providers={loaded.models.providers}
              defaults={loaded.models.defaults}
              onSaved={(defaults) =>
                setLoaded({
                  ...loaded,
                  models: { providers: loaded.models!.providers, defaults },
                })}
              onStale={load}
            />
          )
          : (
            <section className={styles.section} data-models="unavailable">
              <h2 className={styles.heading}>
                {t("settings.heading.models")}
              </h2>
              <p className={styles.muted}>
                {t("settings.defaults.unreadable")}
              </p>
            </section>
          )}
        {onInstructions === undefined
          ? null
          : (
            <section className={styles.section} data-instructions="">
              <h2 className={styles.heading}>
                {t("settings.heading.instructions")}
              </h2>
              <p className={styles.text}>{t("settings.instructions.intro")}</p>
              <div className={styles.actions}>
                <InstructionsButton onOpen={onInstructions} />
              </div>
            </section>
          )}
        <section className={styles.section} data-values="">
          <h2 className={styles.heading}>{t("settings.heading.values")}</h2>
          <ul className={styles.rows}>
            {(loaded.state === "ready" ? loaded.rows : []).map((row) => (
              <SettingItem key={row.key} row={row} />
            ))}
          </ul>
        </section>
      </div>
    </Loading>
  );
}

function SettingItem({ row }: { row: SettingRow }) {
  return (
    <li
      className={styles.row}
      data-setting={row.key}
      data-changed={row.changed}
    >
      <span className={styles.rowText}>
        <span className={styles.subheading}>{row.title}</span>
        <details className={styles.details}>
          <summary>{t("settings.label.details")}</summary>
          <dl>
            <dt>{t("settings.label.applies")}</dt>
            <dd>{applyText(row.applyAt)}</dd>
            <dt>{t("settings.label.default")}</dt>
            <dd>
              {row.hasDefault
                ? valueText(row.defaultValue, true)
                : t("settings.label.value-no-default")}
            </dd>
            <dt>{t("settings.label.source")}</dt>
            <dd>
              {row.changed
                ? t("settings.label.source-you")
                : t("settings.label.source-default")}
            </dd>
          </dl>
        </details>
      </span>
      <span className={styles.value} data-value="">
        {valueText(row.value, row.resolved)}
      </span>
    </li>
  );
}
