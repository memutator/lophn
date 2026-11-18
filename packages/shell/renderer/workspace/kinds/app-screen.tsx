// app_screen 탭 kind. 앱 workspace의 앱 화면(현재 release의 entry screen)이다. 앱 workspace마다 하나이고 key는 앱 id로 정해진다.
// 탭의 기계의 앱을 열고(그 기계의 core가 화면을 준다), 이 컴퓨터에 그 앱이 있으면 이 컴퓨터의 것을 연다(`AppOnMachine`).
import { workspaceIcons } from "../../icons/mod.ts";

import { AppTabIcon } from "../../app-frame/app-icon.tsx";
import { AppOnMachine } from "../../app-frame/app-machine.tsx";
import { AppViewsProvider } from "../../app-frame/app-views.tsx";
import { AppScreenTab } from "../app-screen-tab.tsx";
import { openAppPreview } from "./app-preview.tsx";
import type { TabItem } from "../model.ts";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

const APP_ID = /^app_[0-7][0-9a-hjkmnp-tv-z]{25}$/;

export const appScreenKey = (app: string) => `app-screen:${app}`;

/** 앱 workspace의 앱 화면 탭. 앱 이름은 source가 읽은 뒤 채운다. */
export function appScreenTab(app: string, title: string): TabItem {
  return { key: appScreenKey(app), kind: "app_screen", title, app };
}

/** 앱 화면 탭을 연다. 이미 열려 있으면 그 탭을 고른다. */
export function openAppScreen(host: TabHost): void {
  if (host.workspace.kind !== "app") return;
  host.openTab(appScreenTab(host.workspace.id, host.appName ?? ""));
}

export const appScreenKind: TabKindDef = {
  kind: "app_screen",
  labelKey: "app-space.label.kind-app-screen",
  icon: workspaceIcons.appPanel,
  iconOf: (tab, host) => (
    <AppViewsProvider
      value={host.machineData(tab.machine ?? host.machine).appViews}
    >
      <AppTabIcon app={tab.app} />
    </AppViewsProvider>
  ),
  noDetach: true,
  noReopen: true,
  fromStored(stored, { key }) {
    const { app } = stored;
    if (typeof app !== "string" || !APP_ID.test(app)) return null;
    return { key, kind: "app_screen", title: "", app };
  },
  toStored(tab) {
    if (tab.app === undefined || !APP_ID.test(tab.app)) return null;
    return { kind: "app_screen", key: tab.key, app: tab.app };
  },
  hasAppView: (tab) => tab.app !== undefined,
  // 고르지 않아도 칸에 남아 view를 숨긴 채 둔다. 닫으면 빠져 view가 폐기된다.
  keep(tab, shown, host) {
    const app = tab.app;
    if (app === undefined) return null;
    return (
      <AppOnMachine app={app} machine={tab.machine ?? host.machine}>
        {(machine) => (
          <AppScreenTab
            app={app}
            source={host.machineData(machine).apps}
            shown={shown}
            keepKey={tab.key}
            agentView={host.agentView}
            onOpenPreview={() => openAppPreview(host, app)}
          />
        )}
      </AppOnMachine>
    );
  },
};
