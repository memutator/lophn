// app_panel 탭 kind. 앱이 선언한 panel 화면 하나를 탭에 연다.
import { workspaceIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import { AppPanelPicker, AppPanelTab } from "../app-panel-tab.tsx";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

const TAB_KEY = /^[A-Za-z0-9._:-]+$/;
const APP_ID = /^app_[0-7][0-9a-hjkmnp-tv-z]{25}$/;

let appPanelCount = 0;

/** 사람이 누른 앱 패널 열기. 탭은 앱을 고르는 자리로 시작한다. */
export function openAppPanel(host: TabHost): void {
  const key = `app-panel-${Date.now().toString(36)}-${++appPanelCount}`;
  host.openTab({
    key,
    kind: "app_panel",
    title: t("project-workspace.label.kind-app-panel"),
  });
}

export const appPanelKind: TabKindDef = {
  kind: "app_panel",
  labelKey: "project-workspace.label.kind-app-panel",
  icon: workspaceIcons.appPanel,
  fromStored(stored, { key }) {
    const { app, surface } = stored;
    if (
      typeof app !== "string" || !APP_ID.test(app) ||
      typeof surface !== "string" || surface.length < 1
    ) return null;
    return { key, kind: "app_panel", title: "", app, screen: surface };
  },
  toStored(tab) {
    if (
      tab.app === undefined || !APP_ID.test(tab.app) ||
      tab.screen === undefined || tab.screen.length < 1 ||
      tab.screen.length > 128 || !TAB_KEY.test(tab.key)
    ) return null;
    return {
      kind: "app_panel",
      key: tab.key,
      app: tab.app,
      surface: tab.screen,
    };
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
            })}
          onOpenAppSpace={onOpenApp}
          onClose={() => host.removeTab(tab.key)}
        />
      );
    }
    return (
      <AppPanelTab
        project={host.projectId}
        app={tab.app}
        screen={tab.screen}
        shown={shown}
        keepKey={tab.key}
        onOpenAppSpace={onOpenApp}
      />
    );
  },
};
