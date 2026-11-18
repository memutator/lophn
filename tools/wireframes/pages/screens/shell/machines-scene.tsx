// 한 창의 목록: 이 컴퓨터(Studio)의 창 왼쪽 sidebar와 Home의 Workspaces panel이 모든 기계의 것을 보인다. 줄은 renderer의
// 순수 함수가 `mock/machines-data.ts`의 가짜 기계 셋에서 짓고, 화면은 LeftSidebar·AwayLine·WorkspacesPanel 그대로다.
import { useMemo, useState } from "react";
import { galleryApps } from "../../../../../packages/shell/renderer/apps/testdata/fake-apps.ts";
import { createEventClient } from "../../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { createFakeSource } from "../../../../../packages/shell/renderer/desktop/connection/events/fake-source.ts";
import { EventsProvider } from "../../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import { fakeProjects } from "../../../../../packages/shell/renderer/desktop/workspaces/projects/testdata/fake-projects.ts";
import { shellIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";
import type { WorkspaceRef } from "../../../../../packages/shell/renderer/shell/desk-model.ts";
import { LeftSidebar } from "../../../../../packages/shell/renderer/shell/left-sidebar.tsx";
import { PanelTabs } from "../../../../../packages/shell/renderer/shell/panel-tabs.tsx";
import { ShellFrame } from "../../../../../packages/shell/renderer/shell/shell-frame.tsx";
import { WorkspacesPanel } from "../../../../../packages/shell/renderer/shell/workspaces-panel.tsx";
import { AwayLine } from "../../../../../packages/shell/renderer/workspace/sidebar/away-line.tsx";
import { withSyncLists } from "../../../mock/core-answers/sync-lists.ts";
import {
  MACHINE_NAMES,
  machineRows,
  machineSidebar,
} from "../../../mock/machines-data.ts";

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
      tabs={null}
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
