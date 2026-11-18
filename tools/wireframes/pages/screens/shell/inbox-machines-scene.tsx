// 모든 기계의 대기 목록이 한 Inbox에 뜨는 화면. 이 컴퓨터(Studio)의 창이 기계마다 fake 대기 목록을 읽고(Home server, 꺼진 Laptop),
// 화면은 LeftSidebar의 Inbox overlay와 Inbox 탭(WaitingPage) 그대로다. 같은 앱의 동의가 이 컴퓨터와 Home server 둘에 있어도 한 줄로
// 접히지 않는다(항목 key에 기계가 붙는다).
import { useMemo } from "react";

import type { MachineItem } from "../../../../../packages/shell/renderer/desktop/machines/source.ts";
import { createEventClient } from "../../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { createEventStores } from "../../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import {
  ACTIVATION,
  BUDGET,
  createFakeWaiting,
  EXTERNAL_CALL,
  INVENTORY,
  JOB_HOLD_AGENT,
  ORDERS,
  PROJECT,
  SHELL_COMMAND,
} from "../../../../../packages/shell/renderer/desktop/connection/waiting/fake-source.ts";
import {
  type InboxNames,
  InboxNamesProvider,
} from "../../../../../packages/shell/renderer/desktop/connection/waiting/names.ts";
import { WaitingPage } from "../../../../../packages/shell/renderer/desktop/connection/waiting/waiting-page.tsx";
import { devMock } from "../../../../../packages/shell/renderer/desktop/dev-mock/mod.ts";
import { MachinesProvider } from "../../../../../packages/shell/renderer/desktop/machines/context.tsx";
import type {
  MachineData,
  MachineHub,
} from "../../../../../packages/shell/renderer/desktop/machines/data.ts";
import {
  type MachineRef,
  MachineHubProvider,
  MachineScope,
} from "../../../../../packages/shell/renderer/desktop/machines/scope.tsx";
import { fakeMachines } from "../../../../../packages/shell/renderer/desktop/machines/testdata/fake-source.ts";
import { LeftSidebar } from "../../../../../packages/shell/renderer/shell/left-sidebar.tsx";
import { ShellFrame } from "../../../../../packages/shell/renderer/shell/shell-frame.tsx";
import { PaddedTab } from "../../../../../packages/shell/renderer/workspace/padded-tab.tsx";
import { AwayLine } from "../../../../../packages/shell/renderer/workspace/sidebar/away-line.tsx";
import { press } from "../../../mock/drive.ts";
import { Driven } from "../../../mock/driven.tsx";
import {
  HOME_SERVER,
  LAPTOP,
  MACHINE_NAMES,
  machineSidebar,
  PHRONER_HERE,
} from "../../../mock/machines-data.ts";

const noop = () => {};

const HOUR = 60 * 60 * 1000;

const MACHINES: readonly MachineItem[] = [
  {
    id: HOME_SERVER,
    name: "Home server",
    status: "connected",
    update: null,
    path: "relay",
    lastSeenAt: new Date().toISOString(),
  },
  {
    id: LAPTOP,
    name: "Laptop",
    status: "offline",
    update: null,
    path: null,
    lastSeenAt: new Date(Date.now() - 3 * HOUR).toISOString(),
  },
];

// 기계마다 그 기계의 대기 목록. 같은 앱의 동의(ACTIVATION)가 이 컴퓨터와 Home server에 다 있다. Laptop은 꺼져 있어 마지막으로 본 것이다.
const ITEMS = new Map<MachineRef, Parameters<typeof createFakeWaiting>[0]>([
  [null, [ACTIVATION(), "question"]],
  [HOME_SERVER, [SHELL_COMMAND(), ACTIVATION(), JOB_HOLD_AGENT()]],
  [LAPTOP, [EXTERNAL_CALL()]],
]);

// 기계마다 project·앱 이름(창의 목록이 읽은 것). 키 ""는 이 컴퓨터다. 카드는 자기 기계의 이름으로 읽는다.
const NAMES: ReadonlyMap<string, InboxNames> = new Map([
  [
    "",
    {
      projects: new Map([[PROJECT, "phroner"]]),
      apps: new Map([
        [ORDERS, "Orders"],
        [BUDGET, "Budget"],
        [INVENTORY, "Inventory"],
      ]),
    },
  ],
  [
    HOME_SERVER,
    {
      projects: new Map([[PROJECT, "phroner"]]),
      apps: new Map([
        [ORDERS, "Orders"],
        [BUDGET, "Budget"],
        [INVENTORY, "Inventory"],
      ]),
    },
  ],
  [
    LAPTOP,
    {
      projects: new Map(),
      apps: new Map([[ORDERS, "Orders"]]),
    },
  ],
]);

// 기계마다 같은 모양의 묶음. 대기 목록 층이 읽는 것(store, core, event)과 History의 범위가 쓰는 칸만 있다.
function sceneHub(): MachineHub {
  const mock = devMock("?mock")!;
  const data = new Map<MachineRef, MachineData>();
  return {
    get(machine) {
      let found = data.get(machine);
      if (found === undefined) {
        const events = createEventClient(
          createFakeWaiting(ITEMS.get(machine) ?? []),
        );
        found = {
          machine,
          here: machine === null,
          core: events.core,
          events,
          stores: createEventStores(events),
          appViews: null,
          projectIcons: mock.projectIcons,
          folders: null,
          grant: () => Promise.resolve(true),
        } as unknown as MachineData;
        data.set(machine, found);
      }
      return found;
    },
    stop: noop,
  };
}

function Sidebar() {
  const workspaces = useMemo(() => machineSidebar(PHRONER_HERE), []);
  return (
    <LeftSidebar
      workspaces={workspaces}
      current={PHRONER_HERE}
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
  );
}

/** `overlay`는 sidebar의 Inbox 줄이 여는 panel이고, `tab`은 Inbox 탭이다. */
export function InboxMachinesScene({ view }: { view: "overlay" | "tab" }) {
  const scene = useMemo(
    () => ({
      hub: sceneHub(),
      machines: fakeMachines({ machines: MACHINES }).source,
    }),
    [],
  );
  const frame = (
    <ShellFrame
      left
      onToggleLeft={noop}
      right={false}
      onToggleRight={noop}
      tabs={null}
      panelTabs={null}
      leftSidebar={<Sidebar />}
      rightSidebar={null}
    >
      {view === "tab" ? (
        <PaddedTab>
          <WaitingPage active onOpenSession={noop} />
        </PaddedTab>
      ) : (
        <div style={{ flex: 1 }} />
      )}
    </ShellFrame>
  );
  return (
    <MachinesProvider source={scene.machines}>
      <MachineHubProvider hub={scene.hub}>
        <MachineScope machine={null}>
          <InboxNamesProvider value={NAMES}>
            {view === "overlay" ? (
              <Driven steps={[() => press('[data-nav="inbox"]')]}>
                {frame}
              </Driven>
            ) : (
              frame
            )}
          </InboxNamesProvider>
        </MachineScope>
      </MachineHubProvider>
    </MachinesProvider>
  );
}
