// Settings › Quick launch › Tray. `tray` 자리를 가진 앱 화면마다 줄 하나와 위·아래 단추, Switch. 켜 둔 것이 이 순서로 tray 항목이 된다.
// 기본은 켜짐이고 끈 것만 전역 값에 쌓인다. 순서를 옮기면 지금 보이는 줄 전부의 순서를 쓴다.
// 줄의 모양은 QuickOrderList(workspace/project-settings/quick-launch-editor.tsx)와 같다.
import { t } from "@lophn/i18n";
import { Skeleton } from "@lophn/ui/feedback";
import { Switch } from "@lophn/ui/input";
import { IconButton } from "@lophn/ui/primitives";

import { AppTabIcon } from "../../../app-frame/app-icon.tsx";
import type { AppScreens } from "../../../app-frame/app-views.tsx";
import { actionIcons } from "../../../icons/mod.ts";
import styles from "../../../workspace/project-settings/quick-launch-editor.module.css";
import { byTrayOrder, type SidebarPanelPick } from "./source.ts";

export function TrayList({
  apps,
  loading,
  failed,
  off,
  onOff,
  order,
  onOrder,
}: {
  apps: readonly AppScreens[];
  loading: boolean;
  failed: boolean;
  off: readonly SidebarPanelPick[];
  onOff: (next: readonly SidebarPanelPick[]) => void;
  order: readonly SidebarPanelPick[];
  onOrder: (next: readonly SidebarPanelPick[]) => void;
}) {
  const declared = apps.flatMap((app) =>
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
  const choices = byTrayOrder(declared, order);
  const move = (at: number, delta: -1 | 1) => {
    const next = choices.map(({ app, screen }) => ({ app, screen }));
    const to = at + delta;
    [next[at], next[to]] = [next[to]!, next[at]!];
    onOrder(next);
  };
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
      {choices.map((choice, index) => {
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
            <IconButton
              icon={actionIcons.moveUp}
              label={t("project-settings.button.move-up")}
              size="sm"
              disabled={index === 0}
              onClick={() => move(index, -1)}
            />
            <IconButton
              icon={actionIcons.moveDown}
              label={t("project-settings.button.move-down")}
              size="sm"
              disabled={index === choices.length - 1}
              onClick={() => move(index, 1)}
            />
            <span className={styles.toggle}>
              <Switch
                size="sm"
                label={t("settings.label.quick-tray-show", {
                  name: choice.label,
                })}
                checked={!off.some((item) => same(item, pick))}
                onCheckedChange={(on) =>
                  onOff(
                    on
                      ? off.filter((item) => !same(item, pick))
                      : [...off, pick],
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
