// Settings › Quick launch › Tray. `tray` 자리를 가진 앱 화면마다 줄 하나와 Switch. 켠 것이 tray 항목이 된다(전역 값).
// 줄의 모양은 SidebarPanelList(workspace/project-settings/quick-launch-editor.tsx)와 같다.
import { t } from "@lophn/i18n";
import { Skeleton } from "@lophn/ui/feedback";
import { Switch } from "@lophn/ui/input";

import { AppTabIcon } from "../../../app-frame/app-icon.tsx";
import type { AppScreens } from "../../../app-frame/app-views.tsx";
import styles from "../../../workspace/project-settings/quick-launch-editor.module.css";
import type { SidebarPanelPick } from "./source.ts";

export function TrayList({
  apps,
  loading,
  failed,
  picks,
  onPicks,
}: {
  apps: readonly AppScreens[];
  loading: boolean;
  failed: boolean;
  picks: readonly SidebarPanelPick[];
  onPicks: (next: readonly SidebarPanelPick[]) => void;
}) {
  const choices = apps.flatMap((app) =>
    app.screens
      .filter((screen) => screen.places.includes("tray"))
      .map((screen) => ({
        app: app.app,
        screen: screen.key,
        label: t("app-panel.label.screen", {
          app: app.name,
          screen: screen.label,
        }),
      })),
  );
  if (loading) return <Skeleton lines={3} />;
  if (failed) {
    return (
      <p className={styles.note}>{t("project-settings.notice.apps-failed")}</p>
    );
  }
  if (choices.length === 0) {
    return <p className={styles.note}>{t("settings.note.quick-no-tray")}</p>;
  }
  const same = (a: SidebarPanelPick, b: SidebarPanelPick) =>
    a.app === b.app && a.screen === b.screen;
  return (
    <ul className={styles.rows} data-tray-rows="">
      {choices.map((choice) => {
        const pick = { app: choice.app, screen: choice.screen };
        return (
          <li
            key={`${choice.app}:${choice.screen}`}
            className={styles.row}
            data-tray-row={choice.app}
          >
            <span className={styles.rowName}>
              <AppTabIcon app={choice.app} />
              <span className={styles.rowLabel}>{choice.label}</span>
            </span>
            <span className={styles.toggle}>
              <Switch
                size="sm"
                label={t("settings.label.quick-tray-show", {
                  name: choice.label,
                })}
                checked={picks.some((item) => same(item, pick))}
                onCheckedChange={(on) =>
                  onPicks(
                    on
                      ? [...picks, pick]
                      : picks.filter((item) => !same(item, pick)),
                  )
                }
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
