// Settings › Browser의 "Other computers" 줄. browser profile과 저장 login(값 포함)을 명단의 다른 컴퓨터와 맞출지 고르는
// 이 컴퓨터의 설정 하나다. 바꾸면 바로 저장하고, 저장하지 못하면 앞의 값으로 돌아간다.
import { useEffect, useMemo, useState } from "react";
import { Switch } from "@lophn/ui/input";
import { t } from "@lophn/i18n";

import { settingsList } from "../../../../../protocol/config/file.ts";
import { BROWSER_SHARE_SETTING } from "../../../../../protocol/secrets/browser-vault.ts";
import { useCoreRead } from "../../connection/core-read.ts";
import { useMachinesView } from "../../machines/context.tsx";
import { effectiveOf } from "../declared.ts";
import styles from "../settings.module.css";
import type { BrowserSettingsSource } from "./source.ts";

/** 이 컴퓨터가 다른 컴퓨터와 profile과 login을 나누는가. 못 읽었으면 null이다. */
export function useSharing(): boolean | null {
  const { loaded } = useCoreRead(settingsList, {
    keys: [BROWSER_SHARE_SETTING],
  });
  return useMemo(
    () =>
      loaded.state === "ready"
        ? effectiveOf(loaded.value).get(BROWSER_SHARE_SETTING) !== false
        : null,
    [loaded],
  );
}

/**
 * 지우기가 다른 컴퓨터에서도 지워지는가: 이 컴퓨터가 나누고 명단에 다른 컴퓨터가 하나라도 있다. 기계 목록을 모르면(기계 보기가
 * 없는 화면) 없는 것으로 본다.
 */
export function useDeletesSpread(): boolean {
  const sharing = useSharing();
  const others = useMachinesView()?.machines.some(
    (one) => one.status !== "removed",
  );
  return sharing === true && others === true;
}

export function ShareRow({ source }: { source: BrowserSettingsSource }) {
  const read = useSharing();
  const [picked, setPicked] = useState<boolean | null>(null);
  useEffect(() => setPicked(null), [read]);
  const [notSaved, setNotSaved] = useState(false);

  async function choose(on: boolean): Promise<void> {
    setNotSaved(false);
    setPicked(on);
    const saved = await source.chooseShare(on);
    if (saved.ok) return;
    setPicked(null);
    setNotSaved(true);
  }

  if (read === null) return null;
  const on = picked ?? read;
  return (
    <>
      <ul className={styles.lines}>
        <li className={styles.line} data-browser-share={on ? "on" : "off"}>
          <div className={styles.lineMain}>
            <span className={styles.lineName}>
              {t("settings.label.browser-share")}
            </span>
            <span className={styles.lineHelp}>
              {t("settings.note.browser-share")}
            </span>
          </div>
          <div className={styles.endSlot}>
            <Switch
              label={t(
                on ? "settings.label.value-on" : "settings.label.value-off",
              )}
              checked={on}
              onCheckedChange={(next) => void choose(next)}
            />
          </div>
        </li>
      </ul>
      {notSaved ? (
        <p className={styles.rejected} role="alert">
          {t("settings.error.browser-share-failed")}
        </p>
      ) : null}
    </>
  );
}
