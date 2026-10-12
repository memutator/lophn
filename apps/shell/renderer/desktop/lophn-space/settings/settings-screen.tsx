// lophn 공간 settings 화면. 일반·Providers·Agents·coding agent·도구와 skill·notification·update·진단
// 자리다. 화면 하나에 주 행동 하나라서 왼쪽 세로 nav가 자리를 묶어 고르고, 고른 자리 하나만 가운데
// column에 그린다. nav 순서는 wireframe(Settings)를 따른다: General · Providers · Agents · Coding
// agents · Tools and skills · Notifications · Update · Diagnose. backup 자리는 nav에서 뺐다(backup
// 제거는 후속 작업). secret 값은 이 화면이 받지 않고 보호 창이 받는다.
import { useMemo, useRef, useState } from "react";
import { Icon, iconPixels, settingsIcons } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { AgentsPanel } from "./agents/agents-panel.tsx";
import type { AgentsSettingsSource } from "./agents/settings-source.ts";
import type { BackupSource } from "./backup/source.ts";
import { CodingConnectionsPanel } from "./connections/connections-panel.tsx";
import type { CodingConnectionsSource } from "./connections/source.ts";
import { DiagnosticsPanel } from "./diagnostics/diagnostics-panel.tsx";
import type { DiagnosticsSource } from "./diagnostics/source.ts";
import { ExtensionsPanel } from "./extensions/extensions-panel.tsx";
import { GeneralPanel } from "./general/general-panel.tsx";
import { NotificationsPanel } from "./notifications/notifications-panel.tsx";
import type { NotificationsSource } from "./notifications/source.ts";
import { ProviderList } from "./providers/provider-list.tsx";
import type { ProviderSettingsSource } from "./providers/settings-source.ts";
import { UpdatePanel } from "./update/update-panel.tsx";
import type { UpdateSource } from "./update/source.ts";
import type { SettingsSource } from "./source.ts";
import styles from "./settings.module.css";

/** settings의 운영 탭 통로 묶음(shell#T58). 제품 조립이 entry에서 만든다. */
export type SettingsPanels = Pick<
  SettingsScreenProps,
  "providers" | "agents" | "backup" | "update" | "diagnostics" | "notifications"
>;

export interface SettingsScreenProps {
  /** 일반 설정과 도구·skill 자리가 읽고 쓰는 통로. */
  source: SettingsSource;
  /** Providers 자리(shell/desktop#R49). 없으면 그 자리를 두지 않는다. */
  providers?: ProviderSettingsSource;
  /** Agents 자리(shell/desktop#R50). 없으면 그 자리를 두지 않는다. */
  agents?: AgentsSettingsSource;
  /** 모든 project의 LOPHN.md 편집기(전역 지침)를 연다(shell/editor#R17). Agents의 [Edit]이 쓴다. */
  onInstructions?: () => void;
  /** coding agent 연결 통로(shell#T50). 없으면 그 탭을 두지 않는다. */
  coding?: CodingConnectionsSource;
  /** `lophn://things-to-confirm/<cac id>` 링크로 온 연결. 있으면 그 탭을 먼저 연다. */
  initialConnection?: string;
  /** backup·복원 자리(shell#T58). nav에서 뺐으므로 받아도 그리지 않는다(backup 제거는 후속 작업). */
  backup?: BackupSource;
  /** update 자리(shell#T58). 없으면 그 탭을 두지 않는다. */
  update?: UpdateSource;
  /** 진단 자리(shell#T58). 없으면 그 탭을 두지 않는다. */
  diagnostics?: DiagnosticsSource;
  /** OS notification 자리(shell#T58). 없으면 그 탭을 두지 않는다. */
  notifications?: NotificationsSource;
}

type SectionId =
  | "general"
  | "providers"
  | "agents"
  | "coding"
  | "extensions"
  | "notifications"
  | "update"
  | "diagnostics";

// 전용 아이콘이 생기기 전까지 이웃 자리의 것을 쓴다.
const icons = {
  ...settingsIcons,
  providers: settingsIcons.connections,
  agents: settingsIcons.extensions,
};

interface Section {
  readonly id: SectionId;
  readonly label: string;
}

interface Group {
  readonly id: string;
  readonly label: string;
  readonly sections: readonly Section[];
}

export function SettingsScreen(
  {
    source,
    providers,
    agents,
    onInstructions,
    coding,
    initialConnection,
    update,
    diagnostics,
    notifications,
  }: SettingsScreenProps,
) {
  // 링크로 온 연결이 있으면 그 탭을, 아니면 nav의 첫 자리를 연다.
  const [picked, setPicked] = useState<SectionId | null>(
    coding && initialConnection ? "coding" : null,
  );
  // Agents의 [Add server]는 server form을 가진 Tools and skills 자리로 옮긴다(form을 두 벌 두지 않는다).
  // Agents의 [Edit]은 전역 지침 편집기를 여는 shell 통로로 간다. 통로가 바뀌어도 Agents를 다시 읽지 않는다.
  const instructions = useRef(onInstructions);
  instructions.current = onInstructions;
  const agentsSource = useMemo<AgentsSettingsSource | undefined>(
    () =>
      agents === undefined ? undefined : {
        ...agents,
        addServer: () => {
          setPicked("extensions");
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
  const section = (id: SectionId, label: string): Section => ({ id, label });
  // 통로가 없는 자리는 nav에 두지 않는다.
  const groups: readonly Group[] = [
    {
      id: "preferences",
      label: t("settings.label.group-preferences"),
      sections: [
        section("general", t("settings.label.tab-general")),
        ...(providers === undefined
          ? []
          : [section("providers", t("settings.label.tab-providers"))]),
        ...(agents === undefined
          ? []
          : [section("agents", t("settings.label.tab-agents"))]),
      ],
    },
    {
      id: "integrations",
      label: t("settings.label.group-integrations"),
      sections: [
        ...(coding === undefined
          ? []
          : [section("coding", t("settings.label.tab-coding"))]),
        section("extensions", t("settings.label.tab-extensions")),
      ],
    },
    {
      id: "system",
      label: t("settings.label.group-system"),
      sections: [
        ...(notifications === undefined ? [] : [
          section("notifications", t("settings.label.tab-notifications")),
        ]),
        ...(update === undefined
          ? []
          : [section("update", t("settings.label.tab-update"))]),
        ...(diagnostics === undefined ? [] : [
          section("diagnostics", t("settings.label.tab-diagnostics")),
        ]),
      ],
    },
  ].filter((group) => group.sections.length > 0);
  const labels = groups.flatMap((group) => group.sections);
  const active = labels.find((row) => row.id === picked) ?? labels[0]!;

  return (
    <section className={styles.screen} data-screen-body="settings">
      <nav className={styles.nav} aria-label={t("settings.label.nav")}>
        {groups.map((group) => (
          <div key={group.id} className={styles.navGroup}>
            <h2
              id={`settings-group-${group.id}`}
              className={styles.navHeading}
            >
              {group.label}
            </h2>
            <div
              className={styles.navList}
              role="tablist"
              aria-orientation="vertical"
              aria-labelledby={`settings-group-${group.id}`}
            >
              {group.sections.map((row) => {
                const current = row.id === active.id;
                return (
                  <button
                    key={row.id}
                    type="button"
                    role="tab"
                    id={`settings-tab-${row.id}`}
                    aria-selected={current}
                    aria-controls="settings-panel"
                    data-state={current ? "active" : "inactive"}
                    className={`${styles.navButton} ${
                      current ? styles.navActive : ""
                    }`}
                    data-settings-nav={row.id}
                    onClick={() => setPicked(row.id)}
                  >
                    <Icon
                      icon={icons[row.id]}
                      pixels={iconPixels("base")}
                      className={styles.navIcon}
                    />
                    <span className={styles.navLabel}>{row.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className={styles.content}>
        <div className={styles.page}>
          <div className={styles.head}>
            <h1 className={styles.title}>{active.label}</h1>
          </div>
          <p className={styles.text}>{t("settings.intro.screen")}</p>
          <div
            className={styles.panel}
            id="settings-panel"
            role="tabpanel"
            aria-labelledby={`settings-tab-${active.id}`}
            data-settings-panel={active.id}
          >
            {active.id === "providers" && providers !== undefined
              ? <ProviderList source={providers} />
              : active.id === "agents" && agentsSource !== undefined
              ? <AgentsPanel source={agentsSource} />
              : active.id === "coding" && coding !== undefined
              ? (
                <CodingConnectionsPanel
                  source={coding}
                  focus={initialConnection}
                />
              )
              : active.id === "extensions"
              ? <ExtensionsPanel source={source} />
              : active.id === "general"
              ? <GeneralPanel source={source} />
              : active.id === "notifications" && notifications !== undefined
              ? <NotificationsPanel source={notifications} />
              : active.id === "update" && update !== undefined
              ? <UpdatePanel source={update} />
              : active.id === "diagnostics" && diagnostics !== undefined
              ? <DiagnosticsPanel source={diagnostics} />
              : null}
          </div>
        </div>
      </div>
    </section>
  );
}
