// place(Home, project) 창의 왼쪽 sidebar. 화면(LeftSidebar)에 이 창이 아는 값을 모아 준다: 모든 place의 session, 이 place의 열린 탭 제목,
// 터미널 coding agent session, 사람 차례인 workflow desk(project만). 등록·생성 dialog도 여기서 연다.
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { HARNESS_ADAPTERS } from "../../../../protocol/coding-agent/harness-adapter.ts";
import type { HarnessId } from "../../../../protocol/coding-agent/harness-id.ts";
import type { AppsSource } from "../../apps/source.ts";
import type { AgentTabSourceFactory } from "../../conversation/agent-tab-source.ts";
import {
  useSessions,
  useWorkflowChanges,
} from "../../desktop/connection/events/hooks.tsx";
import type { JobsSource } from "../../desktop/jobs/source.ts";
import { CreateAppDialog } from "../../desktop/places/create-app-dialog.tsx";
import type { ProjectsSource } from "../../desktop/places/projects/source.ts";
import { RegisterDialog } from "../../desktop/places/register-dialog.tsx";
import { useQuickPrefs } from "../../desktop/settings/quick-launch/store.tsx";
import {
  AgentFaceIcon,
  type AgentChoice,
} from "../../parts/agent-session/agent-session.tsx";
import { codingDot, codingFace } from "../../parts/agent-session/coding.ts";
import {
  closeTab,
  placeKey,
  type PlaceRef,
  selectTab,
} from "../../shell/desk-model.ts";
import { agentOf, sessionOf } from "../agent/tab-fields.ts";
import type { WindowPlace } from "../place-window.tsx";
import { LeftSidebar, type QuickLaunch } from "../../shell/left-sidebar.tsx";
import {
  type SidebarPlace,
  type SidebarSession,
} from "../../shell/left-sidebar-model.ts";
import { sidebarPlaces } from "../../shell/left-sidebar-places.ts";
import {
  useKnownSessions,
  useTabsElsewhere,
  useSidebarPlaceList,
} from "../../shell/use-left-sidebar.ts";
import { useRemembered } from "../../shell/sidebar-memory.tsx";
import { closeTerminalTab, type TerminalDeps } from "../../terminal/deps.ts";
import type { TabItem } from "../model.ts";
import {
  otherPlaceTerminalTitle,
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
  // place를 옮기면 창의 마지막 값에서 시작한다.
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

export interface PlaceLeftSidebarProps {
  place: WindowPlace;
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
   * 창의 터미널. store는 place를 옮겨도 살아 있어 다른 place 터미널에서 agent가 지금 도는지 알고, 그 PTY를 닫기 확인을 거쳐 닫는다.
   * 없으면 다른 place의 터미널 줄이 없다.
   */
  terminal?: TerminalDeps;
  /** 고른 tab의 줄(`sessionKey`). */
  selected?: string;
  /** 터미널 탭을 열 수 있다. 없으면 coding agent 항목이 없다. */
  canTerminal: boolean;
  /** 이 place 줄의 +. */
  onNewSession: () => void;
  /** 다른 place 줄의 +. 그 place로 가서 새 session을 연다. 없으면 그 +는 그 place로 가기만 한다. */
  onNewSessionAt?: (place: PlaceRef) => void;
  onNewLophn: (agent: SidebarAgent) => void;
  onNewCoding: (command: string) => void;
  /** 이 project의 session을 desk 규칙으로 연다. */
  onOpenHere: (session: string, agent: string) => void;
  onTerminal: (terminal: PanelTerminal) => void;
  onWorkflow: (workflow: string) => void;
  /** 다른 place의 session이거나 Inbox 카드의 session. 그 place로 가서 연다. */
  onOpenSession: (session: string) => void;
  onPlace: (ref: PlaceRef) => void;
  onNewApp: (app: string) => void;
  /** Jobs overlay의 통로. 없으면 Jobs 줄이 바로 탭을 연다. */
  jobs?: JobsSource;
  onInbox: () => void;
  onJobs: () => void;
  /** 맨 아래 줄의 빠른 실행. Terminal hover 목록(즐겨찾기 coding agent)은 여기서 붙인다. */
  quick?: QuickLaunch;
  /** 이 창의 탭(draft 줄)을 고른다. */
  onTab: (key: string) => void;
  /** 이 창의 탭이 그 session·터미널이면 탭 이름 바꾸기와 같은 길로 바꾸고 true다. 탭이 없으면 false다. */
  onRenameTab?: (item: SidebarSession, title: string) => boolean;
  /** 그 session·터미널의 탭을 보통 닫기 길로 닫는다(터미널은 확인을 묻는다). 탭이 없으면 아무것도 하지 않는다. */
  onCloseTab?: (item: SidebarSession) => void;
  /** 이 place 줄의 설정 단추(project는 Project settings, 앱은 App details). */
  onPlaceSettings?: () => void;
  onSettings: () => void;
}

export function PlaceLeftSidebar(props: PlaceLeftSidebarProps) {
  const { place: current, projects, apps } = props;
  const projectId = current.kind === "project" ? current.id : null;
  const list = useSidebarPlaceList(projects, apps);
  const { sessions } = useSessions();
  const { known, reload: reloadKnown } = useKnownSessions(
    props.agentViewSource,
    sessions,
  );
  const placeRefs = useMemo(
    (): PlaceRef[] => [
      { kind: "home" },
      ...list.projects.map(
        (item): PlaceRef => ({
          kind: "project",
          id: item.id,
        }),
      ),
      ...list.apps.map((item): PlaceRef => ({ kind: "app", id: item.id })),
    ],
    [list.projects, list.apps],
  );
  const elsewhere = useTabsElsewhere(
    props.source.layout,
    placeRefs,
    current,
    sessions,
  );
  // 다른 place의 터미널은 agent가 지금 도는 것만 current다. 끝난 agent는 탭이 남아도 빠진다.
  const store = props.terminal?.store;
  const storeVersion = useSyncExternalStore(
    (listener) => store?.subscribe(listener) ?? (() => {}),
    () => store?.version() ?? 0,
  );
  const otherTerminals = useMemo(
    () =>
      new Map(
        // 창의 마지막 값이라 지금 place가 들 수 있다. 지금 place의 터미널은 props.terminals가 준다.
        [...elsewhere.terminals]
          .filter(([key]) => key !== placeKey(current))
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
                  title: otherPlaceTerminalTitle(tab, store),
                  dot: codingDot(agent),
                  at: 0,
                  live: { tabKey: tab.key },
                  saved: null,
                },
              ];
            }),
          ]),
      ),
    [elsewhere.terminals, store, storeVersion, placeKey(current)],
  );
  const openTitles = useMemo(
    () => new Map(elsewhere.titles).set(placeKey(current), props.openTitles),
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
  const places = useMemo(
    () =>
      sidebarPlaces({
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
      placeKey(current),
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
  const commandOf = (id: HarnessId) =>
    coding.commands[id] ?? HARNESS_ADAPTERS[id].commands[0];
  const favorites = props.canTerminal ? coding.favorites : [];
  const runCoding = (id: HarnessId) => {
    const command = commandOf(id);
    if (command !== undefined) props.onNewCoding(command);
  };
  const quick =
    props.quick === undefined
      ? undefined
      : {
          ...props.quick,
          terminalItems: favorites.map((id) => ({
            id,
            label: HARNESS_ADAPTERS[id].label,
            leading: <AgentFaceIcon face={codingFace(id)} />,
            onSelect: () => runCoding(id),
          })),
        };
  const choices: AgentChoice[] = [
    ...props.agents.map((agent) => ({
      kind: "lophn" as const,
      id: agent.assignment,
      name: agent.name,
      face: { kind: "lophn" as const, profile: agent.profile },
    })),
    ...favorites.map((id) => ({
      kind: "coding" as const,
      id,
      name: HARNESS_ADAPTERS[id].label,
      face: codingFace(id),
    })),
  ];
  const [registering, setRegistering] = useState(false);
  const [creating, setCreating] = useState(false);

  // 다른 place의 터미널 탭: 그 place의 layout에서 탭을 골라 두고 place로 간다.
  const showTerminalAt = async (ref: PlaceRef, tab: string) => {
    const read = await props.source.layout.readPlaceLayout(ref);
    if (read.ok && read.layout !== null) {
      const desk = Object.values(read.layout.desks).find((item) =>
        item.tabs.some((row) => row.key === tab),
      );
      if (desk !== undefined) {
        await props.source.layout.savePlaceLayout(ref, {
          active: desk.key,
          desks: { ...read.layout.desks, [desk.key]: selectTab(desk, tab) },
        });
      }
    }
    props.onPlace(ref);
  };

  // 다른 place의 탭은 그 place의 저장된 layout을 고친다. 그 place를 열면 고친 탭으로 시작한다.
  const editTabAt = async (
    ref: PlaceRef,
    match: (tab: TabItem) => boolean,
    edit: "close" | ((tab: TabItem) => TabItem),
  ) => {
    const read = await props.source.layout.readPlaceLayout(ref);
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
    await props.source.layout.savePlaceLayout(ref, { ...read.layout, desks });
    elsewhere.reload();
  };
  const closeAgentTabAt = (ref: PlaceRef, session: string) =>
    editTabAt(
      ref,
      (row) => row.kind === "agent" && sessionOf(row) === session,
      "close",
    );
  const isTerminal = (key: string) => (row: TabItem) =>
    row.kind === "terminal" && row.key === key;
  // PTY는 이 창의 store가 들고 있어 여기서 닫는다. 닫았을 때만 그 place의 탭을 지운다.
  const closeTerminalAt = async (ref: PlaceRef, key: string) => {
    const terminal = props.terminal;
    if (terminal === undefined || !(await closeTerminalTab(terminal, key))) {
      return;
    }
    await editTabAt(ref, isTerminal(key), "close");
  };
  const renameTerminalAt = (ref: PlaceRef, key: string, name: string) => {
    const person = name.trim() || null;
    void editTabAt(ref, isTerminal(key), (row) =>
      terminalNamed(row, person, store),
    );
    if (props.terminal !== undefined && ref.kind === "project") {
      pinAgentSessionName(props.terminal, ref.id, key, person);
    }
  };

  const open = (place: SidebarPlace, item: SidebarSession) => {
    const here = placeKey(place.ref) === placeKey(current);
    if (item.kind === "workflow") props.onWorkflow(item.ref);
    else if (item.kind === "draft") props.onTab(item.ref);
    else if (item.kind === "terminal") {
      const terminal = props.terminals.find((row) => row.key === item.ref);
      if (terminal !== undefined) props.onTerminal(terminal);
      else if (!here) void showTerminalAt(place.ref, item.ref);
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
      place: entry.place ?? { kind: "global", id: "" },
    });
  };
  const renameSession = (
    place: SidebarPlace,
    item: SidebarSession,
    title: string,
  ) => {
    if (props.onRenameTab?.(item, title) === true) return;
    if (item.kind === "terminal") renameTerminalAt(place.ref, item.ref, title);
    else if (item.kind === "session") {
      void sourceOf(item.ref)
        ?.renameSession(item.ref, title)
        .then((result) => {
          if (result.ok) reloadKnown();
        });
    }
  };
  // Stop은 session을 current에서 내린다: 도는 turn을 멈추고 탭을 닫는다. 멈추지 못하면 탭을 남긴다.
  const stopSession = (place: SidebarPlace, item: SidebarSession) => {
    const here = placeKey(place.ref) === placeKey(current);
    if (item.kind === "terminal" && !here) {
      void closeTerminalAt(place.ref, item.ref);
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
      else void closeAgentTabAt(place.ref, item.ref);
    });
  };

  return (
    <>
      <LeftSidebar
        places={places}
        current={current}
        selected={props.selected}
        choices={choices}
        onNewSession={(ref) => {
          if (placeKey(ref) === placeKey(current)) props.onNewSession();
          else if (props.onNewSessionAt !== undefined) {
            props.onNewSessionAt(ref);
          } else props.onPlace(ref);
        }}
        onNewSessionWith={(choice) => {
          if (choice.kind === "coding") {
            runCoding(choice.id as HarnessId);
            return;
          }
          const agent = props.agents.find(
            (row) => row.assignment === choice.id,
          );
          if (agent !== undefined) props.onNewLophn(agent);
        }}
        onOpenSession={props.onOpenSession}
        {...(props.jobs === undefined ? {} : { jobs: props.jobs })}
        onInbox={props.onInbox}
        onJobs={props.onJobs}
        onPlace={props.onPlace}
        onSession={open}
        onRemoveRecent={(_place, item) => recentHidden.hide(item.ref, item.at)}
        onRenameSession={renameSession}
        onStopSession={stopSession}
        {...(projects === undefined
          ? {}
          : { onRegisterProject: () => setRegistering(true) })}
        {...(apps === undefined
          ? {}
          : { onCreateApp: () => setCreating(true) })}
        {...(quick === undefined ? {} : { quick })}
        {...(props.onPlaceSettings === undefined
          ? {}
          : { onPlaceSettings: props.onPlaceSettings })}
        onSettings={props.onSettings}
      />
      {projects === undefined ? null : (
        <RegisterDialog
          open={registering}
          source={projects}
          onClose={() => setRegistering(false)}
          onRegistered={(created) => {
            setRegistering(false);
            list.reload();
            props.onPlace({ kind: "project", id: created.id });
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
