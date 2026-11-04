import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";

import { useArtifactList } from "../artifact/use-artifact-list.ts";
import { useSessions } from "../desktop/connection/events/hooks.tsx";
import { useAppViews } from "../app-frame/app-views.tsx";
import { createViewKeeps } from "../app-frame/embedded-view.tsx";
import { createWebviewHost } from "../app-frame/webview-host.tsx";
import type { AgentTabSourceFactory } from "../conversation/agent-tab-source.ts";
import { DraftStore } from "../conversation/drafts.ts";
import { useConversation } from "../conversation/window-deps.tsx";
import type { TerminalStore } from "../terminal/store.ts";
import { useSidebarAgents } from "./agents/sidebar-agents.ts";
import { openAgent } from "./kinds/agent.tsx";
import { openArtifact } from "./kinds/artifact.tsx";
import { openFile } from "./kinds/document-editor.tsx";
import type { AgentsSlice, AgentViewSlice, TabHost } from "./kinds/host.ts";
import { openTerminal } from "./kinds/terminal.tsx";
import {
  agentRow,
  openedPlaceLophnSession,
  sessionDot,
} from "./sidebar/panel-sessions.ts";
import type { WorkspaceSource } from "./source.ts";
import type { SettingsPane } from "../desktop/settings/model.ts";
import type { PlaceRef } from "../shell/desk-model.ts";

interface TabHostSlicesInput {
  /** 이 창의 place. */
  place: PlaceRef;
  source: WorkspaceSource;
  agentViewSource?: AgentTabSourceFactory;
  /** 이 창이 만든 TabHost. slice는 이벤트 때만 불러 최신 host를 본다. */
  host: () => TabHost;
  /** 이 창의 터미널 store. 탭 줄이 터미널 안 agent의 icon·점을 읽으려고 바뀔 때 다시 그린다. */
  terminalStore?: TerminalStore;
  /** 이 창에서 앱 화면을 여는 길. detached 창은 noop이다. */
  onSettings: (pane?: SettingsPane) => void;
  /** false면 이 창은 floated 탭을 둘 수 없다(detached 창). 코드 블록의 실행 단추를 두지 않는다. */
  floats?: boolean;
}

// place 창(PlaceWindow)과 detached 창(DetachedTab)이 같이 쓰는 TabHost slice와 view 보관소.
// 창마다 다른 것(openTab·openFloat·patchTab·removeTab·view)은 호출하는 쪽이 host에 직접 넣는다.
export function useTabHostSlices(input: TabHostSlicesInput) {
  const { place, source, agentViewSource, onSettings } = input;
  const agentsSource = source.agentsSource;
  // 값은 쓰지 않고 agent가 바뀔 때 이 hook을 쓴 창이 다시 그려지게만 한다.
  const terminalStore = input.terminalStore;
  useSyncExternalStore(
    useCallback(
      (listener) => terminalStore?.subscribe(listener) ?? (() => {}),
      [terminalStore],
    ),
    () => terminalStore?.version() ?? 0,
  );
  const sidebarAgents = useSidebarAgents(
    agentsSource,
    place.kind === "home" ? null : place.id,
  );
  const { sessions: sessionStates } = useSessions();
  const conversation = useConversation();
  // 창에 대화 메모리가 없을 때(통로 없는 화면 시험) Agent 탭이 쓰는 입력 메모리.
  const localDrafts = useMemo(() => new DraftStore(), []);
  const artifactPlace = place.kind === "home" ? null : place;
  const artifactList = useArtifactList(artifactPlace);
  const hostRef = useRef(input.host);
  hostRef.current = input.host;

  const appViews = useAppViews();
  // 탭 view의 보관소. 닫는 일은 호출하는 쪽 effect가 정한다.
  const closeViewRef = useRef<(session: string) => void>(() => {});
  closeViewRef.current = (session) =>
    void appViews?.views.closeView({ view_session: session }).catch(() => {});
  // 화면(browser 탭·앱·artifact)의 <webview> 그릇. 창마다 하나이고 탭 key당 <webview> 하나다(옮기면 다시 load된다).
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
      : agentRow(entry, sidebarAgents.agents, place);
  };

  const agentView: AgentViewSlice | null =
    agentViewSource === undefined
      ? null
      : {
          factory: agentViewSource,
          drafts: conversation?.drafts ?? localDrafts,
          ...(conversation?.now === undefined ? {} : { now: conversation.now }),
          openFile: (path, from) =>
            openFile(
              hostRef.current(),
              path,
              from === undefined ? {} : { from },
            ),
          runCommand:
            terminalStore === undefined || input.floats === false
              ? null
              : (command) => openTerminal(hostRef.current(), { command }),
          profileOf: (agent) =>
            sidebarAgents.agents.find((row) => row.assignment === agent)
              ?.profile,
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
          placeLophnSession: () =>
            openedPlaceLophnSession(sessionStates, place),
          nameOf: (session) => rowOfSession(session)?.name,
          artifacts: {
            place: artifactPlace,
            items: artifactList.items,
            open: (name) => openArtifact(hostRef.current(), name),
            reload: artifactList.reload,
          },
        };

  const agents: AgentsSlice | null =
    agentsSource === undefined
      ? null
      : {
          source: agentsSource,
          changed: sidebarAgents.reload,
          openExtensions: () => onSettings("tools"),
        };

  return {
    sidebarAgents,
    sessionStates,
    agentView,
    agents,
    appViews,
    keeps,
    webviews,
  };
}
