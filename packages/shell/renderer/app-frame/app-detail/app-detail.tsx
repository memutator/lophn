// app-detail(ui-ux 5절): 한 앱의 version·access·automation·연결·활동·데이터를 보고 결정한다.
// 운영 패널(`ops-panel-frame.tsx`)의 본문이다. 탭마다 필요한 것만 기본으로 보이고 안쪽 이름·원문은
// 자세히 보기에 둔다. 결정은 confirmation window에서만 받는다. Issues·Tasks 탭 자리는 T53·T50이
// 채운다.
import type { ReactNode } from "react";
import { Tab, TabList, TabPanel, Tabs } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { InstructionsButton } from "../../editor/instructions-entry.tsx";
import { ActivityTab } from "./activity/activity-tab.tsx";
import { AccessTab } from "./access/access-tab.tsx";
import { AutomationsTab } from "./automations/automations-tab.tsx";
import { ConnectionsTab } from "./connections/connections-tab.tsx";
import { DataTab } from "./data/data-tab.tsx";
import type { PreviewOpen } from "./model.ts";
import type { AppDetailSource } from "./source.ts";
import { VersionsTab } from "./versions/versions-tab.tsx";
import styles from "./app-detail.module.css";

export interface AppDetailProps {
  app: string;
  /** 사람이 지은 앱 이름. */
  name: string;
  source: AppDetailSource;
  /** 앱 공간에 열려 있는 preview. */
  preview: PreviewOpen | null;
  onPreview(next: PreviewOpen | null): void;
  /** app 층 [Instructions]. 없으면 단추를 두지 않는다. */
  onInstructions?: () => void;
  /** Issues·Tasks 탭 내용. 없으면 아직 없다고 보인다. */
  issues?: ReactNode;
  tasks?: ReactNode;
  /** 처음 열 탭. 접수된 문제로 올 때는 issues, 맡길 일의 링크로 올 때는 tasks다. */
  initialTab?: "issues" | "tasks";
  now?: () => Date;
}

const systemNow = () => new Date();

export function AppDetail(
  {
    app,
    name,
    source,
    preview,
    onPreview,
    onInstructions,
    issues,
    tasks,
    initialTab,
    now = systemNow,
  }: AppDetailProps,
) {
  return (
    <div className={styles.root} data-app-detail={app}>
      <div className={styles.top}>
        <h3 className={styles.name} data-app-detail-name="">{name}</h3>
        {onInstructions ? <InstructionsButton onOpen={onInstructions} /> : null}
      </div>
      <Tabs defaultValue={initialTab ?? "version"}>
        <TabList>
          <Tab value="version" size="sm">
            {t("app-detail.label.tab-version")}
          </Tab>
          <Tab value="access" size="sm">
            {t("app-detail.label.tab-access")}
          </Tab>
          <Tab value="automations" size="sm">
            {t("app-detail.label.tab-automations")}
          </Tab>
          <Tab value="connections" size="sm">
            {t("app-detail.label.tab-connections")}
          </Tab>
          <Tab value="activity" size="sm">
            {t("app-detail.label.tab-activity")}
          </Tab>
          <Tab value="data" size="sm">{t("app-detail.label.tab-data")}</Tab>
          <Tab value="issues" size="sm">
            {t("app-detail.label.tab-issues")}
          </Tab>
          <Tab value="tasks" size="sm">{t("app-detail.label.tab-tasks")}</Tab>
        </TabList>
        <TabPanel value="version">
          <VersionsTab
            app={app}
            source={source}
            now={now}
            preview={preview}
            onPreview={onPreview}
          />
        </TabPanel>
        <TabPanel value="access">
          <AccessTab app={app} source={source} now={now} />
        </TabPanel>
        <TabPanel value="automations">
          <AutomationsTab app={app} source={source} now={now} />
        </TabPanel>
        <TabPanel value="connections">
          <ConnectionsTab app={app} source={source} now={now} />
        </TabPanel>
        <TabPanel value="activity">
          <ActivityTab app={app} source={source} now={now} />
        </TabPanel>
        <TabPanel value="data">
          <DataTab app={app} source={source} now={now} />
        </TabPanel>
        <TabPanel value="issues">
          {issues ?? (
            <p className={styles.state} data-slot-empty="issues">
              {t("app-detail.note.issues-unavailable")}
            </p>
          )}
        </TabPanel>
        <TabPanel value="tasks">
          {tasks ?? (
            <p className={styles.state} data-slot-empty="tasks">
              {t("app-detail.note.tasks-unavailable")}
            </p>
          )}
        </TabPanel>
      </Tabs>
    </div>
  );
}
