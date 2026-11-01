// place(Home, project) 창의 왼쪽 sidebar. 화면(LeftSidebar)에 이 창이 아는 값을 모아 준다: 모든 place의 session, 이 place의 열린 탭 제목,
// 터미널 coding agent session, 사람 차례인 workflow desk(project만). 등록·생성 dialog도 여기서 연다.
import { useEffect, useMemo, useState } from "react";

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
import { harnessVendorOf } from "../../parts/vendor-icon/vendor-icon.tsx";
import { placeKey, type PlaceRef, selectTab } from "../../shell/desk-model.ts";
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
import type { WorkspaceSource } from "../source.ts";
import { useHiddenRecent } from "./hidden-recent.ts";
import type { SidebarAgent } from "./sidebar-agent.ts";
import type { PanelTerminal } from "./panel-types.ts";

/** New session ▾에 올리는 coding agent. 터미널 탭에서 그 command를 연다. */
const CODING_AGENTS: readonly HarnessId[] = ["claude", "codex", "opencode"];

/** 이 project에서 사람 차례를 기다리는 workflow 이름(Home은 없다). instance가 바뀔 때마다 다시 읽는다. */
function useHumanTurnWorkflows(
  source: WorkspaceSource,
  project: string | null,
): readonly string[] {
  const [names, setNames] = useState<readonly string[]>([]);
  const [reads, setReads] = useState(0);
  useEffect(() => {
    if (project === null) return;
    let live = true;
    void source
      .workflowInstances({ project, state: "running" })
      .then((read) => {
        if (!live || !read.ok) return;
        setNames([
          ...new Set(
            read.value
              .filter((item) => item.current?.human_turn === true)
              .map((item) => item.workflow),
          ),
        ]);
      });
    return () => {
      live = false;
    };
  }, [source, project, reads]);
  useWorkflowChanges((_instance, payload) => {
    if (payload.project === project) setReads((count) => count + 1);
  });
  return names;
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
  terminals: readonly PanelTerminal[];
  /** 고른 tab의 줄(`sessionKey`). */
  selected?: string;
  /** 터미널 탭을 열 수 있다. 없으면 coding agent 항목이 없다. */
  canTerminal: boolean;
  onNewSession: () => void;
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
  /** 맨 아래 줄의 Terminal · Browser · App ▾. + menu와 같은 핸들러라 이 place에 없는 것은 비어 있다. */
  quick?: QuickLaunch;
  /** project 창에서 project 줄의 설정 단추. */
  onProjectSettings?: () => void;
  onSettings: () => void;
}

export function PlaceLeftSidebar(props: PlaceLeftSidebarProps) {
  const { place: current, projects, apps } = props;
  const projectId = current.kind === "project" ? current.id : null;
  const list = useSidebarPlaceList(projects, apps);
  const { sessions } = useSessions();
  const known = useKnownSessions(props.agentViewSource, sessions);
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
  const openTitles = useMemo(
    () => new Map(elsewhere.titles).set(placeKey(current), props.openTitles),
    [elsewhere.titles, current, props.openTitles],
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
        terminals: props.terminals,
        otherTerminals: elsewhere.terminals,
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
      props.terminals,
      elsewhere.terminals,
      workflows,
      recentHidden.hidden,
    ],
  );
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

  const open = (place: SidebarPlace, item: SidebarSession) => {
    const here = placeKey(place.ref) === placeKey(current);
    if (item.kind === "workflow") props.onWorkflow(item.ref);
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

  return (
    <>
      <LeftSidebar
        places={places}
        current={current}
        selected={props.selected}
        agents={props.agents.map((agent) => ({
          id: agent.assignment,
          name: agent.name,
          profile: agent.profile,
        }))}
        coding={
          props.canTerminal
            ? CODING_AGENTS.map((id) => ({
                id,
                name: HARNESS_ADAPTERS[id].label,
                vendor: harnessVendorOf(id),
              }))
            : []
        }
        onNewSession={props.onNewSession}
        onNewSessionWith={(kind, id) => {
          if (kind === "coding") {
            const command = HARNESS_ADAPTERS[id as HarnessId].commands[0];
            if (command !== undefined) props.onNewCoding(command);
            return;
          }
          const agent = props.agents.find((row) => row.assignment === id);
          if (agent !== undefined) props.onNewLophn(agent);
        }}
        onOpenSession={props.onOpenSession}
        {...(props.jobs === undefined ? {} : { jobs: props.jobs })}
        onInbox={props.onInbox}
        onJobs={props.onJobs}
        onPlace={props.onPlace}
        onSession={open}
        onRemoveRecent={(_place, item) => recentHidden.hide(item.ref, item.at)}
        {...(projects === undefined
          ? {}
          : { onRegisterProject: () => setRegistering(true) })}
        {...(apps === undefined
          ? {}
          : { onCreateApp: () => setCreating(true) })}
        {...(props.quick === undefined ? {} : { quick: props.quick })}
        {...(props.onProjectSettings === undefined
          ? {}
          : { onProjectSettings: props.onProjectSettings })}
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
