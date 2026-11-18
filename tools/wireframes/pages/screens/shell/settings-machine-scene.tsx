// Settings에서 기계를 고르는 화면. 이 컴퓨터(Studio)의 Settings 머리 아래 고르기에서 Home server를 골라 그 기계의 설정을 연다. 화면은
// renderer의 SettingsSpace 그대로이고 기계마다 가짜 core(core-answers)가 따로 있다. 허락은 그 기계 묶음의 `grant()`가 정한다.
import { useMemo } from "react";

import { AppViewsProvider } from "../../../../../packages/shell/renderer/app-frame/app-views.tsx";
import { createEventClient } from "../../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { createEventStores } from "../../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
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
import { SettingsSpace } from "../../../../../packages/shell/renderer/desktop/settings/settings-space.tsx";
import type { MachineItem } from "../../../../../packages/shell/renderer/desktop/machines/source.ts";
import { GalleryConnectHost } from "../../../mock/connect-host.tsx";
import { settingsCore } from "../../../mock/core-answers/sync-settings.ts";
import { press, type Step } from "../../../mock/drive.ts";
import { Driven } from "../../../mock/driven.tsx";
import { HOME_SERVER, LAPTOP } from "../../../mock/machines-data.ts";

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

// 기계마다 가짜 core 하나. 이 컴퓨터는 모든 항목의 통로가 있고 다른 기계는 그 기계의 core에 걸린 항목만 쓴다.
function sceneHub(granted: boolean) {
  const mock = devMock("?mock")!;
  const data = new Map<MachineRef, MachineData>();
  const made = settingsCore();
  const hub: MachineHub = {
    get(machine) {
      let found = data.get(machine);
      if (found === undefined) {
        const core = machine === null ? made : settingsCore();
        const events = createEventClient(core.source);
        found = {
          machine,
          here: machine === null,
          core: events.core,
          events,
          stores: createEventStores(events),
          settings: core.settings,
          settingsPanels: core.panels,
          appViews: machine === null ? mock.appViews : null,
          projectIcons: mock.projectIcons,
          folders: null,
          grant: () => Promise.resolve(machine === null || granted),
        } as unknown as MachineData;
        data.set(machine, found);
      }
      return found;
    },
    stop: noop,
  };
  return { hub, made, mock };
}

const PICK_HOME_SERVER: readonly Step[] = [
  () => press("[data-settings-machine] [role=combobox]"),
  () => press("[role=option]", /Home server/),
];

/** 이 컴퓨터의 Settings에서 Home server를 골라 그 기계의 항목을 연 상태. `granted`가 아니면 항목 자리에 까닭 한 줄이다. */
export function SettingsMachineScene({ granted }: { granted: boolean }) {
  const scene = useMemo(
    () => ({
      ...sceneHub(granted),
      machines: fakeMachines({ machines: MACHINES }).source,
    }),
    [granted],
  );
  const here = scene.hub.get(null);
  return (
    <MachinesProvider source={scene.machines}>
      <MachineHubProvider hub={scene.hub}>
        <MachineScope machine={null}>
          <GalleryConnectHost
            providers={here.settingsPanels.providers}
            agents={here.settingsPanels.agents}
          >
            <AppViewsProvider value={scene.mock.appViews}>
              <Driven steps={PICK_HOME_SERVER}>
                <SettingsSpace
                  source={scene.mock.catalog}
                  settingsPane="providers"
                  onHome={noop}
                  onBack={noop}
                  backTo={null}
                  onApp={noop}
                  settings={here.settings}
                  settingsPanels={here.settingsPanels}
                  onProject={noop}
                  onOpenSession={noop}
                />
              </Driven>
            </AppViewsProvider>
          </GalleryConnectHost>
        </MachineScope>
      </MachineHubProvider>
    </MachinesProvider>
  );
}
