// lophn 공간 settings 화면. 연결(계정 포함)·도구와 skill·일반 세 자리다. 화면 하나에 주 행동 하나라서
// 자리마다 탭으로 나눈다. secret 값은 이 화면이 받지 않고 보호 창이 받는다.
import { Button, Tab, TabList, TabPanel, Tabs } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { ExtensionsPanel } from "./extensions/extensions-panel.tsx";
import { GeneralPanel } from "./general/general-panel.tsx";
import { ProvidersPanel } from "./providers/providers-panel.tsx";
import type { SettingsSource } from "./source.ts";
import styles from "./settings.module.css";

export interface SettingsScreenProps {
  source: SettingsSource;
  /** 전역 [Instructions] 편집기를 연다(shell/editor#R17). 없으면 단추를 두지 않는다. */
  onInstructions?: () => void;
  /** 대화 도크를 연다. 설정의 뜻을 lophn에게 묻는다(flow ask-lophn-help). */
  onAsk?: () => void;
}

export function SettingsScreen(
  { source, onInstructions, onAsk }: SettingsScreenProps,
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
        <Tabs defaultValue="connections">
          <TabList>
            <Tab value="connections">{t("settings.label.tab-connections")}</Tab>
            <Tab value="extensions">{t("settings.label.tab-extensions")}</Tab>
            <Tab value="general">{t("settings.label.tab-general")}</Tab>
          </TabList>
          <TabPanel value="connections">
            <div className={styles.panel}>
              <ProvidersPanel source={source} />
            </div>
          </TabPanel>
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
        </Tabs>
      </div>
    </section>
  );
}
