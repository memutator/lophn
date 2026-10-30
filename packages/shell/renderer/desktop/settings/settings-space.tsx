import { useEffect, useRef, useState } from "react";
import { Button, IconButton } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { useObservedSize } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import { TopBar } from "../top-bar/top-bar.tsx";
import { LauncherButton } from "../../workspace/launcher-button.tsx";
import { Breadcrumbs } from "../../workspace/top-path/breadcrumbs.tsx";
import {
  SIDEBAR_WIDTH,
  type SidebarState,
  sidebarView,
} from "../../workspace/model.ts";
import { commonIcons, workspaceIcons } from "../../icons/mod.ts";
import { WaitingLayer } from "../connection/waiting/waiting-layer.tsx";
import { SettingsSidebar } from "./sidebar/sidebar.tsx";
import {
  PaletteButton,
  usePaletteEnv,
  usePaletteScope,
} from "../palette/host.tsx";
import type { Catalog, CatalogSource } from "../palette/catalog.ts";
import { desktopScope, type FileOpen } from "../palette/desktop-scope.ts";
import { type SettingsPanels, SettingsScreen } from "./settings-screen.tsx";
import { DEFAULT_PANE, paneLabel, type SettingsPane } from "./model.ts";
import type { SettingsSource } from "./source.ts";
import styles from "./settings-space.module.css";

interface SettingsSpaceProps {
  /** 팔레트의 project·앱 행. */
  source: CatalogSource;
  /** 처음 보일 항목. 없으면 General이다. */
  settingsPane?: SettingsPane;
  /** 창 폭. 테스트가 고정하고 화면은 관측값을 쓴다. */
  windowWidth: number;
  onLauncher: () => void;
  /** Settings를 열기 전 화면으로 돌아간다. 머리의 [Back]이 쓴다. */
  onBack: () => void;
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
export function SettingsSpace({
  source,
  settingsPane: initialPane,
  windowWidth,
  onLauncher,
  onBack,
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
  const [sidebar, setSidebar] = useState<SidebarState>({
    chosenWidth: SIDEBAR_WIDTH,
    collapsedByUser: false,
  });
  // 좁은 창에서 기본으로 접힌 것을 사람이 펼쳤으면 그 선택을 덮지 않는다(project 창과 같다).
  const [userExpanded, setUserExpanded] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const frameSize = useObservedSize(frameRef);
  const shown = sidebarView(
    frameSize?.width ?? windowWidth,
    sidebar,
    userExpanded,
  );
  const toggleSidebar = () => {
    if (shown.mode === "collapsed") {
      setSidebar((state) => ({ ...state, collapsedByUser: false }));
      setUserExpanded(true);
    } else setSidebar((state) => ({ ...state, collapsedByUser: true }));
  };
  const toggleLabel =
    shown.mode === "collapsed"
      ? t("project-workspace.button.expand-sidebar")
      : t("project-workspace.button.collapse-sidebar");

  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);

  // 창 팔레트의 프로젝트·앱 행. 팔레트가 있는 창만 읽고, 읽지 못하면 그 묶음만 빈다.
  const palette = usePaletteEnv();
  useEffect(() => {
    if (!palette.available) return;
    let live = true;
    void source.catalog().then((loaded) => {
      if (live && loaded.ok) setCatalog(loaded.value);
    });
    return () => {
      live = false;
    };
  }, [source, palette.available]);

  // 창 팔레트 행. 고르면 지금 탐색 대상으로만 간다. Settings는 이미 여기라 아무 일도 없다.
  usePaletteScope(() =>
    desktopScope({
      catalog,
      platform: palette.platform,
      search: palette.search
        ? (query) => palette.search!(query, null)
        : undefined,
      go: (target) => {
        if (target.kind === "launcher") onLauncher();
        else if (target.kind === "project") onProject?.(target.id);
        else if (target.kind === "file") {
          onOpenFile?.(target.project, target.file);
        } else if (target.kind === "app") onApp?.(target.id);
      },
    }),
  );

  return (
    <div
      className={styles.space}
      data-space="settings"
      data-settings-pane={settingsPane}
      ref={frameRef}
    >
      <div className={styles.topBar}>
        <TopBar
          rail={<LauncherButton onLauncher={onLauncher} />}
          leading={
            <span className={styles.leading}>
              {shown.mode === "hidden" ? null : (
                <Tooltip content={toggleLabel}>
                  <IconButton
                    icon={workspaceIcons.sidebar}
                    label={toggleLabel}
                    data-sidebar-toggle=""
                    aria-expanded={shown.mode === "open"}
                    onClick={toggleSidebar}
                  />
                </Tooltip>
              )}
              <Button
                size="sm"
                variant="ghost"
                icon={commonIcons.back}
                data-settings-back=""
                onClick={onBack}
              >
                {t("common.button.back")}
              </Button>
              <Breadcrumbs
                crumbs={[
                  { label: t("settings.title.screen") },
                  { label: paneLabel(settingsPane) },
                ]}
              />
            </span>
          }
          trailing={
            <span className={styles.trailing}>
              <WaitingLayer onOpenSession={onOpenSession} />
              <PaletteButton />
            </span>
          }
        />
      </div>
      <div className={styles.main}>
        <SettingsSidebar
          mode={shown.mode}
          width={shown.width}
          pane={settingsPane}
          onPane={setSettingsPane}
        />
        <div className={styles.content}>
          {settings ? (
            <SettingsScreen
              {...settingsPanels}
              pane={settingsPane}
              onPane={setSettingsPane}
              source={settings}
              onOpenSession={onOpenSession}
              onProject={onProject}
            />
          ) : (
            <p className={styles.notReady} data-not-ready="settings">
              {t("common.empty.not-ready")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
