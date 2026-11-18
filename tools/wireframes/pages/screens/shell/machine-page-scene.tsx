// 다른 기계(Home server)의 browser page를 이 컴퓨터의 창의 탭으로 보는 화면. 탭 줄에 Pages(목록) 탭과 page마다 탭이 서고 본문은
// renderer의 page-view 탭 kind가 탭 범위(TabScope) 안에서 그린다. 그 기계의 core는 fake Gateway로, page 그림은 고정 그림
// (`mock/agent-page.ts`)으로 답한다. `PagesMenuScene`은 새 탭 menu가 연결된 기계마다 "Pages on <기계>"를 두는 것이다.
import { useMemo, useState } from "react";

import {
  pageViewControl,
  pageViewInput,
  pageViewList,
  pageViewSnapshot,
  pageViewWatch,
} from "../../../../../packages/protocol/lophn-agent/page-view.ts";
import type {
  PageRow,
  PageSnapshot,
} from "../../../../../packages/shell/renderer/browser/page-view/source.ts";
import { createEventClient } from "../../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import {
  createFakeSource,
  fakeAnswer,
} from "../../../../../packages/shell/renderer/desktop/connection/events/fake-source.ts";
import { createEventStores } from "../../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
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
import { Icon } from "@lophn/ui/primitives";
import { browserIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";
import { ContentCard } from "../../../../../packages/shell/renderer/shell/content-card.tsx";
import { ShellFrame } from "../../../../../packages/shell/renderer/shell/shell-frame.tsx";
import { TabStrip } from "../../../../../packages/shell/renderer/shell/tab-strip.tsx";
import type { TabHost } from "../../../../../packages/shell/renderer/workspace/kinds/host.ts";
import { pageViewKind } from "../../../../../packages/shell/renderer/workspace/kinds/page-view.tsx";
import type { TabItem } from "../../../../../packages/shell/renderer/workspace/model.ts";
import { NewTabMenu } from "../../../../../packages/shell/renderer/workspace/add-tab-menu.tsx";
import { AGENT_PAGE_FRAME } from "../../../mock/agent-page.ts";
import { press, useDrive } from "../../../mock/drive.ts";

const noop = () => {};
const HOME_SERVER = "mch_homeserver";
const WORK_LAPTOP = "mch_laptop";

const PAGES: readonly PageRow[] = [
  {
    tab: "tab_signin",
    url: "https://cloud.example.com/login",
    title: "Sign in to Example Cloud",
    loading: false,
    by: "lophn",
    held_by: null,
  },
  {
    tab: "tab_docs",
    url: "https://docs.example.com/deploy",
    title: "Deploy guide · Example Cloud",
    loading: false,
    by: "Deployer",
    held_by: "phone",
  },
  {
    tab: "tab_github",
    url: "https://github.com/login/device",
    title: "Device activation · GitHub",
    loading: false,
    by: null,
    held_by: null,
  },
];

export type MachinePageState =
  | "list"
  | "page"
  | "held"
  | "not-painting"
  | "view-only"
  | "offline";

function snapshotOf(page: PageRow, state: MachinePageState): PageSnapshot {
  const { held_by: _heldBy, ...fields } = page;
  return {
    ...fields,
    seq: 3,
    frame: AGENT_PAGE_FRAME,
    painting: state !== "not-painting",
    agent: true,
    held: state === "held",
    control: state !== "view-only",
  };
}

// 이 컴퓨터의 hub. 다른 기계의 묶음은 그 기계의 core(fake Gateway)와 허락 묻기만 다르다.
function sceneHub(mock: DevMock, state: MachinePageState): MachineHub {
  const source = createFakeSource({
    snapshots: [],
    consents: [],
    answers: [
      fakeAnswer(pageViewList, { pages: [...PAGES], control: true }),
      fakeAnswer(pageViewSnapshot, (input) =>
        snapshotOf(PAGES.find((page) => page.tab === input.tab)!, state),
      ),
      fakeAnswer(pageViewWatch, {}),
      fakeAnswer(pageViewInput, {}),
      fakeAnswer(pageViewControl, {}),
    ],
  });
  const stores = createEventStores(createEventClient(source));
  const data = new Map<string | null, MachineData>();
  return {
    get(machine) {
      let found = data.get(machine);
      if (found === undefined) {
        found = {
          machine,
          here: machine === null,
          core: source,
          stores,
          appViews: mock.appViews,
          projectIcons: mock.projectIcons,
          folders: null,
          grant: () => Promise.resolve(state !== "view-only"),
        } as unknown as MachineData;
        data.set(machine, found);
      }
      return found;
    },
    stop: noop,
  };
}

export function MachinePageScene({ state }: { state: MachinePageState }) {
  const scene = useMemo(() => {
    const mock = devMock("?mock") as DevMock;
    return {
      hub: sceneHub(mock, state),
      machines: fakeMachines({ machines: sampleMachines() }).source,
    };
  }, [state]);
  const machine = state === "offline" ? WORK_LAPTOP : HOME_SERVER;
  const [tabs, setTabs] = useState<readonly TabItem[]>(() => {
    const list: TabItem = {
      key: `pages-${machine}`,
      kind: "page-view",
      title: "Pages",
      machine,
    };
    const first = PAGES[0]!;
    return state === "list" || state === "offline"
      ? [list]
      : [
          list,
          {
            key: `page-view-${machine}-${first.tab}`,
            kind: "page-view",
            title: first.title,
            machine,
            fields: { page: first.tab },
          },
        ];
  });
  const [selected, setSelected] = useState(
    state === "list" || state === "offline" ? tabs[0]!.key : tabs[1]!.key,
  );
  const host = {
    machine: null,
    openTab(tab: TabItem) {
      setTabs((now) =>
        now.some((one) => one.key === tab.key) ? now : [...now, tab],
      );
      setSelected(tab.key);
    },
    patchTab(key: string, patch: Partial<TabItem>) {
      setTabs((now) =>
        now.map((one) => (one.key === key ? { ...one, ...patch } : one)),
      );
    },
  } as unknown as TabHost;
  const current = tabs.find((tab) => tab.key === selected)!;
  const icon = <Icon icon={browserIcons.globe} pixels={14} />;
  return (
    <MachinesProvider source={scene.machines}>
      <MachineHubProvider hub={scene.hub}>
        <ShellFrame
          left={false}
          onToggleLeft={noop}
          right={false}
          tabs={
            <TabStrip
              entries={tabs.map((tab) => ({
                key: tab.key,
                tabs: [{ key: tab.key, title: tab.title, icon }],
              }))}
              selected={selected}
              minimized={[]}
              floating={[]}
              onSelect={setSelected}
              onClose={noop}
              onToggleFloat={noop}
            />
          }
          leftSidebar={null}
        >
          <ContentCard
            panes={[
              {
                key: selected,
                crumbs: [current.title],
                body: (
                  <TabScope
                    key={selected}
                    tab={current}
                    workspaceMachine={null}
                  >
                    {pageViewKind.render?.(current, true, host)}
                  </TabScope>
                ),
              },
            ]}
            focus={selected}
            deskLabel="Main"
            onFocus={noop}
            onAction={noop}
            onEmptyAction={noop}
          />
        </ShellFrame>
      </MachineHubProvider>
    </MachinesProvider>
  );
}

/** 새 탭 menu: 연결된 다른 기계마다 한 줄. 꺼진 기계(Work laptop)와 명단에서 빠진 기계는 없다. */
export function PagesMenuScene() {
  const [machines] = useState(
    () => fakeMachines({ machines: sampleMachines() }).source,
  );
  useDrive(() => press("[data-new-tab]"));
  return (
    <MachinesProvider source={machines}>
      <ShellFrame
        left={false}
        onToggleLeft={noop}
        right={false}
        tabs={
          <TabStrip
            entries={[
              {
                key: "doc",
                tabs: [
                  {
                    key: "doc",
                    title: "notes.md",
                    icon: <Icon icon={browserIcons.globe} pixels={14} />,
                  },
                ],
              },
            ]}
            selected="doc"
            minimized={[]}
            floating={[]}
            onSelect={noop}
            onClose={noop}
            onToggleFloat={noop}
            newTab={
              <NewTabMenu
                onDocument={noop}
                onTerminal={noop}
                onBrowser={noop}
                onPages={noop}
              />
            }
          />
        }
        leftSidebar={null}
      >
        <div />
      </ShellFrame>
    </MachinesProvider>
  );
}
