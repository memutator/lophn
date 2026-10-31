// 앱 place 오른쪽 sidebar의 본문. title bar의 panel icon tab이 고른 panel 하나(App / Domain / Logs)를 `RightSidebar` 틀에 담는다.
// App은 옛 App details(Icon, Folders, Version·Access·Activity)이고 머리 줄에 Annotate 단추가 있다. Domain은 그 앱의 domain,
// Logs는 이 앱의 run 기록(tool run과 이 앱 place에서 돈 agent run)이다.
import { t } from "@lophn/i18n";
import { IconButton } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";

import { AppDetail } from "../../app-frame/app-detail/app-detail.tsx";
import { DomainsSection } from "../../app-frame/app-detail/domains-section.tsx";
import type { AppDetailSource } from "../../app-frame/app-detail/source.ts";
import { editorIcons, shellIcons } from "../../icons/mod.ts";
import { PanelEmpty } from "../../shell/panel-rows.tsx";
import type { PanelTab } from "../../shell/panel-tabs.tsx";
import { PanelActions, RightSidebar } from "../../shell/right-sidebar.tsx";
import type { PanelSession } from "./panel-types.ts";
import { RunList, type RunRow } from "./run-list.tsx";

export type AppPlaceTab = "app" | "domain" | "logs";

/** title bar의 panel icon tab. */
export function appPanelTabs(): readonly PanelTab[] {
  return [
    {
      key: "app",
      label: t("app-space.heading.panel-app"),
      icon: shellIcons.app,
    },
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
  /** 사람이 지은 앱 이름. 읽기 전에는 빈 글. */
  name: string;
  /** 없으면 App·Domain panel은 준비 전 안내다. */
  detail: AppDetailSource | undefined;
  runs: readonly RunRow[];
  /** 앱 화면이 열려 있고 Annotate 통로가 있을 때만 있다. */
  annotate?: { readonly on: boolean; readonly onToggle: () => void };
  /** 호출 기록의 agent session을 연다. */
  onOpenSession: (session: string) => void;
  onRunSession: (session: PanelSession) => void;
}

export function AppPlacePanel(props: AppPlacePanelProps) {
  const { tab, app, name, detail } = props;
  const title = appPanelTabs().find((item) => item.key === tab)?.label ?? "";
  return (
    <RightSidebar title={title} panel={tab}>
      {tab === "app" ? (
        <>
          {props.annotate === undefined ? null : (
            <PanelActions>
              <Tooltip content={t("app-space.button.annotate")}>
                <IconButton
                  size="sm"
                  icon={editorIcons.edit}
                  label={t("app-space.button.annotate")}
                  aria-pressed={props.annotate.on}
                  data-app-bar="annotate"
                  onClick={props.annotate.onToggle}
                />
              </Tooltip>
            </PanelActions>
          )}
          {detail === undefined ? (
            <PanelEmpty>{t("common.empty.not-ready")}</PanelEmpty>
          ) : (
            <AppDetail
              app={app}
              name={name}
              source={detail}
              onOpenSession={props.onOpenSession}
            />
          )}
        </>
      ) : null}
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
