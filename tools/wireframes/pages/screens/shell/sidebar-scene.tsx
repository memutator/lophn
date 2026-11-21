// 왼쪽 sidebar만 보이는 shell 틀. 맨 아래 줄의 빠른 실행(Terminal · Browser · App ▾)을 workspace마다 보인다.
// `team`은 팀(spawn tree)이 도는 phroner다: coordinator 아래 자식 둘과 손자 하나가 들여쓰여 서고, coordinator 줄을 펴 그
// session이 주인인 탭(자식의 대화 탭, artifact 탭, 접힌 browser float)이 보인다.
import { useState } from "react";
import { createEventClient } from "../../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { createFakeSource } from "../../../../../packages/shell/renderer/desktop/connection/events/fake-source.ts";
import { EventsProvider } from "../../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import { LeftSidebar } from "../../../../../packages/shell/renderer/shell/left-sidebar.tsx";
import { sessionKey } from "../../../../../packages/shell/renderer/shell/left-sidebar-model.ts";
import {
  createSidebarMemory,
  SidebarMemoryProvider,
} from "../../../../../packages/shell/renderer/shell/sidebar-memory.tsx";
import { PanelTabs } from "../../../../../packages/shell/renderer/shell/panel-tabs.tsx";
import { ShellFrame } from "../../../../../packages/shell/renderer/shell/shell-frame.tsx";
import { shellIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";
import { press, runSteps, type Step, useDrive } from "../../../mock/drive.ts";
import {
  COORDINATOR,
  TEAM_PROJECT,
  teamSidebar,
} from "../../../mock/team-tree.ts";
import { PageLeftSidebar, pageQuick } from "../project-window.tsx";

const noop = () => {};

function TeamSidebar() {
  // Inbox(WaitingLayer)가 event를 듣는다.
  const [client] = useState(() => createEventClient(createFakeSource()));
  const [memory] = useState(() => {
    const made = createSidebarMemory();
    made.values = {
      ...made.values,
      sessionTabsOpen: new Set([COORDINATOR]),
    };
    return made;
  });
  const [workspaces] = useState(teamSidebar);
  return (
    <EventsProvider client={client}>
      <SidebarMemoryProvider memory={memory}>
        <LeftSidebar
          workspaces={workspaces}
          current={TEAM_PROJECT}
          selected={sessionKey({ kind: "session", ref: COORDINATOR })}
          quick={pageQuick("project", noop)}
          choices={() => []}
          onNewSession={noop}
          onNewSessionWith={noop}
          onOpenSession={noop}
          onInbox={noop}
          onJobs={noop}
          onAgents={noop}
          onWorkspace={noop}
          onSession={noop}
          onSessionTab={noop}
          onRegisterProject={noop}
          onCreateApp={noop}
          onRenameSession={noop}
          onStopSession={noop}
          onSettings={noop}
        />
      </SidebarMemoryProvider>
    </EventsProvider>
  );
}

export const sidebarSteps = {
  appMenu: [() => press("[data-quick=app]")] as readonly Step[],
};

export function SidebarScene({
  workspace,
  steps = [],
}: {
  workspace: "project" | "home" | "app" | "team";
  steps?: readonly Step[];
}) {
  useDrive(() => runSteps(steps));
  return (
    <ShellFrame
      left
      onToggleLeft={noop}
      right={false}
      onToggleRight={noop}
      tabs={null}
      panelTabs={
        <PanelTabs
          tabs={[
            { key: "workspaces", label: "Workspaces", icon: shellIcons.app },
          ]}
          selected="workspaces"
          onSelect={noop}
        />
      }
      leftSidebar={
        workspace === "team" ? (
          <TeamSidebar />
        ) : (
          <PageLeftSidebar
            workspace={workspace}
            onOpenFile={noop}
            onAgent={noop}
          />
        )
      }
      rightSidebar={null}
    >
      <div
        style={{
          flex: 1,
          borderRadius: "var(--radius-lg)",
          background: "var(--color-surface-base)",
        }}
      />
    </ShellFrame>
  );
}
