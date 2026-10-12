// settings의 일반 자리. 설정 값을 보인다. model 기본값과 모든 project의 지침은 Agents 자리가 맡고
// 여기에는 없다.
// 설정 값은 정의(이름)·현재 적용값을 기본으로 보이고 효력 시점·기본값·바뀐 출처는 펼친 곳에 둔다
// (ui-ux G2). 값을 지어내지 않는다: 정해지지 않은 값은 정해지지 않았다고 말한다.
import { useCallback, useState } from "react";
import { ErrorState, Loading, Skeleton } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { applyText, generalRows, valueText } from "../model.ts";
import type { SettingRow, SettingsSource } from "../source.ts";
import { useReload } from "../use-reload.ts";
import styles from "../settings.module.css";

export interface GeneralPanelProps {
  source: SettingsSource;
}

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly rows: readonly SettingRow[] };

export function GeneralPanel({ source }: GeneralPanelProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });

  const load = useCallback(() => {
    void source.settings().then((settings) => {
      setLoaded(
        settings.ok
          ? { state: "ready", rows: generalRows(settings.value.rows) }
          : { state: "failed" },
      );
    });
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
