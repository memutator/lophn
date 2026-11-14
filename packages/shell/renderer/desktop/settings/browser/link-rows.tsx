// Settings › Browser의 Links 구역. web link와 local link를 열 곳(Browser tab | System browser)을 고른다.
// 고르면 바로 저장하고, 저장하지 못하면 앞의 값으로 돌아간다.
import { useEffect, useMemo, useState } from "react";
import { Select } from "@lophn/ui/input";
import { t } from "@lophn/i18n";

import { settingsList } from "../../../../../protocol/config/file.ts";
import { useCoreRead } from "../../connection/core-read.ts";
import { effectiveOf } from "../declared.ts";
import { NamedControl } from "../general/named-control.tsx";
import styles from "../settings.module.css";
import { LINK_ROWS } from "./model.ts";
import type { BrowserSettingsSource, LinkId, LinkValues } from "./source.ts";
import { linkValuesOf } from "./window-source.ts";

const LINK_KEYS = LINK_ROWS.map((row) => row.settingKey);

export function LinkRows({ source }: { source: BrowserSettingsSource }) {
  const { loaded } = useCoreRead(settingsList, { keys: LINK_KEYS });
  const read = useMemo(
    () =>
      loaded.state === "ready" ? linkValuesOf(effectiveOf(loaded.value)) : null,
    [loaded],
  );
  // 고른 값은 저장이 끝나기 전에도 보인다. 다음에 읽은 값에는 저장한 것이 들어 있다.
  const [picked, setPicked] = useState<LinkValues | null>(null);
  useEffect(() => setPicked(null), [read]);
  const [notSaved, setNotSaved] = useState(false);

  async function choose(
    values: LinkValues,
    id: LinkId,
    value: LinkValues[LinkId],
  ): Promise<void> {
    setNotSaved(false);
    setPicked({ ...values, [id]: value });
    const saved = await source.chooseLink(id, value);
    if (saved.ok) return;
    setPicked(null);
    setNotSaved(true);
  }

  if (loaded.state === "loading") return null;
  if (loaded.state === "failed") {
    return (
      <p className={styles.notice} data-links="failed">
        {t("settings.error.links-load-failed")}
      </p>
    );
  }
  const values = picked ?? read!;
  return (
    <>
      <ul className={styles.lines} data-links="ok">
        {LINK_ROWS.map((row) => (
          <li key={row.id} className={styles.line} data-link-row={row.id}>
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
                          void choose(
                            values,
                            row.id,
                            value as LinkValues[LinkId],
                          )
                        }
                      />,
                    )}
                  </div>
                </>
              )}
            </NamedControl>
          </li>
        ))}
      </ul>
      {notSaved ? (
        <p className={styles.rejected} role="alert" data-failed="">
          {t("settings.error.value-not-saved")}
        </p>
      ) : null}
    </>
  );
}
