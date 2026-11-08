// workspace(Home, project) 창의 왼쪽 sidebar. 화면(LeftSidebar)에 이 창이 아는 값을 모아 준다: 모든 workspace의 session, 이 workspace의 열린 탭 제목,
// 터미널 coding agent session, 사람 차례인 workflow desk(project만). 등록·생성 dialog도 여기서 연다.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { HARNESS_ADAPTERS } from "../../../../protocol/coding-agent/harness-adapter.ts";
import { LOPHN_AGENT_NAME } from "../../../../protocol/lophn-agent/agent-values.ts";
import { isLophn } from "../../../../protocol/lophn-agent/workspaces.ts";
import { lophnIdAt } from "../agents/agent-key.ts";
import type { HarnessId } from "../../../../protocol/coding-agent/harness-id.ts";
import type { AppsSource } from "../../apps/source.ts";
import type { AgentTabSourceFactory } from "../../conversation/agent-tab-source.ts";
import {
  useSessions,
  useWorkflowChanges,
} from "../../desktop/connection/events/hooks.tsx";
import type { JobsSource } from "../../desktop/jobs/source.ts";
import { CreateAppDialog } from "../../desktop/workspaces/create-app-dialog.tsx";
import type { ProjectsSource } from "../../desktop/workspaces/projects/source.ts";
import { RegisterDialog } from "../../desktop/workspaces/register-dialog.tsx";
import { useQuickPrefs } from "../../desktop/settings/quick-launch/store.tsx";
import { type AgentChoice } from "../../parts/agent-session/agent-session.tsx";
import { codingDot } from "../../parts/agent-session/coding.ts";
import { newId } from "../../prefixed-id.ts";
import type { NewSessionStart } from "../../desktop/router.ts";
import {
  type QuickCommand,
  closeTab,
  workspaceKey,
  type WorkspaceRef,
  selectTab,
} from "../../shell/desk-model.ts";
import { agentOf, sessionOf } from "../agent/tab-fields.ts";
import type { WindowWorkspace } from "../workspace-window.tsx";
import { LeftSidebar } from "../../shell/left-sidebar.tsx";
import type { QuickLaunch } from "../../shell/quick-launch.tsx";
import { agentChoices, codingCommand } from "../../shell/agent-sections.tsx";
import {
  type SidebarWorkspace,
  type SidebarSession,
} from "../../shell/left-sidebar-model.ts";
import { sidebarWorkspaces } from "../../shell/left-sidebar-workspaces.ts";
import {
  useKnownSessions,
  useTabsElsewhere,
  useSidebarWorkspaceList,
} from "../../shell/use-left-sidebar.ts";
import { useRemembered } from "../../shell/sidebar-memory.tsx";
import { closeTerminalTab, type TerminalDeps } from "../../terminal/deps.ts";
import type { TabItem } from "../model.ts";
import {
  otherWorkspaceTerminalTitle,
  pinAgentSessionName,
  terminalNamed,
} from "../kinds/terminal.tsx";
import type { WorkspaceSource } from "../source.ts";
import { useHiddenRecent } from "./hidden-recent.ts";
import type { SidebarAgent } from "./sidebar-agent.ts";
import type { PanelTerminal } from "./panel-types.ts";

const NO_WORKFLOWS: readonly string[] = [];

/** 이 project에서 사람 차례를 기다리는 workflow 이름(Home은 없다). instance가 바뀔 때마다 다시 읽는다. */
function useHumanTurnWorkflows(
  source: WorkspaceSource,
  project: string | null,
): readonly string[] {
  // workspace를 옮기면 창의 마지막 값에서 시작한다.
  const [all, setAll] = useRemembered("workflows");
  const [reads, setReads] = useState(0);
  useEffect(() => {
    if (project === null) return;
    let live = true;
    void source
      .workflowInstances({ project, state: "running" })
      .then((read) => {
        if (!live || !read.ok) return;
        const names = [
          ...new Set(
            read.value
              .filter((item) => item.current?.human_turn === true)
              .map((item) => item.workflow),
          ),
        ];
        setAll((now) => new Map(now).set(project, names));
      });
    return () => {
      live = false;
    };
  }, [source, project, reads, setAll]);
  useWorkflowChanges((_instance, payload) => {
    if (payload.project === project) setReads((count) => count + 1);
  });
  return (project === null ? undefined : all.get(project)) ?? NO_WORKFLOWS;
}

export interface WorkspaceLeftSidebarProps {
  workspace: WindowWorkspace;
  source: WorkspaceSource;
  projects?: ProjectsSource;
  apps?: AppsSource;
  agentViewSource?: AgentTabSourceFactory;
  agents: readonly SidebarAgent[];
  /** 이 창에 탭이 열린 session id → 그 탭의 제목. */
  openTitles: ReadonlyMap<string, string>;
  /** 이 창의 아직 session이 없는 Agent 탭. */
  agentDrafts: readonly TabItem[];
  terminals: readonly PanelTerminal[];
  /**
   * 창의 터미널. store는 workspace를 옮겨도 살아 있어 다른 workspace 터미널에서 agent가 지금 도는지 알고, 그 PTY를 닫기 확인을 거쳐 닫는다.
   * 없으면 다른 workspace의 터미널 줄이 없다.
   */
  terminal?: TerminalDeps;
  /** 고른 tab의 줄(`sessionKey`). */
  selected?: string;
  /** 터미널 탭을 열 수 있다. 없으면 coding agent 항목이 없다. */
  canTerminal: boolean;
  /** 이 project만의 터미널 명령. Terminal hover 목록의 Commands 묶음이다. */
  commands?: readonly QuickCommand[];
  /** 이 workspace 줄의 +. */
  onNewSession: () => void;
  /** 다른 workspace 줄의 +와 그 hover 목록. 그 workspace로 가서 새 session(또는 coding agent 터미널)을 연다. 없으면 그 +는 그 workspace로 가기만 한다. */
  onNewSessionAt?: (workspace: WorkspaceRef, start: NewSessionStart) => void;
  /** 이 workspace의 + hover 목록에서 고른 agent. 탭 줄 + menu와 같은 길이다. */
  onNewChoice: (choice: AgentChoice) => void;
  onNewCoding: (command: string) => void;
  /** 이 project의 session을 desk 규칙으로 연다. */
  onOpenHere: (session: string, agent: string) => void;
  onTerminal: (terminal: PanelTerminal) => void;
  onWorkflow: (workflow: string) => void;
  /** 다른 workspace의 session이거나 Inbox 카드의 session. 그 workspace로 가서 연다. */
  onOpenSession: (session: string) => void;
  onWorkspace: (ref: WorkspaceRef) => void;
  /** workspace 줄 누르기. 앱 줄은 그 앱 화면으로 간다. */
  onWorkspaceRow: (ref: WorkspaceRef) => void;
  onNewApp: (app: string) => void;
  /** Jobs overlay의 통로. 없으면 Jobs 줄이 바로 탭을 연다. */
  jobs?: JobsSource;
  onInbox: () => void;
  onJobs: () => void;
  /** 맨 아래 줄의 빠른 실행. 작업 표시줄이 켜져 있으면 주지 않는다(작업 표시줄이 그린다). */
  quick?: QuickLaunch;
  /** 이 창의 탭(draft 줄)을 고른다. */
  onTab: (key: string) => void;
  /** 이 창의 탭이 그 session·터미널이면 탭 이름 바꾸기와 같은 길로 바꾸고 true다. 탭이 없으면 false다. */
  onRenameTab?: (item: SidebarSession, title: string) => boolean;
  /** 그 session·터미널의 탭을 보통 닫기 길로 닫는다(터미널은 확인을 묻는다). 탭이 없으면 아무것도 하지 않는다. */
  onCloseTab?: (item: SidebarSession) => void;
  /** workspace 줄의 설정 단추(project는 Project settings, 앱은 App details). 다른 workspace면 그 workspace로 가서 연다. */
  onWorkspaceSettings?: (workspace: WorkspaceRef) => void;
  /** 작업 표시줄이 켜져 있으면 주지 않는다(작업 표시줄이 그린다). */
  onSettings?: () => void;
}

export function WorkspaceLeftSidebar(props: WorkspaceLeftSidebarProps) {
  const { workspace: current, projects, apps } = props;
  const projectId = current.kind === "project" ? current.id : null;
  const list = useSidebarWorkspaceList(projects, apps);
  const { sessions } = useSessions();
  const { known, reload: reloadKnown } = useKnownSessions(
    props.agentViewSource,
    sessions,
  );
  const workspaceRefs = useMemo(
    (): WorkspaceRef[] => [
      { kind: "home" },
      ...list.projects.map(
        (item): WorkspaceRef => ({
          kind: "project",
          id: item.id,
        }),
      ),
      ...list.apps.map((item): WorkspaceRef => ({ kind: "app", id: item.id })),
    ],
    [list.projects, list.apps],
  );
  const elsewhere = useTabsElsewhere(
    props.source.layout,
    workspaceRefs,
    current,
    sessions,
  );
  // 다른 workspace의 터미널은 agent가 지금 도는 것만 current다. 끝난 agent는 탭이 남아도 빠진다.
  const store = props.terminal?.store;
  const storeVersion = useSyncExternalStore(
    (listener) => store?.subscribe(listener) ?? (() => {}),
    () => store?.version() ?? 0,
  );
  const otherTerminals = useMemo(
    () =>
      new Map(
        // 창의 마지막 값이라 지금 workspace가 들 수 있다. 지금 workspace의 터미널은 props.terminals가 준다.
        [...elsewhere.terminals]
          .filter(([key]) => key !== workspaceKey(current))
          .map(([key, tabs]) => [
            key,
            tabs.flatMap((tab): PanelTerminal[] => {
              const agent = store?.agentOf(tab.key);
              if (store === undefined || agent === undefined || !agent.hooked) {
                return [];
              }
              return [
                {
                  key: tab.key,
                  harness: agent.harness,
                  label: agent.harness,
                  title: otherWorkspaceTerminalTitle(tab, store),
                  dot: codingDot(agent),
                  at: 0,
                  live: { tabKey: tab.key },
                  saved: null,
                },
              ];
            }),
          ]),
      ),
    [elsewhere.terminals, store, storeVersion, workspaceKey(current)],
  );
  const openTitles = useMemo(
    () =>
      new Map(elsewhere.titles).set(workspaceKey(current), props.openTitles),
    [elsewhere.titles, current, props.openTitles],
  );
  const drafts = useMemo(
    () =>
      props.agentDrafts.flatMap((tab) => {
        const agent = agentOf(tab);
        return agent === null ? [] : [{ key: tab.key, agent }];
      }),
    [props.agentDrafts],
  );
  const workflows = useHumanTurnWorkflows(props.source, projectId);
  // 지운 줄은 session id와 터미널 key로 기억하고 둘 다 겹치지 않아 한 곳에 둔다.
  const recentHidden = useHiddenRecent(null);
  const workspaces = useMemo(
    () =>
      sidebarWorkspaces({
        now: Date.now(),
        current,
        projects: list.projects,
        apps: list.apps,
        entries: sessions,
        agents: props.agents,
        known,
        openTitles,
        drafts,
        terminals: props.terminals,
        otherTerminals,
        workflows,
        hidden: recentHidden.hidden,
      }),
    [
      workspaceKey(current),
      list.projects,
      list.apps,
      sessions,
      props.agents,
      known,
      openTitles,
      drafts,
      props.terminals,
      otherTerminals,
      workflows,
      recentHidden.hidden,
    ],
  );
  // 즐겨찾기 coding agent(Settings › Coding agents). + hover와 Terminal hover가 같이 쓴다.
  const { coding } = useQuickPrefs().prefs;
  const commandOf = (id: HarnessId) => codingCommand(coding.commands, id);
  const favorites = props.canTerminal ? coding.favorites : [];
  const runCoding = (id: HarnessId) => {
    const command = commandOf(id);
    if (command !== undefined) props.onNewCoding(command);
  };
  const choices = agentChoices(props.agents, favorites);
  // 다른 workspace의 agent 목록은 읽지 않았다. 어느 workspace에나 있는 그 workspace의 lophn(이름은 모르니 기본 이름)과 즐겨찾기 coding agent(터미널은 project만)를 보인다.
  const choicesAt = (ref: WorkspaceRef): readonly AgentChoice[] =>
    workspaceKey(ref) === workspaceKey(current)
      ? choices
      : agentChoices(
          props.agents
            .filter((agent) => isLophn(agent.assignment))
            .map((agent) => ({
              ...agent,
              assignment: lophnIdAt(ref),
              name: LOPHN_AGENT_NAME,
            })),
          ref.kind === "project" ? coding.favorites : [],
        );
  const [registering, setRegistering] = useState(false);
  const [creating, setCreating] = useState(false);

  // 다른 workspace의 터미널 탭: 그 workspace의 layout에서 탭을 골라 두고 workspace로 간다.
  const showTerminalAt = async (ref: WorkspaceRef, tab: string) => {
    const read = await props.source.layout.readWorkspaceLayout(ref);
    if (read.ok && read.layout !== null) {
      const desk = Object.values(read.layout.desks).find((item) =>
        item.tabs.some((row) => row.key === tab),
      );
      if (desk !== undefined) {
        await props.source.layout.saveWorkspaceLayout(ref, {
          ...read.layout,
          active: desk.key,
          desks: { ...read.layout.desks, [desk.key]: selectTab(desk, tab) },
        });
      }
    }
    props.onWorkspace(ref);
  };

  // 다른 workspace의 탭은 그 workspace의 저장된 layout을 고친다. 그 workspace를 열면 고친 탭으로 시작한다.
  const editTabAt = async (
    ref: WorkspaceRef,
    match: (tab: TabItem) => boolean,
    edit: "close" | ((tab: TabItem) => TabItem),
  ) => {
    const read = await props.source.layout.readWorkspaceLayout(ref);
    if (!read.ok || read.layout === null) return;
    const desks = { ...read.layout.desks };
    for (const desk of Object.values(desks)) {
      const tab = desk.tabs.find(match);
      if (tab === undefined) continue;
      desks[desk.key] =
        edit === "close"
          ? closeTab(desk, tab.key)
          : {
              ...desk,
              tabs: desk.tabs.map((row) => (row === tab ? edit(row) : row)),
            };
    }
    await props.source.layout.saveWorkspaceLayout(ref, {
      ...read.layout,
      desks,
    });
    elsewhere.reload();
  };
  const closeAgentTabAt = (ref: WorkspaceRef, session: string) =>
    editTabAt(
      ref,
      (row) => row.kind === "agent" && sessionOf(row) === session,
      "close",
    );
  const isTerminal = (key: string) => (row: TabItem) =>
    row.kind === "terminal" && row.key === key;
  // PTY는 이 창의 store가 들고 있어 여기서 닫는다. 닫았을 때만 그 workspace의 탭을 지운다.
  const closeTerminalAt = async (ref: WorkspaceRef, key: string) => {
    const terminal = props.terminal;
    if (terminal === undefined || !(await closeTerminalTab(terminal, key))) {
      return;
    }
    await editTabAt(ref, isTerminal(key), "close");
  };
  const renameTerminalAt = (ref: WorkspaceRef, key: string, name: string) => {
    const person = name.trim() || null;
    void editTabAt(ref, isTerminal(key), (row) =>
      terminalNamed(row, person, store),
    );
    if (props.terminal !== undefined && ref.kind === "project") {
      pinAgentSessionName(props.terminal, ref.id, key, person);
    }
  };

  const open = (workspace: SidebarWorkspace, item: SidebarSession) => {
    const here = workspaceKey(workspace.ref) === workspaceKey(current);
    if (item.kind === "workflow") props.onWorkflow(item.ref);
    else if (item.kind === "draft") props.onTab(item.ref);
    else if (item.kind === "terminal") {
      const terminal = props.terminals.find((row) => row.key === item.ref);
      if (terminal !== undefined) props.onTerminal(terminal);
      else if (!here) void showTerminalAt(workspace.ref, item.ref);
    } else if (here) {
      const agent = sessions.find((row) => row.session === item.ref)?.agent;
      if (agent !== null && agent !== undefined) {
        props.onOpenHere(item.ref, agent);
      }
    } else props.onOpenSession(item.ref);
  };

  // tab 없이 current에 있는 lophn session(도는 중, 기다리는 중)은 그 agent의 source로 바로 부른다.
  const sourceOf = (session: string) => {
    const entry = sessions.find((row) => row.session === session);
    if (props.agentViewSource === undefined || !entry?.agent) return undefined;
    return props.agentViewSource({
      assignment: entry.agent,
      workspace: entry.workspace ?? { kind: "global", id: "" },
    });
  };
  const renameSession = (
    workspace: SidebarWorkspace,
    item: SidebarSession,
    title: string,
  ) => {
    if (props.onRenameTab?.(item, title) === true) return;
    if (item.kind === "terminal")
      renameTerminalAt(workspace.ref, item.ref, title);
    else if (item.kind === "session") {
      void sourceOf(item.ref)
        ?.act(item.ref, {
          type: "rename",
          session: item.ref,
          key: newId("rename"),
          title,
        })
        .then((result) => {
          if (result.ok) reloadKnown();
        });
    }
  };
  // Stop은 session을 current에서 내린다: 도는 turn을 멈추고 탭을 닫는다. 멈추지 못하면 탭을 남긴다.
  const stopSession = (workspace: SidebarWorkspace, item: SidebarSession) => {
    const here = workspaceKey(workspace.ref) === workspaceKey(current);
    if (item.kind === "terminal" && !here) {
      void closeTerminalAt(workspace.ref, item.ref);
      return;
    }
    if (item.kind !== "session") {
      props.onCloseTab?.(item);
      return;
    }
    const source = sourceOf(item.ref);
    if (source === undefined) return;
    void source.stopSession(item.ref).then((result) => {
      if (!result.ok) return;
      if (here) props.onCloseTab?.(item);
      else void closeAgentTabAt(workspace.ref, item.ref);
    });
  };

  return (
    <>
      <LeftSidebar
        workspaces={workspaces}
        current={current}
        selected={props.selected}
        choices={choicesAt}
        onNewSession={(ref) => {
          if (workspaceKey(ref) === workspaceKey(current)) props.onNewSession();
          else if (props.onNewSessionAt !== undefined) {
            props.onNewSessionAt(ref, {});
          } else props.onWorkspace(ref);
        }}
        onNewSessionWith={(choice, ref) => {
          if (workspaceKey(ref) === workspaceKey(current)) {
            props.onNewChoice(choice);
            return;
          }
          const command =
            choice.kind === "coding"
              ? commandOf(choice.id as HarnessId)
              : undefined;
          if (choice.kind === "coding" && command === undefined) return;
          props.onNewSessionAt?.(
            ref,
            command === undefined ? { agent: choice.id } : { command },
          );
        }}
        onOpenSession={props.onOpenSession}
        {...(props.jobs === undefined ? {} : { jobs: props.jobs })}
        onInbox={props.onInbox}
        onJobs={props.onJobs}
        onWorkspace={props.onWorkspaceRow}
        onSession={open}
        onRemoveRecent={(_workspace, item) =>
          recentHidden.hide(item.ref, item.at)
        }
        onRenameSession={renameSession}
        onStopSession={stopSession}
        {...(projects === undefined
          ? {}
          : { onRegisterProject: () => setRegistering(true) })}
        {...(apps === undefined
          ? {}
          : { onCreateApp: () => setCreating(true) })}
        {...(props.quick === undefined ? {} : { quick: props.quick })}
        {...(props.onWorkspaceSettings === undefined
          ? {}
          : { onWorkspaceSettings: props.onWorkspaceSettings })}
        {...(props.onSettings === undefined
          ? {}
          : { onSettings: props.onSettings })}
      />
      {projects === undefined ? null : (
        <RegisterDialog
          open={registering}
          source={projects}
          onClose={() => setRegistering(false)}
          onRegistered={(created) => {
            setRegistering(false);
            list.reload();
            props.onWorkspace({ kind: "project", id: created.id });
          }}
        />
      )}
      {apps === undefined ? null : (
        <CreateAppDialog
          open={creating}
          source={apps}
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            list.reload();
            props.onNewApp(created.id);
          }}
        />
      )}
    </>
  );
}
