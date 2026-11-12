// shell 틀을 fake desk 상태로 그린다. 진짜 연결은 project 화면 task가 하고, 여기는 틀이 callback에 맞게 움직이는지 보이려고
// 선택·닫기·float·group만 가볍게 받는다. desk는 실제 desk model이고 동작은 그 순수 함수를 부른다.
import { useEffect, useRef, useState } from "react";
import { useObservedSize } from "@lophn/ui/shared";
import { matchKey } from "../../../../../packages/protocol/shell/keybindings.ts";
import { shellIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";
import {
  ContentCard,
  type TabAction,
} from "../../../../../packages/shell/renderer/shell/content-card.tsx";
import {
  DeskCloseDialog,
  type DeskCloseSummary,
} from "../../../../../packages/shell/renderer/shell/desk-close-dialog.tsx";
import { DeskSwitcher } from "../../../../../packages/shell/renderer/shell/desk-switcher.tsx";
import { FloatLayer } from "../../../../../packages/shell/renderer/shell/float-layer.tsx";
import {
  TabContextMenu,
  type TabMenuState,
} from "../../../../../packages/shell/renderer/shell/tab-menu.tsx";
import { neighborLeaf } from "../../../../../packages/shell/renderer/shell/group-geometry.ts";
import { PanelTabs } from "../../../../../packages/shell/renderer/shell/panel-tabs.tsx";
import { ShellFrame } from "../../../../../packages/shell/renderer/shell/shell-frame.tsx";
import { QuickLaunchRow } from "../../../../../packages/shell/renderer/shell/quick-launch.tsx";
import { Taskbar } from "../../../../../packages/shell/renderer/shell/taskbar/taskbar.tsx";
import { TabDragProvider } from "../../../../../packages/shell/renderer/shell/tab-drag.tsx";
import { TabStrip } from "../../../../../packages/shell/renderer/shell/tab-strip.tsx";
import {
  TabsCloseDialog,
  type TabsCloseRow,
} from "../../../../../packages/shell/renderer/shell/tabs-close-dialog.tsx";
import {
  applyTabDrop,
  closeFloat,
  closeTab,
  closeTargets,
  cyclePane,
  type Desk,
  deskEntries,
  deskTabs,
  dirsOf,
  emptyDesk,
  dockFloat,
  floatTab,
  groupOf,
  leavesOf,
  membersOf,
  minimizeFloat,
  minimizeLooseFloats,
  openFloatTab,
  openTab,
  paneStackOf,
  pinFloat,
  restoreFloat,
  selectTab,
  setFloatRect,
  setRatio,
  splitPartner,
  splitTab,
  tabDropState,
  type TabItem,
  ungroup,
  ungroupTab,
} from "../../../../../packages/shell/renderer/shell/desk-model.ts";
import {
  cardPane,
  FLOAT_RECTS,
  floatBody,
  type MockDesk,
  type MockTab,
  mockDesks,
  mockGlobalFloats,
  mockOf,
  stripTab,
  tabIcon,
  type Variant,
} from "../../../mock/shell-data.tsx";
import { MockRightSidebar } from "../../../mock/shell-sidebars.tsx";
import { PageLeftSidebar, pageQuick } from "../project-window.tsx";
import {
  click,
  contextMenu,
  dragPointer,
  press,
  type Spot,
  useDrive,
  wait,
} from "../../../mock/drive.ts";

const PANELS = [
  { key: "files", label: "Files", icon: shellIcons.folder },
  { key: "artifact", label: "Artifacts", icon: shellIcons.artifact },
  { key: "workflow", label: "Workflows", icon: shellIcons.workflow },
  { key: "jobs", label: "Jobs", icon: shellIcons.jobs },
];

export function ShellScene({
  variant,
  left = true,
  right = true,
  open,
  context,
  drag,
  closeDesk,
  closeTabs,
  keys,
  recentOpen = false,
  globalFloats = false,
  taskbar = true,
}: {
  variant: Variant;
  /** 모든 workspace에 사는 전역 float을 desk float 위에 띄운다. float chip 묶음에는 전역 표시가 붙은 chip이 먼저 놓인다. "chip"이면 접힌 것 하나만 둔다. */
  globalFloats?: boolean | "chip";
  /** 설정 `shell.taskbar`. 켜면 float chip이 맨 아래 작업 표시줄에 있고, 끄면 tab 줄 끝에 있다. 기본은 켬이다. */
  taskbar?: boolean;
  /** 왼쪽 sidebar에서 project의 Recent를 펼친 채 시작한다. */
  recentOpen?: boolean;
  left?: boolean;
  right?: boolean;
  /** mount 뒤 눌러서 열어 둘 요소의 selector. */
  open?: string;
  /** mount 뒤 오른쪽 클릭할 tab의 이름 조각. 그 tab의 menu가 열린다. */
  context?: string;
  /** mount 뒤 pointer로 끌 것. release가 false면 끄는 도중에 멈춘다. */
  drag?: { from: Spot; to: Spot; release?: boolean };
  /** mount 뒤 desk 단추를 열고 이 이름의 desk를 지우는 x를 누른다. */
  closeDesk?: string;
  /** 이 tab key의 group을 Close group으로 닫을 때 뜨는 dialog를 연 채 시작한다. */
  closeTabs?: string;
  /** mount 뒤 차례로 누를 단축키(예: "Ctrl+Alt+ArrowRight"). */
  keys?: readonly string[];
}) {
  const [desks, setDesks] = useState(() => mockDesks(variant));
  const floatRef = useRef<HTMLDivElement>(null);
  const floatArea = useObservedSize(floatRef);
  // 전역 float도 desk model의 floats 규칙을 그대로 쓴다(앱의 shell/global-floats/store.ts와 같다).
  const [globals, setGlobals] = useState<Desk>(() =>
    globalFloats
      ? mockGlobalFloats(globalFloats === "chip")
      : emptyDesk("global", "Global"),
  );
  const globalRef = useRef<HTMLDivElement>(null);
  const globalArea = useObservedSize(globalRef);
  const [deskKey, setDeskKey] = useState("_default");
  const [leftOpen, setLeft] = useState(left);
  const [rightOpen, setRight] = useState(right);
  const [panel, setPanel] = useState("files");
  const [closing, setClosing] = useState<string | null>(null);
  const [closingTabs, setClosingTabs] = useState(closeTabs ?? null);
  const [menu, setMenu] = useState<{
    key: string;
    x: number;
    y: number;
  } | null>(null);
  useDrive(async () => {
    if (open !== undefined) await press(open);
    if (closeDesk !== undefined) {
      await press("[data-desk-button]");
      await click(`[aria-label="Delete desk ${closeDesk}"]`);
    }
    // 단축키 listener가 effect로 서 있어야 한다.
    if (keys !== undefined) await wait(100);
    for (const chord of keys ?? []) {
      const parts = chord.split("+");
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          code: parts.at(-1),
          ctrlKey: parts.includes("Ctrl"),
          altKey: parts.includes("Alt"),
          bubbles: true,
        }),
      );
      await wait(60);
    }
    if (context !== undefined) await contextMenu('[role="tab"]', context);
    if (drag !== undefined) {
      await dragPointer(drag.from, drag.to, drag.release ?? true);
    }
  });

  const mock = desks.find((d) => d.key === deskKey) ?? desks[0]!;
  const desk = mock.model;
  const patch = (change: (d: Desk) => Desk) =>
    setDesks((all) =>
      all.map((d) =>
        d.key === mock.key ? { ...d, model: change(d.model) } : d,
      ),
    );

  // 실제 앱의 pane.focus-* command와 같은 표(protocol의 shell/keybindings.ts)와 같은 함수(neighborLeaf)를 쓴다.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const hit = matchKey(
        {
          key: event.key,
          code: event.code,
          ctrl: event.ctrlKey,
          meta: event.metaKey,
          alt: event.altKey,
          shift: event.shiftKey,
        },
        "other",
      );
      if (!hit?.command.startsWith("pane.focus-")) return;
      const own = groupOf(desk, desk.selected);
      if (own === null || desk.selected === null) return;
      const to = neighborLeaf(
        own.layout,
        desk.selected,
        hit.command.slice("pane.focus-".length) as "left",
      );
      if (to !== null) patch((d) => selectTab(d, to));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const closeSummary = (target: Desk): DeskCloseSummary => {
    const tabs = deskTabs(target);
    return {
      tabs: tabs.length,
      terminals: tabs.filter((tab) => mockOf(tab).kind === "terminal").length,
      floats: target.floats.length,
      detached: target.detached.length,
      unsaved: tabs
        .filter((tab) => mockOf(tab).unsaved)
        .map((tab) => ({
          title: mockOf(tab).title,
          path: `~/projects/${mockOf(tab).crumbs.join("/")}`,
        })),
    };
  };
  const closingDesk = desks.find((d) => d.key === closing);

  // 실제 앱의 closeMany처럼 group의 tab 중 멈출 터미널(coding agent 포함)과 저장하지 못한 파일을 줄로 보인다.
  const closingKeys =
    closingTabs === null
      ? []
      : closeTargets(desk, "group", closingTabs, (key) =>
          desk.tabs.some((tab) => tab.key === key && mockOf(tab).unsaved),
        );
  const closingRows = desk.tabs
    .filter((tab) => closingKeys.includes(tab.key))
    .map((tab) => ({ tab, mock: mockOf(tab) }));
  const rowOf = ({
    tab,
    mock,
  }: (typeof closingRows)[number]): TabsCloseRow => ({
    key: tab.key,
    title: mock.title,
    icon: tabIcon(mock),
    ...(mock.kind === "file"
      ? { path: `~/projects/${mock.crumbs.join("/")}` }
      : {}),
  });

  const close = (key: string) =>
    patch((d) => closeFloat(closeTab(d, key), key));

  const action = (what: TabAction, key: string) => {
    if (what === "close") close(key);
    if (what === "float") {
      const rect = FLOAT_RECTS[desk.floats.length % FLOAT_RECTS.length]!;
      patch((d) => floatTab(d, key, rect));
    }
    if (what === "split-right" || what === "split-down") {
      const partner = splitPartner(desk, key);
      if (partner === null) return;
      patch((d) =>
        splitTab(d, key, partner, what === "split-right" ? "right" : "bottom", {
          select: "target",
        }),
      );
    }
    if (what === "split-remove" || what === "unstack") {
      patch((d) => ungroupTab(d, key));
    }
    if (what === "unsplit") patch((d) => ungroup(d, key));
  };

  const toggleGlobal = (key: string) =>
    setGlobals((d) =>
      d.floats.some((f) => f.tab.key === key && !f.minimized)
        ? minimizeFloat(d, key)
        : restoreFloat(d, key),
    );
  // "이 desk로": 전역 float을 이 desk의 float으로 옮긴다.
  const globalToDesk = (key: string) => {
    const item = globals.floats.find((f) => f.tab.key === key);
    if (item === undefined) return;
    setGlobals((d) => closeFloat(d, key));
    patch((d) => openFloatTab(d, item.tab, item.rect));
  };

  const toggleFloat = (key: string) =>
    patch((d) =>
      d.floats.some((f) => f.tab.key === key && !f.minimized)
        ? minimizeFloat(d, key)
        : restoreFloat(d, key),
    );

  const menuState = (tab: TabItem): TabMenuState => {
    const own = groupOf(desk, tab.key);
    const span = own === null ? [tab.key] : membersOf(own.layout);
    const at = Math.max(
      ...span.map((key) => desk.tabs.findIndex((item) => item.key === key)),
    );
    return {
      renamable: mockOf(tab).kind !== "file",
      preview: mockOf(tab).preview === true,
      file: mockOf(tab).kind === "file",
      canDetach: mockOf(tab).kind !== "terminal",
      group: own === null ? 0 : leavesOf(own.layout).length,
      stacked: paneStackOf(desk, tab.key).length > 1,
      // 칸에 숨은 tab은 나눌 자리가 없다.
      canSplit:
        (own === null || leavesOf(own.layout).includes(tab.key)) &&
        splitPartner(desk, tab.key) !== null,
      hasOthers: desk.tabs.length > span.length,
      hasRight: at < desk.tabs.length - 1,
    };
  };
  const menuTab =
    menu === null ? undefined : desk.tabs.find((tab) => tab.key === menu.key);
  const group = groupOf(desk, desk.selected);
  const panes = desk.tabs
    .filter((tab) =>
      group === null
        ? tab.key === desk.selected
        : leavesOf(group.layout).includes(tab.key),
    )
    .map((tab) => cardPane(mockOf(tab), menuState(tab)));
  const chosen = PANELS.find((p) => p.key === panel) ?? PANELS[0]!;
  const deskChips = desk.floats.map((f) => stripTab(mockOf(f.tab)));
  const globalChips = globals.floats.map((f) => stripTab(mockOf(f.tab)));
  const pressedChips = [...globals.floats, ...desk.floats]
    .filter((f) => !f.minimized)
    .map((f) => f.tab.key);

  return (
    <TabDragProvider
      describe={(key) => {
        const found = desk.tabs.find((item) => item.key === key);
        return found === undefined
          ? undefined
          : { title: mockOf(found).title, icon: tabIcon(mockOf(found)) };
      }}
      state={(item, hit) => tabDropState(desk, item, hit)}
      onDrop={(item, hit) => patch((d) => applyTabDrop(d, item, hit))}
    >
      <ShellFrame
        left={leftOpen}
        onToggleLeft={() => setLeft(!leftOpen)}
        right={rightOpen}
        onToggleRight={() => setRight(!rightOpen)}
        deskSwitcher={
          <DeskSwitcher
            desks={desks.map((d) => ({
              key: d.key,
              label: d.label,
              workflow: d.workflow,
              status: d.status,
              manageable: d.key !== "_default" && !d.workflow,
            }))}
            current={mock.key}
            onSelect={setDeskKey}
            onNewDesk={() => {}}
            onRename={(key, label) =>
              setDesks((all) =>
                all.map((d) => (d.key === key ? { ...d, label } : d)),
              )
            }
            onDelete={setClosing}
          />
        }
        tabs={
          <TabStrip
            entries={deskEntries(desk).map((entry) => ({
              key: entry.key,
              tabs: entry.tabs.map((tab) => {
                const stack = paneStackOf(desk, tab.key);
                return stack.length < 2
                  ? stripTab(mockOf(tab))
                  : {
                      ...stripTab(mockOf(tab)),
                      stack: stack.map((key) =>
                        stripTab(
                          mockOf(desk.tabs.find((each) => each.key === key)!),
                        ),
                      ),
                    };
              }),
              ...(entry.group === null
                ? {}
                : {
                    dirs: dirsOf(entry.group.layout),
                    focus: entry.group.focus,
                  }),
            }))}
            selected={
              group === null ? desk.selected : leavesOf(group.layout)[0]!
            }
            minimized={taskbar ? [] : deskChips}
            globalFloats={taskbar ? [] : globalChips}
            floating={pressedChips}
            onToggleGlobalFloat={toggleGlobal}
            onSelect={(key) => patch((d) => selectTab(d, key))}
            onClose={close}
            onMenu={(key, at) => setMenu({ key, ...at })}
            onPin={(key) =>
              patch((d) => ({
                ...d,
                tabs: d.tabs.map((tab) =>
                  tab.key === key
                    ? {
                        ...tab,
                        fields: { mock: { ...mockOf(tab), preview: false } },
                      }
                    : tab,
                ),
              }))
            }
            onNewTab={() => {}}
            onToggleFloat={toggleFloat}
          />
        }
        panelTabs={
          <PanelTabs tabs={PANELS} selected={panel} onSelect={setPanel} />
        }
        leftSidebar={
          <PageLeftSidebar
            onOpenFile={() => {}}
            onAgent={() => {}}
            recentOpen={recentOpen}
            selected="session:weekly"
            taskbar={taskbar}
          />
        }
        rightSidebar={<MockRightSidebar title={chosen.label} />}
        taskbarStart={
          taskbar ? (
            <QuickLaunchRow quick={pageQuick("project", () => {})} />
          ) : undefined
        }
        taskbar={
          taskbar ? (
            <Taskbar
              globalFloats={globalChips}
              floats={deskChips}
              floating={pressedChips}
              onToggleGlobalFloat={toggleGlobal}
              onToggleFloat={toggleFloat}
              onSettings={() => {}}
            />
          ) : undefined
        }
        floats={
          <>
            <FloatLayer
              layerRef={floatRef}
              area={
                floatArea !== undefined &&
                floatArea.width > 0 &&
                floatArea.height > 0
                  ? floatArea
                  : undefined
              }
              floats={desk.floats.flatMap((item, order) => {
                if (item.minimized) return [];
                const tab = mockOf(item.tab);
                return [
                  {
                    key: tab.key,
                    title: tab.title,
                    icon: tabIcon(tab),
                    dot: tab.dot,
                    rect: item.rect,
                    pinned: item.pinned,
                    body: floatBody(tab),
                  },
                ];
              })}
              onRaise={(key) => patch((d) => restoreFloat(d, key))}
              onRect={(key, rect) => patch((d) => setFloatRect(d, key, rect))}
              onMinimize={toggleFloat}
              onDock={(key) => patch((d) => dockFloat(d, key))}
              onClose={close}
              onPin={(key, pinned) => patch((d) => pinFloat(d, key, pinned))}
              onOutside={(inside) =>
                patch((d) => minimizeLooseFloats(d, inside))
              }
            />
            {globals.floats.length === 0 ? null : (
              // 앱에서는 Desktop이 창 몸통 위에 한 번 놓는 층이다(shell/global-floats/global-float-layer.module.css).
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: "calc(var(--z-sticky) + 100)",
                  pointerEvents: "none",
                }}
              >
                <FloatLayer
                  layerRef={globalRef}
                  area={
                    globalArea !== undefined &&
                    globalArea.width > 0 &&
                    globalArea.height > 0
                      ? globalArea
                      : undefined
                  }
                  floats={globals.floats.flatMap((item) => {
                    if (item.minimized) return [];
                    const tab = mockOf(item.tab);
                    return [
                      {
                        key: tab.key,
                        title: tab.title,
                        icon: tabIcon(tab),
                        dot: tab.dot,
                        rect: item.rect,
                        pinned: item.pinned,
                        global: true,
                        body: floatBody(tab),
                      },
                    ];
                  })}
                  onRaise={(key) => setGlobals((d) => restoreFloat(d, key))}
                  onRect={(key, rect) =>
                    setGlobals((d) => setFloatRect(d, key, rect))
                  }
                  onMinimize={toggleGlobal}
                  onGlobal={globalToDesk}
                  onClose={(key) => setGlobals((d) => closeFloat(d, key))}
                  onPin={(key, pinned) =>
                    setGlobals((d) => pinFloat(d, key, pinned))
                  }
                  onOutside={(inside) =>
                    setGlobals((d) => minimizeLooseFloats(d, inside))
                  }
                />
              </div>
            )}
          </>
        }
      >
        <ContentCard
          panes={panes}
          {...(group === null ? {} : { layout: group.layout })}
          focus={desk.selected}
          onSplitRatio={(path, ratio) =>
            patch((d) => setRatio(d, d.selected!, path, ratio))
          }
          deskLabel={mock.label}
          onFocus={(key) => patch((d) => selectTab(d, key))}
          onCycle={(key, delta) => patch((d) => cyclePane(d, key, delta))}
          onAction={action}
          onEmptyAction={() => {}}
        />
        {closingDesk === undefined ? null : (
          <DeskCloseDialog
            label={closingDesk.label}
            summary={closeSummary(closingDesk.model)}
            onCancel={() => setClosing(null)}
            onConfirm={() => {
              setDesks((all) => all.filter((d) => d.key !== closingDesk.key));
              if (deskKey === closingDesk.key) setDeskKey("_default");
              setClosing(null);
            }}
          />
        )}
        {closingTabs === null ? null : (
          <TabsCloseDialog
            count={closingKeys.length}
            terminals={closingRows
              .filter(
                ({ mock }) =>
                  mock.kind === "terminal" || mock.agent?.kind === "coding",
              )
              .map(rowOf)}
            lost={closingRows.filter(({ mock }) => mock.unsaved).map(rowOf)}
            onCancel={() => setClosingTabs(null)}
            onConfirm={() => {
              patch((d) => closingKeys.reduce(closeTab, d));
              setClosingTabs(null);
            }}
          />
        )}
        {menu === null || menuTab === undefined ? null : (
          <TabContextMenu
            at={menu}
            state={menuState(menuTab)}
            onSelect={(what) => action(what, menuTab.key)}
            onClose={() => setMenu(null)}
          />
        )}
      </ShellFrame>
    </TabDragProvider>
  );
}
