// app-detail: 한 앱의 Version·Access·Activity를 보고 이전 release로 돌아가기,
// 바깥 자원 거두기, 앱 data rewind를 한다. 오른쪽 패널(`side-panel.tsx`)의 App details 탭 본문이다. 사람은
// release를 고르거나 쓰기 시작하지 않는다. 결정은 확인 창 없이 이 탭에서 바로 한다.
import { Tab, TabList, TabPanel, Tabs } from "@lophn/ui/navigation";
import { t } from "@lophn/wording";

import { InstructionsButton } from "../../editor/instructions-entry.tsx";
import { AccessTab } from "./access/access-tab.tsx";
import { ActivityTab } from "./activity/activity-tab.tsx";
import { DomainsSection } from "./domains-section.tsx";
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
  /** Domains 줄 menu의 Open DOMAIN.md. 없으면 그 항목은 아무것도 하지 않는다. */
  onOpenDomainDoc?: (domain: string) => void;
  /** 호출 기록의 agent session을 연다. 없으면 session 이름만 보인다. */
  onOpenSession?: (session: string) => void;
  now?: () => Date;
}

const systemNow = () => new Date();

export function AppDetail({
  app,
  name,
  source,
  onInstructions,
  onOpenDomainDoc,
  onOpenSession,
  now = systemNow,
}: AppDetailProps) {
  return (
    <div className={styles.root} data-app-detail={app}>
      <div className={styles.top}>
        <h3 className={styles.name} data-app-detail-name="">
          {name}
        </h3>
        {onInstructions ? <InstructionsButton onOpen={onInstructions} /> : null}
      </div>
      <DomainsSection app={app} source={source} onOpenDoc={onOpenDomainDoc} />
      <Tabs defaultValue="version">
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
      </Tabs>
    </div>
  );
}
