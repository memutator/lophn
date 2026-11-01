// 앱 place 오른쪽 sidebar의 본문. title bar의 panel icon tab이 고른 panel 하나(Domain / Logs)를 `RightSidebar` 틀에 담는다.
// Domain은 그 앱의 domain, Logs는 이 앱의 run 기록(tool run과 이 앱 place에서 돈 agent run)이다. 앱 상세는 App details 탭이다.
import { t } from "@lophn/i18n";

import { DomainsSection } from "../../app-frame/app-detail/domains-section.tsx";
import type { AppDetailSource } from "../../app-frame/app-detail/source.ts";
import { shellIcons } from "../../icons/mod.ts";
import { PanelEmpty } from "../../shell/panel-rows.tsx";
import type { PanelTab } from "../../shell/panel-tabs.tsx";
import { RightSidebar } from "../../shell/right-sidebar.tsx";
import type { PanelSession } from "./panel-types.ts";
import { RunList, type RunRow } from "./run-list.tsx";

export type AppPlaceTab = "domain" | "logs";

/** title bar의 panel icon tab. */
export function appPanelTabs(): readonly PanelTab[] {
  return [
    {
      key: "domain",
      label: t("domain.label.sidebar-tab"),
      icon: shellIcons.domain,
    },
    {
      key: "logs",
      label: t("app-space.heading.panel-logs"),
      icon: shellIcons.logs,
    },
  ];
}

interface AppPlacePanelProps {
  tab: AppPlaceTab;
  app: string;
  /** 없으면 Domain panel은 준비 전 안내다. */
  detail: AppDetailSource | undefined;
  runs: readonly RunRow[];
  onRunSession: (session: PanelSession) => void;
}

export function AppPlacePanel(props: AppPlacePanelProps) {
  const { tab, app, detail } = props;
  const title = appPanelTabs().find((item) => item.key === tab)?.label ?? "";
  return (
    <RightSidebar title={title} panel={tab}>
      {tab === "domain" ? (
        detail === undefined ? (
          <PanelEmpty>{t("common.empty.not-ready")}</PanelEmpty>
        ) : (
          <DomainsSection app={app} source={detail} />
        )
      ) : null}
      {tab === "logs" ? (
        props.runs.length === 0 ? (
          <div data-runs-empty="">
            <PanelEmpty>{t("run-list.empty.none")}</PanelEmpty>
          </div>
        ) : (
          <RunList runs={props.runs} onSession={props.onRunSession} />
        )
      ) : null}
    </RightSidebar>
  );
}
