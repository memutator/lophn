// workspace(Home, project) 창의 왼쪽 sidebar. 화면(LeftSidebar)에 이 창이 아는 값을 모아 준다: 모든 기계의 workspace와 session, 이 workspace의 열린 탭 제목,
// 터미널 coding agent session, 사람 차례인 workflow desk(project만). 등록·생성·잇기 dialog도 여기서 연다.
// 줄과 session은 창의 목록(`useMachineLists`)이 기계마다 읽은 것이다. 이 창이 보는 workspace가 다른 기계의 것이어도 줄은 같다.
import { t } from "@lophn/i18n";
import { Toast } from "@lophn/ui/overlay";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { HARNESS_ADAPTERS } from "../../../../protocol/coding-agent/harness-adapter.ts";
import type { HarnessId } from "../../../../protocol/coding-agent/harness-id.ts";
import { HOME_TERMINAL_PROJECT } from "../../../../protocol/coding-agent/terminals.ts";
import { LOPHN_AGENT_NAME } from "../../../../protocol/lophn-agent/agent-values.ts";
import type { HandoffNote } from "../../../../protocol/lophn-agent/handoff.ts";
import { archiveSession } from "../../../../protocol/lophn-agent/sessions.ts";
import { isLophn } from "../../../../protocol/lophn-agent/workspaces.ts";
import { STAY, useViewToast } from "../../app-frame/annotate/use-view-toast.ts";
import type { AppsSource } from "../../apps/source.ts";
import { takeInText } from "../../apps/take-in-note.ts";
import { useBrowserOverlay } from "../../browser/browser-api.tsx";
import { commandCall } from "../../command-call.ts";
import type { AgentTabSourceFactory } from "../../conversation/agent-tab-source.ts";
import { useFollowedRead } from "../../desktop/connection/core-read.ts";
import { runToastAction } from "../../desktop/connection/toasts/toast-actions.ts";
import type { JobsSource } from "../../desktop/jobs/source.ts";
import { useMachines } from "../../desktop/machines/context.tsx";
import { LocalMachineScope } from "../../desktop/machines/scope.tsx";
import type { NewSessionStart } from "../../desktop/router.ts";
import {
  useCodingPrefs,
  useCodingPrefsStore,
} from "../../desktop/settings/connections/prefs-store.tsx";
import { CreateAppDialog } from "../../desktop/workspaces/create-app-dialog.tsx";
import {
  continueHandoff,
  HandoffProvider,
  useHandoffNotes,
} from "../../desktop/workspaces/projects/handoff-source.ts";
import { LinkProjectDialog } from "../../desktop/workspaces/projects/link-dialog.tsx";
import type { ListedProject } from "../../desktop/workspaces/projects/machine-workspaces.ts";
import type { ProjectsSource } from "../../desktop/workspaces/projects/source.ts";
import {
  RegisterDialog,
  type RegisterTarget,
} from "../../desktop/workspaces/register-dialog.tsx";
import { type AgentChoice } from "../../parts/agent-session/agent-session.tsx";
import { codingDot } from "../../parts/agent-session/coding.ts";
import { newId } from "../../prefixed-id.ts";
import { agentChoices, codingCommand } from "../../shell/agent-sections.tsx";
import {
  allTabs,
  closeTab,
  findTab,
  restoreFloat,
  selectTab,
  setActiveDesk,
  type TabDragItem,
  updateDesk,
  type WorkspaceRef,
  workspaceKey,
} from "../../shell/desk-model.ts";
import leftStyles from "../../shell/left-sidebar.module.css";
import { LeftSidebar } from "../../shell/left-sidebar.tsx";
import {
  type SidebarCommand,
  type SidebarSession,
  type SidebarTab,
  type SidebarWorkspace,
  sessionKey,
  withChildren,
} from "../../shell/left-sidebar-model.ts";
import {
  type LayoutDesks,
  type SidebarWaitingWorkflow,
  sidebarWorkspaces,
} from "../../shell/left-sidebar-workspaces.ts";
import type { QuickLaunch } from "../../shell/quick-launch.tsx";
import { useRemembered } from "../../shell/sidebar-memory.tsx";
import { useTabDrag } from "../../shell/tab-drag.tsx";
import {
  type SessionTitles,
  useMachineLists,
  useTabsElsewhere,
} from "../../shell/use-left-sidebar.ts";
import { closeTerminalTab, type TerminalDeps } from "../../terminal/deps.ts";
import { isLiveAgent } from "../../terminal/store.ts";
import { instanceTitle } from "../../workflow/model.ts";
import { agentOf, sessionOf } from "../agent/tab-fields.ts";
import { lophnIdAt } from "../agents/agent-key.ts";
import {
  pinAgentSessionName,
  terminalNamed,
  terminalRefOf,
  terminalTabTitle,
} from "../kinds/terminal.tsx";
import type { TabItem } from "../model.ts";
import {
  type ProjectCommandActions,
  ProjectCommandsList,
} from "../project-commands/commands-menu.tsx";
import { createProjectCommandsSource } from "../project-commands/source.ts";
import {
  isCommandActive,
  isCommandFailed,
  type ProjectCommandGroup,
  previewUrlOf,
  projectCommandTabKey,
  useSidebarCommandsIndex,
} from "../project-commands/use-project-commands.ts";
import type { WorkspaceSource } from "../source.ts";
import type { WindowWorkspace } from "../workspace-window.tsx";
import type { BranchTagInfo } from "../worktrees/branch-tag.tsx";
import { CloneNote, type CloneState, cloneResult } from "./clone-note.tsx";
import { useHiddenRecent } from "./hidden-recent.ts";
import { movedTab, putTab, sessionTab } from "./move-tab.ts";
import type { PanelTerminal } from "./panel-types.ts";
import type { SidebarAgent } from "./sidebar-agent.ts";

const NO_WORKFLOWS: readonly SidebarWaitingWorkflow[] = [];

/** 이 project에서 사람 차례를 기다리는 workflow instance 목록(Home은 없다). instance가 바뀔 때마다 다시 읽는다. */
function useHumanTurnWorkflows(
  source: WorkspaceSource,
  project: string | null,
): readonly SidebarWaitingWorkflow[] {
  // workspace를 옮기면 창의 마지막 값에서 시작한다.
  const [all, setAll] = useRemembered("workflows");
  // 값에 project를 실어 project를 옮긴 직후 앞 project의 값이 새 project 자리에 들지 않게 한다.
  const read = useFollowedRead(
    async () => {
      if (project === null) return { ok: true as const, value: null };
      const listed = await source.workflowInstances({
        project,
        state: "running",
      });
      return listed.ok
        ? { ok: true as const, value: { project, items: listed.value } }
        : listed;
    },
    ["workflow_instances"],
    project ?? "",
  ).loaded;
  useEffect(() => {
    if (read.state !== "ready" || read.value === null) return;
    const { project: at, items } = read.value;
    const waiting: SidebarWaitingWorkflow[] = items
      .filter((item) => item.current?.human_turn === true)
      .map((item) => ({
        instance: item.id,
        workflow: item.workflow,
        title: instanceTitle(item),
      }));
    setAll((now) => new Map(now).set(at, waiting));
  }, [read, setAll]);
  return (project === null ? undefined : all.get(project)) ?? NO_WORKFLOWS;
}

export interface WorkspaceLeftSidebarProps {
  workspace: WindowWorkspace;
  source: WorkspaceSource;
  projects?: ProjectsSource;
  apps?: AppsSource;
  agentViewSource?: AgentTabSourceFactory;
  /** 창이 아는 session 제목. 탭 줄과 같은 값이다. */
  sessionTitles: SessionTitles;
  agents: readonly SidebarAgent[];
  /** 모든 workspace의 lophn 이름(agent id → 이름). 다른 workspace의 새 session 줄이 쓴다. */
  lophnNames: Readonly<Record<string, string>>;
  /** 이 창의 layout을 읽었다. 읽기 전의 `openTitles`·`desks`는 기본 layout의 값이라 sidebar가 쓰지 않는다. */
  layoutReady: boolean;
  /** 이 창에 탭이 열린 session id → 그 탭의 제목. 줄이 current인지만 정하고 이름으로는 쓰지 않는다. */
  openTitles: ReadonlyMap<string, string>;
  /** 이 창 layout의 desk. current 줄을 desk로 나눈다. */
  desks: LayoutDesks;
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
  /** 지금 보이는 project의 명령 묶음(로컬 + 같은 pri_ 원격 컴퓨터). */
  activeProjectCommandGroups?: readonly ProjectCommandGroup[];
  /** 지금 보이는 project의 명령 동작. */
  projectCommandActions?: ProjectCommandActions;
  /** 다른 project의 명령 프리뷰 열기(그 workspace로 가거나 바로 연다). */
  onCommandPreview?: (group: ProjectCommandGroup, url: string) => void;
  /** 이 workspace 줄의 +. */
  onNewSession: () => void;
  /** 다른 workspace 줄의 +와 그 hover 목록. 그 workspace로 가서 새 session(또는 coding agent 터미널)을 연다. 없으면 그 +는 그 workspace로 가기만 한다. */
  onNewSessionAt?: (workspace: WorkspaceRef, start: NewSessionStart) => void;
  /** 이 workspace의 + hover 목록에서 고른 agent. 탭 줄 + menu와 같은 길이다. */
  onNewChoice: (choice: AgentChoice) => void;
  /** 이 workspace 줄의 + hover 목록 위에 서는 체크아웃(worktree) 고르기. worktree가 없으면 없다. */
  checkoutPicker?: ReactNode;
  /** 이 workspace 줄 session의 브랜치 꼬리표. */
  branchOf?: (item: SidebarSession) => BranchTagInfo | null;
  onNewCoding: (command: string) => void;
  /** 이 project의 session을 desk 규칙으로 연다. */
  onOpenHere: (session: string, agent: string) => void;
  /** 이 workspace 줄 안의 다른 기계 session. 그 기계를 단 탭으로 연다. */
  onOpenOn: (session: string, machine: string) => void;
  /** 다른 workspace 줄의 session. 그 workspace로 가서 연다. 없으면 `onOpenSession`이다. */
  onSessionAt?: (
    workspace: WorkspaceRef,
    session: string,
    machine?: string,
  ) => void;
  /** 다른 workspace 줄의 터미널(다른 기계 coding agent 포함). 그 workspace로 가서 곧바로 탭을 연다. */
  onTerminalAt?: (workspace: WorkspaceRef, terminal: string) => void;
  onTerminal: (terminal: PanelTerminal) => void;
  onWorkflow: (workflow: string) => void;
  /** 이 workspace의 desk를 고른다. 없으면 `onWorkflow`로 간다. */
  onDesk?: (deskKey: string) => void;
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
  /** 없으면 Agents 줄이 없다. */
  onAgents?: () => void;
  /** 맨 아래 줄의 빠른 실행. 작업 표시줄이 켜져 있으면 주지 않는다(작업 표시줄이 그린다). */
  quick?: QuickLaunch;
  /** 이 창의 탭(draft 줄, session 줄 아래의 탭 줄)을 고른다. float이면 펴고 detached면 그 창을 앞으로 한다. */
  onTab: (key: string) => void;
  /** 이 창의 탭이 그 session·터미널이면 탭 이름 바꾸기와 같은 길로 바꾸고 true다. 탭이 없으면 false다. */
  onRenameTab?: (item: SidebarSession, title: string) => boolean;
  /** 그 session·터미널의 탭을 보통 닫기 길로 닫는다(터미널은 확인을 묻는다). 탭이 없으면 아무것도 하지 않는다. */
  onCloseTab?: (item: SidebarSession) => void;
  /** workspace 줄의 설정 단추(project는 Project settings, 앱은 App details). 다른 workspace면 그 workspace로 가서 연다. */
  onWorkspaceSettings?: (workspace: WorkspaceRef) => void;
  /** 작업 표시줄이 켜져 있으면 주지 않는다(작업 표시줄이 그린다). */
  onSettings?: () => void;
  /** 창이 다른 workspace의 layout에 탭을 옮겨 쓸 때마다 는다. 그 layout을 다시 읽는다. */
  layoutsMoved?: number;
  /** 이 창의 session 탭(없으면 지어서)을 그 workspace로 옮긴다. */
  onMoveSession?: (session: string, to: WorkspaceRef) => void;
  /** 이 창의 탭을 그 workspace로 옮긴다. */
  onMoveTab?: (key: string, to: WorkspaceRef) => void;
  /** 다른 workspace에서 옮겨 온 탭을 이 창에 연다. */
  onPutTab?: (tab: TabItem) => void;
  /** 이 창의 모든 탭(지금 layout). 끈 줄의 탭을 찾는다. */
  hereTabs?: () => readonly TabItem[];
  /** sidebar가 줄의 탭을 찾고 옮기는 길을 여기에 둔다. 창이 끌어 놓기에서 부른다. */
  rowDrops?: { current: SidebarRowDrops | null };
}

/** sidebar 줄을 끌어 놓을 때 창이 부르는 길. */
export interface SidebarRowDrops {
  /** 줄의 탭을 이 창에 둘 모양. 이 창에 있으면 그 key, 다른 자리에서 빼 왔거나 지었으면 그 탭. 없으면 줄을 누른 것처럼 열고 null이다. */
  take(
    row: NonNullable<TabDragItem["row"]>,
  ): Promise<{ readonly key: string } | { readonly tab: TabItem } | null>;
  /** 줄의 탭을 그 workspace로 옮긴다. */
  moveTo(row: NonNullable<TabDragItem["row"]>, to: WorkspaceRef): Promise<void>;
}

export function WorkspaceLeftSidebar(props: WorkspaceLeftSidebarProps) {
  const { workspace: current } = props;
  const machines = useMachines();
  const projectId = current.kind === "project" ? current.id : null;
  const lists = useMachineLists();
  const { entries, dataOf } = lists;
  // 왼쪽 sidebar는 창 전체(이 컴퓨터 + 연결된 기계) 목록이라 project 등록·앱 만들기·handoff note는 열린 workspace 기계와 무관하게 이 컴퓨터 묶음을 기준으로 둔다.
  const here = dataOf(null);
  const projects = props.projects === undefined ? undefined : here.projects;
  const apps = props.apps === undefined ? undefined : here.apps;
  const sidebarCommands = useSidebarCommandsIndex(lists);
  const commandsActionsFor = (ref: WorkspaceRef): ProjectCommandActions => {
    if (
      props.projectCommandActions !== undefined &&
      workspaceKey(ref) === workspaceKey(current)
    ) {
      return props.projectCommandActions;
    }
    const callSource = (group: ProjectCommandGroup) =>
      createProjectCommandsSource(dataOf(group.machine).core);
    return {
      onRun: (group, cmd) =>
        void callSource(group).run(group.projectId, cmd.id),
      onStop: (group, cmd) =>
        void callSource(group).stop(group.projectId, { command: cmd.id }),
      onStopAll: (group) =>
        void callSource(group).stop(group.projectId, { all: true }),
      onRestart: (group, cmd) =>
        void callSource(group).restart(group.projectId, cmd.id),
      onDismiss: (group, cmd) =>
        void callSource(group).stop(group.projectId, {
          command: cmd.id,
          dismiss: true,
        }),
      onViewTerminal: (_group, _cmd, run) => {
        if (run.terminal_id !== null && props.onTerminalAt !== undefined) {
          props.onTerminalAt(ref, run.terminal_id);
        } else {
          props.onWorkspace(ref);
        }
      },
      onOpenPreview: (group, url) => {
        if (props.onCommandPreview !== undefined) {
          props.onCommandPreview(group, url);
        } else {
          props.onWorkspace(ref);
        }
      },
      ...(props.onWorkspaceSettings !== undefined &&
      ref.kind === "project" &&
      ref.machine === undefined
        ? { onManage: () => props.onWorkspaceSettings?.(ref) }
        : {}),
    };
  };
  const commandGroupsFor = (
    ref: WorkspaceRef,
  ): readonly ProjectCommandGroup[] => {
    if (ref.kind !== "project") return [];
    if (
      props.activeProjectCommandGroups !== undefined &&
      workspaceKey(ref) === workspaceKey(current)
    ) {
      return props.activeProjectCommandGroups;
    }
    if (ref.machine !== undefined) return [];
    const entry = sidebarCommands.get(ref.id);
    if (entry === undefined) return [];
    return [
      {
        machine: null,
        projectId: ref.id,
        commands: entry.commands,
        runs: entry.runs,
        canRun: true,
      },
    ];
  };
  const handoffNotes = useHandoffNotes(here.events);
  const failToast = useViewToast(useBrowserOverlay() ?? undefined);
  const hideHandoff = handoffNotes.hide;
  const handoffs = useMemo(
    () => ({
      notes: handoffNotes.notes,
      open: async (note: HandoffNote) => {
        if (await continueHandoff(here.core, note)) hideHandoff(note);
        else {
          failToast.show({
            title: t("left-sidebar.error.handoff-continue-failed"),
          });
        }
      },
      dismiss: hideHandoff,
    }),
    [handoffNotes.notes, hideHandoff, here.core, failToast.show],
  );
  // 모든 기계의 session 제목. 창에 하나이고 탭 줄과 같은 값이다.
  const { known } = props.sessionTitles;
  const workspaceRefs = useMemo(
    () => lists.rows.map((row) => row.ref),
    [lists.rows],
  );
  const layoutOf = useCallback(
    (ref: WorkspaceRef) => dataOf(ref.machine ?? null).workspace.layout,
    [dataOf],
  );
  // 다른 기계의 coding agent가 새로 서거나(그 기계의 화면에서 시작한 것) 이 창이 그 기계의 터미널 탭을 열었을 때(그 기계의 store가
  // 바뀐다) layout을 다시 읽는다. 안 그러면 방금 연 탭을 모르는 줄을 다시 누를 때 탭이 하나 더 열린다.
  const remoteMachines = lists.lists
    .flatMap((list) => (list.machine === null ? [] : [list.machine]))
    .join();
  const remoteStores = useMemo(
    () =>
      remoteMachines === ""
        ? []
        : remoteMachines.split(",").flatMap((id) => {
            const remote = dataOf(id).terminal?.store;
            return remote === undefined ? [] : [remote];
          }),
    [remoteMachines, dataOf],
  );
  const remoteVersions = useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        const stops = remoteStores.map((remote) => remote.subscribe(listener));
        return () => stops.forEach((stop) => stop());
      },
      [remoteStores],
    ),
    () => remoteStores.map((remote) => remote.version()).join(),
  );
  const remoteSignal = `${lists.terminals.map((one) => one.terminal).join()}|${remoteVersions}|${props.layoutsMoved ?? 0}`;
  const elsewhere = useTabsElsewhere(
    layoutOf,
    workspaceRefs,
    current,
    entries,
    remoteSignal,
  );
  // 다른 workspace의 터미널은 agent가 지금 도는 것만 current다. 끝난 agent는 탭이 남아도 빠진다. 이 컴퓨터의 터미널은 이 컴퓨터의
  // terminal store가 안다(창이 보는 workspace가 다른 기계의 것이어도 이 컴퓨터의 store다: 창의 store를 쓰면 다른 기계의 workspace를
  // 연 동안 이 컴퓨터의 도는 coding agent가 모두 빠졌다). 다른 기계의 터미널은 그 기계의 목록(`lists.terminals`)이 주고, 이 창에 그
  // 탭이 있으면 그 탭의 줄이다(`attached`).
  const store = dataOf(null).terminal?.store;
  const thisComputer = machines?.get().thisComputer?.id ?? null;
  const workspaceOfKey = useMemo(
    () => new Map(workspaceRefs.map((ref) => [workspaceKey(ref), ref])),
    [workspaceRefs],
  );
  const onThisComputer = (key: string, tab: TabItem) => {
    const on = tab.machine ?? workspaceOfKey.get(key)?.machine;
    return on === undefined || on === thisComputer;
  };
  const storeVersion = useSyncExternalStore(
    (listener) => store?.subscribe(listener) ?? (() => {}),
    () => store?.version() ?? 0,
  );
  // 이 창이 아직 그리지 않은 workspace(앱을 다시 켠 뒤)의 탭도 저장된 터미널 참조로 core의 살아 있는 터미널과 agent를 안다.
  useEffect(() => {
    for (const [key, tabs] of elsewhere.terminals) {
      for (const tab of tabs) {
        const ref = terminalRefOf(tab);
        if (ref !== null && onThisComputer(key, tab)) {
          store?.rememberElsewhere(tab.key, ref);
        }
      }
    }
  }, [elsewhere.terminals, store, workspaceOfKey]);
  const otherTerminals = useMemo(
    () =>
      new Map(
        // 창의 마지막 값이라 지금 workspace가 들 수 있다. 지금 workspace의 터미널은 props.terminals가 준다.
        [...elsewhere.terminals]
          .filter(
            ([key]) => !props.layoutReady || key !== workspaceKey(current),
          )
          .map(([key, tabs]) => [
            key,
            tabs.flatMap((tab): PanelTerminal[] => {
              const agent = store?.agentOf(tab.key);
              if (
                store === undefined ||
                agent === undefined ||
                !isLiveAgent(agent) ||
                !onThisComputer(key, tab)
              ) {
                return [];
              }
              const terminalRef = terminalRefOf(tab);
              return [
                {
                  key: tab.key,
                  harness: agent.harness,
                  label: agent.harness,
                  title: terminalTabTitle(tab, store),
                  dot: codingDot(agent),
                  at: 0,
                  live: { tabKey: tab.key },
                  saved: null,
                  ...(terminalRef === null ? {} : { terminalRef }),
                },
              ];
            }),
          ]),
      ),
    [
      elsewhere.terminals,
      store,
      workspaceOfKey,
      storeVersion,
      workspaceKey(current),
      props.layoutReady,
    ],
  );
  const attached = useMemo(
    () =>
      new Map(
        [...elsewhere.terminals].map(([key, tabs]) => [
          key,
          new Map(
            tabs.flatMap((tab) => {
              const ref = terminalRefOf(tab);
              return ref === null ? [] : [[ref, tab.key] as const];
            }),
          ),
        ]),
      ),
    [elsewhere.terminals],
  );
  // layout을 읽기 전의 이 창은 기본 layout(탭 없음)이다. 그 값으로 덮으면 workspace를 옮길 때마다 줄이 비었다 차오르므로 저장된 값을 그대로 쓴다.
  const openTitles = useMemo(
    () =>
      props.layoutReady
        ? new Map(elsewhere.titles).set(workspaceKey(current), props.openTitles)
        : elsewhere.titles,
    [elsewhere.titles, current, props.openTitles, props.layoutReady],
  );
  const desks = useMemo(
    () =>
      props.layoutReady
        ? new Map(elsewhere.desks).set(workspaceKey(current), props.desks)
        : elsewhere.desks,
    [elsewhere.desks, current, props.desks, props.layoutReady],
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
        rows: lists.rows,
        entries,
        members: lists.members,
        offline: lists.offline,
        agents: props.agents,
        lophnNames: props.lophnNames,
        known,
        openTitles,
        desks,
        drafts,
        terminals: props.terminals,
        otherTerminals,
        remoteTerminals: lists.terminals,
        attached,
        workflows,
        hidden: recentHidden.hidden,
      }),
    [
      workspaceKey(current),
      lists.rows,
      entries,
      lists.members,
      lists.offline,
      props.agents,
      props.lophnNames,
      known,
      openTitles,
      desks,
      drafts,
      props.terminals,
      otherTerminals,
      lists.terminals,
      attached,
      workflows,
      recentHidden.hidden,
    ],
  );
  // 즐겨찾기 coding agent(Settings › Coding agents). 지금 workspace는 지금 기계의 값, 다른 이 컴퓨터 project는 이 컴퓨터의 값을 쓴다.
  const { coding } = useCodingPrefs();
  const { coding: hereCoding } = useCodingPrefsStore(here.codingPrefs);
  const commandOf = (id: HarnessId) => codingCommand(coding.commands, id);
  const favorites = props.canTerminal ? coding.favorites : [];
  const runCoding = (id: HarnessId) => {
    const command = commandOf(id);
    if (command !== undefined) props.onNewCoding(command);
  };
  const choices = agentChoices(props.agents, favorites);
  // 다른 workspace의 agent 목록은 읽지 않았다. 어느 workspace에나 있는 그 workspace의 lophn(사람이 바꾼 이름, 못 읽었으면 기본 이름)과 즐겨찾기 coding agent(터미널은 project만)를 보인다.
  const choicesAt = (ref: WorkspaceRef): readonly AgentChoice[] =>
    workspaceKey(ref) === workspaceKey(current)
      ? choices
      : agentChoices(
          props.agents
            .filter((agent) => isLophn(agent.assignment))
            .map((agent) => {
              const assignment = lophnIdAt(ref);
              // lophn 이름은 기계마다 같은 id라 이 컴퓨터의 것만 안다.
              return {
                ...agent,
                assignment,
                name:
                  (ref.machine === undefined
                    ? props.lophnNames[assignment]
                    : undefined) ?? LOPHN_AGENT_NAME,
              };
            }),
          ref.kind === "project" && ref.machine === undefined
            ? hereCoding.favorites
            : [],
        );
  const [registering, setRegistering] = useState(false);
  const [creating, setCreating] = useState(false);
  // 잇기 dialog가 가리키는 다른 기계의 git이 아닌 project.
  const [linking, setLinking] = useState<{
    readonly machine: string;
    readonly project: ListedProject;
  } | null>(null);
  // workspace key → menu에서 시작한 clone의 진행·결과.
  const [clones, setClones] = useState<ReadonlyMap<string, CloneState>>(
    new Map(),
  );
  const setClone = (key: string, state: CloneState | null) =>
    setClones((now) => {
      const next = new Map(now);
      if (state === null) next.delete(key);
      else next.set(key, state);
      return next;
    });
  // 다른 기계의 project이고 이 컴퓨터에 같은 project가 없으면 가져오는 menu를 둔다. git은 remote가 있어야 clone한다.
  // 다른 기계의 앱이고 이 컴퓨터에 같은 id의 앱이 없으면 들이는 menu를 둔다: 그 앱이 들일 수 있는지는 누를 때 읽는다.
  const bringItems = (workspace: SidebarWorkspace) => {
    const { listed, ref } = workspace;
    if (
      ref.kind === "app" &&
      ref.machine !== undefined &&
      workspace.offline !== true &&
      !(
        lists.lists
          .find((list) => list.machine === null)
          ?.apps.some((app) => app.id === ref.id) ?? true
      )
    ) {
      return [{ id: "install", label: t("take-in.button.install") }];
    }
    if (
      ref.machine === undefined ||
      workspace.offline === true ||
      listed === undefined ||
      listed.identity === null ||
      (workspace.also ?? []).some((copy) => copy.machine === null)
    ) {
      return [];
    }
    if (listed.repo === "git" && listed.remote !== null && machines !== null) {
      return [{ id: "clone", label: t("left-sidebar.button.clone-here") }];
    }
    if (listed.repo === "none") {
      return [{ id: "link", label: t("left-sidebar.button.link-here") }];
    }
    return [];
  };
  const bring = (workspace: SidebarWorkspace, id: string) => {
    const { listed } = workspace;
    const machineId = workspace.ref.machine;
    if (machineId === undefined) return;
    const key = workspaceKey(workspace.ref);
    if (id === "install") {
      if (workspace.ref.kind !== "app") return;
      const appId = workspace.ref.id;
      const name = workspace.name;
      const from = lists.names.get(machineId) ?? "";
      setClone(key, {
        state: "cloning",
        text: t("take-in.note.installing", { name }),
      });
      void dataOf(null)
        .apps.takeIn(appId)
        .then((outcome) =>
          setClone(key, {
            state: outcome.ok ? "done" : "failed",
            text: takeInText(outcome, name, from),
            ...(outcome.ok
              ? {
                  onOpen: () => {
                    const target: WorkspaceRef = {
                      kind: "app",
                      id: outcome.app,
                    };
                    if (props.onNewSessionAt !== undefined) {
                      props.onNewSessionAt(target, {});
                    } else {
                      props.onWorkspaceRow(target);
                    }
                  },
                }
              : {}),
          }),
        );
      return;
    }
    if (listed === undefined) return;
    if (id === "link") {
      setLinking({ machine: machineId, project: listed });
      return;
    }
    if (machines === null || listed.remote === null || listed.identity === null)
      return;
    setClone(key, { state: "cloning" });
    void machines
      .cloneHere({
        url: listed.remote.url,
        identity: listed.identity,
        title: listed.title,
      })
      .then((outcome) => setClone(key, cloneResult(outcome)));
  };
  // 연결된 다른 기계. 등록 dialog가 허락한 기계를 골라 그 기계에 등록한다. 목록이 바뀔 때마다 새로 지으면 열린 dialog의
  // 고른 기계가 풀리므로 연결된 기계가 바뀔 때만 짓는다.
  const live = lists.lists
    .flatMap((list) =>
      list.machine === null || !list.live
        ? []
        : [`${list.machine}\0${list.name}`],
    )
    .join("\n");
  const targets = useMemo(
    (): readonly RegisterTarget[] =>
      live === ""
        ? []
        : live.split("\n").map((line) => {
            const [machine, name] = line.split("\0") as [string, string];
            const data = dataOf(machine);
            return {
              machine,
              name,
              source: data.projects,
              grant: () => data.grant(),
            };
          }),
    [live, dataOf],
  );

  // 다른 workspace의 탭: 그 workspace의 layout에서 탭을 골라 두고(접힌 float은 펴고) workspace로 간다. detached 탭은 그 desk만
  // 보이게 둔다(그 창은 그 workspace가 열려야 선다).
  const showTabAt = async (ref: WorkspaceRef, tab: string) => {
    const read = await layoutOf(ref).readWorkspaceLayout(ref);
    const found =
      read.ok && read.layout !== null ? findTab(read.layout, tab) : null;
    if (read.ok && read.layout !== null && found !== null) {
      await layoutOf(ref).saveWorkspaceLayout(
        ref,
        updateDesk(
          setActiveDesk(read.layout, found.desk),
          found.desk,
          (desk) =>
            found.where === "float"
              ? restoreFloat(desk, tab)
              : selectTab(desk, tab),
        ),
      );
    }
    props.onWorkspace(ref);
  };

  // 다른 workspace의 탭은 그 workspace의 layout(이 창이 읽거나 쓴 값)을 고친다. 그 workspace를 열면 고친 탭으로 시작한다.
  const editTabAt = async (
    ref: WorkspaceRef,
    match: (tab: TabItem) => boolean,
    edit: "close" | ((tab: TabItem) => TabItem),
  ) => {
    const read = await layoutOf(ref).readWorkspaceLayout(ref);
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
    await layoutOf(ref).saveWorkspaceLayout(ref, {
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
  // PTY는 그 기계의 store가 들고 있어 여기서 닫는다. 닫았을 때만 그 workspace의 탭을 지운다.
  const closeTerminalAt = async (ref: WorkspaceRef, key: string) => {
    const terminal = dataOf(ref.machine ?? null).terminal;
    if (terminal === undefined || !(await closeTerminalTab(terminal, key))) {
      return;
    }
    await editTabAt(ref, isTerminal(key), "close");
  };
  const terminalProjectOfRef = (ref: WorkspaceRef): string | null =>
    ref.kind === "project"
      ? ref.id
      : ref.kind === "home"
        ? HOME_TERMINAL_PROJECT
        : null;
  const renameTerminalAt = (ref: WorkspaceRef, key: string, name: string) => {
    const person = name.trim() || null;
    const terminal = dataOf(ref.machine ?? null).terminal;
    void editTabAt(ref, isTerminal(key), (row) =>
      terminalNamed(row, person, terminal?.store),
    );
    const project = terminalProjectOfRef(ref);
    if (terminal !== undefined && project !== null) {
      pinAgentSessionName(terminal, project, key, person);
    }
  };

  // 다른 기계의 coding agent 터미널. 지금 workspace면 열린 탭을 고르거나 바로 붙는 탭을 열고,
  // 다른 workspace면 터미널 참조를 실어 그 workspace로 이동해 첫 클릭에 탭이 바로 열리게 한다.
  const openRemoteTerminal = (
    workspace: SidebarWorkspace,
    item: SidebarSession,
    remote: NonNullable<SidebarSession["remote"]>,
  ) => {
    const here = workspaceKey(workspace.ref) === workspaceKey(current);
    if (here) {
      // elsewhere.terminals는 지금 workspace에서 탭을 닫은 직후 아직 낡았을 수 있어 지금 layout을 직접 본다.
      const openTab =
        props
          .hereTabs?.()
          .find(
            (tab) =>
              tab.kind === "terminal" &&
              (tab.key === remote.tab ||
                terminalRefOf(tab) === remote.terminal),
          )?.key ?? (props.hereTabs === undefined ? remote.tab : null);
      if (openTab !== null) props.onTab(openTab);
      else {
        props.onTerminal({
          key: item.ref,
          harness: remote.harness,
          label: remote.harness,
          title: item.title,
          dot: item.dot,
          at: item.at,
          live: null,
          saved: null,
          ...(remote.machine === workspace.ref.machine
            ? {}
            : { machine: remote.machine }),
          remote: { terminal: remote.terminal },
        });
      }
      return;
    }
    if (props.onTerminalAt !== undefined) {
      props.onTerminalAt(workspace.ref, remote.terminal);
    } else if (remote.tab !== null) {
      void showTabAt(workspace.ref, remote.tab);
    } else {
      props.onWorkspace(workspace.ref);
    }
  };

  const open = (workspace: SidebarWorkspace, item: SidebarSession) => {
    const here = workspaceKey(workspace.ref) === workspaceKey(current);
    if (item.offline) return;
    // 다른 컴퓨터에서 도는 팀원은 그 컴퓨터의 session을 그 기계를 단 탭으로 연다(그 컴퓨터가 꺼져 있으면 탭이 한 줄로 말한다).
    if (item.member !== undefined) {
      runToastAction({
        kind: "session",
        session: item.ref,
        machine: item.member.machine,
      });
      return;
    }
    if (item.kind === "session" && !here) {
      if (props.onSessionAt !== undefined) {
        props.onSessionAt(workspace.ref, item.ref, item.machine);
      } else props.onOpenSession(item.ref);
      return;
    }
    if (item.kind === "session" && item.machine !== undefined) {
      props.onOpenOn(item.ref, item.machine);
      return;
    }
    if (item.kind === "workflow") props.onWorkflow(item.ref);
    else if (item.kind === "draft") props.onTab(item.ref);
    else if (item.kind === "terminal" && item.remote !== undefined) {
      openRemoteTerminal(workspace, item, item.remote);
    } else if (item.kind === "terminal") {
      const terminal = props.terminals.find((row) => row.key === item.ref);
      if (terminal !== undefined) props.onTerminal(terminal);
      else if (!here) void showTabAt(workspace.ref, item.ref);
    } else {
      const agent = entries.find((row) => row.session === item.ref)?.agent;
      if (agent !== null && agent !== undefined) {
        props.onOpenHere(item.ref, agent);
      }
    }
  };

  // session 줄 아래의 탭 줄. 이 창의 탭은 창이 고른다(접힌 float은 펴고 detached는 그 창을 앞으로).
  const openSessionTab = (tab: SidebarTab) => {
    if (workspaceKey(tab.workspace) === workspaceKey(current)) {
      props.onTab(tab.key);
    } else void showTabAt(tab.workspace, tab.key);
  };

  // current 줄의 desk 머리 줄. 이 workspace면 바로 desk를 바꾸고, 다른 workspace면 그 layout의 active_desk를 맞춘 뒤 이동한다.
  const openDesk = (workspace: SidebarWorkspace, deskKey: string) => {
    if (workspaceKey(workspace.ref) === workspaceKey(current)) {
      (props.onDesk ?? props.onWorkflow)(deskKey);
      return;
    }
    void (async () => {
      const read = await layoutOf(workspace.ref).readWorkspaceLayout(
        workspace.ref,
      );
      if (
        read.ok &&
        read.layout !== null &&
        Object.hasOwn(read.layout.desks, deskKey)
      ) {
        await layoutOf(workspace.ref).saveWorkspaceLayout(
          workspace.ref,
          setActiveDesk(read.layout, deskKey),
        );
      }
      props.onWorkspace(workspace.ref);
    })();
  };

  // tab 없이 current에 있는 lophn session(도는 중, 기다리는 중)은 그 기계의 agent source로 바로 부른다.
  const sourceOf = (session: string) => {
    const entry = entries.find((row) => row.session === session);
    if (!entry?.agent) return undefined;
    return dataOf(entry.machine).agentViewSource({
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
    if (item.kind === "terminal") {
      const saved = props.terminals.find(
        (row) => row.key === item.ref && row.saved !== null,
      );
      const savedProject = terminalProjectOfRef(workspace.ref);
      if (saved?.saved != null && savedProject !== null) {
        const terminal = dataOf(workspace.ref.machine ?? null).terminal;
        const person = title.trim() || null;
        if (terminal?.core != null) {
          void terminal.core.renameSaved({
            project: savedProject,
            harness: saved.harness,
            external_session: saved.saved.externalSession,
            name: person?.slice(0, 200) ?? null,
          });
        }
        return;
      }
      renameTerminalAt(workspace.ref, item.ref, title);
    } else if (item.kind === "session") {
      void sourceOf(item.ref)?.act(item.ref, {
        type: "rename",
        session: item.ref,
        key: newId("rename"),
        title,
      });
    }
  };
  // Stop은 session을 current에서 내린다: 도는 turn을 멈추고 탭을 닫는다. 멈추지 못하면 탭을 남긴다.
  const stopSession = (workspace: SidebarWorkspace, item: SidebarSession) => {
    const here = workspaceKey(workspace.ref) === workspaceKey(current);
    if (item.member !== undefined) {
      endMember(item.ref, item.member.stateSeq);
      return;
    }
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

  // 다른 컴퓨터에서 도는 팀원을 끝낸다: 자리를 가진 기계에서 자리를 보관하면 그 기계가 곧바로 닫고 그 컴퓨터에 닫으라는 mail을 낸다.
  // 자리는 session read에 없어 snapshot의 `state_seq`가 compare다. 줄은 `SessionEnded`로 빠진다.
  const endMember = (session: string, stateSeq: string) => {
    const owner = lists.members.find((one) => one.session === session);
    if (owner === undefined) return;
    void dataOf(owner.machine)
      .core.call(
        commandCall(archiveSession, {
          input: { session },
          compare: { state_seq: stateSeq },
          key: `sessions-archive-${session}-${stateSeq}`,
        }),
      )
      .then((reply) => {
        if (!reply.ok) {
          failToast.show({ title: t("left-sidebar.error.end-member-failed") });
        }
      });
  };

  // sidebar 줄의 탭을 끌어 놓기(`move-tab.ts`). 줄의 탭은 kind를 가리지 않고 그 줄의 workspace layout에서 찾는다: session은 그
  // session의 Agent 탭, draft는 그 key, 터미널은 그 탭(이 창의 도는 터미널은 store의 탭 key, 다른 기계의 터미널은 붙은 탭). 탭 없이
  // 도는 session은 탭을 짓는다. 찾지도 짓지도 못하는 줄(탭 없는 saved·다른 기계 터미널)은 누른 것처럼 연다.
  const hereKey = workspaceKey(current);
  const rowOf = (row: NonNullable<TabDragItem["row"]>) =>
    workspaces.find(
      (one) => workspaceKey(one.ref) === workspaceKey(row.workspace),
    );
  const itemOf = (row: NonNullable<TabDragItem["row"]>) =>
    rowOf(row)
      ?.current.flatMap((group) => group.items.flatMap(withChildren))
      .concat(rowOf(row)?.recent ?? [])
      .find((one) => one.kind === row.kind && one.ref === row.ref);
  const matches =
    (row: NonNullable<TabDragItem["row"]>) =>
    (tab: TabItem): boolean => {
      if (row.kind === "session")
        return tab.kind === "agent" && sessionOf(tab) === row.ref;
      if (row.kind === "draft") return tab.key === row.ref;
      if (row.kind !== "terminal") return false;
      const live = props.terminals.find((one) => one.key === row.ref)?.live;
      const remote = itemOf(row)?.remote?.tab;
      return (
        tab.key === row.ref ||
        tab.key === live?.tabKey ||
        (remote != null && tab.key === remote)
      );
    };
  // 탭 없이 도는 session의 새 탭. 기계는 session의 기계이고 `retarget`이 놓을 workspace에 맞춘다.
  const freshTab = (row: NonNullable<TabDragItem["row"]>): TabItem | null => {
    if (row.kind !== "session") return null;
    const entry = entries.find((one) => one.session === row.ref);
    if (entry?.agent == null) return null;
    return sessionTab({
      session: row.ref,
      agent: entry.agent,
      workspace: entry.workspace?.id ?? "home",
      machine: entry.machine,
      title: row.title,
    });
  };
  // 탭의 기계를 놓을 workspace에 맞춘다. 지은 탭은 이 컴퓨터를 뜻하는 자리에서 온 것으로 본다(기계를 이미 적었다).
  const retarget = (
    tab: TabItem,
    from: WorkspaceRef,
    to: WorkspaceRef,
  ): TabItem | null =>
    movedTab(
      tab,
      workspaceKey(from) === workspaceKey(to) ? { kind: "app", id: "" } : from,
      to,
      thisComputer,
    );
  const readTabs = async (ref: WorkspaceRef) => {
    const read = await layoutOf(ref).readWorkspaceLayout(ref);
    return read.ok && read.layout !== null ? allTabs(read.layout) : [];
  };
  const take: SidebarRowDrops["take"] = async (row) => {
    const from = row.workspace;
    if (workspaceKey(from) === hereKey) {
      const found = props.hereTabs?.().find(matches(row));
      if (found !== undefined) return { key: found.key };
      const fresh = freshTab(row);
      const tab =
        fresh === null ? null : retarget(fresh, { kind: "home" }, current);
      if (tab !== null) return { tab };
    } else {
      const found = (await readTabs(from)).find(matches(row));
      if (found !== undefined) {
        const tab = retarget(found, from, current);
        if (tab === null) return null;
        await editTabAt(from, (one) => one.key === found.key, "close");
        return { tab };
      }
      const fresh = freshTab(row);
      const tab =
        fresh === null ? null : retarget(fresh, { kind: "home" }, current);
      if (tab !== null) return { tab };
    }
    const workspace = rowOf(row);
    const item = itemOf(row);
    if (workspace !== undefined && item !== undefined) open(workspace, item);
    return null;
  };
  const moveTo: SidebarRowDrops["moveTo"] = async (row, to) => {
    const from = row.workspace;
    if (workspaceKey(from) === workspaceKey(to)) return;
    if (workspaceKey(from) === hereKey) {
      const found = props.hereTabs?.().find(matches(row));
      if (found !== undefined) props.onMoveTab?.(found.key, to);
      else if (row.kind === "session") props.onMoveSession?.(row.ref, to);
      return;
    }
    const found = (await readTabs(from)).find(matches(row));
    const fresh = found === undefined ? freshTab(row) : null;
    const tab =
      found !== undefined
        ? retarget(found, from, to)
        : fresh === null
          ? null
          : retarget(fresh, { kind: "home" }, to);
    if (tab === null) return;
    if (workspaceKey(to) === hereKey) props.onPutTab?.(tab);
    else if (!(await putTab(layoutOf(to), to, tab))) return;
    if (found !== undefined) {
      await editTabAt(from, (one) => one.key === found.key, "close");
    } else elsewhere.reload();
  };
  const drops = props.rowDrops;
  if (drops !== undefined) drops.current = { take, moveTo };
  const { start: startDrag } = useTabDrag();

  return (
    <HandoffProvider value={handoffs}>
      <LeftSidebar
        onRowDrag={(event, workspace, item) => {
          // 다른 컴퓨터의 팀원은 이 창에 탭이 없어 끌지 않는다(LeftSidebar도 끌기를 걸지 않는다).
          if (item.kind === "member") return;
          startDrag(
            event,
            {
              key: `row:${item.kind}:${item.ref}`,
              whole: false,
              row: {
                workspace: workspace.ref,
                kind: item.kind,
                ref: item.ref,
                title: item.title,
              },
            },
            "leaf",
          );
        }}
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
              ? codingCommand(
                  (ref.machine === undefined ? hereCoding : coding).commands,
                  choice.id as HarnessId,
                )
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
        {...(props.onAgents === undefined ? {} : { onAgents: props.onAgents })}
        onWorkspace={props.onWorkspaceRow}
        onSession={open}
        onDesk={openDesk}
        onSessionTab={openSessionTab}
        onRemoveRecent={(workspace, item) => {
          recentHidden.hide(item.ref, item.at);
          // 터미널 coding session을 지우면 그 GUI 탭이 맡던 팀원 session도 보관해 더는 불리지 않게 한다.
          if (item.kind !== "terminal" || workspace.ref.kind !== "project") {
            return;
          }
          const saved = props.terminals.find(
            (row) => row.key === item.ref && row.saved !== null,
          );
          const terminal = dataOf(workspace.ref.machine ?? null).terminal;
          if (saved?.saved == null || terminal?.core == null) return;
          void terminal.core.forgetSaved({
            project: workspace.ref.id,
            harness: saved.harness,
            cli_session: saved.saved.externalSession,
          });
        }}
        onRenameSession={renameSession}
        onStopSession={stopSession}
        machineNames={lists.names}
        machineUpdates={lists.updates}
        workspaceMenu={bringItems}
        onWorkspaceMenu={bring}
        renderNote={(workspace) => {
          const key = workspaceKey(workspace.ref);
          const clone = clones.get(key);
          return clone === undefined ? null : (
            <CloneNote clone={clone} onDismiss={() => setClone(key, null)} />
          );
        }}
        checkoutPicker={(ref) =>
          workspaceKey(ref) === workspaceKey(current)
            ? (props.checkoutPicker ?? null)
            : null
        }
        {...(props.branchOf === undefined
          ? {}
          : {
              branchOf: (ref: WorkspaceRef, item: SidebarSession) =>
                workspaceKey(ref) === workspaceKey(current)
                  ? (props.branchOf?.(item) ?? null)
                  : null,
            })}
        commandsPopover={(ref) => {
          if (ref.kind !== "project" || ref.machine !== undefined) return null;
          const groups = commandGroupsFor(ref);
          const actions = commandsActionsFor(ref);
          if (
            groups.every((g) => g.commands.length === 0) &&
            actions.onManage === undefined
          ) {
            return null;
          }
          return (
            <ProjectCommandsList
              heading={t("left-sidebar.heading.commands")}
              groups={groups}
              actions={actions}
              showEmpty
            />
          );
        }}
        workspaceCommands={(ref): readonly SidebarCommand[] => {
          const groups = commandGroupsFor(ref);
          if (groups.length === 0) return [];
          const actions = commandsActionsFor(ref);
          const rows: SidebarCommand[] = [];
          for (const group of groups) {
            for (const cmd of group.commands) {
              const run = group.runs.get(cmd.id);
              const active = isCommandActive(run);
              const failed = isCommandFailed(run);
              if (!active && !failed) continue;
              const status: SidebarCommand["status"] = active
                ? "running"
                : run?.status === "timed_out"
                  ? "timed_out"
                  : "failed";
              const url = previewUrlOf(cmd, run);
              const tabKey = projectCommandTabKey(
                group.machine,
                group.projectId,
                cmd.id,
              );
              rows.push({
                key: `${group.machine ?? "local"}:${group.projectId}:${cmd.id}`,
                name: cmd.name,
                status,
                exitCode: run?.exit_code ?? null,
                ...(group.machine !== null && group.machineName !== undefined
                  ? { machineName: group.machineName }
                  : {}),
                previewUrl: url,
                selectedKey: sessionKey({ kind: "terminal", ref: tabKey }),
                onOpen: () => {
                  if (run?.terminal_id != null) {
                    actions.onViewTerminal(group, cmd, run);
                  } else if (!active) {
                    actions.onRun(group, cmd);
                  }
                },
                onRestart: () => {
                  if (active) actions.onRestart(group, cmd);
                  else actions.onRun(group, cmd);
                },
                onDismiss: () => actions.onDismiss?.(group, cmd),
                ...(url !== null && active
                  ? { onPreview: () => actions.onOpenPreview(group, url) }
                  : {}),
              });
            }
          }
          return rows;
        }}
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
        <LocalMachineScope>
          <RegisterDialog
            open={registering}
            source={projects}
            targets={targets}
            onClose={() => setRegistering(false)}
            onRegistered={(created, on) => {
              setRegistering(false);
              props.onWorkspace({
                kind: "project",
                id: created.id,
                ...(on === undefined ? {} : { machine: on }),
              });
            }}
          />
        </LocalMachineScope>
      )}
      {linking === null ? null : (
        <LinkProjectDialog
          remote={{
            machineName: lists.names.get(linking.machine) ?? "",
            title: linking.project.title,
            identity: linking.project.identity ?? "",
          }}
          candidates={(lists.lists[0]?.projects ?? []).filter(
            (item) =>
              !item.archived &&
              item.repo === "none" &&
              item.identity !== linking.project.identity,
          )}
          onLink={(project) =>
            dataOf(null).projects.linkIdentity(
              project,
              linking.project.identity ?? "",
            )
          }
          onClose={() => setLinking(null)}
        />
      )}
      {apps === undefined ? null : (
        <LocalMachineScope>
          <CreateAppDialog
            open={creating}
            source={apps}
            onClose={() => setCreating(false)}
            onCreated={(created) => {
              setCreating(false);
              props.onNewApp(created.id);
            }}
          />
        </LocalMachineScope>
      )}
      {failToast.dom === null ? null : (
        <div className={leftStyles.handoffToast}>
          <Toast
            tone="error"
            title={failToast.dom.title}
            timer={STAY}
            onClose={failToast.hide}
          />
        </div>
      )}
    </HandoffProvider>
  );
}
