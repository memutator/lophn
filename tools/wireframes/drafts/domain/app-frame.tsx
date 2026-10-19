// 앱 공간 틀. 실제 AppBar·AgentSelect·SidePanel·TabStrip과 앱 view 자리의 고정 그림(OrdersView)을 쓴다. 진짜 AppSpace는
// 위쪽 바와 App details 안을 밖에서 바꿀 수 없어서 같은 부품을 다시 놓는다. 고르면 renderer가 AppSpace 안에서 같은 자리에 놓는다.
import { type ReactNode, useMemo } from "react";
import { Tab, TabList, TabPanel, Tabs } from "@lophn/ui/navigation";
import { t } from "@lophn/wording";

import { AppBar } from "../../../../packages/shell/renderer/app-frame/app-bar.tsx";
import {
  AgentSelect,
  type AppSpaceAgent,
} from "../../../../packages/shell/renderer/app-frame/agent-select.tsx";
import { SidePanel } from "../../../../packages/shell/renderer/app-frame/side-panel.tsx";
import { VersionsTab } from "../../../../packages/shell/renderer/app-frame/app-detail/versions/versions-tab.tsx";
import { fakeDetail } from "../../../../packages/shell/renderer/app-frame/app-detail/testdata/fake-source.ts";
import { createEventClient } from "../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { EventsProvider } from "../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import { createFakeWaiting } from "../../../../packages/shell/renderer/desktop/connection/waiting/fake-source.ts";
import { TabStrip } from "../../../../packages/shell/renderer/parts/tab-strip/tab-strip.tsx";
import detail from "../../../../packages/shell/renderer/app-frame/app-detail/app-detail.module.css";
import sidePanel from "../../../../packages/shell/renderer/app-frame/side-panel.module.css";
import { AGENTS, APP_NAME } from "../../mock/domain/data.ts";
import { OrdersView } from "../../mock/app-space/orders-view.tsx";
import styles from "./domain.module.css";

const APP = "app_01h455vb4pex5v6nkc6gd5fd01";
const noop = () => {};

const SELECT_AGENTS: readonly AppSpaceAgent[] = AGENTS.map((agent) => ({
  assignment: agent.id,
  role: agent.role === "project_manager" ? "app_engineer" : agent.role,
  name: agent.name,
  profile: { kind: "icon", icon: agent.icon },
}));

/** App details 탭 본문. 실제 AppDetail과 같은 순서(이름, 탭 줄)에 Domains 절을 이름 아래에 끼운다. */
export function DetailsWithDomains({ domains }: { domains: ReactNode }) {
  const source = useMemo(() => fakeDetail().source, []);
  return (
    <div className={detail.root}>
      <div className={detail.top}>
        <h3 className={detail.name}>{APP_NAME}</h3>
      </div>
      {domains}
      <Tabs defaultValue="version">
        <TabList>
          <Tab value="version" size="sm">
            {t("app-detail.label.tab-version")}
          </Tab>
          <Tab value="access" size="sm">{t("app-detail.label.tab-access")}</Tab>
          <Tab value="activity" size="sm">
            {t("app-detail.label.tab-activity")}
          </Tab>
          <Tab value="issues" size="sm">{t("app-detail.label.tab-issues")}</Tab>
        </TabList>
        <TabPanel value="version">
          <VersionsTab app={APP} source={source} now={() => new Date()} />
        </TabPanel>
      </Tabs>
    </div>
  );
}

/** 오른쪽 패널의 Manage agents 탭 하나. 안에 agent 편집 화면을 놓는다. */
export function ManagePanel({ children }: { children: ReactNode }) {
  return (
    <aside className={sidePanel.pane} style={{ width: "640px" }}>
      <TabStrip
        tabs={[{ key: "manage", title: t("app-space.button.manage-agents") }]}
        selected="manage"
      />
      <div className={sidePanel.manage}>{children}</div>
    </aside>
  );
}

/** 앱 공간. agentExtra는 agent select 앞에 놓이고, details가 있으면 오른쪽 패널에 App details 탭을 연다. */
export function DraftAppSpace(
  { agentExtra, details, aside }: {
    agentExtra?: ReactNode;
    details?: ReactNode;
    aside?: ReactNode;
  },
) {
  const events = useMemo(() => createEventClient(createFakeWaiting([])), []);
  return (
    <EventsProvider client={events}>
      <div className={styles.appRoot} data-space="app">
        <AppBar
          name={APP_NAME}
          status="running"
          onLauncher={noop}
          detailsOpen={details !== undefined}
          onDetails={noop}
          agentSelect={
            <>
              {agentExtra}
              <AgentSelect
                agents={SELECT_AGENTS}
                paneOpen={false}
                onOpenAgent={noop}
                onManage={noop}
              />
            </>
          }
        />
        <div className={styles.appBody}>
          <div className={styles.appView}>
            <OrdersView />
          </div>
          {details === undefined ? aside : (
            <SidePanel
              tabs={["details"]}
              tab="details"
              onTab={noop}
              onCloseTab={noop}
              placement="docked"
              details={details}
              state={null}
              app={APP}
              appName=""
              agents={SELECT_AGENTS}
              opened={false}
              onOpenedClose={noop}
              onState={noop}
              onChanged={noop}
            />
          )}
        </div>
      </div>
    </EventsProvider>
  );
}
