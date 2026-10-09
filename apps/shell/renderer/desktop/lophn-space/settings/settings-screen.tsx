// lophn 공간 settings 화면. backup·연결(계정 포함)·도구와 skill·일반·update·진단·notification
// 자리다. 화면 하나에 주 행동 하나라서 자리마다 탭으로 나눈다. secret 값은 이 화면이 받지 않고
// 보호 창이 받는다.
import { Button, Tab, TabList, TabPanel, Tabs } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { BackupPanel } from "./backup/backup-panel.tsx";
import type { BackupSource } from "./backup/source.ts";
import { CodingConnectionsPanel } from "./connections/connections-panel.tsx";
import type { CodingConnectionsSource } from "./connections/source.ts";
import { DiagnosticsPanel } from "./diagnostics/diagnostics-panel.tsx";
import type { DiagnosticsSource } from "./diagnostics/source.ts";
import { ExtensionsPanel } from "./extensions/extensions-panel.tsx";
import { GeneralPanel } from "./general/general-panel.tsx";
import { NotificationsPanel } from "./notifications/notifications-panel.tsx";
import type { NotificationsSource } from "./notifications/source.ts";
import { ProvidersPanel } from "./providers/providers-panel.tsx";
import { UpdatePanel } from "./update/update-panel.tsx";
import type { UpdateSource } from "./update/source.ts";
import type { SettingsSource } from "./source.ts";
import styles from "./settings.module.css";

/** settings의 운영 탭 통로 묶음(shell#T58). 제품 조립이 entry에서 만든다. */
export type SettingsPanels = Pick<
  SettingsScreenProps,
  "backup" | "update" | "diagnostics" | "notifications"
>;

export interface SettingsScreenProps {
  source: SettingsSource;
  /** 전역 [Instructions] 편집기를 연다(shell/editor#R17). 없으면 단추를 두지 않는다. */
  onInstructions?: () => void;
  /** 대화 도크를 연다. 설정의 뜻을 lophn에게 묻는다(flow ask-lophn-help). */
  onAsk?: () => void;
  /** coding agent 연결 통로(shell#T50). 없으면 그 탭을 두지 않는다. */
  coding?: CodingConnectionsSource;
  /** `lophn://things-to-confirm/<cac id>` 링크로 온 연결. 있으면 그 탭을 먼저 연다. */
  initialConnection?: string;
  /** backup·복원 자리(shell#T58). 없으면 그 탭을 두지 않는다. */
  backup?: BackupSource;
  /** update 자리(shell#T58). 없으면 그 탭을 두지 않는다. */
  update?: UpdateSource;
  /** 진단 자리(shell#T58). 없으면 그 탭을 두지 않는다. */
  diagnostics?: DiagnosticsSource;
  /** OS notification 자리(shell#T58). 없으면 그 탭을 두지 않는다. */
  notifications?: NotificationsSource;
}

export function SettingsScreen(
  {
    source,
    onInstructions,
    onAsk,
    coding,
    initialConnection,
    backup,
    update,
    diagnostics,
    notifications,
  }: SettingsScreenProps,
) {
  return (
    <section className={styles.screen} data-screen-body="settings">
      <div className={styles.page}>
        <div className={styles.head}>
          <p className={styles.text}>{t("settings.intro.screen")}</p>
          {onAsk === undefined ? null : (
            <Button
              size="sm"
              variant="secondary"
              data-action="ask-lophn"
              onClick={onAsk}
            >
              {t("settings.button.ask-lophn")}
            </Button>
          )}
        </div>
        <Tabs
          defaultValue={coding && initialConnection ? "coding" : "connections"}
        >
          <TabList>
            {backup === undefined
              ? null
              : <Tab value="backup">{t("settings.label.tab-backup")}</Tab>}
            <Tab value="connections">{t("settings.label.tab-connections")}</Tab>
            {coding === undefined
              ? null
              : <Tab value="coding">{t("settings.label.tab-coding")}</Tab>}
            <Tab value="extensions">{t("settings.label.tab-extensions")}</Tab>
            <Tab value="general">{t("settings.label.tab-general")}</Tab>
            {update === undefined
              ? null
              : <Tab value="update">{t("settings.label.tab-update")}</Tab>}
            {diagnostics === undefined ? null : (
              <Tab value="diagnostics">
                {t("settings.label.tab-diagnostics")}
              </Tab>
            )}
            {notifications === undefined ? null : (
              <Tab value="notifications">
                {t("settings.label.tab-notifications")}
              </Tab>
            )}
          </TabList>
          {backup === undefined ? null : (
            <TabPanel value="backup">
              <div className={styles.panel}>
                <BackupPanel source={backup} />
              </div>
            </TabPanel>
          )}
          <TabPanel value="connections">
            <div className={styles.panel}>
              <ProvidersPanel source={source} />
            </div>
          </TabPanel>
          {coding === undefined ? null : (
            <TabPanel value="coding">
              <div className={styles.panel}>
                <CodingConnectionsPanel
                  source={coding}
                  focus={initialConnection}
                />
              </div>
            </TabPanel>
          )}
          <TabPanel value="extensions">
            <div className={styles.panel}>
              <ExtensionsPanel source={source} />
            </div>
          </TabPanel>
          <TabPanel value="general">
            <div className={styles.panel}>
              <GeneralPanel source={source} onInstructions={onInstructions} />
            </div>
          </TabPanel>
          {update === undefined ? null : (
            <TabPanel value="update">
              <div className={styles.panel}>
                <UpdatePanel source={update} />
              </div>
            </TabPanel>
          )}
          {diagnostics === undefined ? null : (
            <TabPanel value="diagnostics">
              <div className={styles.panel}>
                <DiagnosticsPanel source={diagnostics} />
              </div>
            </TabPanel>
          )}
          {notifications === undefined ? null : (
            <TabPanel value="notifications">
              <div className={styles.panel}>
                <NotificationsPanel source={notifications} />
              </div>
            </TabPanel>
          )}
        </Tabs>
      </div>
    </section>
  );
}
