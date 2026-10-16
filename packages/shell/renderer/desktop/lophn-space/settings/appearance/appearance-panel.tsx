// Settings › Appearance. 화면 모양을 고른다: theme, 글자 크기, 문서 읽기 폭, 화면 밀도. 줄은 이름과
// 설명이 왼쪽이고 고르는 칸이 오른쪽 끝 고정 열이다. Theme은 고르면 바로 바뀐다.
import { useCallback, useState } from "react";
import {
  ErrorState,
  Loading,
  Select,
  Skeleton,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import { NamedControl } from "../general/named-control.tsx";
import { useReload } from "../use-reload.ts";
import styles from "../settings.module.css";
import { APPEARANCE_ROWS, applyTheme } from "./model.ts";
import type { AppearanceSource, AppearanceValues } from "./source.ts";

interface AppearancePanelProps {
  source: AppearanceSource;
}

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly values: AppearanceValues };

export function AppearancePanel({ source }: AppearancePanelProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    void source.values().then((read) => {
      if (read.ok) applyTheme(read.value.theme);
      setLoaded(
        read.ok ? { state: "ready", values: read.value } : { state: "failed" },
      );
    });
  }, [source]);
  useReload(source, load);

  async function choose(
    values: AppearanceValues,
    id: keyof AppearanceValues,
    value: string,
  ): Promise<void> {
    setFailed(false);
    setLoaded({ state: "ready", values: { ...values, [id]: value } });
    if (id === "theme") applyTheme(value);
    const saved = await source.choose(id, value);
    if (saved.ok) return;
    // 저장하지 못했으면 앞의 값으로 돌아간다.
    setLoaded({ state: "ready", values });
    if (id === "theme") applyTheme(values.theme);
    setFailed(true);
  }

  if (loaded.state === "failed") {
    return (
      <ErrorState
        target={t("settings.label.appearance-target")}
        onRetry={() => {
          setLoaded({ state: "loading" });
          load();
        }}
      />
    );
  }
  const values = loaded.state === "ready" ? loaded.values : null;
  return (
    <div data-appearance="">
      <h1 className={styles.paneTitle}>{t("settings.label.tab-appearance")}</h1>
      <p className={styles.lead}>{t("settings.intro.appearance")}</p>
      <Loading
        loading={values === null}
        placeholder={<Skeleton lines={4} />}
      >
        <ul className={styles.lines}>
          {values === null ? null : APPEARANCE_ROWS.map((row) => (
            <li
              key={row.id}
              className={styles.line}
              data-appearance-row={row.id}
            >
              <NamedControl name={t(row.name)} labelClass={styles.lineName}>
                {({ label, provide }) => (
                  <>
                    <div className={styles.lineMain}>
                      {label}
                      <span className={styles.lineHelp}>{t(row.help)}</span>
                    </div>
                    <div className={styles.lineControl}>
                      {provide(
                        <Select
                          options={row.options.map((option) => ({
                            value: option.value,
                            label: t(option.label),
                          }))}
                          value={values[row.id]}
                          onValueChange={(value) =>
                            void choose(values, row.id, value)}
                        />,
                      )}
                    </div>
                  </>
                )}
              </NamedControl>
            </li>
          ))}
        </ul>
        {failed
          ? (
            <p className={styles.rejected} role="alert" data-failed="">
              {t("settings.error.value-not-saved")}
            </p>
          )
          : null}
      </Loading>
    </div>
  );
}
