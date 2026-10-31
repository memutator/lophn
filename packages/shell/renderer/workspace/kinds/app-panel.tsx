// app_panel 탭 kind. 앱이 선언한 panel 화면 하나를 탭에 연다.
import { workspaceIcons } from "../../icons/mod.ts";
import { t } from "@lophn/i18n";

import { AppTabIcon } from "../../app-frame/app-icon.tsx";
import { AppPanelPicker, AppPanelTab } from "../app-panel-tab.tsx";
import type { RailApp } from "../model.ts";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

const TAB_KEY = /^[A-Za-z0-9._:-]+$/;
const APP_ID = /^app_[0-7][0-9a-hjkmnp-tv-z]{25}$/;

let appPanelCount = 0;

const newKey = () => `app-panel-${Date.now().toString(36)}-${++appPanelCount}`;

/** 사람이 누른 앱 패널 열기. 탭은 앱을 고르는 자리로 시작한다. */
export function openAppPanel(host: TabHost): void {
  host.openTab({
    key: newKey(),
    kind: "app_panel",
    title: t("project-workspace.label.kind-app-panel"),
  });
}

/**
 * activity bar에 고정한 앱 패널 열기. 같은 앱·화면 탭이 이 창 어디에 있든(자리, 접힘, 떠 있음, 떼어 낸 창) 그 탭으로 가고,
 * 없으면 고르는 단계 없이 focus 칸에 새로 연다.
 */
export function openPinnedAppPanel(host: TabHost, pin: RailApp): void {
  const existing = host
    .windowTabs()
    .find(
      (tab) =>
        tab.kind === "app_panel" &&
        tab.app === pin.app &&
        tab.screen === pin.surface,
    );
  host.openTab(
    existing ?? {
      key: newKey(),
      kind: "app_panel",
      title: pin.title ?? t("project-workspace.label.kind-app-panel"),
      app: pin.app,
      screen: pin.surface,
    },
  );
}

export const appPanelKind: TabKindDef = {
  kind: "app_panel",
  labelKey: "project-workspace.label.kind-app-panel",
  icon: workspaceIcons.appPanel,
  // 앱이 선언한 icon이 있으면 그것이다. 저장하지 않고 그릴 때 읽는다.
  iconOf: (tab) => <AppTabIcon app={tab.app} />,
  fromStored(stored, { key }) {
    const { app, surface, title } = stored;
    if (
      typeof app !== "string" ||
      !APP_ID.test(app) ||
      typeof surface !== "string" ||
      surface.length < 1
    )
      return null;
    return {
      key,
      kind: "app_panel",
      title: typeof title === "string" ? title : "",
      app,
      screen: surface,
    };
  },
  toStored(tab) {
    if (
      tab.app === undefined ||
      !APP_ID.test(tab.app) ||
      tab.screen === undefined ||
      tab.screen.length < 1 ||
      tab.screen.length > 128 ||
      !TAB_KEY.test(tab.key)
    )
      return null;
    return {
      kind: "app_panel",
      key: tab.key,
      ...(tab.title.length > 0 ? { title: tab.title.slice(0, 200) } : {}),
      app: tab.app,
      surface: tab.screen,
    };
  },
  railApp: (tab) =>
    tab.app === undefined || tab.screen === undefined
      ? null
      : {
          app: tab.app,
          surface: tab.screen,
          ...(tab.title.length > 0 ? { title: tab.title } : {}),
        },
  hasAppView: (tab) => tab.app !== undefined && tab.screen !== undefined,
  // 앱 패널은 고르지 않아도 칸에 남아 view를 숨긴 채 둔다. 닫으면 빠져 view가 폐기된다.
  keep(tab, shown, host) {
    const onOpenApp = host.props.onOpenApp;
    if (tab.app === undefined || tab.screen === undefined) {
      return (
        <AppPanelPicker
          onChoose={(choice) =>
            host.patchTab(tab.key, {
              app: choice.app,
              screen: choice.screen,
              title: choice.title,
            })
          }
          onOpenAppSpace={onOpenApp}
          onClose={() => host.removeTab(tab.key)}
        />
      );
    }
    return (
      <AppPanelTab
        app={tab.app}
        screen={tab.screen}
        shown={shown}
        keepKey={tab.key}
        onOpenAppSpace={onOpenApp}
      />
    );
  },
};
