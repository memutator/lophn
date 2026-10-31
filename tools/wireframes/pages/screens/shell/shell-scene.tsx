// shell 틀을 fake desk 상태로 그린다. 진짜 연결은 project 화면 task가 하고, 여기는 틀이 callback에 맞게 움직이는지 보이려고
// 선택·닫기·float·split만 가볍게 받는다.
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
import {
  type Side,
  TabStrip,
} from "../../../../../packages/shell/renderer/shell/tab-strip.tsx";
import type { FloatRect } from "../../../../../packages/shell/renderer/workspace/model.ts";
import {
  cardPane,
  floatBody,
  type MockDesk,
  type MockEntry,
  type MockTab,
  mockDesks,
  stripTab,
  tabIcon,
  type Variant,
} from "../../../mock/shell-data.tsx";
import { MockRightSidebar } from "../../../mock/shell-sidebars.tsx";
import { PageLeftSidebar } from "../project-window.tsx";
import { contextMenu, press, useDrive } from "../../../mock/drive.ts";

const PANELS = [
  { key: "files", label: "Files", icon: shellIcons.folder },
  { key: "domain", label: "Domain", icon: shellIcons.domain },
  { key: "artifact", label: "Artifacts", icon: shellIcons.artifact },
  { key: "workflow", label: "Workflows", icon: shellIcons.workflow },
  { key: "jobs", label: "Jobs", icon: shellIcons.jobs },
];

// gallery 창 크기(1280x800)에 맞춘 자리. 편 순서대로 쓴다.
const FLOAT_RECTS: readonly FloatRect[] = [
  { x: 300, y: 56, width: 396, height: 300 },
  { x: 32, y: 420, width: 440, height: 220 },
  { x: 180, y: 240, width: 400, height: 260 },
];

const tabsOf = (entry: MockEntry) => (entry.b ? [entry.a, entry.b] : [entry.a]);

export function ShellScene({
  variant,
  left = true,
  right = true,
  open,
  context,
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
}) {
  const [desks, setDesks] = useState(() => mockDesks(variant));
  const [deskKey, setDeskKey] = useState("_default");
  const [leftOpen, setLeft] = useState(left);
  const [rightOpen, setRight] = useState(right);
  const [panel, setPanel] = useState("files");
  const [rects, setRects] = useState<Readonly<Record<string, FloatRect>>>({});
  const [menu, setMenu] = useState<{
    key: string;
    x: number;
    y: number;
  } | null>(null);
  useDrive(async () => {
    if (open !== undefined) await press(open);
    if (context !== undefined) await contextMenu('[role="tab"]', context);
  });

  const desk = desks.find((d) => d.key === deskKey) ?? desks[0]!;
  const patch = (change: (d: MockDesk) => Partial<MockDesk>) =>
    setDesks((all) =>
      all.map((d) => (d.key === desk.key ? { ...d, ...change(d) } : d)),
    );

  const entry = desk.entries.find((e) => e.key === desk.selected);
  const index = entry === undefined ? -1 : desk.entries.indexOf(entry);
  const next = desk.entries[index + 1] ?? desk.entries[index - 1];
  const tabByKey = (key: string): MockTab | undefined =>
    [...desk.entries.flatMap(tabsOf), ...desk.minimized].find(
      (tab) => tab.key === key,
    );

  const close = (key: string) =>
    patch((d) => {
      const entries = d.entries.flatMap((e) => {
        if (e.b === undefined) return e.key === key ? [] : [e];
        if (e.a.key === key) return [{ key: e.b.key, a: e.b }];
        return e.b.key === key ? [{ key: e.a.key, a: e.a }] : [e];
      });
      return {
        entries,
        selected: entries.some((e) => e.key === d.selected)
          ? d.selected
          : (entries[0]?.key ?? null),
        minimized: d.minimized.filter((tab) => tab.key !== key),
        floating: d.floating.filter((k) => k !== key),
      };
    });

  const action = (what: TabAction, side: Side) => {
    if (entry === undefined) return;
    const tab = side === "b" && entry.b ? entry.b : entry.a;
    if (what === "close") close(tab.key);
    if (what === "float") {
      close(tab.key);
      patch((d) => ({
        minimized: [...d.minimized, tab],
        floating: [...d.floating, tab.key],
      }));
    }
    if (what === "split" && next !== undefined) {
      patch((d) => ({
        entries: d.entries
          .filter((e) => e.key !== next.key)
          .map((e) => (e.key === entry.key ? { ...e, b: next.a } : e)),
      }));
    }
    if (what === "unsplit" && entry.b) {
      const b = entry.b;
      patch((d) => ({
        entries: d.entries.flatMap((e) =>
          e.key === entry.key
            ? [
                { key: e.a.key, a: e.a },
                { key: b.key, a: b },
              ]
            : [e],
        ),
        focus: "a",
      }));
    }
  };

  const toggleFloat = (key: string) =>
    patch((d) => ({
      floating: d.floating.includes(key)
        ? d.floating.filter((k) => k !== key)
        : [...d.floating, key],
    }));

  const dock = (key: string) => {
    const tab = tabByKey(key);
    if (tab === undefined) return;
    patch((d) => ({
      entries: [...d.entries, { key, a: tab }],
      selected: key,
      minimized: d.minimized.filter((t) => t.key !== key),
      floating: d.floating.filter((k) => k !== key),
    }));
  };

  const reorder = (key: string, before: string | null) =>
    patch((d) => {
      const moving = d.entries.find((e) => e.key === key);
      if (moving === undefined || key === before) return {};
      const rest = d.entries.filter((e) => e.key !== key);
      const at =
        before === null ? rest.length : rest.findIndex((e) => e.key === before);
      return {
        entries: [...rest.slice(0, at), moving, ...rest.slice(at)],
      };
    });

  const menuState = (tab: MockTab): TabMenuState => {
    const at = desk.entries.findIndex((e) => tabsOf(e).includes(tab));
    const member = desk.entries[at]?.b !== undefined;
    return {
      renamable: tab.kind !== "file",
      preview: tab.preview === true,
      file: tab.kind === "file",
      canDetach: tab.kind !== "terminal",
      inSplit: member,
      canSplit: desk.entries.length > 1,
      hasOthers: desk.entries.length > 1,
      hasRight: at < desk.entries.length - 1,
    };
  };
  const menuTab = menu === null ? undefined : tabByKey(menu.key);
  const panes =
    entry === undefined
      ? []
      : tabsOf(entry).map((tab) => cardPane(tab, menuState(tab)));
  const chosen = PANELS.find((p) => p.key === panel) ?? PANELS[0]!;

  return (
    <ShellFrame
      left={leftOpen}
      onToggleLeft={() => setLeft(!leftOpen)}
      right={rightOpen}
      onToggleRight={() => setRight(!rightOpen)}
      deskSwitcher={
        <DeskSwitcher
          desks={desks}
          current={desk.key}
          onSelect={setDeskKey}
          onNewDesk={() => {}}
        />
      }
      tabs={
        <TabStrip
          entries={desk.entries.map((e) => ({
            key: e.key,
            a: stripTab(e.a),
            b: e.b === undefined ? undefined : stripTab(e.b),
          }))}
          selected={desk.selected}
          focus={desk.focus}
          minimized={desk.minimized.map(stripTab)}
          floating={desk.floating}
          onSelect={(key, side) =>
            patch(() => ({ selected: key, focus: side }))
          }
          onClose={close}
          onMenu={(key, at) => setMenu({ key, ...at })}
          onPin={(key) =>
            patch((d) => ({
              entries: d.entries.map((e) => ({
                ...e,
                a: e.a.key === key ? { ...e.a, preview: false } : e.a,
              })),
            }))
          }
          onNewTab={() => {}}
          onReorder={reorder}
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
          floats={desk.floating.flatMap((key, order) => {
            const tab = desk.minimized.find((t) => t.key === key);
            if (tab === undefined) return [];
            return [
              {
                key,
                title: tab.title,
                icon: tabIcon(tab),
                dot: tab.dot,
                rect: rects[key] ?? FLOAT_RECTS[order % FLOAT_RECTS.length]!,
                body: floatBody(tab),
              },
            ];
          })}
          onRaise={(key) =>
            patch((d) => ({
              floating: [...d.floating.filter((k) => k !== key), key],
            }))
          }
          onRect={(key, rect) => setRects((all) => ({ ...all, [key]: rect }))}
          onMinimize={toggleFloat}
          onDock={dock}
          onClose={close}
        />
      }
    >
      <ContentCard
        panes={panes}
        focus={desk.focus}
        deskLabel={desk.label}
        canBack
        canForward={false}
        onBack={() => {}}
        onForward={() => {}}
        onFocus={(side) => patch(() => ({ focus: side }))}
        onAction={action}
        onEmptyAction={() => {}}
      />
      {menu === null || menuTab === undefined ? null : (
        <TabContextMenu
          at={menu}
          state={menuState(menuTab)}
          onSelect={(what) => {
            if (what === "close") close(menuTab.key);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </ShellFrame>
  );
}
