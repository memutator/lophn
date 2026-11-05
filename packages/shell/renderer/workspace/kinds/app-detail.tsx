// app detail 탭 kind. 앱 workspace의 앱 상세(Icon, Folders, Version·Access·Activity)이고 앱 workspace에 하나다.
// 앱은 workspace가 정하고 값은 core에 있어 탭은 열려 있다는 사실만 저장한다.
import { t } from "@lophn/i18n";

import { AppDetail } from "../../app-frame/app-detail/app-detail.tsx";
import { runToastAction } from "../../desktop/connection/toasts/toast-actions.ts";
import { commonIcons } from "../../icons/mod.ts";
import { PaddedTab } from "../padded-tab.tsx";
import type { TabHost } from "./host.ts";
import type { TabKindDef } from "./kind.ts";

// 고정 key라 다시 열면 열려 있는 탭을 고른다(openTab은 같은 key면 고르기만 한다).
const APP_DETAIL_KEY = "app-detail";

/** App details 탭을 연다. 이미 열려 있으면 고르기만 한다. */
export function openAppDetail(host: TabHost): void {
  if (host.workspace.kind !== "app") return;
  host.openTab({
    key: APP_DETAIL_KEY,
    kind: "app_detail",
    title: t("project-workspace.label.kind-app-detail"),
  });
}

export const appDetailKind: TabKindDef = {
  kind: "app_detail",
  labelKey: "project-workspace.label.kind-app-detail",
  icon: commonIcons.settings,
  // 앱 workspace 창은 detached 창을 갖지 않는다.
  noDetach: true,
  fromStored: (_stored, { key }) => ({
    key,
    kind: "app_detail",
    title: t("project-workspace.label.kind-app-detail"),
  }),
  toStored: (tab) =>
    tab.key === APP_DETAIL_KEY ? { kind: "app_detail", key: tab.key } : null,
  render(_tab, _active, host) {
    const source = host.props.appDetail;
    if (host.workspace.kind !== "app" || source === undefined) return null;
    return (
      <PaddedTab bare>
        <AppDetail
          app={host.workspace.id}
          name={host.appName ?? ""}
          source={source}
          onOpenSession={(session) =>
            runToastAction({ kind: "session", session })
          }
        />
      </PaddedTab>
    );
  },
};
