// 왼쪽 sidebar만 보이는 shell 틀. 맨 아래 줄의 빠른 실행(Terminal · Browser · App ▾)을 workspace마다 보인다.
// `team`은 팀(spawn tree)이 도는 phroner다: coordinator 아래 자식 둘과 손자 하나가 들여쓰여 서고, coordinator 줄을 펴 그
// session이 주인인 탭(자식의 대화 탭, artifact 탭, 접힌 browser float)이 보인다. `team-across`는 coordinator 아래에 이 컴퓨터의 자식
// 하나와 다른 컴퓨터에서 도는 팀원 셋(pending, held, running)이 선다.
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
import {
  type Handoffs,
  HandoffProvider,
} from "../../../../../packages/shell/renderer/desktop/workspaces/projects/handoff-source.ts";
import { press, runSteps, type Step, useDrive } from "../../../mock/drive.ts";
import {
  ACROSS_COORDINATOR,
  ACROSS_MACHINE_NAMES,
  COORDINATOR,
  TEAM_PROJECT,
  teamAcrossSidebar,
  teamSidebar,
} from "../../../mock/team-tree.ts";
import { PageLeftSidebar, pageQuick } from "../project-window.tsx";

const noop = () => {};

function TeamSidebar({ across = false }: { across?: boolean }) {
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
  const [workspaces] = useState(across ? teamAcrossSidebar : teamSidebar);
  return (
    <EventsProvider client={client}>
      <SidebarMemoryProvider memory={memory}>
        <LeftSidebar
          workspaces={workspaces}
          current={TEAM_PROJECT}
          selected={sessionKey({
            kind: "session",
            ref: across ? ACROSS_COORDINATOR : COORDINATOR,
          })}
          machineNames={ACROSS_MACHINE_NAMES}
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

// 다른 컴퓨터 둘이 phroner에 남긴 note. 하나는 branch가 없다. 시각은 지금에서 잰다.
const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();
const HANDOFFS: Handoffs = {
  notes: [
    {
      machine: "mch_01h455vb4pex5v6nkc6gd5fm01",
      computer: "Home server",
      session: "ses_01h455vb4pex5v6nkc6gd5fn01",
      project: "prj_phroner",
      agent_name: "lophn",
      text: "Checkout flow half done: rounding is per line, not per order.\nTests in cart_test.ts still fail for 3 items.",
      branch: "fix/checkout-rounding",
      commit: "9f2c1ab",
      written_at: ago(25),
    },
    {
      machine: "mch_01h455vb4pex5v6nkc6gd5fm02",
      computer: "Laptop",
      session: "ses_01h455vb4pex5v6nkc6gd5fn02",
      project: "prj_phroner",
      agent_name: "lophn",
      text: "Sketched the order export. Next: wire the CSV button.",
      branch: null,
      commit: null,
      written_at: ago(3 * 60),
    },
  ],
  open: () => Promise.resolve(),
  dismiss: noop,
};

export const sidebarSteps = {
  appMenu: [() => press("[data-quick=app]")] as readonly Step[],
};

export function SidebarScene({
  workspace,
  steps = [],
}: {
  workspace: "project" | "home" | "app" | "team" | "team-across";
  steps?: readonly Step[];
}) {
  useDrive(() => runSteps(steps));
  return (
    <HandoffProvider value={workspace === "project" ? HANDOFFS : null}>
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
          workspace === "team" || workspace === "team-across" ? (
            <TeamSidebar across={workspace === "team-across"} />
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
    </HandoffProvider>
  );
}
