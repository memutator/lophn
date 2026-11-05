// 빠른 실행을 고치는 목록 둘. 단추 순서와 켜고 끄기(QuickOrderList), 고정할 앱 panel(AppPanelList)이다.
// Settings › Quick launch(전역 값)와 Project settings(이 project만의 값)가 같이 쓴다.
import { useRef } from "react";
import { t } from "@lophn/i18n";
import { Skeleton } from "@lophn/ui/feedback";
import { SegmentedControl, Switch } from "@lophn/ui/input";
import { Button, Icon, IconButton } from "@lophn/ui/primitives";

import { AppTabIcon } from "../../app-frame/app-icon.tsx";
import type { AppScreens } from "../../app-frame/app-views.tsx";
import {
  type AppLaunch,
  type AppLaunchMap,
  launchKey,
} from "../../desktop/settings/quick-launch/source.ts";
import {
  actionIcons,
  browserIcons,
  shellIcons,
  workspaceIcons,
} from "../../icons/mod.ts";
import type { WorkspaceQuick } from "../../shell/desk-model.ts";
import { panelChoices, useScreensRead } from "../app-panel-tab.tsx";
import {
  isPinned,
  isQuickHidden,
  moveQuick,
  pinId,
  quickOrder,
  setPinned,
  setQuickHidden,
} from "./quick-launch.ts";
import styles from "./quick-launch-editor.module.css";

const BUILTIN_LABEL = {
  terminal: "left-sidebar.button.quick-terminal",
  browser: "left-sidebar.button.quick-browser",
  app: "left-sidebar.button.quick-app",
  search: "left-sidebar.button.quick-search",
} as const;

const BUILTIN_ICON = {
  terminal: workspaceIcons.terminal,
  browser: browserIcons.globe,
  app: workspaceIcons.appPanel,
  search: shellIcons.search,
} as const;

/** 설치된 앱의 panel 화면 목록. 다시 읽는 동안에도 목록이 비지 않게 마지막으로 읽은 값을 쓴다. */
export function useAppPanelApps(): {
  apps: readonly AppScreens[];
  loading: boolean;
  failed: boolean;
} {
  const { read } = useScreensRead();
  const known = useRef<readonly AppScreens[]>([]);
  if (read?.ok) known.current = read.value;
  const apps = known.current;
  return {
    apps,
    loading: read === null && apps.length === 0,
    failed: read !== null && !read.ok && apps.length === 0,
  };
}

export function QuickOrderList({
  quick,
  onQuick,
  apps,
}: {
  quick: WorkspaceQuick;
  onQuick: (next: WorkspaceQuick) => void;
  apps: readonly AppScreens[];
}) {
  const order = quickOrder(quick);
  const labelOf = (app: string, surface: string) =>
    panelChoices(apps).find(
      (choice) => choice.app === app && choice.screen === surface,
    )?.label ?? t("project-workspace.label.kind-app-panel");
  return (
    <ul className={styles.rows} data-quick-rows="">
      {order.map((id, index) => {
        const builtin =
          id in BUILTIN_LABEL ? (id as keyof typeof BUILTIN_LABEL) : null;
        const pin = quick.apps.find((item) => pinId(item) === id);
        const label =
          builtin !== null
            ? t(BUILTIN_LABEL[builtin])
            : labelOf(pin?.app ?? "", pin?.surface ?? "");
        const hidden = isQuickHidden(quick, id);
        return (
          <li
            key={id}
            className={styles.row}
            data-quick-row={id}
            data-hidden={hidden || undefined}
          >
            <span className={styles.rowName}>
              {builtin === null ? (
                <AppTabIcon app={pin?.app} />
              ) : (
                <Icon icon={BUILTIN_ICON[builtin]} pixels={16} />
              )}
              <span className={styles.rowLabel}>{label}</span>
            </span>
            <IconButton
              icon={actionIcons.moveUp}
              label={t("project-settings.button.move-up")}
              size="sm"
              disabled={index === 0}
              onClick={() => onQuick(moveQuick(quick, id, -1))}
            />
            <IconButton
              icon={actionIcons.moveDown}
              label={t("project-settings.button.move-down")}
              size="sm"
              disabled={index === order.length - 1}
              onClick={() => onQuick(moveQuick(quick, id, 1))}
            />
            {pin === undefined ? null : (
              // 없어진 앱의 고정도 여기서 풀 수 있다.
              <IconButton
                icon={actionIcons.remove}
                label={t("project-settings.button.unpin")}
                size="sm"
                onClick={() => onQuick(setPinned(quick, pin, false))}
              />
            )}
            <span className={styles.toggle}>
              <Switch
                size="sm"
                label={t("settings.label.quick-show", { name: label })}
                checked={!hidden}
                onCheckedChange={(on) =>
                  onQuick(setQuickHidden(quick, id, !on))
                }
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 앱 panel 화면마다 고정 단추. `launch`를 주면 그 줄에 여는 자리(Tab·Float)를 고르는 칸도 둔다(전역 값이라
 * Settings에만 둔다).
 */
export function AppPanelList({
  apps,
  loading,
  failed,
  quick,
  onQuick,
  launch,
  onLaunch,
}: {
  apps: readonly AppScreens[];
  loading: boolean;
  failed: boolean;
  quick: WorkspaceQuick;
  onQuick: (next: WorkspaceQuick) => void;
  launch?: AppLaunchMap;
  onLaunch?: (key: string, next: AppLaunch) => void;
}) {
  const choices = panelChoices(apps);
  if (loading) return <Skeleton lines={3} />;
  if (failed) {
    return (
      <p className={styles.note}>{t("project-settings.notice.apps-failed")}</p>
    );
  }
  if (choices.length === 0) {
    return (
      <p className={styles.note}>
        {t("project-settings.notice.no-app-panels")}
      </p>
    );
  }
  return (
    <ul className={styles.rows} data-app-panel-rows="">
      {choices.map((choice) => {
        const pin = { app: choice.app, surface: choice.screen };
        const on = isPinned(quick, pin);
        const key = launchKey(choice.app, choice.screen);
        const now = launch?.[key];
        return (
          <li key={key} className={styles.row} data-app-panel-row={choice.app}>
            <span className={styles.rowName}>
              <AppTabIcon app={choice.app} />
              <span className={styles.rowLabel}>{choice.label}</span>
            </span>
            {launch === undefined || onLaunch === undefined ? null : (
              <SegmentedControl
                size="sm"
                label={t("settings.label.quick-open-as")}
                options={[
                  { value: "dock", label: t("settings.label.quick-open-tab") },
                  {
                    value: "float",
                    label: t("settings.label.quick-open-float"),
                  },
                ]}
                value={now?.open ?? "dock"}
                onValueChange={(value) =>
                  onLaunch(key, {
                    ...now,
                    open: value === "float" ? "float" : "dock",
                  })
                }
              />
            )}
            <Button
              size="sm"
              onClick={() => onQuick(setPinned(quick, pin, !on))}
            >
              {on
                ? t("project-settings.button.unpin")
                : t("project-settings.button.pin")}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
