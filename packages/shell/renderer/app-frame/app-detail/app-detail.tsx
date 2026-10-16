// app-detail(ui-ux 5절): 한 앱의 Version·Access·Activity·Issues를 보고 이전 release로 돌아가기,
// 바깥 자원 거두기, 앱 data rewind를 한다. 운영 패널(`ops-panel-frame.tsx`)의 본문이다. 사람은
// release를 고르거나 쓰기 시작하지 않는다. 결정은 확인 창 없이 이 탭에서 바로 한다.
import type { ReactNode } from "react";
import { Tab, TabList, TabPanel, Tabs } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { InstructionsButton } from "../../editor/instructions-entry.tsx";
import { AccessTab } from "./access/access-tab.tsx";
import { ActivityTab } from "./activity/activity-tab.tsx";
import type { AppDetailSource } from "./source.ts";
import { VersionsTab } from "./versions/versions-tab.tsx";
import styles from "./app-detail.module.css";

interface AppDetailProps {
  app: string;
  /** 사람이 지은 앱 이름. */
  name: string;
  source: AppDetailSource;
  /** app 층 [Instructions]. 없으면 단추를 두지 않는다. */
  onInstructions?: () => void;
  /** 호출 기록의 agent session을 연다. 없으면 session 이름만 보인다. */
  onOpenSession?: (session: string) => void;
  /** Issues 탭 내용. 없으면 아직 없다고 보인다. */
  issues?: ReactNode;
  /** 처음 열 탭. 접수된 문제로 올 때는 issues다. */
  initialTab?: "issues";
  now?: () => Date;
}

const systemNow = () => new Date();

export function AppDetail(
  {
    app,
    name,
    source,
    onInstructions,
    onOpenSession,
    issues,
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
          <Tab value="activity" size="sm">
            {t("app-detail.label.tab-activity")}
          </Tab>
          <Tab value="issues" size="sm">
            {t("app-detail.label.tab-issues")}
          </Tab>
        </TabList>
        <TabPanel value="version">
          <VersionsTab app={app} source={source} now={now} />
        </TabPanel>
        <TabPanel value="access">
          <AccessTab app={app} source={source} now={now} />
        </TabPanel>
        <TabPanel value="activity">
          <ActivityTab
            app={app}
            name={name}
            source={source}
            now={now}
            onOpenSession={onOpenSession}
          />
        </TabPanel>
        <TabPanel value="issues">
          {issues ?? (
            <p className={styles.state} data-slot-empty="issues">
              {t("app-detail.note.issues-unavailable")}
            </p>
          )}
        </TabPanel>
      </Tabs>
    </div>
  );
}
