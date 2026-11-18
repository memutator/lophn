// 한 창의 목록: 이 컴퓨터(Studio)의 창 왼쪽 sidebar와 Home의 Workspaces panel이 모든 기계의 것을 보인다. 줄은 renderer의
// 순수 함수가 `mock/machines-data.ts`의 가짜 기계 셋에서 짓고, 화면은 LeftSidebar·AwayLine·WorkspacesPanel 그대로다.
import { Icon } from "@lophn/ui/primitives";
import { useMemo, useState } from "react";
import { galleryApps } from "../../../../../packages/shell/renderer/apps/testdata/fake-apps.ts";
import { createEventClient } from "../../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { createFakeSource } from "../../../../../packages/shell/renderer/desktop/connection/events/fake-source.ts";
import { EventsProvider } from "../../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import { fakeProjects } from "../../../../../packages/shell/renderer/desktop/workspaces/projects/testdata/fake-projects.ts";
import { shellIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";
import type { WorkspaceRef } from "../../../../../packages/shell/renderer/shell/desk-model.ts";
import { LeftSidebar } from "../../../../../packages/shell/renderer/shell/left-sidebar.tsx";
import { sessionKey } from "../../../../../packages/shell/renderer/shell/left-sidebar-model.ts";
import { PanelTabs } from "../../../../../packages/shell/renderer/shell/panel-tabs.tsx";
import { ShellFrame } from "../../../../../packages/shell/renderer/shell/shell-frame.tsx";
import {
  type StripTab,
  TabStrip,
} from "../../../../../packages/shell/renderer/shell/tab-strip.tsx";
import { WorkspacesPanel } from "../../../../../packages/shell/renderer/shell/workspaces-panel.tsx";
import { AwayLine } from "../../../../../packages/shell/renderer/workspace/sidebar/away-line.tsx";
import { withSyncLists } from "../../../mock/core-answers/sync-lists.ts";
import {
  GROCERY_THERE,
  HOME_SERVER,
  MACHINE_NAMES,
  machineRows,
  machineSidebar,
  PHRONER_HERE,
  TUNE,
  TUNE_TAB,
} from "../../../mock/machines-data.ts";
import { workspaceKey } from "../../../../../packages/shell/renderer/shell/desk-model.ts";

const noop = () => {};

const PANELS = [
  { key: "workspaces", label: "Workspaces", icon: shellIcons.app },
];

function Sidebar({
  current,
  laptop,
}: {
  current: WorkspaceRef;
  laptop: boolean;
}) {
  // Inbox(WaitingLayer)가 event를 듣는다.
  const [client] = useState(() => createEventClient(createFakeSource()));
  const workspaces = useMemo(
    () => machineSidebar(current, laptop),
    [current, laptop],
  );
  return (
    <EventsProvider client={client}>
      <LeftSidebar
        workspaces={workspaces}
        current={current}
        {...(workspaceKey(current) === workspaceKey(PHRONER_HERE)
          ? { selected: sessionKey({ kind: "terminal", ref: TUNE_TAB }) }
          : {})}
        choices={() => []}
        onNewSession={noop}
        onNewSessionWith={noop}
        onOpenSession={noop}
        onInbox={noop}
        onJobs={noop}
        onAgents={noop}
        onWorkspace={noop}
        onSession={noop}
        onRegisterProject={noop}
        onCreateApp={noop}
        onRenameSession={noop}
        onStopSession={noop}
        onSettings={noop}
        machineNames={MACHINE_NAMES}
        renderAway={(workspace) =>
          workspace.away === undefined ? null : (
            <AwayLine
              away={workspace.away}
              {...(workspace.offline
                ? { offline: MACHINE_NAMES.get(workspace.away.machine) ?? "" }
                : {})}
              cloneHere={() => new Promise(() => {})}
              onLink={noop}
            />
          )
        }
      />
    </EventsProvider>
  );
}

const card = (
  <div
    style={{
      flex: 1,
      borderRadius: "var(--radius-lg)",
      background: "var(--color-surface-base)",
    }}
  />
);

const tab = (key: string, title: string, machine?: string): StripTab => ({
  key,
  title,
  icon: <Icon icon={shellIcons.terminal} pixels={14} />,
  ...(machine === undefined ? {} : { machine: MACHINE_NAMES.get(machine) }),
});

// 이 컴퓨터의 phroner에는 이 컴퓨터의 탭 하나와 Home server의 터미널 탭이 열려 있다. Grocery list는 Home server의 project라 그
// workspace의 탭은 모두 그 기계의 것이다. 이 컴퓨터의 탭에는 꼬리표가 없다.
function tabsOf(current: WorkspaceRef) {
  const here = workspaceKey(current) === workspaceKey(PHRONER_HERE);
  const there = workspaceKey(current) === workspaceKey(GROCERY_THERE);
  if (!here && !there) return null;
  const tabs = here
    ? [tab("shell", "zsh"), tab(TUNE_TAB, TUNE.title ?? "", HOME_SERVER)]
    : [tab("terminal-dedupe", "Dedupe the shopping list", HOME_SERVER)];
  return (
    <TabStrip
      entries={tabs.map((one) => ({ key: one.key, tabs: [one] }))}
      selected={here ? TUNE_TAB : "terminal-dedupe"}
      minimized={[]}
      floating={[]}
      onSelect={noop}
      onClose={noop}
      onNewTab={noop}
      onToggleFloat={noop}
    />
  );
}

/** 왼쪽 sidebar. `current`가 이 창이 보는 workspace이고 `laptop`이면 꺼진 Laptop의 줄도 선다. */
export function MachinesSidebarScene({
  current,
  laptop = false,
}: {
  current: WorkspaceRef;
  laptop?: boolean;
}) {
  return (
    <ShellFrame
      left
      onToggleLeft={noop}
      right={false}
      onToggleRight={noop}
      tabs={tabsOf(current)}
      panelTabs={null}
      leftSidebar={<Sidebar current={current} laptop={laptop} />}
      rightSidebar={null}
    >
      {card}
    </ShellFrame>
  );
}

/** Home의 오른쪽 Workspaces panel. 다른 기계에도 있는 project는 그 이름을 달고 이 컴퓨터에 없는 줄은 기계 꼬리표를 단다. */
export function MachinesPanelScene() {
  const projects = useMemo(() => fakeProjects().source, []);
  const apps = useMemo(() => galleryApps().source, []);
  const client = useMemo(
    () => createEventClient(withSyncLists(createFakeSource(), projects, apps)),
    [projects, apps],
  );
  const rows = useMemo(() => machineRows(true), []);
  return (
    <ShellFrame
      left
      onToggleLeft={noop}
      right
      onToggleRight={noop}
      tabs={null}
      panelTabs={
        <PanelTabs tabs={PANELS} selected="workspaces" onSelect={noop} />
      }
      leftSidebar={<Sidebar current={{ kind: "home" }} laptop />}
      rightSidebar={
        <EventsProvider client={client}>
          <WorkspacesPanel
            projects={projects}
            apps={apps}
            onProject={noop}
            onApp={noop}
            onNewApp={noop}
            elsewhere={{ rows, names: MACHINE_NAMES, onOpen: noop }}
          />
        </EventsProvider>
      }
    >
      {card}
    </ShellFrame>
  );
}
