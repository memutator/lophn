// 다른 기계(Home server)의 창에서 그 기계의 browser page를 보는 탭. 탭 줄에 Pages(목록) 탭과 page마다 탭이 있고, card에는
// renderer의 PageList·PageView가 fake source(`browser/page-view/fake-source.ts`)와 고정 그림(`mock/agent-page.ts`)으로 선다.
import { useState } from "react";

import { PageList } from "../../../../../packages/shell/renderer/browser/page-view/page-list.tsx";
import { PageView } from "../../../../../packages/shell/renderer/browser/page-view/page-view.tsx";
import { fakePageViewSource } from "../../../../../packages/shell/renderer/browser/page-view/fake-source.ts";
import type {
  PageRow,
  PageSnapshot,
} from "../../../../../packages/shell/renderer/browser/page-view/source.ts";
import { createEventClient } from "../../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { createFakeSource } from "../../../../../packages/shell/renderer/desktop/connection/events/fake-source.ts";
import { EventsProvider } from "../../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import {
  MachineGrantProvider,
  MachinesProvider,
} from "../../../../../packages/shell/renderer/desktop/machines/context.tsx";
import { MachineSwitcher } from "../../../../../packages/shell/renderer/desktop/machines/machine-switcher.tsx";
import {
  fakeMachines,
  sampleMachines,
} from "../../../../../packages/shell/renderer/desktop/machines/testdata/fake-source.ts";
import { Icon } from "@lophn/ui/primitives";
import { browserIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";
import { ContentCard } from "../../../../../packages/shell/renderer/shell/content-card.tsx";
import { ShellFrame } from "../../../../../packages/shell/renderer/shell/shell-frame.tsx";
import { TabStrip } from "../../../../../packages/shell/renderer/shell/tab-strip.tsx";
import { PaddedTab } from "../../../../../packages/shell/renderer/workspace/padded-tab.tsx";
import { AGENT_PAGE_FRAME } from "../../../mock/agent-page.ts";

const noop = () => {};
const MACHINE = "Home server";

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
    held_by: null,
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
  | "view-only";

function snapshotOf(state: MachinePageState): PageSnapshot {
  const page = PAGES[0]!;
  return {
    ...page,
    seq: 3,
    frame: AGENT_PAGE_FRAME,
    painting: state !== "not-painting",
    agent: true,
    held: state === "held",
    control: state !== "view-only",
  };
}

export function MachinePageScene({ state }: { state: MachinePageState }) {
  const [machines] = useState(
    () =>
      fakeMachines({
        machines: sampleMachines(),
        window: { id: "mch_homeserver", name: MACHINE },
      }).source,
  );
  const [client] = useState(() => createEventClient(createFakeSource()));
  const [source] = useState(() =>
    fakePageViewSource({
      pages: PAGES,
      snapshots: { tab_signin: snapshotOf(state) },
    }),
  );
  const [open, setOpen] = useState<readonly PageRow[]>(
    state === "list" ? [] : [PAGES[0]!],
  );
  const [selected, setSelected] = useState(
    state === "list" ? "pages" : "tab_signin",
  );
  const icon = <Icon icon={browserIcons.globe} pixels={14} />;
  const tabs = [
    { key: "pages", title: "Pages", icon },
    ...open.map((page) => ({ key: page.tab, title: page.title, icon })),
  ];
  const body =
    selected === "pages" ? (
      <PageList
        source={source}
        machineName={MACHINE}
        onOpen={(tab) => {
          const page = PAGES.find((one) => one.tab === tab);
          if (page !== undefined && !open.includes(page)) {
            setOpen([...open, page]);
          }
          setSelected(tab);
        }}
      />
    ) : (
      <PageView source={source} tab={selected} machineName={MACHINE} />
    );
  const frame = (
    <MachinesProvider source={machines}>
      <EventsProvider client={client}>
        <ShellFrame
          left={false}
          onToggleLeft={noop}
          right={false}
          machineSwitcher={<MachineSwitcher onPairAnother={noop} />}
          tabs={
            <TabStrip
              entries={tabs.map((tab) => ({ key: tab.key, tabs: [tab] }))}
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
                crumbs: [
                  MACHINE,
                  tabs.find((tab) => tab.key === selected)?.title ?? "",
                ],
                body: (
                  <PaddedTab bare key={selected}>
                    {body}
                  </PaddedTab>
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
      </EventsProvider>
    </MachinesProvider>
  );
  return state === "view-only" ? (
    <MachineGrantProvider check={() => Promise.resolve(false)}>
      {frame}
    </MachineGrantProvider>
  ) : (
    frame
  );
}
