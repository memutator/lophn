import { useMemo, useRef } from "react";

import { useSessions } from "../desktop/connection/events/hooks.tsx";
import { useAppViews } from "../app-frame/app-views.tsx";
import {
  createViewCovers,
  createViewKeeps,
} from "../app-frame/embedded-view.tsx";
import { createWebviewHost } from "../browser/webview-host.tsx";
import type { AgentTabSourceFactory } from "../conversation/agent-tab-source.ts";
import { DraftStore } from "../conversation/drafts.ts";
import { useConversation } from "../conversation/window-deps.tsx";
import { useSidebarAgents } from "./agents/sidebar-agents.ts";
import { openAgent } from "./kinds/agent.tsx";
import { openFile } from "./kinds/document-editor.tsx";
import type { AgentsSlice, AgentViewSlice, TabHost } from "./kinds/host.ts";
import {
  agentRow,
  openedProjectManagerSession,
  sessionDot,
} from "./sidebar/panel-sessions.ts";
import type { WorkspaceSource } from "./source.ts";
import type { SettingsPane } from "../desktop/settings/model.ts";

interface TabHostSlicesInput {
  project: string;
  source: WorkspaceSource;
  agentViewSource?: AgentTabSourceFactory;
  /** 이 창이 만든 TabHost. slice는 이벤트 때만 불러 최신 host를 본다. */
  host: () => TabHost;
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
    onSettings,
    onProjectInstructions,
  } = input;
  const agentsSource = source.agentsSource;
  const sidebarAgents = useSidebarAgents(agentsSource, project);
  const { sessions: sessionStates } = useSessions();
  const conversation = useConversation();
  // 창에 대화 메모리가 없을 때(통로 없는 화면 시험) Agent 탭이 쓰는 입력 메모리.
  const localDrafts = useMemo(() => new DraftStore(), []);
  const hostRef = useRef(input.host);
  hostRef.current = input.host;

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

  // session을 가진 agent의 sidebar 줄.
  const rowOfSession = (session: string) => {
    const entry = sessionStates.find((item) => item.session === session);
    return entry === undefined
      ? undefined
      : agentRow(entry, sidebarAgents.agents, project);
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
      openSession: (session) => {
        const row = rowOfSession(session);
        if (row === undefined) return;
        openAgent(hostRef.current(), {
          agent: row.assignment,
          name: row.name,
          session,
        });
      },
      projectManagerSession: () =>
        openedProjectManagerSession(sessionStates, project),
      nameOf: (session) => rowOfSession(session)?.name,
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
    agentView,
    agents,
    covers,
    appViews,
    keeps,
    webviews,
  };
}
