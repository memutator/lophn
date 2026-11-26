import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { codingSessionsList } from "../../../protocol/coding-agent/relay.ts";
import { HOME_TERMINAL_PROJECT } from "../../../protocol/coding-agent/terminals.ts";
import { workspaceSessionRead } from "../../../protocol/lophn-agent/agent-sessions.ts";
import type { LophnShellViewsApi } from "../../ipc/app-frame.ts";
import type { LophnDetachedApi } from "../../ipc/detached.ts";
import type { OverlayApi } from "../../ipc/overlay.ts";
import type { IntentApi } from "../../ipc/shortcuts.ts";
import { AppWindow } from "../app-frame/app-window.tsx";
import { WorkspaceViewsProvider } from "../app-frame/workspace-views.tsx";
import { AppKeyContributions } from "../commands/app-keys.ts";
import { CommandsProvider } from "../commands/react.tsx";
import { createWindowCommands } from "../commands/window.ts";
import { type WorkspaceRef, workspaceKey } from "../shell/desk-model.ts";
import { GlobalFloatLayer } from "../shell/global-floats/global-float-layer.tsx";
import { GlobalFloatsProvider } from "../shell/global-floats/global-floats.tsx";
import {
  createSidebarMemory,
  SidebarMemoryProvider,
} from "../shell/sidebar-memory.tsx";
import { TrayPopupLayer } from "../shell/tray/tray.tsx";
import {
  createTrayMemory,
  TrayMemoryProvider,
} from "../shell/tray/tray-memory.tsx";
import { MachineListsProvider } from "../shell/use-left-sidebar.ts";
import { DetachedSpace } from "../workspace/detached/detached-space.tsx";
import { WorkspaceWindow } from "../workspace/workspace-window.tsx";
import {
  ConnectionNotice,
  retryConnection,
  useConnection,
} from "./connection/connection.tsx";
import { useStateChanged } from "./connection/core-read.ts";
import { useSessions } from "./connection/events/hooks.tsx";
import { registerToastActionHandler } from "./connection/toasts/toast-actions.ts";
import { ToastHost } from "./connection/toasts/toast-host.tsx";
import { useWaitingPanel } from "./connection/waiting/waiting-layer.tsx";
import { HookPromptHost } from "./hook-prompt/hook-prompt-host.tsx";
import { DesktopIntents } from "./intents.tsx";
import {
  useHostMachine,
  useMachineData,
  useMachineHub,
} from "./machines/scope.tsx";
import type { DesktopTarget } from "./palette/desktop-scope.ts";
import { type PaletteDeps, PaletteProvider } from "./palette/host.tsx";
import {
  HOME,
  openApp,
  openAppScreenAt,
  openHome,
  openNewApp,
  openProject,
  openSettings,
  openTerminalIn,
  openWorkspace,
  openWorkspaceNewSession,
  openWorkspaceSession,
  openWorkspaceSettings,
  openWorkspaceTerminal,
  type Route,
} from "./router.ts";
import { applyAppearance } from "./settings/appearance/model.ts";
import type { SettingsPane } from "./settings/model.ts";
import { ConnectProviderHost } from "./settings/providers/connect-host.tsx";
import { SettingsSpace } from "./settings/settings-space.tsx";
import { currentPlatform } from "./top-bar/platform.ts";
import { HomeGate } from "./workspaces/home-gate.tsx";

// desktop preload만 연다(entry.tsx의 bridges와 같은 꼴). gallery·dev 창에는 없어 main이 먼저 받는 키는 표의 키로 남는다.

// 창의 통로(core, 작업대, 터미널, project·앱 목록, 설정)는 범위의 기계 묶음(`useMachineData`)에서 온다. entry와 gallery의
// MockDesktop이 `MachineHubProvider`와 root `MachineScope`를 세운다.
interface DesktopProps {
  /** 창이 처음 여는 화면. 기본 창은 Home이다. */
  initial?: Route;
  formatTime?: (confirmedAt: number) => string;
  /** 창 폭. 테스트가 고정한다. */
  windowWidth?: number;
  /** 창 안 팔레트와 shortcut 통로. 없으면 팔레트를 열지 않는다. */
  palette?: PaletteDeps;
  /** main이 시키는 것(전역 팔레트). 없으면 받지 않는다. */
  intents?: IntentApi;
  /** shell preload의 앱 view 통로. 앱 전용 창이 쓴다(workspace 창의 앱 화면은 AppViewsProvider로 받는다). */
  views?: LophnShellViewsApi;
  /** 창 위 overlay. toast를 띄운다. 없으면 toast를 띄우지 않는다. */
  overlay?: OverlayApi;
  /** detached 창 통로. 없으면 Detach 항목과 detached 공간을 두지 않는다. */
  detached?: LophnDetachedApi;
}

// Settings의 [Back]이 돌아갈 자리. Home이면 null이다.
function backTarget(
  route: Route | null,
): { kind: "project" | "app"; id: string } | null {
  if (route?.space === "project" && route.project) {
    return { kind: "project", id: route.project };
  }
  if (route?.space === "app" && route.app) {
    return { kind: "app", id: route.app };
  }
  return null;
}

// toast 행동의 기본 처리. 지금 보이는 화면이 처리하지 못한 행동(그 화면이 false를 돌렸다)을 다른 화면으로 가서
// 연다. 화면의 처리기보다 먼저 등록돼야(목록에서 뒤에 서야) 화면이 먼저 처리하니, 화면보다 앞에 그린다.
function DefaultToastHandler({
  openSession,
  openTerminal,
  goApp,
}: {
  openSession: (session: string, machine?: string) => void;
  openTerminal: (terminal: string, machine: string) => void;
  goApp: (app: string, machine?: string) => void;
}) {
  const { setOpen } = useWaitingPanel();
  const latest = useRef({ openSession, openTerminal, goApp });
  latest.current = { openSession, openTerminal, goApp };
  useEffect(
    () =>
      registerToastActionHandler((action) => {
        const current = latest.current;
        switch (action.kind) {
          case "waiting":
            setOpen(true);
            return true;
          case "terminal":
            current.openTerminal(action.terminal, action.machine);
            return true;
          case "session":
            if (action.session !== null) {
              current.openSession(action.session, action.machine);
              return true;
            }
            // 열린 session이 없는 반응(앱 재시작 중단)은 그 앱 공간으로 간다.
            if (action.app === undefined) return false;
            current.goApp(action.app, action.machine);
            return true;
        }
      }),
    [setOpen],
  );
  return null;
}

const on = (machine: string | undefined) =>
  machine === undefined ? {} : { machine };

// 새 기본 창의 첫 화면. 공간 이동은 이 상태가 기억한다.
export function Desktop({
  initial = HOME,
  formatTime,
  windowWidth = 1280,
  palette,
  intents,
  views,
  overlay,
  detached,
}: DesktopProps) {
  // 이 컴퓨터(root 범위) 묶음. Settings, 팔레트, 전역 float, toast는 이 기계의 것이다.
  const root = useMachineData();
  const {
    core: source,
    workspace,
    editor,
    terminal,
    catalog,
    projects,
    apps,
    settings,
    settingsPanels,
    jobs,
    appDetail,
    agentViewSource,
  } = root;
  // 창 하나의 command 표와 키 listener 하나. 공간이 바뀌어도 같은 것을 쓰고 공간이 자기 command를 올린다.
  const keyPlatform =
    (palette?.platform ?? currentPlatform()) === "mac" ? "mac" : "other";
  const commands = useMemo(
    () =>
      createWindowCommands({
        platform: keyPlatform,
        log: (message, error) => console.error(message, error),
      }),
    [keyPlatform],
  );
  useEffect(() => {
    const listening = commands.keybindings.listen(document);
    return () => listening.dispose();
  }, [commands]);
  const [route, setRoute] = useState<Route>(initial);
  // 지금 workspace의 기계 묶음. 다른 기계의 workspace(이 컴퓨터에 없는 project, Home · <이름>)는 그 기계의 통로로 그린다.
  const at = useMachineData(route.machine);
  // 같은 화면이어도 다시 열게 하는 횟수. Settings는 열 때 처음 상태로 선다.
  const [visits, setVisits] = useState(0);
  // workspace를 옮겨도 왼쪽 sidebar가 빈 목록부터 다시 그리지 않게 마지막 읽기 값을 창에 둔다.
  const [sidebarMemory] = useState(createSidebarMemory);
  // pin한 tray popup도 workspace를 옮겨 Tray가 새로 서면 다시 열어야 하므로 창에 둔다.
  const [trayMemory] = useState(createTrayMemory);
  const home = () => setRoute(HOME);
  // Settings를 열기 전 자리. Settings의 [Back]이 돌아가는 곳이고, 없으면(처음부터 Settings) Home으로 간다.
  const beforeSettings = useRef<Route | null>(null);
  // Settings로 간다. 이미 Settings여도 고른 항목부터 다시 연다.
  const settingsSpace = (pane?: SettingsPane) => {
    // Settings 자신은 앞 자리가 아니다. 한 번 쓰고 끝나는 시작값(열 파일)은 버려 돌아올 때 다시 일어나지 않게 한다.
    if (route.space !== "settings") {
      beforeSettings.current =
        route.space === "project" && route.project
          ? openProject(route.project, {
              session: route.session,
              ...on(route.machine),
            })
          : route.space === "app" && route.app
            ? openApp(route.app, route.session, route.machine)
            : route.space === "home"
              ? openHome(undefined, route.machine)
              : route;
    }
    setVisits((value) => value + 1);
    setRoute(openSettings(pane));
  };
  // sidebar에서 고른 workspace를 연다.
  const goWorkspace = (workspace: WorkspaceRef) =>
    setRoute(openWorkspace(workspace));
  const sessionAt = (
    workspace: WorkspaceRef,
    session: string,
    machine?: string,
  ) => setRoute(openWorkspaceSession(workspace, session, machine));
  const terminalAt = (workspace: WorkspaceRef, terminal: string) =>
    setRoute(openWorkspaceTerminal(workspace, terminal));
  const appSpace = (app: string, machine?: string) =>
    setRoute(openApp(app, undefined, machine));
  // 전역 팔레트에서 고른 대상. Workspace 팔레트와 같은 목적지로만 간다.
  const go = (target: DesktopTarget) => {
    if (target.kind === "home") home();
    else if (target.kind === "project") {
      setRoute(openProject(target.id, on(target.machine)));
    } else if (target.kind === "settings") settingsSpace();
    else if (target.kind === "app") appSpace(target.id);
    else setRoute(openProject(target.project, { open: target.file }));
  };

  // session을 그 session의 workspace에서 연다. project의 session은 그 project 창, 앱의 session은 그 앱 공간,
  // home(workspace 없음)이거나 모르는 session은 Home이다. workspace 창은 그 workspace의 session만 보인다.
  const { sessions } = useSessions();
  const known = useRef(sessions);
  known.current = sessions;
  const hub = useMachineHub();
  const openSession = (session: string, machine?: string) => {
    const routeSession = (
      workspace:
        | { readonly kind: "project"; readonly id: string }
        | { readonly kind: "app"; readonly id: string }
        | null
        | undefined,
    ) => {
      if (workspace?.kind === "project") {
        setRoute(openProject(workspace.id, { session, ...on(machine) }));
      } else if (workspace?.kind === "app") {
        setRoute(openApp(workspace.id, session, machine));
      } else {
        setRoute(openHome(session, machine));
      }
    };
    const found = (
      machine === undefined
        ? known.current
        : (hub?.get(machine).stores.sessions.get().sessions ?? [])
    ).find((entry) => entry.session === session);
    if (found !== undefined) {
      routeSession(found.workspace);
      return;
    }
    // 방금 만든 handoff·follow-up session은 SessionStarted가 아직 store에 닿기 전일 수 있어 core에서 workspace를 확인한다.
    const targetCore =
      machine === undefined ? source : (hub?.get(machine).core ?? source);
    void targetCore
      .call({
        kind: workspaceSessionRead.kind,
        resource: workspaceSessionRead.resource,
        method: workspaceSessionRead.method,
        body: { session },
      })
      .then((reply) => {
        const parsed = reply.ok
          ? workspaceSessionRead.output.safeParse(reply.value)
          : null;
        routeSession(parsed?.success ? parsed.data.session.workspace : null);
      })
      .catch(() => routeSession(null));
  };
  const openRemoteTerminal = (terminalRef: string, machine: string) => {
    const data = hub?.get(machine);
    if (data === undefined) return;
    void (async () => {
      let project: string | undefined;
      const listed = await data.core.call({
        kind: codingSessionsList.kind,
        resource: codingSessionsList.resource,
        method: codingSessionsList.method,
        body: {},
      });
      if (listed.ok) {
        const list = (
          listed.value as {
            sessions?: { terminal: string; project: string }[];
          }
        ).sessions;
        project = list?.find((one) => one.terminal === terminalRef)?.project;
      }
      if (project === undefined) {
        const runtimes = await data.terminal?.core?.list();
        project = runtimes?.find(
          (one) => one.terminal_ref === terminalRef,
        )?.project;
      }
      if (project === undefined) return;
      // 이미 보이는 workspace layout에 탭이 있으면 useToastHandler가 먼저 열었다. store.has는 같은 기계의 다른 workspace 탭에도
      // 참이라 여기서 건너뛰면 빈 desk에 머문다.
      setRoute(openTerminalIn(project, terminalRef, machine));
    })();
  };
  // 다른 project나 공간에 있을 때 터미널 알림을 누르면 그 터미널의 project로 가서 연다. 같은 project이거나
  // cross-workspace workflow desk처럼 이 창에 이미 그 터미널 탭이 열려 있으면 창을 옮기지 않고 store가 탭을 고른다.
  const terminalBridge = terminal?.bridge;
  useEffect(
    () =>
      terminalBridge?.onReveal(({ project, terminal: ref }) =>
        setRoute((current) =>
          terminal?.store.has(ref) ||
          ((project === HOME_TERMINAL_PROJECT
            ? current.space === "home"
            : current.space === "project" && current.project === project) &&
            current.machine === undefined)
            ? current
            : openTerminalIn(project, ref),
        ),
      ),
    [terminal, terminalBridge],
  );
  // 저장한 모드와 사람이 바꾼 단축키를 이 창에 적용한다. core가 준비되면 읽고, 설정이 바뀌면 다시 읽는다
  // (Settings 화면, `lophn settings set`, agent 어느 쪽이 바꿔도 같다). 색·글꼴 CSS는 main이 같은 설정을 따라 넣는다.
  const appearance = settingsPanels?.appearance;
  const keyboard = settingsPanels?.keyboard;
  const applySettings = useCallback(() => {
    void appearance?.values().then((read) => {
      if (read.ok) applyAppearance(read.value);
    });
    void keyboard?.read().then((read) => {
      if (read.ok) commands.setOverrides(read.value[keyPlatform] ?? {});
    });
  }, [appearance, keyboard, commands, keyPlatform]);
  useStateChanged(["settings"], applySettings);

  // modal(dialog·palette)이 뜨면 overlay view가 상단 바까지 한 번에 scrim으로 덮고, 여기서는 상단 바 끌기만 끈다(chrome.css).
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

  // 작업대는 core 기록을 읽어 연다. 준비 전·실패에는 연결 화면(HomeGate)을 보이고, 준비되면 그때
  // 작업대를 열어 읽는다.
  const connection = useConnection(source);
  const hostMachine = useHostMachine();
  const live = connection.state === "ready" || connection.state === "stale";
  let space: ReactNode;
  // home·project·app 공간이 그리는 workspace.
  const ref: WorkspaceRef =
    route.space === "project" && route.project
      ? { kind: "project", id: route.project, ...on(route.machine) }
      : route.space === "app" && route.app
        ? { kind: "app", id: route.app, ...on(route.machine) }
        : { kind: "home", ...on(route.machine) };
  // 전역 float 층은 workspace와 Settings 위에만 있다. detached 창, 앱 전용 창, 연결 화면(HomeGate)에는 없다.
  let globalFloats = false;
  if (route.space === "project" && route.project && workspace && live) {
    globalFloats = true;
    space = (
      <WorkspaceWindow
        key={workspaceKey(ref)}
        workspace={ref}
        source={at.workspace}
        windowWidth={windowWidth}
        onHome={home}
        onSettings={settingsSpace}
        jobs={at.jobs}
        onOpenApp={apps ? appSpace : undefined}
        apps={at.apps}
        onWorkspace={goWorkspace}
        onSessionAt={sessionAt}
        onTerminalAt={terminalAt}
        onAppScreenAt={(app, machine) =>
          setRoute(openAppScreenAt(app, machine))
        }
        onNewApp={(app) => setRoute(openNewApp(app))}
        projects={at.projects}
        editor={at.editor}
        terminal={at.terminal}
        detached={at.here ? detached : undefined}
        agentViewSource={at.agentViewSource}
        session={route.session}
        sessionMachine={route.sessionMachine}
        startSession={route.startSession}
        onNewSessionAt={(workspace, start) =>
          setRoute(openWorkspaceNewSession(workspace, start))
        }
        onSettingsAt={(workspace) => setRoute(openWorkspaceSettings(workspace))}
        startSettings={route.startSettings}
        revealTerminal={route.terminal}
        open={route.open}
      />
    );
  } else if (route.space === "home" && workspace && live) {
    globalFloats = true;
    // Home은 project가 없어 detached 창이 없다. 터미널은 있다.
    space = (
      <WorkspaceWindow
        key={workspaceKey(ref)}
        workspace={ref}
        source={at.workspace}
        windowWidth={windowWidth}
        onHome={home}
        notice={
          connection.state === "stale" ? (
            <ConnectionNotice
              connection={connection}
              onRetry={() => retryConnection(source)}
              formatTime={formatTime}
            />
          ) : undefined
        }
        onSettings={settingsSpace}
        jobs={at.jobs}
        onOpenApp={apps ? appSpace : undefined}
        apps={at.apps}
        onWorkspace={goWorkspace}
        onSessionAt={sessionAt}
        onTerminalAt={terminalAt}
        onAppScreenAt={(app, machine) =>
          setRoute(openAppScreenAt(app, machine))
        }
        onNewApp={(app) => setRoute(openNewApp(app))}
        projects={at.projects}
        editor={at.editor}
        terminal={at.terminal}
        agentViewSource={at.agentViewSource}
        session={route.session}
        sessionMachine={route.sessionMachine}
        startSession={route.startSession}
        onNewSessionAt={(workspace, start) =>
          setRoute(openWorkspaceNewSession(workspace, start))
        }
        onSettingsAt={(workspace) => setRoute(openWorkspaceSettings(workspace))}
        startSettings={route.startSettings}
        revealTerminal={route.terminal}
      />
    );
  } else if (route.space === "detached") {
    // 창이 detached 탭 하나만 그리므로 core가 준비되기 전에 연결 화면으로 떨어지지 않는다.
    space =
      detached && workspace && live ? <DetachedSpace api={detached} /> : null;
  } else if (route.space === "app" && route.app && workspace && apps && live) {
    globalFloats = true;
    space = (
      <WorkspaceWindow
        key={workspaceKey(ref)}
        workspace={ref}
        source={at.workspace}
        windowWidth={windowWidth}
        onHome={home}
        onSettings={settingsSpace}
        jobs={at.jobs}
        onOpenApp={appSpace}
        apps={at.apps}
        appDetail={at.appDetail}
        onWorkspace={goWorkspace}
        onSessionAt={sessionAt}
        onTerminalAt={terminalAt}
        onAppScreenAt={(app, machine) =>
          setRoute(openAppScreenAt(app, machine))
        }
        onNewApp={(app) => setRoute(openNewApp(app))}
        projects={at.projects}
        editor={at.editor}
        windowTerminal={at.terminal}
        agentViewSource={at.agentViewSource}
        session={route.session}
        sessionMachine={route.sessionMachine}
        startSession={route.startSession}
        onNewSessionAt={(workspace, start) =>
          setRoute(openWorkspaceNewSession(workspace, start))
        }
        onSettingsAt={(workspace) => setRoute(openWorkspaceSettings(workspace))}
        startSettings={route.startSettings}
        startAppScreen={route.startAppScreen}
        startLophn={route.newSession}
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
    globalFloats = true;
    space = (
      <SettingsSpace
        key={visits}
        source={catalog}
        settingsPane={route.settingsPane}
        onHome={home}
        onBack={() => setRoute(beforeSettings.current ?? HOME)}
        backTo={backTarget(beforeSettings.current)}
        onProject={(project, machine) =>
          setRoute(openProject(project, on(machine)))
        }
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
    space = <HomeGate source={source} />;
  }
  // 창 shortcut의 Home 복귀와 팔레트는 어느 공간에서든 이 한 곳에서 받는다.
  const tree = (
    <SidebarMemoryProvider memory={sidebarMemory}>
      <TrayMemoryProvider memory={trayMemory}>
        <CommandsProvider value={commands}>
          <AppKeyContributions />
          <PaletteProvider deps={palette} onHome={home}>
            <DefaultToastHandler
              openSession={openSession}
              openTerminal={openRemoteTerminal}
              goApp={(app, machine) =>
                setRoute(openApp(app, undefined, machine))
              }
            />
            <GlobalFloatsProvider
              enabled={
                route.space !== "detached" && route.space !== "app-window"
              }
            >
              <WorkspaceViewsProvider>
                {/* 목록은 workspace를 그리는 창만 읽는다(detached 창과 앱 전용 창은 읽지 않는다). */}
                {route.space === "detached" || route.space === "app-window" ? (
                  space
                ) : (
                  <MachineListsProvider>{space}</MachineListsProvider>
                )}
                {globalFloats && workspace ? (
                  <GlobalFloatLayer
                    env={{
                      source: workspace,
                      hostMachine,
                      editor,
                      terminal,
                      agentViewSource,
                      apps,
                      onOpenApp: apps ? appSpace : undefined,
                      onSettings: settingsSpace,
                    }}
                  />
                ) : null}
                <TrayPopupLayer memory={trayMemory} />
              </WorkspaceViewsProvider>
            </GlobalFloatsProvider>
            {overlay &&
            route.space !== "detached" &&
            route.space !== "app-window" ? (
              <ToastHost overlay={overlay} />
            ) : null}
            {overlay && terminal ? (
              <HookPromptHost overlay={overlay} terminals={terminal.store} />
            ) : null}
            {intents &&
            route.space !== "detached" &&
            route.space !== "app-window" ? (
              <DesktopIntents
                intents={intents}
                catalog={catalog}
                go={go}
                onSettings={settingsSpace}
              />
            ) : null}
          </PaletteProvider>
        </CommandsProvider>
      </TrayMemoryProvider>
    </SidebarMemoryProvider>
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
