// Settings › Appearance. 화면 모양을 고른다: theme, accent, 배경, 글꼴, 글자 크기, 문서 읽기 폭, 화면 밀도.
// 줄은 이름과 설명이 왼쪽이고 고르는 칸이 오른쪽 끝 고정 열이다. 고르면 바로 모든 문서에 적용된다.
import { useCallback, useId, useState } from "react";
import { FieldContext, Input, Select, SwatchPicker } from "@lophn/ui/input";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { isFontName } from "@lophn/ui";
import { t } from "@lophn/wording";

import { NamedControl } from "../general/named-control.tsx";
import { useReload } from "../use-reload.ts";
import styles from "../settings.module.css";
import { APPEARANCE_ROWS, applyAppearance } from "./model.ts";
import type {
  AppearanceId,
  AppearanceSource,
  AppearanceValues,
} from "./source.ts";

interface AppearancePanelProps {
  source: AppearanceSource;
}

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly values: AppearanceValues };

/** Custom 글꼴 이름 칸. 칸을 떠나거나 Enter를 누르면 저장하고, 글꼴 이름이 아닌 글자가 있으면 저장하지 않는다. */
function CustomFontName({
  value,
  onCommit,
}: {
  readonly value: string;
  readonly onCommit: (name: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  function commit() {
    const name = draft.trim();
    if (name === value) {
      setInvalid(false);
      return;
    }
    if (name !== "" && !isFontName(name)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onCommit(name);
  }
  return (
    <>
      <FieldContext.Provider value={{ id, invalid }}>
        <Input
          aria-label={t("settings.label.font-custom-name")}
          placeholder={t("settings.label.font-custom-name")}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
          }}
        />
      </FieldContext.Provider>
      {invalid ? (
        <p className={styles.rejected} role="alert" data-invalid="">
          {t("settings.error.font-name")}
        </p>
      ) : null}
    </>
  );
}

export function AppearancePanel({ source }: AppearancePanelProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    void source.values().then((read) => {
      if (read.ok) applyAppearance(read.value);
      setLoaded(
        read.ok ? { state: "ready", values: read.value } : { state: "failed" },
      );
    });
  }, [source]);
  useReload(source, load);

  async function choose(
    values: AppearanceValues,
    id: AppearanceId,
    value: string,
  ): Promise<void> {
    setFailed(false);
    setLoaded({ state: "ready", values: { ...values, [id]: value } });
    applyAppearance({ ...values, [id]: value });
    const saved = await source.choose(id, value);
    if (saved.ok) return;
    // 저장하지 못했으면 앞의 값으로 돌아간다.
    setLoaded({ state: "ready", values });
    applyAppearance(values);
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
      <Loading loading={values === null} placeholder={<Skeleton lines={4} />}>
        <ul className={styles.lines}>
          {values === null
            ? null
            : APPEARANCE_ROWS.map((row) => (
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
                            row.control === "swatch" ? (
                              <SwatchPicker
                                label={t(row.name)}
                                options={row.options.map((option) => ({
                                  value: option.value,
                                  label: t(option.label),
                                  swatch: option.swatch ?? "",
                                }))}
                                value={values[row.id]}
                                onValueChange={(value) =>
                                  void choose(values, row.id, value)
                                }
                              />
                            ) : (
                              <Select
                                options={row.options.map((option) => ({
                                  value: option.value,
                                  label: t(option.label),
                                }))}
                                value={values[row.id]}
                                onValueChange={(value) =>
                                  void choose(values, row.id, value)
                                }
                              />
                            ),
                          )}
                          {row.customId !== undefined &&
                          values[row.id] === "custom" ? (
                            <CustomFontName
                              key={values[row.customId]}
                              value={values[row.customId]}
                              onCommit={(name) =>
                                void choose(values, row.customId!, name)
                              }
                            />
                          ) : null}
                        </div>
                      </>
                    )}
                  </NamedControl>
                </li>
              ))}
        </ul>
        {failed ? (
          <p className={styles.rejected} role="alert" data-failed="">
            {t("settings.error.value-not-saved")}
          </p>
        ) : null}
      </Loading>
    </div>
  );
}
