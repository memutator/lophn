// Settings › Browser의 Links 구역. web link와 local link를 열 곳(Browser tab | System browser)을 고른다.
// 고르면 바로 저장하고, 저장하지 못하면 앞의 값으로 돌아간다.
import { useEffect, useState } from "react";
import { Select } from "@lophn/ui/input";
import { t } from "@lophn/i18n";

import { NamedControl } from "../general/named-control.tsx";
import styles from "../settings.module.css";
import { LINK_ROWS } from "./model.ts";
import type { BrowserSettingsSource, LinkId, LinkValues } from "./source.ts";

type Loaded = LinkValues | "failed" | null;

export function LinkRows({ source }: { source: BrowserSettingsSource }) {
  const [loaded, setLoaded] = useState<Loaded>(null);
  const [notSaved, setNotSaved] = useState(false);

  useEffect(() => {
    void source
      .links()
      .then((read) => setLoaded(read.ok ? read.value : "failed"));
  }, [source]);

  async function choose(
    values: LinkValues,
    id: LinkId,
    value: LinkValues[LinkId],
  ): Promise<void> {
    setNotSaved(false);
    setLoaded({ ...values, [id]: value });
    const saved = await source.chooseLink(id, value);
    if (saved.ok) return;
    setLoaded(values);
    setNotSaved(true);
  }

  if (loaded === null) return null;
  if (loaded === "failed") {
    return (
      <p className={styles.notice} data-links="failed">
        {t("settings.error.links-load-failed")}
      </p>
    );
  }
  const values = loaded;
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
