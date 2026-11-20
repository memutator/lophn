// app detail 탭 kind. 앱 workspace의 앱 상세(General, Icon, Folders, Version·Access·Activity)이고 앱 workspace에 하나다.
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
  render(tab, _active, host) {
    const source =
      host.machineData(tab.machine ?? host.machine).appDetail ??
      host.props.appDetail;
    if (host.workspace.kind !== "app" || source === undefined) return null;
    return (
      <PaddedTab bare>
        <AppDetail
          app={host.workspace.id}
          name={host.appName ?? ""}
          source={source}
          // 다른 기계의 session은 이 컴퓨터의 toast 길로 열 수 없다. 이름만 보인다.
          onOpenSession={
            source.readOnly === true
              ? undefined
              : (session) => runToastAction({ kind: "session", session })
          }
          onRenamed={host.appRenamed}
          // 보관한 앱의 workspace에는 머물 까닭이 없다.
          onArchived={host.props.onHome}
        />
      </PaddedTab>
    );
  },
};
