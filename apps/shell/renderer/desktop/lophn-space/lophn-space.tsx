import { useEffect, useRef, useState } from "react";
import { useObservedSize } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { TopBar } from "../top-bar/top-bar.tsx";
import { LauncherButton } from "../../workspace/launcher-button.tsx";
import { Breadcrumbs } from "../../workspace/top-path/breadcrumbs.tsx";
import {
  SIDEBAR_WIDTH,
  type SidebarState,
  sidebarView,
} from "../../workspace/model.ts";
import { DEFAULT_SCREEN, type LophnScreen } from "./model.ts";
import { screenLabel } from "./screens.ts";
import type { Catalog, LophnSource } from "./source.ts";
import type { EditorSessions } from "../../editor/sessions.ts";
import { LophnSidebar } from "./sidebar/sidebar.tsx";
import { DocumentsScreen } from "./documents/documents-screen.tsx";
import type { ReaderTarget } from "./documents/reader.tsx";
import {
  PaletteButton,
  usePaletteEnv,
  usePaletteScope,
} from "../palette/host.tsx";
import { lophnScope } from "../palette/lophn-scope.ts";
import { ThingsToConfirm } from "./things-to-confirm/things-to-confirm.tsx";
import { ProjectsScreen } from "./projects/projects-screen.tsx";
import type { OrganizeSource } from "./organize/source.ts";
import { useRequests } from "./things-to-confirm/context.tsx";
import { AppsScreen } from "./apps/apps-screen.tsx";
import type { AppsSource } from "./apps/source.ts";
import {
  type SettingsPanels,
  SettingsScreen,
} from "./settings/settings-screen.tsx";
import type { SettingsSource } from "./settings/source.ts";
import type { CodingConnectionsSource } from "./settings/connections/source.ts";
import styles from "./lophn-space.module.css";

export interface LophnSpaceProps {
  source: LophnSource;
  /** projects 화면의 정리 통로. 없으면 projects는 준비 전 안내다. */
  organize?: OrganizeSource;
  /** 처음 보일 형제. 없으면 documents다(desktop#R1). */
  screen?: LophnScreen;
  /** 창 폭. 테스트가 고정하고 화면은 관측값을 쓴다. */
  windowWidth: number;
  onLauncher: () => void;
  /** 프로젝트 작업대로 간다. 창 팔레트의 프로젝트 행이 쓴다. */
  onProject?: (project: string) => void;
  /** 상대 시각의 기준. 테스트가 고정한다. */
  now?: () => number;
  /** documents 화면에서 처음 읽을 문서(전역 팔레트의 문서 행). */
  initialRead?: { readonly document: string; readonly version: string };
  /** things-to-confirm에서 처음 고를 요청. */
  initialRequest?: string;
  /** 창의 편집 session 묶음. documents 화면의 series 새 멤버 쓰기가 쓴다. */
  sessions?: EditorSessions;
  /** apps 화면 통로. 없으면 apps는 준비 전 안내다. */
  apps?: AppsSource;
  /** 그 앱의 앱 공간으로 간다. apps 화면의 열기와 팔레트의 앱 행이 쓴다. */
  onApp?: (app: string) => void;
  /** settings 화면 통로. 없으면 settings는 준비 전 안내다. */
  settings?: SettingsSource;
  /** 전역 [Instructions] 편집기로 간다. settings 화면의 단추가 쓴다. */
  onInstructions?: () => void;
  /** settings의 coding agent 연결 통로. 없으면 그 자리를 두지 않는다. */
  coding?: CodingConnectionsSource;
  /** `lophn://things-to-confirm/<cac id>` 링크로 온 연결. settings가 그 연결을 먼저 보인다. */
  initialConnection?: string;
  /** settings의 backup·update·진단·notification 탭 통로. 없는 탭은 두지 않는다. */
  settingsPanels?: SettingsPanels;
}

const EMPTY_CATALOG: Catalog = { projects: [], apps: [] };

// lophn 공간. 왼쪽 sidebar의 여섯 형제 중 하나를 본문에 연다. 대화는 이 화면에 기대지 않는다.
export function LophnSpace(
  {
    source,
    organize,
    screen,
    windowWidth,
    onLauncher,
    onProject,
    now,
    initialRead,
    initialRequest,
    sessions,
    apps,
    onApp,
    settings,
    onInstructions,
    coding,
    initialConnection,
    settingsPanels,
  }: LophnSpaceProps,
) {
  const [current, setCurrent] = useState<LophnScreen>(screen ?? DEFAULT_SCREEN);
  const [sidebar, setSidebar] = useState<SidebarState>({
    chosenWidth: SIDEBAR_WIDTH,
    collapsedByUser: false,
  });
  const frameRef = useRef<HTMLDivElement>(null);
  const frameSize = useObservedSize(frameRef);
  const shown = sidebarView(frameSize?.width ?? windowWidth, sidebar, false);
  // 팔레트나 바깥 링크로 연 문서. 바뀔 때마다 documents 화면을 그 문서로 다시 연다.
  const [reading, setReading] = useState<
    { readonly target: ReaderTarget; readonly count: number } | null
  >(
    initialRead
      ? {
        target: {
          document: initialRead.document,
          version: initialRead.version,
          section: null,
        },
        count: 1,
      }
      : null,
  );

  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  // 질문·approval 통로. 없으면(통로 없는 테스트) things-to-confirm은 준비 전 안내다.
  const requests = useRequests();

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

  // 창 팔레트의 lophn 공간 행(desktop#R30). 고르면 지금 탐색 대상으로만 간다.
  usePaletteScope(() =>
    lophnScope({
      catalog,
      platform: palette.platform,
      search: palette.search
        ? (query) => palette.search!(query, null)
        : undefined,
      go: (target) => {
        if (target.kind === "launcher") onLauncher();
        else if (target.kind === "project") onProject?.(target.id);
        else if (target.kind === "screen") setCurrent(target.screen);
        else if (target.kind === "app") {
          if (onApp) onApp(target.id);
          else setCurrent("apps");
        } else {
          setCurrent("documents");
          setReading((last) => ({
            target: {
              document: target.document,
              version: target.version,
              section: null,
            },
            count: (last?.count ?? 0) + 1,
          }));
        }
      },
    })
  );

  return (
    <div
      className={styles.space}
      data-space="lophn"
      data-current-screen={current}
      ref={frameRef}
    >
      <LophnSidebar
        mode={shown.mode}
        width={shown.width}
        current={current}
        onLauncher={onLauncher}
        onToggle={() =>
          setSidebar((state) => ({
            ...state,
            collapsedByUser: shown.mode !== "collapsed",
          }))}
        onOpen={setCurrent}
      />
      <div className={styles.main}>
        <div className={styles.topBar}>
          <TopBar
            leading={
              <span className={styles.leading}>
                {shown.launcherInTopBar
                  ? <LauncherButton onLauncher={onLauncher} />
                  : null}
                <Breadcrumbs
                  crumbs={[
                    { label: t("common.label.lophn-space") },
                    { label: screenLabel(current) },
                  ]}
                />
              </span>
            }
            trailing={
              <span className={styles.trailing}>
                <PaletteButton />
              </span>
            }
          />
        </div>
        <div className={styles.content}>
          {current === "documents"
            ? (
              <DocumentsScreen
                key={reading?.count ?? 0}
                source={source}
                now={now}
                initialRead={reading?.target}
                {...(sessions ? { sessions } : {})}
              />
            )
            : current === "apps" && apps && onApp
            ? <AppsScreen source={apps} onOpen={onApp} />
            : current === "settings" && settings
            ? (
              <SettingsScreen
                {...settingsPanels}
                source={settings}
                coding={coding}
                initialConnection={initialConnection}
                onInstructions={onInstructions}
              />
            )
            : current === "things-to-confirm" && requests !== null
            ? (
              <ThingsToConfirm
                deps={requests}
                initialSelected={initialRequest}
              />
            )
            : current === "projects" && organize !== undefined
            ? <ProjectsScreen source={organize} lophn={source} />
            : (
              <p className={styles.notReady} data-not-ready={current}>
                {t("common.empty.not-ready")}
              </p>
            )}
        </div>
      </div>
    </div>
  );
}
