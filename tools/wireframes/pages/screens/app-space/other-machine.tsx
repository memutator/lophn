// 다른 기계(Home server)의 앱 화면 탭. 이 컴퓨터의 창이 그 기계의 Grocery budget 앱 화면을 그린다. 탭 본문은 renderer의
// 탭 범위(TabScope)와 앱 화면 탭(AppScreenTab)이 dev mock 통로로 그리고, 머리 줄에 그 기계의 꼬리표가 선다. 기계가 꺼져
// 있으면 탭 범위가 본문 대신 그 기계의 상태 한 줄을 그린다. 앱 화면(<webview>)은 gallery에 없어 고정 그림을 넣는다.
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { AppTabIcon } from "../../../../../packages/shell/renderer/app-frame/app-icon.tsx";
import {
  createWebviewHost,
  WebviewHostProvider,
  WebviewLayer,
} from "../../../../../packages/shell/renderer/app-frame/webview-host.tsx";
import { createEventClient } from "../../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import {
  createEventStores,
  EventsProvider,
} from "../../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import { APP_BUDGET } from "../../../../../packages/shell/renderer/desktop/dev-mock/ids.ts";
import {
  type DevMock,
  devMock,
} from "../../../../../packages/shell/renderer/desktop/dev-mock/mod.ts";
import { MachinesProvider } from "../../../../../packages/shell/renderer/desktop/machines/context.tsx";
import type {
  MachineData,
  MachineHub,
} from "../../../../../packages/shell/renderer/desktop/machines/data.ts";
import { MachineHubProvider } from "../../../../../packages/shell/renderer/desktop/machines/scope.tsx";
import { TabScope } from "../../../../../packages/shell/renderer/desktop/machines/tab-scope.tsx";
import {
  fakeMachines,
  sampleMachines,
} from "../../../../../packages/shell/renderer/desktop/machines/testdata/fake-source.ts";
import { ContentCard } from "../../../../../packages/shell/renderer/shell/content-card.tsx";
import { ShellFrame } from "../../../../../packages/shell/renderer/shell/shell-frame.tsx";
import { TabStrip } from "../../../../../packages/shell/renderer/shell/tab-strip.tsx";
import { AppScreenTab } from "../../../../../packages/shell/renderer/workspace/app-screen-tab.tsx";
import { appScreenTab } from "../../../../../packages/shell/renderer/workspace/kinds/app-screen.tsx";
import { OrdersView } from "../../../mock/app-space/orders-view.tsx";

const noop = () => {};
const TITLE = "Grocery budget";

// 기계마다 같은 dev mock 통로를 쓰는 hub. 다른 기계의 묶음은 이 컴퓨터만의 칸(here, App details, 앱 켜기)이 없다. 이 컴퓨터에는
// 이 앱이 없다(있으면 탭이 이 컴퓨터의 것을 연다).
function sceneHub(mock: DevMock): MachineHub {
  const events = createEventClient(mock.events);
  const stores = createEventStores(events);
  const data = new Map<string | null, MachineData>();
  return {
    get(machine) {
      let found = data.get(machine);
      if (found === undefined) {
        const { enableRun: _here, ...appViews } = mock.appViews;
        found = {
          machine,
          here: machine === null,
          core: mock.core,
          events,
          stores,
          apps:
            machine === null
              ? {
                  ...mock.apps,
                  get: (app: string) =>
                    app === APP_BUDGET
                      ? Promise.resolve({ ok: true as const, value: null })
                      : mock.apps.get(app),
                }
              : mock.apps,
          appViews: machine === null ? mock.appViews : appViews,
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

// <webview>가 없는 gallery에서 webview 그릇은 앱 화면을 빈 div로 그린다. 그 div를 찾는다.
function useScreenRegion(): HTMLElement | null {
  const [region, setRegion] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const look = () =>
      setRegion(
        document.querySelector<HTMLElement>('[data-webview-kind="app"]'),
      );
    look();
    const watch = new MutationObserver(look);
    watch.observe(document.body, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, []);
  return region;
}

/** `machine`은 탭의 기계다: 붙은 Home server 또는 꺼진 Work laptop. */
export function OtherMachineAppScene({ offline }: { offline: boolean }) {
  const scene = useMemo(() => {
    const mock = devMock("?mock") as DevMock;
    return {
      mock,
      hub: sceneHub(mock),
      machines: fakeMachines({ machines: sampleMachines() }).source,
      webviews: createWebviewHost(),
      events: createEventClient(mock.events),
    };
  }, []);
  const machine = offline ? "mch_laptop" : "mch_homeserver";
  const tab = { ...appScreenTab(APP_BUDGET, TITLE), machine };
  const region = useScreenRegion();
  const icon = <AppTabIcon app={APP_BUDGET} />;
  return (
    <MachinesProvider source={scene.machines}>
      <MachineHubProvider hub={scene.hub}>
        <EventsProvider client={scene.events}>
          <WebviewHostProvider value={scene.webviews}>
            <ShellFrame
              left={false}
              onToggleLeft={noop}
              right={false}
              tabs={
                <TabStrip
                  entries={[
                    {
                      key: tab.key,
                      tabs: [{ key: tab.key, title: TITLE, icon }],
                    },
                  ]}
                  selected={tab.key}
                  minimized={[]}
                  floating={[]}
                  onSelect={noop}
                  onClose={noop}
                  onToggleFloat={noop}
                />
              }
              leftSidebar={null}
            >
              <ContentCard
                panes={[
                  {
                    key: tab.key,
                    crumbs: [TITLE],
                    body: (
                      <TabScope tab={tab} workspaceMachine={null}>
                        <AppScreenTab
                          app={APP_BUDGET}
                          source={scene.mock.apps}
                          shown
                          keepKey={tab.key}
                          agentView={null}
                          onOpenPreview={noop}
                        />
                      </TabScope>
                    ),
                  },
                ]}
                focus={tab.key}
                deskLabel="Main"
                onFocus={noop}
                onAction={noop}
                onEmptyAction={noop}
              />
            </ShellFrame>
            <WebviewLayer host={scene.webviews} />
          </WebviewHostProvider>
        </EventsProvider>
      </MachineHubProvider>
      {region === null || offline
        ? null
        : createPortal(<OrdersView marks={{}} />, region)}
    </MachinesProvider>
  );
}
