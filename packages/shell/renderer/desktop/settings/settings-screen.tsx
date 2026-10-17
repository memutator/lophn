// Settings 화면. 항목 목록은 sidebar의 Settings 아래에 있고(`SETTINGS_GROUPS`), 이 화면은
// 고른 항목(`pane`)의 본문 하나만 가운데 기둥에 그린다. 둘째 목차 열은 없다. secret 값은 이 화면이 받지
// 않고 보호 창이 받는다.
import { useMemo, useRef } from "react";
import { t } from "@lophn/wording";

import { AppearancePanel } from "./appearance/appearance-panel.tsx";
import type { AppearanceSource } from "./appearance/source.ts";
import { AgentsPanel } from "./agents/agents-panel.tsx";
import type { AgentsSettingsSource } from "./agents/settings-source.ts";
import { CodingConnectionsPanel } from "./connections/connections-panel.tsx";
import type { CodingConnectionsSource } from "./connections/source.ts";
import { DiagnosticsPanel } from "./diagnostics/diagnostics-panel.tsx";
import type { DiagnosticsSource } from "./diagnostics/source.ts";
import { ExtensionsPanel } from "./extensions/extensions-panel.tsx";
import { GeneralPanel } from "./general/general-panel.tsx";
import type { SettingsPane } from "./model.ts";
import { ProviderList } from "./providers/provider-list.tsx";
import type { ProviderSettingsSource } from "./providers/settings-source.ts";
import { ReactionsPanel } from "./reactions/reactions-panel.tsx";
import type { ReactionsSource } from "./reactions/source.ts";
import type { SettingsSource } from "./source.ts";
import styles from "./settings.module.css";

/** settings 항목마다의 통로 묶음. 제품 조립이 entry에서 만든다. */
export type SettingsPanels = Pick<
  SettingsScreenProps,
  | "providers"
  | "agents"
  | "diagnostics"
  | "reactions"
  | "coding"
  | "appearance"
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
  /** 모든 project의 LOPHN.md 편집기(전역 지침)를 연다. Agents의 [Edit]이 쓴다. */
  onInstructions?: () => void;
  /** Coding agents 항목. 없으면 준비 전 안내다. */
  coding?: CodingConnectionsSource;
  /** Diagnostics 항목. 없으면 준비 전 안내다. */
  diagnostics?: DiagnosticsSource;
  /** Reactions 항목. 없으면 준비 전 안내다. */
  reactions?: ReactionsSource;
  /** Appearance 항목. 없으면 준비 전 안내다. */
  appearance?: AppearanceSource;
}

// 표를 보이는 항목은 기둥을 더 넓게 쓴다.
const WIDE: ReadonlySet<SettingsPane> = new Set(["coding", "diagnostics"]);

export function SettingsScreen(
  {
    pane,
    onPane,
    source,
    providers,
    agents,
    onInstructions,
    coding,
    diagnostics,
    reactions,
    appearance,
  }: SettingsScreenProps,
) {
  // Agents의 [Add server]는 server form을 가진 Tools and skills 항목으로 옮긴다(form을 두 벌 두지 않는다).
  // Agents의 [Edit]은 전역 지침 편집기를 여는 shell 통로로 간다. 통로가 바뀌어도 Agents를 다시 읽지 않는다.
  const instructions = useRef(onInstructions);
  instructions.current = onInstructions;
  const toPane = useRef(onPane);
  toPane.current = onPane;
  const agentsSource = useMemo<AgentsSettingsSource | undefined>(
    () =>
      agents === undefined ? undefined : {
        ...agents,
        addServer: () => {
          toPane.current("tools");
          return Promise.resolve({ ok: true, value: null });
        },
        openInstructions: () => {
          const open = instructions.current;
          if (open === undefined) {
            return Promise.resolve({ ok: false, code: "unavailable" });
          }
          open();
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
          <p className={styles.notReady}>
            {t("common.empty.not-ready")}
          </p>
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
      case "providers":
        return providers && (
          <div className={styles.panel}>
            <ProviderList source={providers} />
          </div>
        );
      case "agents":
        return agentsSource && (
          <div className={styles.panel}>
            <AgentsPanel source={agentsSource} />
          </div>
        );
      case "tools":
        return agentsSource && (
          <div className={styles.panel}>
            <ExtensionsPanel source={agentsSource} />
          </div>
        );
      case "coding":
        return coding && <CodingConnectionsPanel source={coding} />;
      case "reactions":
        return reactions && <ReactionsPanel source={reactions} />;
      case "diagnostics":
        return diagnostics && <DiagnosticsPanel source={diagnostics} />;
    }
  }
}
