// Settings 화면. 항목 목록은 Settings 공간 sidebar(묶음별로 모든 항목 줄, `SETTINGS_GROUPS`)에 있고, 이 화면은
// 고른 항목(`pane`)의 본문 하나만 가운데 기둥에 그린다. 둘째 목차 열은 없다. secret 값은 이 화면이 받지
// 않고 보호 창이 받는다.
import { useMemo, useRef } from "react";
import { t } from "@lophn/i18n";

import { AppearancePanel } from "./appearance/appearance-panel.tsx";
import type { AppearanceSource } from "./appearance/source.ts";
import { BrowserPanel } from "./browser/browser-panel.tsx";
import type { BrowserSettingsSource } from "./browser/source.ts";
import { AgentsPanel } from "./agents/agents-panel.tsx";
import type { AgentsSettingsSource } from "./agents/settings-source.ts";
import { CodingConnectionsPanel } from "./connections/connections-panel.tsx";
import type { CodingConnectionsSource } from "./connections/source.ts";
import { DiagnosticsPanel } from "./diagnostics/diagnostics-panel.tsx";
import type { DiagnosticsSource } from "./diagnostics/source.ts";
import { ExtensionsPanel } from "./extensions/extensions-panel.tsx";
import { GeneralPanel } from "./general/general-panel.tsx";
import { KeyboardPanel } from "./keyboard/keyboard-panel.tsx";
import type { KeyboardSource } from "./keyboard/source.ts";
import type { SettingsPane } from "./model.ts";
import { ProviderList } from "./providers/provider-list.tsx";
import { QuickLaunchPanel } from "./quick-launch/quick-launch-panel.tsx";
import type { ProviderSettingsSource } from "./providers/settings-source.ts";
import { ShellRulesPanel } from "./shell-rules/shell-rules-panel.tsx";
import type { ShellRulesSource } from "./shell-rules/source.ts";
import type { SettingsSource } from "./source.ts";
import styles from "./settings.module.css";

/** settings 항목마다의 통로 묶음. 제품 조립이 entry에서 만든다. */
export type SettingsPanels = Pick<
  SettingsScreenProps,
  | "providers"
  | "agents"
  | "diagnostics"
  | "shellRules"
  | "coding"
  | "appearance"
  | "browser"
  | "keyboard"
>;

interface SettingsScreenProps {
  /** 고른 항목. sidebar가 고르고 이 화면은 그 항목의 본문 하나만 그린다. */
  pane: SettingsPane;
  /** 이 화면 안에서 다른 항목으로 가는 길(Agents의 [Add server], 필수 설정 안내의 [Choose in Agents]). */
  onPane: (pane: SettingsPane) => void;
  /** General과 Tools and skills가 읽고 쓰는 통로. */
  source: SettingsSource;
  /** Providers 항목. 없으면 준비 전 안내다. */
  providers?: ProviderSettingsSource;
  /** Agents 항목. 없으면 준비 전 안내다. */
  agents?: AgentsSettingsSource;
  /** Coding agents 항목. 없으면 준비 전 안내다. */
  coding?: CodingConnectionsSource;
  /** Diagnostics 항목. 없으면 준비 전 안내다. */
  diagnostics?: DiagnosticsSource;
  /** Shell rules 항목. 없으면 준비 전 안내다. */
  shellRules?: ShellRulesSource;
  /** Appearance 항목. 없으면 준비 전 안내다. */
  appearance?: AppearanceSource;
  /** Browser 항목. 없으면 준비 전 안내다. */
  browser?: BrowserSettingsSource;
  /** Keyboard 항목. 없으면 준비 전 안내다. */
  keyboard?: KeyboardSource;
}

// 표를 보이는 항목은 기둥을 더 넓게 쓴다.
const WIDE: ReadonlySet<SettingsPane> = new Set(["coding", "diagnostics"]);

export function SettingsScreen({
  pane,
  onPane,
  source,
  providers,
  agents,
  coding,
  diagnostics,
  shellRules,
  appearance,
  browser,
  keyboard,
}: SettingsScreenProps) {
  // Agents의 [Add server]는 server form을 가진 Tools and skills 항목으로 옮긴다(form을 두 벌 두지 않는다).
  // 통로가 바뀌어도 Agents를 다시 읽지 않는다.
  const toPane = useRef(onPane);
  toPane.current = onPane;
  const agentsSource = useMemo<AgentsSettingsSource | undefined>(
    () =>
      agents === undefined
        ? undefined
        : {
            ...agents,
            addServer: () => {
              toPane.current("tools");
              return Promise.resolve({ ok: true, value: null });
            },
          },
    [agents],
  );

  const body = bodyOf();
  return (
    <section
      className={styles.screen}
      data-screen-body="settings"
      data-settings-pane={pane}
    >
      <div className={`${styles.column} ${WIDE.has(pane) ? styles.wide : ""}`}>
        {body ?? (
          <p className={styles.notReady}>{t("common.empty.not-ready")}</p>
        )}
      </div>
    </section>
  );

  function bodyOf() {
    switch (pane) {
      case "general":
        return <GeneralPanel source={source} onPane={onPane} />;
      case "appearance":
        return appearance && <AppearancePanel source={appearance} />;
      case "browser":
        return (
          browser && (
            <div className={styles.panel}>
              <BrowserPanel source={browser} />
            </div>
          )
        );
      case "keyboard":
        return keyboard && <KeyboardPanel source={keyboard} />;
      case "quick-launch":
        return <QuickLaunchPanel />;
      case "providers":
        return (
          providers && (
            <div className={styles.panel}>
              <ProviderList source={providers} />
            </div>
          )
        );
      case "agents":
        return (
          agentsSource && (
            <div className={styles.panel}>
              <AgentsPanel source={agentsSource} />
            </div>
          )
        );
      case "tools":
        return (
          agentsSource && (
            <div className={styles.panel}>
              <ExtensionsPanel source={agentsSource} />
            </div>
          )
        );
      case "coding":
        return coding && <CodingConnectionsPanel source={coding} />;
      case "shell-rules":
        return shellRules && <ShellRulesPanel source={shellRules} />;
      case "diagnostics":
        return diagnostics && <DiagnosticsPanel source={diagnostics} />;
    }
  }
}
