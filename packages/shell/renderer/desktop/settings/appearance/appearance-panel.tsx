// Settings › Appearance. 화면 모양을 고른다: 모드, 모드별 theme, accent, 글꼴, 글자 크기, 문서 읽기 폭, 화면 밀도.
// 줄은 이름과 설명이 왼쪽이고 고르는 칸이 오른쪽 끝 고정 열이다. 고르면 바로 모든 문서에 적용된다.
// 글꼴 줄은 preset과 설치된 글꼴을 검색해 고르는 칸과, 그 글꼴에 있는 굵기를 고르는 칸이다.
// theme 줄은 내장 theme과 theme file을 고르고, 고른 file의 문제(틀린 값, 대비)를 줄 아래에 보인다.
import { type ReactNode, useCallback, useEffect, useId, useState } from "react";
import {
  FieldContext,
  SearchSelect,
  Select,
  Switch,
  SwatchPicker,
} from "@lophn/ui/input";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { Button } from "@lophn/ui/primitives";
import type { ThemeProblem, Themes } from "@lophn/ui";
import { VisuallyHidden } from "@lophn/ui/shared";
import { type MessageKey, t } from "@lophn/i18n";

import { NamedControl } from "../general/named-control.tsx";
import { useQuickPrefs } from "../quick-launch/store.tsx";
import { useReload } from "../use-reload.ts";
import styles from "../settings.module.css";
import {
  accentSwatch,
  APPEARANCE_ROWS,
  applyAppearance,
  chooseFont,
  fontChoiceOf,
  fontChoices,
  missingFontOf,
  themeChoices,
  themeProblemsOf,
  weightsOf,
} from "./model.ts";
import type {
  AppearanceId,
  AppearanceSource,
  AppearanceValues,
  InstalledFont,
} from "./source.ts";

interface AppearancePanelProps {
  source: AppearanceSource;
}

type Loaded =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly values: AppearanceValues };

/** 굵기 칸. 줄 이름은 글꼴 칸이 가지므로 이 칸의 이름은 보이지 않게 단다. */
function WeightSelect({
  name,
  weights,
  value,
  onChange,
}: {
  readonly name: string;
  readonly weights: readonly string[];
  readonly value: string;
  readonly onChange: (weight: string) => void;
}) {
  const id = useId();
  // 저장된 굵기가 이 글꼴에 없어도 칸이 비지 않게 선택지에 둔다.
  const shown = weights.includes(value) ? weights : [...weights, value].sort();
  return (
    <div className={styles.fontWeight}>
      <VisuallyHidden>
        <label htmlFor={id}>{t("settings.label.font-weight", { name })}</label>
      </VisuallyHidden>
      <FieldContext.Provider value={{ id, invalid: false }}>
        <Select
          options={shown.map((weight) => ({
            value: weight,
            label: t(`settings.label.weight-${weight}` as MessageKey),
          }))}
          value={value}
          onValueChange={onChange}
        />
      </FieldContext.Provider>
    </div>
  );
}

export function AppearancePanel({ source }: AppearancePanelProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: "loading" });
  const [failed, setFailed] = useState(false);
  const { prefs, set: setPrefs } = useQuickPrefs();
  // 설치된 글꼴. 읽기 전에는 null이고, 빈 목록이면 글꼴 칸을 열 때(사람이 누른 때) 다시 읽는다.
  const [fonts, setFonts] = useState<readonly InstalledFont[] | null>(null);
  const loadFonts = useCallback(() => {
    void source.fonts().then(setFonts);
  }, [source]);
  useEffect(loadFonts, [loadFonts]);
  // 고를 수 있는 theme. theme file이 바뀌면 main이 알린다.
  const [themes, setThemes] = useState<Themes | null>(null);
  useEffect(() => {
    const loadThemes = () => void source.themes().then(setThemes);
    loadThemes();
    return source.onThemesChanged(loadThemes);
  }, [source]);

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
    changes: readonly (readonly [AppearanceId, string])[],
  ): Promise<void> {
    setFailed(false);
    const next = { ...values, ...Object.fromEntries(changes) };
    setLoaded({ state: "ready", values: next });
    applyAppearance(next);
    // 글꼴 이름을 먼저, 그 이름을 쓰는 값을 나중에 둔다.
    for (const [id, value] of changes) {
      const saved = await source.choose(id, value);
      if (saved.ok) continue;
      // 저장하지 못했으면 저장된 값을 다시 읽어 그 모양으로 돌아간다.
      setFailed(true);
      load();
      return;
    }
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
                          {row.control === "font" ? (
                            <FontControl
                              name={t(row.name)}
                              row={row}
                              values={values}
                              fonts={fonts}
                              provide={provide}
                              onOpen={() => {
                                if (fonts === null || fonts.length === 0) {
                                  loadFonts();
                                }
                              }}
                              onChoose={(changes) =>
                                void choose(values, changes)
                              }
                            />
                          ) : row.control === "theme" ? (
                            <ThemeControl
                              row={row}
                              values={values}
                              themes={themes}
                              provide={provide}
                              onChoose={(value) =>
                                void choose(values, [[row.id, value]])
                              }
                            />
                          ) : (
                            provide(
                              row.control === "accent" ? (
                                <SwatchPicker
                                  label={t(row.name)}
                                  options={row.options.map((option) => ({
                                    value: option.value,
                                    label: t(option.label),
                                    swatch: accentSwatch(
                                      option.value,
                                      values,
                                      themes,
                                    ),
                                  }))}
                                  custom={{
                                    label: t("settings.label.accent-custom"),
                                  }}
                                  value={values[row.id]}
                                  onValueChange={(value) =>
                                    void choose(values, [[row.id, value]])
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
                                    void choose(values, [[row.id, value]])
                                  }
                                />
                              ),
                            )
                          )}
                        </div>
                      </>
                    )}
                  </NamedControl>
                </li>
              ))}
          {values === null ? null : (
            <li className={styles.line} data-appearance-row="themes-folder">
              <div className={styles.lineMain}>
                <span className={styles.lineName}>
                  {t("settings.label.themes-folder")}
                </span>
                <span className={styles.lineHelp}>
                  {t("settings.appearance.themes-folder-help")}
                </span>
                {themes?.broken.map((broken) => (
                  <span
                    key={broken.id}
                    className={styles.lineHelp}
                    data-theme-broken={broken.id}
                  >
                    {t("settings.appearance.theme-broken", {
                      id: broken.id,
                      reason: t(
                        `settings.reason.theme-${broken.reason}` as MessageKey,
                      ),
                    })}
                  </span>
                ))}
              </div>
              <div className={styles.endSlot}>
                <Button
                  variant="secondary"
                  onClick={() => source.openThemesFolder()}
                >
                  {t("settings.label.open-themes-folder")}
                </Button>
              </div>
            </li>
          )}
          {values === null ? null : (
            <li className={styles.line} data-appearance-row="taskbar">
              <div className={styles.lineMain}>
                <span className={styles.lineName}>
                  {t("settings.label.taskbar")}
                </span>
                <span className={styles.lineHelp}>
                  {t("settings.appearance.taskbar-help")}
                </span>
              </div>
              <div className={styles.endSlot}>
                <Switch
                  label={t(
                    prefs.taskbar
                      ? "settings.label.value-on"
                      : "settings.label.value-off",
                  )}
                  checked={prefs.taskbar}
                  onCheckedChange={(on) => setPrefs("taskbar", on)}
                />
              </div>
            </li>
          )}
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

type AppearanceRow = (typeof APPEARANCE_ROWS)[number];

/** 글꼴 줄의 두 칸: preset과 설치된 글꼴을 검색해 고르는 칸, 그 글꼴의 굵기 칸. */
function FontControl({
  name,
  row,
  values,
  fonts,
  provide,
  onOpen,
  onChoose,
}: {
  readonly name: string;
  readonly row: AppearanceRow;
  readonly values: AppearanceValues;
  readonly fonts: readonly InstalledFont[] | null;
  readonly provide: (control: ReactNode) => ReactNode;
  readonly onOpen: () => void;
  readonly onChoose: (
    changes: readonly (readonly [AppearanceId, string])[],
  ) => void;
}) {
  const choice = fontChoiceOf(row, values);
  const weights = weightsOf(row, choice, fonts);
  const missing = missingFontOf(row, values, fonts);
  return (
    <>
      <div className={styles.fontControl}>
        <div className={styles.fontFamily}>
          {provide(
            <SearchSelect
              label={name}
              options={fontChoices(row, values, fonts).map((option) => ({
                value: option.value,
                label: option.preset
                  ? t(option.label as MessageKey)
                  : option.label,
                ...(option.missing
                  ? { note: t("settings.label.font-not-installed") }
                  : {}),
              }))}
              value={choice}
              onOpenChange={(open) => open && onOpen()}
              onValueChange={(next) =>
                onChoose(chooseFont(row, values, next, fonts))
              }
            />,
          )}
        </div>
        {weights === undefined || row.weightId === undefined ? null : (
          <WeightSelect
            name={name}
            weights={weights}
            value={values[row.weightId]}
            onChange={(weight) => onChoose([[row.weightId!, weight]])}
          />
        )}
      </div>
      {missing === undefined ? null : (
        <p className={styles.lineHelp} data-font-missing="">
          {t("settings.appearance.font-missing", { name: missing })}
        </p>
      )}
    </>
  );
}

// 문제가 많으면 처음 몇 개만 보이고 나머지는 수로 말한다.
const SHOWN_PROBLEMS = 3;

function problemText(problem: ThemeProblem): string {
  switch (problem.kind) {
    case "unknown_path":
      return t("settings.appearance.theme-problem-unknown-path", {
        path: problem.path,
      });
    case "bad_value":
      return t("settings.appearance.theme-problem-bad-value", {
        path: problem.path,
      });
    case "contrast":
      return t("settings.appearance.theme-problem-contrast", {
        foreground: problem.foreground,
        background: problem.background,
        ratio: String(problem.ratio),
        minimum: String(problem.minimum),
      });
  }
}

/** theme 줄: 그 모드의 theme을 고르는 칸과, 고른 file theme의 문제·없는 file 안내. */
function ThemeControl({
  row,
  values,
  themes,
  provide,
  onChoose,
}: {
  readonly row: AppearanceRow;
  readonly values: AppearanceValues;
  readonly themes: Themes | null;
  readonly provide: (control: ReactNode) => ReactNode;
  readonly onChoose: (value: string) => void;
}) {
  const choices = themeChoices(row, values, themes);
  const missing = choices.find(
    (choice) => choice.missing && choice.value === values[row.id],
  );
  const problems = themeProblemsOf(row, values, themes);
  return (
    <>
      {provide(
        <Select
          options={choices.map((choice) => ({
            value: choice.value,
            label: choice.missing
              ? t("settings.label.theme-not-found", { name: choice.name })
              : choice.file
                ? t("settings.label.theme-file", { name: choice.name })
                : choice.name,
          }))}
          value={values[row.id]}
          onValueChange={onChoose}
        />,
      )}
      {missing === undefined ? null : (
        <p className={styles.lineHelp} data-theme-missing="">
          {t("settings.appearance.theme-missing", { name: missing.name })}
        </p>
      )}
      {problems.slice(0, SHOWN_PROBLEMS).map((problem, index) => (
        <p key={index} className={styles.lineHelp} data-theme-problem="">
          {problemText(problem)}
        </p>
      ))}
      {problems.length > SHOWN_PROBLEMS ? (
        <p className={styles.lineHelp}>
          {t("settings.appearance.theme-more", {
            count: String(problems.length - SHOWN_PROBLEMS),
          })}
        </p>
      ) : null}
    </>
  );
}
