// app_preview 탭 kind. 그 앱의 지금 preview를 보인다. 앱마다 탭 하나이고 layout에 저장하지 않는다: preview process는 core와
// 같이 죽는다. 연 길은 둘이다. 사람이 앱 화면 탭의 [Preview]로 연 탭은 key가 `app-preview:<app>`이고 core의 탭 표에 없어
// agent가 다루지 못한다. agent나 `lophn preview start`가 연 탭은 key가 `host:<tab id>`다.
import { workspaceIcons } from "../../icons/mod.ts";
import { t } from "@lophn/i18n";

import { AppTabIcon } from "../../app-frame/app-icon.tsx";
import { AppPreviewTab } from "../app-preview-tab.tsx";
import type { TabItem } from "../model.ts";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

export const appPreviewKey = (app: string) => `app-preview:${app}`;

/** agent가 `--device`로 연 탭은 그 기기 이름을 `fields.device`로 갖고 시작한다. 저장하지 않는 탭이라 시작값일 뿐이다. */
export const appPreviewTab = (
  app: string,
  key = appPreviewKey(app),
  device: string | null = null,
): TabItem => ({
  key,
  kind: "app_preview",
  title: t("app-space.title.preview-tab"),
  app,
  ...(device === null ? {} : { fields: { device } }),
});

/** 사람이 누른 [Preview]. 그 앱의 preview 탭이 이미 열려 있으면 그 탭을 고른다. */
export function openAppPreview(host: TabHost, app: string): void {
  const open = host
    .windowTabs()
    .find((tab) => tab.kind === "app_preview" && tab.app === app);
  host.openTab(open ?? appPreviewTab(app));
}

export const appPreviewKind: TabKindDef = {
  kind: "app_preview",
  labelKey: "app-space.label.kind-app-preview",
  icon: workspaceIcons.appPanel,
  iconOf: (tab) => <AppTabIcon app={tab.app} />,
  noDetach: true,
  noReopen: true,
  fromStored: () => null,
  toStored: () => null,
  hasAppView: (tab) => tab.app !== undefined,
  // 고르지 않아도 칸에 남아 view를 숨긴 채 둔다. 닫으면 빠져 view가 폐기된다.
  keep(tab, shown, host) {
    if (tab.app === undefined) return null;
    return (
      <AppPreviewTab
        app={tab.app}
        tabKey={tab.key}
        source={host.props.apps}
        shown={shown}
        agentView={host.agentView}
        initialDevice={
          typeof tab.fields?.device === "string" ? tab.fields.device : null
        }
      />
    );
  },
};
