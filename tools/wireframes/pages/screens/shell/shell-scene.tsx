// shell 틀을 fake desk 상태로 그린다. 진짜 연결은 project 화면 task가 하고, 여기는 틀이 callback에 맞게 움직이는지 보이려고
// 선택·닫기·float·group만 가볍게 받는다. desk는 실제 desk model이고 동작은 그 순수 함수를 부른다.
import { useState } from "react";
import { shellIcons } from "../../../../../packages/shell/renderer/icons/mod.ts";
import {
  ContentCard,
  type TabAction,
} from "../../../../../packages/shell/renderer/shell/content-card.tsx";
import { DeskSwitcher } from "../../../../../packages/shell/renderer/shell/desk-switcher.tsx";
import { FloatLayer } from "../../../../../packages/shell/renderer/shell/float-layer.tsx";
import {
  TabContextMenu,
  type TabMenuState,
} from "../../../../../packages/shell/renderer/shell/tab-menu.tsx";
import { PanelTabs } from "../../../../../packages/shell/renderer/shell/panel-tabs.tsx";
import { ShellFrame } from "../../../../../packages/shell/renderer/shell/shell-frame.tsx";
import { TabDragProvider } from "../../../../../packages/shell/renderer/shell/tab-drag.tsx";
import { TabStrip } from "../../../../../packages/shell/renderer/shell/tab-strip.tsx";
import {
  applyTabDrop,
  closeFloat,
  closeTab,
  type Desk,
  deskEntries,
  dirsOf,
  dockFloat,
  floatTab,
  groupOf,
  leavesOf,
  minimizeFloat,
  openTab,
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
  mockOf,
  stripTab,
  tabIcon,
  type Variant,
} from "../../../mock/shell-data.tsx";
import { MockRightSidebar } from "../../../mock/shell-sidebars.tsx";
import { PageLeftSidebar } from "../project-window.tsx";
import {
  contextMenu,
  dragPointer,
  press,
  type Spot,
  useDrive,
} from "../../../mock/drive.ts";

const PANELS = [
  { key: "files", label: "Files", icon: shellIcons.folder },
  { key: "domain", label: "Domain", icon: shellIcons.domain },
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
  recentOpen = false,
}: {
  variant: Variant;
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
}) {
  const [desks, setDesks] = useState(() => mockDesks(variant));
  const [deskKey, setDeskKey] = useState("_default");
  const [leftOpen, setLeft] = useState(left);
  const [rightOpen, setRight] = useState(right);
  const [panel, setPanel] = useState("files");
  const [menu, setMenu] = useState<{
    key: string;
    x: number;
    y: number;
  } | null>(null);
  useDrive(async () => {
    if (open !== undefined) await press(open);
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
    if (what === "split-remove") patch((d) => ungroupTab(d, key));
    if (what === "unsplit") patch((d) => ungroup(d, key));
  };

  const toggleFloat = (key: string) =>
    patch((d) =>
      d.floats.some((f) => f.tab.key === key && !f.minimized)
        ? minimizeFloat(d, key)
        : restoreFloat(d, key),
    );

  const menuState = (tab: TabItem): TabMenuState => {
    const own = groupOf(desk, tab.key);
    const span = own === null ? [tab.key] : leavesOf(own.layout);
    const at = Math.max(
      ...span.map((key) => desk.tabs.findIndex((item) => item.key === key)),
    );
    return {
      renamable: mockOf(tab).kind !== "file",
      preview: mockOf(tab).preview === true,
      file: mockOf(tab).kind === "file",
      canDetach: mockOf(tab).kind !== "terminal",
      group: own === null ? 0 : span.length,
      canSplit: splitPartner(desk, tab.key) !== null,
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
            onDelete={(key) => {
              const gone = desks.find((d) => d.key === key);
              if (gone === undefined) return;
              setDesks((all) =>
                all
                  .filter((d) => d.key !== key)
                  .map((d) =>
                    d.key === "_default"
                      ? {
                          ...d,
                          model: gone.model.tabs.reduce(
                            (now, tab) => openTab(now, tab, { select: false }),
                            d.model,
                          ),
                        }
                      : d,
                  ),
              );
              if (deskKey === key) setDeskKey("_default");
            }}
          />
        }
        tabs={
          <TabStrip
            entries={deskEntries(desk).map((entry) => ({
              key: entry.key,
              tabs: entry.tabs.map((tab) => stripTab(mockOf(tab))),
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
            minimized={desk.floats.map((f) => stripTab(mockOf(f.tab)))}
            floating={desk.floats
              .filter((f) => !f.minimized)
              .map((f) => f.tab.key)}
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
          />
        }
        rightSidebar={<MockRightSidebar title={chosen.label} />}
        floats={
          <FloatLayer
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
                  body: floatBody(tab),
                },
              ];
            })}
            onRaise={(key) => patch((d) => restoreFloat(d, key))}
            onRect={(key, rect) => patch((d) => setFloatRect(d, key, rect))}
            onMinimize={toggleFloat}
            onDock={(key) => patch((d) => dockFloat(d, key))}
            onClose={close}
          />
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
          canBack
          canForward={false}
          onBack={() => {}}
          onForward={() => {}}
          onFocus={(key) => patch((d) => selectTab(d, key))}
          onAction={action}
          onEmptyAction={() => {}}
        />
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
