// 전역 float 층. Desktop이 `{space}` 옆에 한 번 놓는다(workspace 창 밖이라 workspace를 바꿔도 다시 mount되지 않고, 그 안의
// <webview> page도 다시 load되지 않는다). 본문은 탭이 나온 workspace의 TabHost로 그리고(detached 창이 탭 하나를 그리는 것과
// 같은 방식), 탭의 기계 범위(TabScope)에 선다: 다른 기계의 탭은 그 기계의 통로로 그리고 그 기계가 꺼져 있으면 한 줄이다.
// 바깥을 누르면 고정 안 한 펼친 것이 접힌다.

import { Icon } from "@lophn/ui/primitives";
import { iconPixels, useObservedSize } from "@lophn/ui/shared";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { ViewKeepsProvider } from "../../app-frame/embedded-view.tsx";
import {
  WebviewHostProvider,
  WebviewLayer,
} from "../../app-frame/webview-host.tsx";
import type { AppsSource } from "../../apps/source.ts";
import type { EditorDeps } from "../../editor/document-view.tsx";
import type { AgentTabSourceFactory } from "../../conversation/agent-tab-source.ts";
import type { TerminalDeps } from "../../terminal/deps.ts";
import type { SettingsPane } from "../../desktop/settings/model.ts";
import type { SessionDot } from "../../parts/agent-session/activity.ts";
import {
  OwnerProvider,
  ownerLookup,
} from "../../parts/agent-session/owner.tsx";
import { useSessions } from "../../desktop/connection/events/hooks.tsx";
import { useSidebarAgents } from "../../workspace/agents/sidebar-agents.ts";
import type { TabHost } from "../../workspace/kinds/host.ts";
import { isThisComputerOnly } from "../../workspace/kinds/kind.ts";
import { tabKindOf } from "../../workspace/kinds/registry.ts";
import type { ProjectView, WorkspaceSource } from "../../workspace/source.ts";
import { TabBoundary } from "../../workspace/tab-boundary.tsx";
import {
  useMachinesView,
  useScopeMachineItem,
} from "../../desktop/machines/context.tsx";
import { useMachineHub } from "../../desktop/machines/scope.tsx";
import { OnlyHere } from "../../desktop/machines/only-here.tsx";
import {
  type MachineRef,
  useScopeMachine,
} from "../../desktop/machines/scope.tsx";
import { TabScope } from "../../desktop/machines/tab-scope.tsx";
import { useTabHostSlices } from "../../workspace/use-tab-host-slices.ts";
import type { WorkspaceWindowProps } from "../../workspace/workspace-window.tsx";
import { clampFloatRect } from "../../workspace/model.ts";
import {
  deskTabs,
  type FloatRect,
  newFloatRect,
  type TabItem,
} from "../desk-model.ts";
import { FloatLayer } from "../float-layer.tsx";
import styles from "./global-float-layer.module.css";
import {
  type GlobalFloatView,
  useGlobalFloats,
  useGlobalFloatsHost,
} from "./global-floats.tsx";

/** 본문이 workspace 창 없이 kind를 그리려고 Desktop에서 받는 통로. */
export interface GlobalFloatEnv {
  source: WorkspaceSource;
  /** 범위의 기계와 기계마다의 묶음(`useHostMachine`). */
  hostMachine: Pick<TabHost, "machine" | "machineData">;
  editor?: EditorDeps;
  terminal?: TerminalDeps;
  agentViewSource?: AgentTabSourceFactory;
  apps?: AppsSource;
  /** 앱 panel을 선언하지 않은 화면을 앱 공간으로 안내하는 길. */
  onOpenApp?: (app: string, machine?: string) => void;
  onSettings: (pane?: SettingsPane) => void;
}

const noop = () => {};

// float의 workspace가 다른 기계의 것이면 그 기계의 통로 묶음으로 바꾼 env. 이 컴퓨터의 env는 창이 이미 지닌 것(문서 편집, 터미널)이다.
function envOn(env: GlobalFloatEnv, machine: MachineRef): GlobalFloatEnv {
  if (machine === env.hostMachine.machine) return env;
  const data = env.hostMachine.machineData(machine);
  return {
    source: data.workspace,
    hostMachine: { machine, machineData: env.hostMachine.machineData },
    ...(data.editor === undefined ? {} : { editor: data.editor }),
    ...(data.terminal === undefined ? {} : { terminal: data.terminal }),
    agentViewSource: data.agentViewSource,
    apps: data.apps,
    ...(env.onOpenApp === undefined ? {} : { onOpenApp: env.onOpenApp }),
    onSettings: env.onSettings,
  };
}

const envOf = (env: GlobalFloatEnv, float: GlobalFloatView) =>
  envOn(env, float.workspace.machine ?? env.hostMachine.machine);

// kind가 host로 읽는 값 가운데 이 창에 없는 것(탭 줄, project 설정, 앱 화면 목록)은 비워 둔다.
function hostOf(
  env: GlobalFloatEnv,
  float: GlobalFloatView,
  parts: Pick<
    TabHost,
    | "desk"
    | "viewKeeps"
    | "agents"
    | "agentView"
    | "projectTitle"
    | "windowTabs"
    | "openTab"
    | "openFloat"
    | "patchTab"
    | "removeTab"
    | "document"
  >,
): TabHost {
  const { workspace } = float;
  const props: WorkspaceWindowProps = {
    workspace,
    source: env.source,
    windowWidth: globalThis.innerWidth,
    onHome: noop,
    onSettings: env.onSettings,
    editor: env.editor,
    terminal: env.terminal,
    agentViewSource: env.agentViewSource,
    apps: env.apps,
    onOpenApp: env.onOpenApp,
  };
  return {
    workspace,
    projectId: workspace.kind === "project" ? workspace.id : null,
    explorerRoot: undefined,
    appName: undefined,
    appRenamed: () => {},
    props,
    appScreens: false,
    projectSettings: null,
    ...env.hostMachine,
    ...parts,
  };
}

// float 하나의 본문. 탭의 기계 범위 안에서 그린다. 그 기계가 붙어 있지 않으면 본문 대신 그 기계의 상태 한 줄이다.
function GlobalFloatBody(props: {
  float: GlobalFloatView;
  env: GlobalFloatEnv;
  area: { width: number; height: number };
}) {
  const scope = useScopeMachine();
  const { tab, workspace } = props.float;
  return (
    <TabScope tab={tab} workspaceMachine={workspace.machine ?? scope}>
      <GlobalFloatContent {...props} />
    </TabScope>
  );
}

// 이 float의 workspace로 slice를 만들어 kind의 keep·render를 부른다.
function GlobalFloatContent({
  float,
  env: layerEnv,
  area,
}: {
  float: GlobalFloatView;
  env: GlobalFloatEnv;
  area: { width: number; height: number };
}) {
  const env = envOf(layerEnv, float);
  const globalFloats = useGlobalFloats();
  const pool = useGlobalFloatsHost();
  const { workspace, tab } = float;
  const def = tabKindOf(tab.kind);
  const latest = useRef(globalFloats);
  latest.current = globalFloats;

  const [projectView, setProjectView] = useState<ProjectView | null>(null);
  const project = workspace.kind === "project" ? workspace.id : null;
  useEffect(() => {
    if (project === null) return;
    let live = true;
    void env.source.project(project).then((read) => {
      if (live && read.ok) setProjectView(read.value);
    });
    return () => {
      live = false;
    };
  }, [env.source, project]);

  const { agentView, agents, keeps } = useTabHostSlices({
    workspace,
    source: env.source,
    agentViewSource: env.agentViewSource,
    terminalStore: env.terminal?.store,
    host: () => hostRef.current,
    onSettings: env.onSettings,
    pool,
  });

  // 이 float에서 연 탭은 이 float 옆의 전역 float이 된다. 이미 있는 탭은 펼쳐 올린다.
  const openGlobal = (next: TabItem, at?: FloatRect | FloatArea) => {
    const existing = latest.current.floats.find(
      (item) => item.key === next.key,
    );
    if (existing !== undefined) {
      latest.current.expand(existing.key);
      return;
    }
    const rect =
      at !== undefined && "x" in at
        ? clampFloatRect(at, area)
        : newFloatRect(area, at);
    latest.current.add({
      tab: next,
      workspace,
      rect,
      minimized: false,
      pinned: false,
    });
  };

  const host: TabHost = hostOf(env, float, {
    desk: globalFloats.desk,
    viewKeeps: keeps,
    agents,
    agentView,
    projectTitle: projectView?.title,
    windowTabs: () => deskTabs(latest.current.desk),
    openTab: (next) => openGlobal(next),
    openFloat: (next, at) => openGlobal(next, at),
    patchTab: (key, patch) => latest.current.patch(key, patch),
    removeTab: (key) => latest.current.remove(key),
    // 읽던 위치는 탭 값이라 저장된다(toStored가 readPosition을 싣는다).
    document: {
      noteReadPosition: (document, position) =>
        latest.current.patch(document, { readPosition: position }),
    },
  });
  const hostRef = useRef(host);
  hostRef.current = host;
  const machine = useScopeMachineItem();

  const { registerHost } = globalFloats;
  useEffect(
    () => registerHost(float.key, () => hostRef.current),
    [registerHost, float.key],
  );

  // transfer가 낸 값은 그리기 전에 한 번 받는다.
  const received = useRef(false);
  if (!received.current) {
    received.current = true;
    const transfer = globalFloats.takeTransfer(float.key);
    if (transfer !== undefined) def?.receive?.(tab, transfer, host);
  }

  if (def === undefined) return null;
  if (machine !== null && isThisComputerOnly(def, tab)) {
    return <OnlyHere machine={machine} />;
  }
  return (
    <TabBoundary key={tab.key}>
      {def.keep?.(tab, true, host) ?? def.render?.(tab, true, host)}
    </TabBoundary>
  );
}

type FloatArea = { readonly width: number; readonly height: number };

export function GlobalFloatLayer({ env }: { env: GlobalFloatEnv }) {
  const floats = useGlobalFloats();
  const host = useGlobalFloatsHost();
  // float bar의 주인 이름과 얼굴. 층은 workspace 창 밖이라 이 창의 Home agent 목록과 lophn 이름으로 찾는다.
  const { sessions } = useSessions();
  const owners = useSidebarAgents(env.source.agentsSource, null);
  const ref = useRef<HTMLDivElement>(null);
  const size = useObservedSize(ref);
  // 터미널 탭의 아이콘과 점이 agent 상태를 따라 바뀐다. float의 터미널은 어느 기계의 것이든 그 기계의 store가 안다.
  const hub = useMachineHub();
  const machineIds = (useMachinesView()?.machines ?? [])
    .filter((one) => one.status !== "removed")
    .map((one) => one.id)
    .join();
  const terminalStores = useMemo(
    () =>
      [
        env.terminal?.store,
        ...(machineIds === "" ? [] : machineIds.split(",")).map(
          (id) => hub?.get(id).terminal?.store,
        ),
      ].flatMap((store) => (store === undefined ? [] : [store])),
    [env.terminal?.store, machineIds, hub],
  );
  useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        const stops = terminalStores.map((store) => store.subscribe(listener));
        return () => stops.forEach((stop) => stop());
      },
      [terminalStores],
    ),
    () => terminalStores.map((store) => store.version()).join(),
  );
  if (host === null) return null;
  // 0이면 못 잰 것과 같다(0x0으로 가둔 rect는 저장이 거절된다).
  const area =
    size !== undefined && size.width > 0 && size.height > 0 ? size : undefined;
  // 제목 줄의 아이콘과 상태 점은 본문의 slice 없이 읽는다. agent의 profile 아이콘과 상태 점은 본문 안에서만 알 수 있어 종류 아이콘이다.
  const chrome = (
    item: GlobalFloatView,
  ): { icon: ReactNode; dot: SessionDot | null } => {
    const def = tabKindOf(item.tab.kind);
    if (def === undefined) return { icon: null, dot: null };
    const light = hostOf(envOf(env, item), item, {
      desk: floats.desk,
      viewKeeps: host.keeps,
      agents: null,
      agentView: null,
      projectTitle: undefined,
      windowTabs: () => deskTabs(floats.desk),
      openTab: noop,
      openFloat: noop,
      patchTab: noop,
      removeTab: noop,
      document: { noteReadPosition: noop },
    });
    return {
      icon: def.iconOf?.(item.tab, light) ?? (
        <Icon icon={def.icon} pixels={iconPixels("small")} />
      ),
      dot: def.dotOf?.(item.tab, light) ?? null,
    };
  };
  return (
    <div className={styles.layer} data-global-floats="">
      <OwnerProvider
        lookup={ownerLookup(sessions, owners.agents, owners.lophnNames)}
      >
        <ViewKeepsProvider value={host.keeps}>
          <WebviewHostProvider value={host.webviews}>
            <WebviewLayer host={host.webviews} />
            <FloatLayer
              layerRef={ref}
              area={area}
              floats={floats.floats
                .filter((item) => !item.minimized)
                .map((item) => ({
                  key: item.key,
                  title: item.title,
                  icon: chrome(item).icon,
                  dot: chrome(item).dot,
                  ...(item.tab.owner === undefined
                    ? {}
                    : { owner: item.tab.owner }),
                  rect: item.rect,
                  pinned: item.pinned,
                  ...(floats.canMoveToDesk(item) ? { global: true } : {}),
                  ...(item.tab.kind === "app_panel" ? { appHead: true } : {}),
                  body: (
                    <GlobalFloatBody
                      key={item.key}
                      float={item}
                      env={env}
                      area={area ?? { width: 0, height: 0 }}
                    />
                  ),
                }))}
              onRaise={floats.expand}
              onRect={floats.setRect}
              onMinimize={floats.minimize}
              onGlobal={floats.moveToDesk}
              onClose={floats.close}
              onPin={floats.pin}
              onOutside={floats.minimizeLoose}
            />
          </WebviewHostProvider>
        </ViewKeepsProvider>
      </OwnerProvider>
    </div>
  );
}
