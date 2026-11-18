import { useEffect, useState } from "react";
import { Icon } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";

import { settingsEntryIcon, shellIcons } from "../../icons/mod.ts";
import { ShellFrame, useSidebarOpen } from "../../shell/shell-frame.tsx";
import { TabStrip } from "../../shell/tab-strip.tsx";
import { WaitingLayer } from "../connection/waiting/waiting-layer.tsx";
import { usePaletteEnv, usePaletteScope } from "../palette/host.tsx";
import type { Catalog, CatalogSource } from "../palette/catalog.ts";
import { desktopScope, type FileOpen } from "../palette/desktop-scope.ts";
import { type SettingsPanels, SettingsScreen } from "./settings-screen.tsx";
import {
  DEFAULT_PANE,
  MACHINE_PANES,
  paneLabel,
  SETTINGS_GROUPS,
  type SettingsPane,
} from "./model.ts";
import type { SettingsSource } from "./source.ts";
import { useMachineGrant, useMachinesView } from "../machines/context.tsx";
import {
  type MachineRef,
  MachineScope,
  useMachineData,
  useMachineHub,
} from "../machines/scope.tsx";
import {
  MachinePicker,
  SettingsGate,
  ThisComputerOnly,
} from "./machine-picker.tsx";
import styles from "./settings-space.module.css";

interface SettingsSpaceProps {
  /** 팔레트의 project·앱 행. */
  source: CatalogSource;
  /** 처음 보일 항목. 없으면 General이다. */
  settingsPane?: SettingsPane;
  onHome: () => void;
  /** Settings를 열기 전 화면으로 돌아간다. 왼쪽 위 [Back]과 tab 닫기가 쓴다. */
  onBack: () => void;
  /** 돌아갈 자리. 이름을 [Back] 줄에 보인다. Home이면 null이다. */
  backTo: { kind: "project" | "app"; id: string } | null;
  /** 프로젝트 작업대로 간다. 창 팔레트의 프로젝트 행이 쓴다. */
  onProject?: (project: string) => void;
  /** 그 project 창에서 그 파일을 연다. 창 팔레트의 파일 행이 쓴다. */
  onOpenFile?: (project: string, file: FileOpen) => void;
  /** 그 앱의 앱 공간으로 간다. 팔레트의 앱 행이 쓴다. */
  onApp?: (app: string) => void;
  /** General과 Tools and skills가 읽고 쓰는 통로. 없으면 준비 전 안내다. */
  settings?: SettingsSource;
  /** 항목마다의 통로. 없는 항목은 준비 전 안내다. */
  settingsPanels?: SettingsPanels;
  /** 대기 목록 질문 카드의 [Open session]. */
  onOpenSession: (session: string) => void;
}

const EMPTY_CATALOG: Catalog = { projects: [], apps: [] };

// Settings 공간. 왼쪽 sidebar가 항목 목록을 들고 본문은 고른 항목 하나만 그린다. 대화는 이 화면에 기대지 않는다.
// 왼쪽 위에서 설정을 열 기계를 고른다. 다른 기계를 고르면 그 기계의 core에 걸린 항목(`MACHINE_PANES`)만 서고 나머지 항목은 "이
// 컴퓨터의 설정" 한 줄이다. 이 컴퓨터가 그 기계에서 터미널 입력을 허락받지 못했으면(항목을 열 때마다 묻는다) 열 항목 자리는 그 까닭
// 한 줄이다.
export function SettingsSpace({
  source,
  settingsPane: initialPane,
  onHome,
  onBack,
  backTo,
  onProject,
  onOpenFile,
  onApp,
  settings,
  settingsPanels,
  onOpenSession,
}: SettingsSpaceProps) {
  const [settingsPane, setSettingsPane] = useState<SettingsPane>(
    initialPane ?? DEFAULT_PANE,
  );
  const [left, setLeft] = useSidebarOpen("left", true);
  const [machine, setMachine] = useState<MachineRef>(null);
  const hub = useMachineHub();
  const view = useMachinesView();
  const others =
    hub === null
      ? []
      : (view?.machines ?? []).filter((one) => one.status !== "removed");
  // 고른 기계가 명단에 없으면(빠졌다) 이름도 모른다.
  const item =
    machine === null
      ? null
      : (others.find((one) => one.id === machine) ?? null);
  const shown = (id: SettingsPane) => machine === null || MACHINE_PANES.has(id);
  const pickMachine = (next: MachineRef) => {
    setMachine(next);
    if (next !== null && !MACHINE_PANES.has(settingsPane)) {
      setSettingsPane(DEFAULT_PANE);
    }
  };

  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);

  // project·앱 이름([Back] 줄)과 창 팔레트의 행. 읽지 못하면 그 묶음만 빈다.
  const palette = usePaletteEnv();
  useEffect(() => {
    let live = true;
    void source.catalog().then((loaded) => {
      if (live && loaded.ok) setCatalog(loaded.value);
    });
    return () => {
      live = false;
    };
  }, [source]);

  // 창 팔레트 행. 고르면 지금 탐색 대상으로만 간다. Settings는 이미 여기라 아무 일도 없다.
  usePaletteScope(() =>
    desktopScope({
      catalog,
      platform: palette.platform,
      keys: palette.keys(),
      search: palette.search
        ? (query) => palette.search!(query, null)
        : undefined,
      go: (target) => {
        if (target.kind === "home") onHome();
        else if (target.kind === "project") onProject?.(target.id);
        else if (target.kind === "file") {
          onOpenFile?.(target.project, target.file);
        } else if (target.kind === "app") onApp?.(target.id);
      },
    }),
  );

  const backName =
    backTo === null
      ? undefined
      : (backTo.kind === "project" ? catalog.projects : catalog.apps).find(
          (item) => item.id === backTo.id,
        )?.title;
  const backLabel =
    backTo === null
      ? t("settings.button.back-to-home")
      : backName === undefined
        ? t("common.button.back")
        : t("settings.button.back-to", { workspace: backName });
  const waiting = <WaitingLayer align="start" onOpenSession={onOpenSession} />;
  const title = t("settings.title.screen");

  return (
    <div className={styles.space} data-space="settings">
      <ShellFrame
        left={left}
        onToggleLeft={() => setLeft(!left)}
        right={false}
        tabs={
          <TabStrip
            entries={[
              {
                key: "settings",
                tabs: [
                  {
                    key: "settings",
                    title,
                    icon: <Icon icon={settingsEntryIcon} pixels={14} />,
                  },
                ],
              },
            ]}
            selected="settings"
            minimized={[]}
            floating={[]}
            onSelect={() => {}}
            onClose={onBack}
            newTab={<></>}
            onToggleFloat={() => {}}
          />
        }
        leftSidebar={
          <nav className={styles.nav} aria-label={title}>
            <div className={styles.navHead}>
              <button
                type="button"
                className={styles.navRow}
                data-settings-back=""
                onClick={onBack}
              >
                <Icon icon={shellIcons.back} pixels={16} />
                <span className={styles.rowLabel}>{backLabel}</span>
              </button>
              {waiting}
            </div>
            {others.length === 0 ? null : (
              <MachinePicker
                machine={machine}
                machines={others}
                onPick={pickMachine}
              />
            )}
            <div className={styles.navList}>
              {SETTINGS_GROUPS.map((group) => (
                <div key={group.id} className={styles.navGroup}>
                  <div className={styles.sectionHead}>{t(group.label)}</div>
                  {group.panes
                    .filter((entry) => shown(entry.id))
                    .map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        className={styles.navRow}
                        data-settings-pane={entry.id}
                        aria-current={entry.id === settingsPane || undefined}
                        onClick={() => setSettingsPane(entry.id)}
                      >
                        <Icon icon={entry.icon} pixels={16} />
                        <span className={styles.rowLabel}>
                          {t(entry.label)}
                        </span>
                      </button>
                    ))}
                </div>
              ))}
              {machine === null ? null : (
                <ThisComputerOnly onThisComputer={() => pickMachine(null)} />
              )}
            </div>
          </nav>
        }
      >
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <span className={styles.crumbs}>
              <span className={styles.crumb}>{title}</span>
              <span className={styles.crumb}>
                <span className={styles.sep}>/</span>
                {paneLabel(settingsPane)}
              </span>
            </span>
          </div>
          <div className={styles.cardBody}>
            {machine === null ? (
              settings ? (
                <SettingsScreen
                  {...settingsPanels}
                  pane={settingsPane}
                  onPane={setSettingsPane}
                  source={settings}
                />
              ) : (
                <p className={styles.notReady} data-not-ready="settings">
                  {t("common.empty.not-ready")}
                </p>
              )
            ) : item === null || item.status !== "connected" ? (
              <SettingsGate
                reason={
                  item === null
                    ? "removed"
                    : item.status === "connecting"
                      ? "connecting"
                      : "offline"
                }
                name={item?.name ?? t("machines.label.unknown-name")}
              />
            ) : (
              <MachineScope key={machine} machine={machine}>
                <OtherMachineSettings
                  name={item.name}
                  pane={settingsPane}
                  onPane={setSettingsPane}
                />
              </MachineScope>
            )}
          </div>
        </div>
      </ShellFrame>
    </div>
  );
}

// 다른 기계의 설정. 그 기계 범위 안에서 그린다: 항목의 통로와 허락 묻기가 모두 그 기계로 간다.
function OtherMachineSettings({
  name,
  pane,
  onPane,
}: {
  name: string;
  pane: SettingsPane;
  onPane: (pane: SettingsPane) => void;
}) {
  const data = useMachineData();
  const grant = useMachineGrant(true, pane);
  if (grant === "checking") return null;
  if (grant === "denied") return <SettingsGate reason="no-grant" name={name} />;
  return (
    <SettingsScreen
      {...data.settingsPanels}
      pane={pane}
      onPane={onPane}
      source={data.settings}
    />
  );
}
