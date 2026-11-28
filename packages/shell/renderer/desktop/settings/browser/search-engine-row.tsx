// Settings › Browser의 Search engine 구역. 주소 칸에 검색어를 적었을 때 쓸 검색 엔진을 고른다.
// preset은 고르면 바로 저장하고, Custom은 `%s`를 담은 http(s) URL template을 입력해 저장한다.
import { useEffect, useMemo, useState } from "react";
import { Input, Select } from "@lophn/ui/input";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";

import { settingsList } from "../../../../../protocol/config/file.ts";
import {
  BROWSER_SEARCH_ENGINE_CUSTOM_SETTING,
  BROWSER_SEARCH_ENGINE_SETTING,
  isValidCustomSearchUrl,
} from "../../../../../protocol/shell/browser-search.ts";
import { useCoreRead } from "../../connection/core-read.ts";
import { effectiveOf } from "../declared.ts";
import { NamedControl } from "../general/named-control.tsx";
import styles from "../settings.module.css";
import { SEARCH_ENGINE_OPTIONS } from "./model.ts";
import type { BrowserSettingsSource, SearchEngineId } from "./source.ts";
import { searchEngineValuesOf } from "./window-source.ts";

const SEARCH_ENGINE_KEYS = [
  BROWSER_SEARCH_ENGINE_SETTING,
  BROWSER_SEARCH_ENGINE_CUSTOM_SETTING,
];

export function SearchEngineRow({ source }: { source: BrowserSettingsSource }) {
  const { loaded } = useCoreRead(settingsList, { keys: SEARCH_ENGINE_KEYS });
  const read = useMemo(
    () =>
      loaded.state === "ready"
        ? searchEngineValuesOf(effectiveOf(loaded.value))
        : null,
    [loaded],
  );
  const [pickedEngine, setPickedEngine] = useState<SearchEngineId | null>(null);
  const [customDraft, setCustomDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPickedEngine(null);
    setCustomDraft(null);
  }, [read]);

  async function chooseEngine(next: SearchEngineId): Promise<void> {
    setError(null);
    setPickedEngine(next);
    // Custom은 저장된 URL이 아직 없으면 먼저 입력 칸을 보여 주고 [Save]로 저장한다.
    if (next === "custom" && !isValidCustomSearchUrl(read?.custom ?? "")) {
      return;
    }
    const saved = await source.chooseSearchEngine(next);
    if (saved.ok) return;
    setPickedEngine(null);
    setError(t("settings.error.value-not-saved"));
  }

  async function saveCustom(draft: string): Promise<void> {
    const trimmed = draft.trim();
    if (!isValidCustomSearchUrl(trimmed)) {
      setError(t("settings.error.search-engine-custom-url"));
      return;
    }
    setError(null);
    setSaving(true);
    const saved = await source.saveCustomSearchEngine(trimmed);
    setSaving(false);
    if (saved.ok) return;
    setError(
      saved.code === "invalid_value"
        ? t("settings.error.search-engine-custom-url")
        : t("settings.error.value-not-saved"),
    );
  }

  if (loaded.state === "loading") return null;
  if (loaded.state === "failed") {
    return (
      <p className={styles.notice} data-search-engine="failed">
        {t("settings.error.search-engine-load-failed")}
      </p>
    );
  }
  const engine = pickedEngine ?? read!.engine;
  const custom = customDraft ?? read!.custom;
  const unchanged = read!.engine === "custom" && custom.trim() === read!.custom;
  return (
    <>
      <ul className={styles.lines} data-search-engine="ok">
        <li className={styles.line} data-search-engine-row="engine">
          <NamedControl
            name={t("settings.label.search-engine")}
            labelClass={styles.lineName}
          >
            {({ label, provide }) => (
              <>
                <div className={styles.lineMain}>
                  {label}
                  <span className={styles.lineHelp}>
                    {t("settings.note.search-engine")}
                  </span>
                </div>
                <div className={styles.lineControl}>
                  {provide(
                    <Select
                      options={SEARCH_ENGINE_OPTIONS.map((option) => ({
                        value: option.value,
                        label: t(option.label),
                      }))}
                      value={engine}
                      onValueChange={(value) =>
                        void chooseEngine(value as SearchEngineId)
                      }
                    />,
                  )}
                </div>
              </>
            )}
          </NamedControl>
        </li>
        {engine === "custom" ? (
          <li className={styles.line} data-search-engine-row="custom">
            <NamedControl
              name={t("settings.label.search-engine-custom-url")}
              labelClass={styles.lineName}
            >
              {({ label, provide }) => (
                <>
                  <div className={styles.lineMain}>
                    {label}
                    <span className={styles.lineHelp}>
                      {t("settings.note.search-engine-custom")}
                    </span>
                  </div>
                  <div className={styles.lineControl}>
                    {provide(
                      <Input
                        type="url"
                        spellCheck={false}
                        autoComplete="off"
                        placeholder={t(
                          "settings.label.search-engine-custom-placeholder",
                        )}
                        value={custom}
                        onChange={(event) => {
                          setError(null);
                          setCustomDraft(event.currentTarget.value);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void saveCustom(custom);
                        }}
                      />,
                    )}
                    <Button
                      variant="secondary"
                      disabled={saving || unchanged}
                      onClick={() => void saveCustom(custom)}
                    >
                      {t("settings.button.search-engine-save")}
                    </Button>
                  </div>
                </>
              )}
            </NamedControl>
          </li>
        ) : null}
      </ul>
      {error === null ? null : (
        <p className={styles.rejected} role="alert" data-failed="">
          {error}
        </p>
      )}
    </>
  );
}
