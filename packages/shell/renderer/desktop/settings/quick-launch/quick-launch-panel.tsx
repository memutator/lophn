// Settings › Quick launch. 왼쪽 sidebar 아래 빠른 실행의 전역 값이다: 단추 순서, 고정할 앱 panel, 앱 panel 화면마다
// 여는 자리(Tab·Float). 자기 값을 둔 project는 Project settings의 값을 쓴다. 마지막 float 자리는 사람이 옮길 때 기억한다.
import { t } from "@lophn/i18n";

import {
  AppPanelList,
  QuickOrderList,
  useAppPanelApps,
} from "../../../workspace/project-settings/quick-launch-editor.tsx";
import styles from "../settings.module.css";
import { useQuickPrefs } from "./store.tsx";

export function QuickLaunchPanel() {
  const { prefs, set } = useQuickPrefs();
  const { apps, loading, failed } = useAppPanelApps();
  return (
    <div data-quick-launch="">
      <h1 className={styles.paneTitle}>
        {t("settings.label.tab-quick-launch")}
      </h1>
      <p className={styles.lead}>{t("settings.intro.quick-launch")}</p>
      <section>
        <h2 className={styles.groupTitle}>
          {t("settings.heading.quick-buttons")}
        </h2>
        <QuickOrderList
          quick={prefs.quick}
          onQuick={(next) => set("quick", next)}
          apps={apps}
        />
      </section>
      <section className={styles.groupBlock}>
        <h2 className={styles.groupTitle}>
          {t("settings.heading.quick-app-panels")}
        </h2>
        <p className={styles.lineHelp}>{t("settings.note.quick-app-panels")}</p>
        <AppPanelList
          apps={apps}
          loading={loading}
          failed={failed}
          quick={prefs.quick}
          onQuick={(next) => set("quick", next)}
          launch={prefs.launch}
          onLaunch={(key, next) =>
            set("launch", { ...prefs.launch, [key]: next })
          }
        />
      </section>
    </div>
  );
}
