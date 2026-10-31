import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import type { CoreSource } from "./connection/connection.ts";
import { useConnection } from "./connection/connection.tsx";
import { useSessions } from "./connection/events/hooks.tsx";
import {
  type HookPromptApi,
  HookPromptHost,
} from "./hook-prompt/hook-prompt-host.tsx";
import { ToastHost } from "./connection/toasts/toast-host.tsx";
import { registerToastActionHandler } from "./connection/toasts/toast-actions.ts";
import { useWaitingPanel } from "./connection/waiting/waiting-layer.tsx";
import { Launcher } from "./launcher/launcher.tsx";
import {
  LAUNCHER,
  openApp,
  openLauncher,
  openNewApp,
  openProject,
  openSettings,
  type Route,
} from "./router.ts";
import { Workspace } from "../workspace/workspace.tsx";
import { DetachedSpace } from "../workspace/detached/detached-space.tsx";
import type { LophnDetachedApi } from "../../ipc/detached.ts";
import type { WorkspaceSource } from "../workspace/source.ts";
import type { EditorDeps } from "../editor/document-view.tsx";
import type { TerminalDeps } from "../terminal/deps.ts";
import { SettingsSpace } from "./settings/settings-space.tsx";
import type { CatalogSource } from "./palette/catalog.ts";
import { type PaletteDeps, PaletteProvider } from "./palette/host.tsx";
import type { ProjectsSource } from "./launcher/projects/source.ts";
import type { IntentApi } from "../../ipc/shortcuts.ts";
import { DesktopIntents } from "./intents.tsx";
import type { DesktopTarget } from "./palette/desktop-scope.ts";
import { AppSpace } from "../app-frame/app-space.tsx";
import { AppWindow } from "../app-frame/app-window.tsx";
import type { AppsSource } from "../apps/source.ts";
import type { SettingsPane } from "./settings/model.ts";
import type { SettingsSource } from "./settings/source.ts";
import type { SettingsPanels } from "./settings/settings-screen.tsx";
import { ConnectProviderHost } from "./settings/providers/connect-host.tsx";
import { applyAppearance } from "./settings/appearance/model.ts";
import type { AppDetailSource } from "../app-frame/app-detail/source.ts";
import type { LophnShellViewsApi } from "../../ipc/app-frame.ts";
import type { LophnShellAnnotateApi } from "../../ipc/annotation.ts";
import type { OverlayApi } from "../../ipc/overlay.ts";
import type { KeybindingsApi } from "../../ipc/keybindings.ts";
import type { AgentTabSourceFactory } from "../conversation/agent-tab-source.ts";
import { CommandsProvider } from "../commands/react.tsx";
import { createWindowCommands } from "../commands/window.ts";
import { currentPlatform } from "./top-bar/platform.ts";
import {
  type PlaceRef,
  rememberPlace,
} from "../workspace/top-path/recent-places.ts";

// desktop preload만 연다(entry.tsx의 bridges와 같은 꼴). gallery·dev 창에는 없어 main이 먼저 받는 키는 표의 키로 남는다.
const keybindingsBridge = globalThis as { lophnKeybindings?: KeybindingsApi };

interface DesktopProps {
  source: CoreSource;
  /** 창이 처음 여는 화면. 기본 창은 런처다. */
  initial?: Route;
  formatTime?: (confirmedAt: number) => string;
  /** 프로젝트 작업대 통로. project 공간에서만 쓴다. */
  workspace?: WorkspaceSource;
  /** 창 폭. 테스트가 고정한다. */
  windowWidth?: number;
  /** 문서 탭의 읽기·편집 통로. */
  editor?: EditorDeps;
  /** 터미널 탭 통로. 창 preload가 열어 둔 통로로 entry가 만든다. */
  terminal?: TerminalDeps;
  /** 팔레트의 project·앱 행 통로. 없으면 Settings 대신 런처를 보인다. */
  catalog?: CatalogSource;
  /** 창 안 팔레트와 shortcut 통로. 없으면 팔레트를 열지 않는다. */
  palette?: PaletteDeps;
  /** main이 시키는 것(전역 팔레트). 없으면 받지 않는다. */
  intents?: IntentApi;
  /** 런처의 프로젝트 카드·등록·보관·detail 통로. 없으면 카드는 비었음 상태다. */
  projects?: ProjectsSource;
  /** 런처의 앱 카드·보관과 앱 공간의 통로. 없으면 앱 공간을 열지 않는다. */
  apps?: AppsSource;
  /** settings 공간 통로. 없으면 settings는 준비 전 안내다. */
  settings?: SettingsSource;
  /** settings 항목마다의 통로. 없는 항목은 준비 전 안내다. */
  settingsPanels?: SettingsPanels;
  /** 앱 공간 운영 패널의 app-detail 통로. 없으면 app-detail 탭을 두지 않는다. */
  appDetail?: AppDetailSource;
  /** shell preload의 앱 view 통로. 앱 공간 본문이 쓴다. */
  views?: LophnShellViewsApi;
  /** shell preload의 Annotate 통로. 없으면 Annotate 단추를 두지 않는다. */
  annotate?: LophnShellAnnotateApi;
  /** Agent 화면이 agent 하나의 통로를 얻는 함수. 앱 공간의 agent 칸이 쓴다. 없으면 칸은 준비 안 됨이다. */
  agentViewSource?: AgentTabSourceFactory;
  /** 창 위 overlay. toast를 띄운다. 없으면 toast를 띄우지 않는다. */
  overlay?: OverlayApi;
  /** main이 묻는 전역 hook 설치 확인 통로. overlay와 함께 있어야 dialog를 띄운다. */
  hookPrompt?: HookPromptApi;
  /** detached 창 통로. 없으면 Detach 항목과 detached 공간을 두지 않는다. */
  detached?: LophnDetachedApi;
}

// toast 행동의 기본 처리. 지금 보이는 화면이 처리하지 못한 행동(그 화면이 false를 돌렸다)을 다른 화면으로 가서
// 연다. 화면의 처리기보다 먼저 등록돼야(목록에서 뒤에 서야) 화면이 먼저 처리하니, 화면보다 앞에 그린다.
function DefaultToastHandler({
  openSession,
  goApp,
}: {
  openSession: (session: string) => void;
  goApp: (app: string) => void;
}) {
  const { setOpen } = useWaitingPanel();
  const latest = useRef({ openSession, goApp });
  latest.current = { openSession, goApp };
  useEffect(
    () =>
      registerToastActionHandler((action) => {
        const current = latest.current;
        switch (action.kind) {
          case "waiting":
            setOpen(true);
            return true;
          case "session":
            if (action.session !== null) {
              current.openSession(action.session);
              return true;
            }
            // 열린 session이 없는 반응(앱 재시작 중단)은 그 앱 공간으로 간다.
            if (action.app === undefined) return false;
            current.goApp(action.app);
            return true;
        }
      }),
    [setOpen],
  );
  return null;
}

// 새 기본 창의 첫 화면. 공간 이동은 이 상태가 기억한다.
export function Desktop({
  source,
  initial = LAUNCHER,
  formatTime,
  workspace,
  windowWidth = 1280,
  editor,
  terminal,
  catalog,
  palette,
  projects,
  intents,
  apps,
  settings,
  settingsPanels,
  appDetail,
  views,
  annotate,
  agentViewSource,
  overlay,
  hookPrompt,
  detached,
}: DesktopProps) {
  // 창 하나의 command 표와 키 listener 하나. 공간이 바뀌어도 같은 것을 쓰고 공간이 자기 command를 올린다.
  const keyPlatform =
    (palette?.platform ?? currentPlatform()) === "mac" ? "mac" : "other";
  const commands = useMemo(
    () =>
      createWindowCommands({
        platform: keyPlatform,
        log: (message, error) => console.error(message, error),
        tellMain: (overrides) =>
          keybindingsBridge.lophnKeybindings?.set(overrides),
      }),
    [keyPlatform],
  );
  useEffect(() => {
    const listening = commands.keybindings.listen(document);
    return () => listening.dispose();
  }, [commands]);
  const [route, setRoute] = useState<Route>(initial);
  // 런처의 lophn 패널이 열 session. route가 바뀔 때마다 새 객체라 같은 session도 다시 연다.
  const lophnRequest = useMemo(
    () =>
      route.space === "launcher" && route.session !== undefined
        ? { session: route.session }
        : undefined,
    [route],
  );
  // 같은 화면이어도 다시 열게 하는 횟수. Settings는 열 때 처음 상태로 선다.
  const [visits, setVisits] = useState(0);
  // place에 닿을 때마다 최근 목록을 고친다. 어느 길로 왔든(switcher, 런처 카드, palette, toast의 session)
  // 한 곳에서 남기려고 route를 본다.
  useEffect(() => {
    if (route.space === "project" && route.project !== undefined) {
      rememberPlace({ kind: "project", id: route.project });
    } else if (route.space === "app" && route.app !== undefined) {
      rememberPlace({ kind: "app", id: route.app });
    }
  }, [route]);
  const launcher = () => setRoute(LAUNCHER);
  // Settings를 열기 전 자리. Settings의 [Back]이 돌아가는 곳이고, 없으면(처음부터 Settings) 런처로 간다.
  const beforeSettings = useRef<Route | null>(null);
  // Settings로 간다. 이미 Settings여도 고른 항목부터 다시 연다.
  const settingsSpace = (pane?: SettingsPane) => {
    // Settings 자신은 앞 자리가 아니다. 한 번 쓰고 끝나는 시작값(열 파일)은 버려 돌아올 때 다시 일어나지 않게 한다.
    if (route.space !== "settings") {
      beforeSettings.current =
        route.space === "project" && route.project
          ? openProject(route.project, { session: route.session })
          : route.space === "app" && route.app
            ? openApp(route.app, route.session)
            : route;
    }
    setVisits((value) => value + 1);
    setRoute(openSettings(pane));
  };
  // place switcher에서 고른 place를 연다.
  const openPlace = (place: PlaceRef) =>
    setRoute(
      place.kind === "project" ? openProject(place.id) : openApp(place.id),
    );
  const appSpace = (app: string) => setRoute(openApp(app));
  // 전역 팔레트에서 고른 대상. Workspace 팔레트와 같은 목적지로만 간다.
  const go = (target: DesktopTarget) => {
    if (target.kind === "launcher") launcher();
    else if (target.kind === "project") setRoute(openProject(target.id));
    else if (target.kind === "settings") settingsSpace();
    else if (target.kind === "app") appSpace(target.id);
    else setRoute(openProject(target.project, { open: target.file }));
  };

  // session을 그 session의 place에서 연다. project의 session은 그 project 창, 앱의 session은 그 앱 공간,
  // home(place 없음)이거나 모르는 session은 런처의 lophn 패널이다. project 창은 그 project place의 session만 보인다.
  const { sessions } = useSessions();
  const known = useRef(sessions);
  known.current = sessions;
  const openSession = (session: string) => {
    const place = known.current.find(
      (entry) => entry.session === session,
    )?.place;
    if (place?.kind === "project") {
      setRoute(openProject(place.id, { session }));
    } else if (place?.kind === "app") setRoute(openApp(place.id, session));
    else setRoute(openLauncher(session));
  };
  // 다른 project나 공간에 있을 때 터미널 알림을 누르면 그 터미널의 project로 가서 연다. 같은 project면 store가 탭을 고른다.
  const terminalBridge = terminal?.bridge;
  useEffect(
    () =>
      terminalBridge?.onReveal(({ project, terminal_ref }) =>
        setRoute((current) =>
          current.space === "project" && current.project === project
            ? current
            : openProject(project, { terminal: terminal_ref }),
        ),
      ),
    [terminalBridge],
  );
  // 저장한 appearance를 시작할 때 적용한다. core가 준비되면 읽는다.
  const appearance = settingsPanels?.appearance;
  useEffect(() => {
    if (appearance === undefined) return;
    return appearance.watch((state) => {
      if (state.state !== "ready") return;
      void appearance.values().then((read) => {
        if (read.ok) applyAppearance(read.value);
      });
    });
  }, [appearance]);
  // 사람이 바꾼 단축키도 시작할 때 덮는다. Settings를 열지 않아도 바뀐 키가 듣는다.
  const keyboard = settingsPanels?.keyboard;
  useEffect(() => {
    if (keyboard === undefined) return;
    return keyboard.watch((state) => {
      if (state.state !== "ready") return;
      void keyboard.read().then((read) => {
        if (read.ok) commands.setOverrides(read.value[keyPlatform] ?? {});
      });
    });
  }, [keyboard, commands, keyPlatform]);

  // modal(dialog·palette)이 뜨면 scrim이 창의 위쪽 줄도 덮고 그 줄은 끌기에서 빠진다. 스타일은 chrome.css다.
  useEffect(() => {
    if (!overlay) return;
    const root = document.documentElement;
    const off = overlay.subscribe(
      (event) => {
        if ("type" in event && event.type === "modal") {
          if (event.open) root.dataset.overlayModal = "";
          else delete root.dataset.overlayModal;
        }
      },
      () => {},
    );
    return () => {
      off();
      delete root.dataset.overlayModal;
    };
  }, [overlay]);

  // 작업대는 core 기록을 읽어 연다. 준비 전·실패에는 런처의 연결 화면을 보이고, 준비되면 그때
  // 작업대를 열어 읽는다.
  const connection = useConnection(source);
  const live = connection.state === "ready" || connection.state === "stale";
  let space: ReactNode;
  if (route.space === "project" && route.project && workspace && live) {
    space = (
      <Workspace
        key={route.project}
        projectId={route.project}
        source={workspace}
        windowWidth={windowWidth}
        onLauncher={launcher}
        onOpenPlace={openPlace}
        places={catalog}
        onSettings={settingsSpace}
        jobs={settingsPanels?.jobs}
        onOpenApp={apps ? appSpace : undefined}
        editor={editor}
        terminal={terminal}
        detached={detached}
        agentViewSource={agentViewSource}
        session={route.session}
        revealTerminal={route.terminal}
        open={route.open}
      />
    );
  } else if (route.space === "detached") {
    // 창이 detached 탭 하나만 그리므로 core가 준비되기 전에 런처로 떨어지지 않는다.
    space =
      detached && workspace && live ? (
        <DetachedSpace
          api={detached}
          workspace={workspace}
          editor={editor}
          terminal={terminal}
          agentViewSource={agentViewSource}
        />
      ) : null;
  } else if (route.space === "app" && route.app && apps && live) {
    space = (
      <AppSpace
        key={route.app}
        app={route.app}
        source={apps}
        views={views}
        detail={appDetail}
        agents={workspace?.agentsSource}
        runs={
          workspace === undefined
            ? undefined
            : () => workspace.runs({ place: { app: route.app! } })
        }
        agentViewSource={agentViewSource}
        onSettings={settingsSpace}
        windowWidth={windowWidth}
        onLauncher={launcher}
        annotate={annotate}
        overlay={overlay}
        session={route.session}
        startLophn={route.newSession}
        onOpenSession={openSession}
        places={catalog}
        onOpenPlace={openPlace}
      />
    );
  } else if (
    route.space === "app-window" &&
    route.app &&
    route.release &&
    route.screen
  ) {
    // 앱 전용 창은 앱 화면 하나만 그린다. core 연결을 기다리지 않는다.
    space = views ? (
      <AppWindow
        app={route.app}
        release={route.release}
        screen={route.screen}
        views={views}
      />
    ) : null;
  } else if (route.space === "settings" && catalog) {
    space = (
      <SettingsSpace
        key={visits}
        source={catalog}
        settingsPane={route.settingsPane}
        windowWidth={windowWidth}
        onLauncher={launcher}
        onBack={() => setRoute(beforeSettings.current ?? LAUNCHER)}
        onProject={(project) => setRoute(openProject(project))}
        onOpenFile={(project, file) =>
          setRoute(openProject(project, { open: file }))
        }
        onApp={appSpace}
        settings={settings}
        settingsPanels={settingsPanels}
        onOpenSession={openSession}
      />
    );
  } else {
    space = (
      <Launcher
        source={source}
        formatTime={formatTime}
        onSettings={settingsSpace}
        projects={projects}
        onProject={(project) => setRoute(openProject(project))}
        apps={apps}
        onApp={appSpace}
        onNewApp={(app) => setRoute(openNewApp(app))}
        onOpenSession={openSession}
        agentViewSource={agentViewSource}
        lophnRequest={lophnRequest}
      />
    );
  }
  // 창 shortcut의 런처 복귀와 팔레트는 어느 공간에서든 이 한 곳에서 받는다.
  const tree = (
    <CommandsProvider value={commands}>
      <PaletteProvider deps={palette} onLauncher={launcher}>
        <DefaultToastHandler
          openSession={openSession}
          goApp={(app) => setRoute(openApp(app))}
        />
        {space}
        {overlay &&
        route.space !== "detached" &&
        route.space !== "app-window" ? (
          <ToastHost overlay={overlay} />
        ) : null}
        {overlay && hookPrompt ? (
          <HookPromptHost overlay={overlay} coding={hookPrompt} />
        ) : null}
        {intents &&
        route.space !== "detached" &&
        route.space !== "app-window" ? (
          <DesktopIntents intents={intents} catalog={catalog} go={go} />
        ) : null}
      </PaletteProvider>
    </CommandsProvider>
  );
  // model picker 같은 곳에서도 provider 연결 화면을 열 수 있게 화면 전체를 감싼다.
  return settingsPanels?.providers && settingsPanels.agents ? (
    <ConnectProviderHost
      providers={settingsPanels.providers}
      agents={settingsPanels.agents}
    >
      {tree}
    </ConnectProviderHost>
  ) : (
    tree
  );
}
