import { useEffect, useMemo, useRef, useState } from "react";

import { useSessions } from "../desktop/connection/events/hooks.tsx";
import { useAppViews } from "../app-frame/app-views.tsx";
import {
  createViewCovers,
  createViewKeeps,
} from "../app-frame/embedded-view.tsx";
import { createWebviewHost } from "../browser/webview-host.tsx";
import type { AgentTabSourceFactory } from "../conversation/agent-tab-source.ts";
import type { ContextChipView } from "../conversation/composer/types.ts";
import { DraftStore } from "../conversation/drafts.ts";
import { useConversation } from "../conversation/window-deps.tsx";
import { useSidebarAgents } from "./agents/sidebar-agents.ts";
import type { ContextListItem } from "./contexts/source.ts";
import { openAgent } from "./kinds/agent.tsx";
import { openFile } from "./kinds/document-editor.tsx";
import type {
  AgentsSlice,
  AgentViewSlice,
  ContextsSlice,
  TabHost,
} from "./kinds/host.ts";
import { openSearchFor } from "./kinds/search.tsx";
import {
  agentByRole,
  openedProjectManagerSession,
  sessionDot,
} from "./sidebar/panel-sessions.ts";
import type { FileRow, ProjectView, WorkspaceSource } from "./source.ts";
import type { SettingsPane } from "../desktop/settings/model.ts";

const NO_CONTEXTS: readonly ContextListItem[] = [];

interface TabHostSlicesInput {
  project: string;
  source: WorkspaceSource;
  agentViewSource?: AgentTabSourceFactory;
  /** 이 창이 만든 TabHost. slice는 이벤트 때만 불러 최신 host를 본다. */
  host: () => TabHost;
  projectView: ProjectView | null;
  files: readonly FileRow[];
  /** 이 창에서 앱 화면을 여는 길. detached 창은 noop이다. */
  onSettings: (pane?: SettingsPane) => void;
  onProjectInstructions?: () => void;
}

// project 창(Workspace)과 detached 창(DetachedTab)이 같이 쓰는 TabHost slice와 view 보관소.
// 창마다 다른 것(openTab·openFloat·patchTab·removeTab·view)은 호출하는 쪽이 host에 직접 넣는다.
export function useTabHostSlices(input: TabHostSlicesInput) {
  const {
    project,
    source,
    agentViewSource,
    projectView,
    files,
    onSettings,
    onProjectInstructions,
  } = input;
  const contextsSource = source.contextsSource;
  const agentsSource = source.agentsSource;
  const sidebarAgents = useSidebarAgents(agentsSource, project);
  const { sessions: sessionStates } = useSessions();
  const conversation = useConversation();
  // 창에 대화 메모리가 없을 때(통로 없는 화면 시험) Agent 탭이 쓰는 입력 메모리.
  const localDrafts = useMemo(() => new DraftStore(), []);
  const hostRef = useRef(input.host);
  hostRef.current = input.host;

  // 이 project의 context 목록. 여는 때(Contexts 탭, sidebar의 Context 모양, 새 탭 menu)만 읽는다.
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
  // 탭 view의 보관소. 닫는 일은 호출하는 쪽 effect가 정한다.
  const closeViewRef = useRef<(session: string) => void>(() => {});
  closeViewRef.current = (session) =>
    void appViews?.views.closeView({ view_session: session }).catch(() => {});
  // browser 탭의 <webview> 그릇. 창마다 하나이고 탭 key당 <webview> 하나다(옮기면 다시 load된다).
  const webviews = useMemo(createWebviewHost, []);
  const keeps = useMemo(
    () => createViewKeeps((session) => closeViewRef.current(session)),
    [],
  );

  // 검색 결과·Overview 예시의 도메인 객체는 그 파일 탭으로 간다. 경로는 연결 폴더 기준 상대 경로이거나
  // 절대 경로다.
  const openPath = (path: string) => {
    if (path.startsWith("/")) {
      openFile(hostRef.current(), path);
      return;
    }
    const folders = projectView?.folders ?? [];
    const row = files.find((item) =>
      item.path === path || item.path.endsWith(`/${path}`)
    );
    const folder = row?.folder ??
      (folders.find((item) => item.found) ?? folders[0])?.path;
    if (folder === undefined) return;
    openFile(hostRef.current(), `${folder.replace(/\/+$/, "")}/${path}`);
  };

  // Project Manager에게 묻는 단추(askProjectManager). 열린 PM session이 있으면 그 탭에, 없으면 새 PM 탭에 chip을 붙인다.
  const askPm = (chips: readonly ContextChipView[]) => {
    const row = agentByRole(sidebarAgents.agents, "project_manager");
    if (agentViewSource === undefined || row === undefined) return;
    openAgent(hostRef.current(), {
      agent: row.assignment,
      name: row.name,
      session: openedProjectManagerSession(sessionStates, project),
      chips,
    });
  };

  const contexts: ContextsSlice | null = contextsSource === undefined ? null : {
    source: contextsSource,
    list: contextList,
    titleOf: (id) => contextList.find((item) => item.id === id)?.title,
    refresh: readContexts,
    openPath,
    openSearch: (state) => openSearchFor(hostRef.current(), state),
    askProjectManager: askPm,
  };

  const agentView: AgentViewSlice | null = agentViewSource === undefined
    ? null
    : {
      factory: agentViewSource,
      drafts: conversation?.drafts ?? localDrafts,
      ...(conversation?.now === undefined ? {} : { now: conversation.now }),
      openFile: (path) => openFile(hostRef.current(), path),
      profileOf: (agent) =>
        sidebarAgents.agents.find((row) => row.assignment === agent)?.profile,
      dotOf: (session) => sessionDot(sessionStates, session),
      openSettings: () => onSettings("tools"),
      openConnections: () => onSettings("providers"),
    };

  const agents: AgentsSlice | null = agentsSource === undefined ? null : {
    source: agentsSource,
    changed: sidebarAgents.reload,
    editInstructions: () => onProjectInstructions?.(),
    openExtensions: () => onSettings("tools"),
  };

  return {
    sidebarAgents,
    sessionStates,
    contextList,
    setContextList,
    readContexts,
    contexts,
    agentView,
    agents,
    covers,
    appViews,
    keeps,
    webviews,
  };
}
