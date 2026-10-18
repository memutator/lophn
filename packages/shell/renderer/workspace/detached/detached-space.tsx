import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { Button, Icon, IconButton } from "@lophn/ui/primitives";
import { Loading, Skeleton } from "@lophn/ui/feedback";
import { Tooltip } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/wording";

import type {
  DetachedBounds,
  DetachedTaken,
  LophnDetachedApi,
  TabTransfer,
} from "../../../ipc/detached.ts";
import { slimDetachedTab } from "../../../ipc/detached.ts";
import { TopBar } from "../../desktop/top-bar/top-bar.tsx";
import { useSessions } from "../../desktop/connection/events/hooks.tsx";
import { workspaceIcons } from "../../icons/mod.ts";
import { useAppViews } from "../../app-frame/app-views.tsx";
import {
  createViewCovers,
  createViewKeeps,
  ViewCoversProvider,
  ViewKeepsProvider,
} from "../../app-frame/embedded-view.tsx";
import {
  createWebviewHost,
  WebviewHostProvider,
  WebviewLayer,
} from "../../browser/webview-host.tsx";
import type { EditorDeps } from "../../editor/document-view.tsx";
import type { TerminalDeps } from "../../terminal/deps.ts";
import type { AgentTabSourceFactory } from "../../conversation/agent-tab-source.ts";
import { useConversation } from "../../conversation/window-deps.tsx";
import { DraftStore } from "../../conversation/drafts.ts";
import type { ContextListItem } from "../contexts/source.ts";
import type { ProjectView, WorkspaceSource } from "../source.ts";
import { useSidebarAgents } from "../agents/sidebar-agents.ts";
import {
  agentByRole,
  openedProjectManagerSession,
  sessionDot,
} from "../sidebar/panel-sessions.ts";
import { openAgent } from "../kinds/agent.tsx";
import { openFile } from "../kinds/document-editor.tsx";
import { openSearchFor } from "../kinds/search.tsx";
import { tabKindOf } from "../kinds/registry.ts";
import type {
  AgentsSlice,
  AgentViewSlice,
  ContextsSlice,
  TabHost,
} from "../kinds/host.ts";
import type { TabItem, WorkspaceView } from "../model.ts";
import type { WorkspaceProps } from "../workspace.tsx";
import styles from "./detached-space.module.css";

interface DetachedSpaceProps {
  api: LophnDetachedApi;
  workspace: WorkspaceSource;
  editor?: EditorDeps;
  terminal?: TerminalDeps;
  agentViewSource?: AgentTabSourceFactory;
}

// take()는 bounds를 주지 않는다. 이 창에서는 읽는 곳이 없어 자리표시다.
const BOUNDS: DetachedBounds = { x: 0, y: 0, width: 1, height: 1 };
const NO_CONTEXTS: readonly ContextListItem[] = [];

type Taken =
  | { state: "loading" }
  | { state: "failed" }
  | { state: "ready"; taken: DetachedTaken };

// detached 창 하나. 탭 하나를 받아 그리고, [Dock]이나 창 닫기가 그 탭을 project 창으로 돌려보낸다.
export function DetachedSpace(props: DetachedSpaceProps): ReactElement {
  const { api } = props;
  const [attempt, setAttempt] = useState(0);
  const [taken, setTaken] = useState<Taken>({ state: "loading" });
  useEffect(() => {
    let live = true;
    setTaken({ state: "loading" });
    api.take().then(
      (value) => live && setTaken({ state: "ready", taken: value }),
      () => live && setTaken({ state: "failed" }),
    );
    return () => {
      live = false;
    };
  }, [api, attempt]);
  // 탭을 받지 못했으면 창은 [Reload]만 두고 dock-request는 듣지 않는다. 창 닫기(dock-request)에 remove를 부르면 project 창이 탭을 버리므로
  // 일시적 실패가 탭을 잃게 한다. 창이 정말 사라지면 main이 저장된 값으로 돌려보낸다.

  if (taken.state === "ready") {
    return <DetachedTab {...props} taken={taken.taken} />;
  }
  return (
    <div className={styles.window}>
      <TopBar />
      <div className={styles.body}>
        <Loading
          loading={taken.state === "loading"}
          placeholder={<Skeleton lines={2} />}
        >
          <div className={styles.failed} data-detached-failed>
            <p>{t("project-workspace.error.load-failed")}</p>
            <Button onClick={() => setAttempt((count) => count + 1)}>
              {t("common.button.reload")}
            </Button>
          </div>
        </Loading>
      </div>
    </div>
  );
}

function DetachedTab(
  { api, workspace, editor, terminal, agentViewSource, taken }:
    & DetachedSpaceProps
    & { taken: DetachedTaken },
) {
  const { project } = taken;
  // DetachedTab은 key와 kind만 적은 모양이라 나머지 칸은 TabItem으로 읽는다.
  const [tab, setTab] = useState(taken.tab as TabItem);
  const tabRef = useRef(tab);
  const def = tabKindOf(tab.kind);

  const [projectView, setProjectView] = useState<ProjectView | null>(null);
  useEffect(() => {
    let live = true;
    void workspace.project(project).then((read) => {
      if (live && read.ok) setProjectView(read.value);
    });
    return () => {
      live = false;
    };
  }, [workspace, project]);

  // 아래 slice 설정은 Workspace의 것을 따라 만들었다. 앱 화면을 여는 길(Settings 등)은 이 창에 없다.
  const contextsSource = workspace.contextsSource;
  const agentsSource = workspace.agentsSource;
  const sidebarAgents = useSidebarAgents(agentsSource, project);
  const { sessions: sessionStates } = useSessions();
  const conversation = useConversation();
  const localDrafts = useMemo(() => new DraftStore(), []);
  const [contextList, setContextList] = useState<readonly ContextListItem[]>(
    NO_CONTEXTS,
  );
  const readContexts = () => {
    if (contextsSource === undefined) return;
    void contextsSource.list(project).then((read) => {
      if (read.ok) setContextList(read.value);
    });
  };
  useEffect(readContexts, [contextsSource, project]);

  const covers = useMemo(createViewCovers, []);
  const appViews = useAppViews();
  const closeViewRef = useRef<(session: string) => void>(() => {});
  closeViewRef.current = (session) =>
    void appViews?.views.closeView({ view_session: session }).catch(() => {});
  const webviews = useMemo(createWebviewHost, []);
  const keeps = useMemo(
    () => createViewKeeps((session) => closeViewRef.current(session)),
    [],
  );
  const key = taken.tab.key;
  useEffect(() => () => webviews.release(key), [webviews, key]);

  const view = useMemo<WorkspaceView>(() => ({
    panes: [{ tabs: [], selected: null }],
    splitRatio: 0.5,
    focusedPane: 0,
    floats: [],
    detached: [{ tab, bounds: BOUNDS }],
  }), [tab]);

  const noop = () => {};
  const hostProps: WorkspaceProps = {
    projectId: project,
    source: workspace,
    windowWidth: globalThis.innerWidth,
    bodyWidth: globalThis.innerWidth,
    onLauncher: noop,
    onSettings: noop,
    editor,
    terminal,
    agentViewSource,
  };

  const contexts: ContextsSlice | null = contextsSource === undefined ? null : {
    source: contextsSource,
    list: contextList,
    titleOf: (id) => contextList.find((item) => item.id === id)?.title,
    refresh: readContexts,
    openPath: (path) => {
      const folder = (projectView?.folders.find((item) => item.found) ??
        projectView?.folders[0])?.path;
      if (path.startsWith("/")) openFile(host, path);
      else if (folder !== undefined) {
        openFile(host, `${folder.replace(/\/+$/, "")}/${path}`);
      }
    },
    openSearch: (state) => openSearchFor(host, state),
    askProjectManager: (chips) => {
      const row = agentByRole(sidebarAgents.agents, "project_manager");
      if (agentViewSource === undefined || row === undefined) return;
      openAgent(host, {
        agent: row.assignment,
        name: row.name,
        session: openedProjectManagerSession(sessionStates, project),
        chips,
      });
    },
  };
  const agentView: AgentViewSlice | null = agentViewSource === undefined
    ? null
    : {
      factory: agentViewSource,
      drafts: conversation?.drafts ?? localDrafts,
      ...(conversation?.now === undefined ? {} : { now: conversation.now }),
      openFile: (path) => openFile(host, path),
      profileOf: (agent) =>
        sidebarAgents.agents.find((row) => row.assignment === agent)?.profile,
      dotOf: (session) => sessionDot(sessionStates, session),
      openSettings: noop,
      openConnections: noop,
    };
  const agents: AgentsSlice | null = agentsSource === undefined ? null : {
    source: agentsSource,
    changed: sidebarAgents.reload,
    editInstructions: noop,
    openExtensions: noop,
  };

  const host: TabHost = {
    projectId: project,
    projectTitle: projectView?.title,
    props: hostProps,
    appScreens: false,
    view,
    viewKeeps: keeps,
    // 이 창에는 탭 줄이 없다. project 창에 docked로 연다.
    openTab: (next) => {
      void api.openTab({ tab: slimDetachedTab(next) }).catch(() => {});
    },
    // 크기 준 popup(adopt)만 또 하나의 detached 창으로 옮긴다. DevTools 패널 같은 것은 이 창에 둘 수 없다.
    openFloat: (next) => {
      const adopt = next.fields?.adopt;
      if (typeof adopt !== "string") return;
      void api.open({
        project,
        tab: slimDetachedTab(next),
        transfer: { value: null, views: [adopt] },
        bounds: null,
      }).catch(() => {});
    },
    patchTab: (target, patch) => {
      if (target !== tabRef.current.key) return;
      const current = tabRef.current;
      const next = {
        ...current,
        ...(typeof patch === "function" ? patch(current) : patch),
      };
      tabRef.current = next;
      setTab(next);
      void api.changed({ tab: slimDetachedTab(next) }).catch(() => {});
    },
    // DevTools 패널처럼 이 창에 없는 탭을 지우는 호출이 창을 닫지 않게 이 탭의 key만 받는다.
    removeTab: (target) => {
      if (target === tabRef.current.key) void api.remove().catch(() => {});
    },
    document: { noteReadPosition: noop },
    contexts,
    agents,
    agentView,
  };
  const hostRef = useRef(host);
  hostRef.current = host;

  // transfer가 낸 값은 그리기 전에 한 번 받는다.
  const received = useRef(false);
  if (!received.current) {
    received.current = true;
    if (taken.transfer !== null) def?.receive?.(tab, taken.transfer, host);
  }

  // [Dock]과 창 닫기는 같은 흐름이다. transfer가 null이거나 dock이 거절되면 창과 탭은 그대로다.
  const docking = useRef(false);
  const dock = async () => {
    if (docking.current) return;
    docking.current = true;
    try {
      const current = hostRef.current;
      const transfer: TabTransfer | null = def?.transfer
        ? await def.transfer(tabRef.current, current)
        : { value: null, views: [] };
      if (transfer === null) return;
      // transfer가 탭을 바꿨을 수 있어 지금 값을 다시 읽는다.
      await api.dock({ tab: slimDetachedTab(tabRef.current), transfer });
    } catch {
      // 거절되면 창을 그대로 둔다.
    } finally {
      docking.current = false;
    }
  };
  const dockRef = useRef(dock);
  dockRef.current = dock;
  useEffect(() =>
    api.subscribe((event) => {
      if (event.kind === "dock-request") void dockRef.current();
    }), [api]);

  const label = t("project-workspace.button.detached-dock");
  const icon = def === undefined ? undefined : def.iconOf?.(tab, host) ??
    <Icon icon={def.icon} pixels={iconPixels("small")} />;
  const body = def === undefined
    ? null
    : def.keep?.(tab, true, host) ?? def.render?.(tab, true, host) ?? null;

  return (
    <ViewCoversProvider value={covers}>
      <ViewKeepsProvider value={keeps}>
        <WebviewHostProvider value={webviews}>
          <div className={styles.window}>
            <TopBar
              leading={
                <>
                  {icon}
                  <span className={styles.title} data-detached-title>
                    {tab.title}
                  </span>
                </>
              }
              trailing={
                <Tooltip content={label}>
                  <IconButton
                    icon={workspaceIcons.dock}
                    label={label}
                    size="sm"
                    data-detached-action="dock"
                    onClick={() => void dock()}
                  />
                </Tooltip>
              }
            />
            <div className={styles.body}>
              {body}
              <WebviewLayer host={webviews} />
            </div>
          </div>
        </WebviewHostProvider>
      </ViewKeepsProvider>
    </ViewCoversProvider>
  );
}
