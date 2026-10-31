// shell draft의 Settings. 같은 shell 안에서 왼쪽 sidebar가 Settings 항목으로 바뀌고, tab 줄에는 Settings tab 하나,
// 오른쪽 sidebar는 없다. 가운데 card의 칸은 renderer의 실제 Settings panel을 fake source로 그린다.
import { type ReactNode, useState } from "react";
import { t } from "@lophn/i18n";
import { Icon, IconButton } from "@lophn/ui/primitives";

import { AgentsPanel } from "../../../../packages/shell/renderer/desktop/settings/agents/agents-panel.tsx";
import { fakeAgents } from "../../../../packages/shell/renderer/desktop/settings/agents/testdata/fake-agents.ts";
import { AppearancePanel } from "../../../../packages/shell/renderer/desktop/settings/appearance/appearance-panel.tsx";
import { fakeAppearance } from "../../../../packages/shell/renderer/desktop/settings/appearance/testdata/fake-source.ts";
import { BrowserPanel } from "../../../../packages/shell/renderer/desktop/settings/browser/browser-panel.tsx";
import { fakeBrowserSettings } from "../../../../packages/shell/renderer/desktop/settings/browser/testdata/fake-source.ts";
import { DiagnosticsPanel } from "../../../../packages/shell/renderer/desktop/settings/diagnostics/diagnostics-panel.tsx";
import { fakeDiagnostics } from "../../../../packages/shell/renderer/desktop/settings/diagnostics/testdata/fake-source.ts";
import { GeneralPanel } from "../../../../packages/shell/renderer/desktop/settings/general/general-panel.tsx";
import { KeyboardPanel } from "../../../../packages/shell/renderer/desktop/settings/keyboard/keyboard-panel.tsx";
import { fakeKeyboard } from "../../../../packages/shell/renderer/desktop/settings/keyboard/testdata/fake-source.ts";
import {
  SETTINGS_GROUPS,
  type SettingsPane,
} from "../../../../packages/shell/renderer/desktop/settings/model.ts";
import { ShellRulesPanel } from "../../../../packages/shell/renderer/desktop/settings/shell-rules/shell-rules-panel.tsx";
import { fakeShellRules } from "../../../../packages/shell/renderer/desktop/settings/shell-rules/testdata/fake-source.ts";
import { fakeSettings } from "../../../../packages/shell/renderer/desktop/settings/testdata/fake-settings.ts";
import { Avatar } from "../../../../packages/shell/renderer/parts/avatar/avatar.tsx";
import { shellIcons } from "./icons.ts";
import styles from "./shell.module.css";

const LOPHN = { kind: "character", shape: "square", color: "coral" } as const;

export function SettingsDraft({ pane: initial }: { pane: SettingsPane }) {
  const [pane, setPane] = useState(initial);
  const [sources] = useState(() => ({
    general: fakeSettings().source,
    appearance: fakeAppearance().source,
    browser: fakeBrowserSettings().source,
    keyboard: fakeKeyboard().source,
    agents: fakeAgents().source,
    shellRules: fakeShellRules().source,
    diagnostics: fakeDiagnostics().source,
  }));
  const entry = SETTINGS_GROUPS.flatMap((group) => group.panes).find(
    (item) => item.id === pane,
  );

  const body = (): ReactNode => {
    switch (pane) {
      case "general":
        return <GeneralPanel source={sources.general} onPane={setPane} />;
      case "appearance":
        return <AppearancePanel source={sources.appearance} />;
      case "browser":
        return <BrowserPanel source={sources.browser} />;
      case "keyboard":
        return <KeyboardPanel source={sources.keyboard} />;
      case "agents":
        return <AgentsPanel source={sources.agents} />;
      case "shell-rules":
        return <ShellRulesPanel source={sources.shellRules} />;
      case "diagnostics":
        return <DiagnosticsPanel source={sources.diagnostics} />;
      default:
        return (
          <p className={styles.settingsMissing}>
            이 draft는 이 항목의 panel을 그리지 않았다.
          </p>
        );
    }
  };

  return (
    <div className={styles.shell} data-left="open" data-right="closed">
      <header className={styles.titlebar}>
        <div className={styles.titleLeft}>
          <IconButton
            icon={shellIcons.leftPanel}
            label="Toggle left sidebar"
            size="sm"
          />
          <span className={styles.brand}>
            <Avatar profile={LOPHN} size="sm" />
            lophn
          </span>
          <span className={styles.grow} />
        </div>

        <div className={styles.tabStrip} role="tablist">
          <div className={styles.tab} role="tab" aria-selected data-active="">
            <span className={styles.flareStart} aria-hidden />
            <span className={styles.tabHalf}>
              <Icon icon={shellIcons.settings} pixels={14} />
              <span className={styles.tabTitle}>Settings</span>
            </span>
            <button
              type="button"
              className={styles.tabClose}
              aria-label="Close Settings"
            >
              <Icon icon={shellIcons.close} pixels={12} />
            </button>
            <span className={styles.flareEnd} aria-hidden />
          </div>
          <span className={styles.drag} />
        </div>

        <div className={styles.titleRight}>
          <span className={styles.windowControls}>
            <IconButton icon={shellIcons.minimize} label="Minimize" size="sm" />
            <IconButton icon={shellIcons.maximize} label="Maximize" size="sm" />
            <IconButton icon={shellIcons.close} label="Close" size="sm" />
          </span>
        </div>
      </header>

      <div className={styles.body}>
        <nav className={styles.left}>
          <button type="button" className={styles.navRow}>
            <Icon icon={shellIcons.back} pixels={16} />
            <span className={styles.rowLabel}>Back to phroner</span>
          </button>
          <div className={styles.placeList}>
            {SETTINGS_GROUPS.map((group) => (
              <div key={group.id} className={styles.navGroup}>
                <div className={styles.sectionHead}>
                  <span>{t(group.label)}</span>
                </div>
                {group.panes.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={styles.navRow}
                    aria-current={item.id === pane || undefined}
                    onClick={() => setPane(item.id)}
                  >
                    <Icon icon={item.icon} pixels={16} />
                    <span className={styles.rowLabel}>{t(item.label)}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </nav>

        <main className={styles.stage}>
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <span className={styles.crumbs}>
                <span className={styles.crumb}>Settings</span>
                <span className={styles.crumb}>
                  <span className={styles.crumbSep}>/</span>
                  {entry === undefined ? "" : t(entry.label)}
                </span>
              </span>
            </div>
            <div className={styles.cardBody}>
              <div className={styles.settingsColumn}>{body()}</div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
