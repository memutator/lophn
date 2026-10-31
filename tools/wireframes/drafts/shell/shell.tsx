// UI 개편 shell 실험. title bar와 양쪽 sidebar가 한 바탕(shell)이고, 가운데만 둥근 card다.
// tab은 Obsidian처럼 title bar 줄에 올라가고, 고른 tab은 Chrome처럼 아래 card와 곡선으로 이어진다.
// grid와 activity bar는 없다. 왼쪽은 place와 session, 오른쪽은 그 place의 panel(Files, Domain …)이다.
// desk는 tab 줄 맨 앞 단추가 바꾸고 tab 줄·float을 통째로 바꾼다. 접힌 float은 tab 줄 오른쪽 끝 아이콘 칸이다.
// 칸 split은 두 tab을 한 칸으로 붙인 split tab 하나뿐이다.
import { type ReactNode, useState } from "react";
import { Button, Icon, IconButton, FileIcon } from "@lophn/ui/primitives";
import { Menu, MenuIcon, Tooltip } from "@lophn/ui/overlay";
import { Markdown } from "@lophn/ui/reading";
import type { LucideIcon } from "lucide-react";

import { Avatar } from "../../../../packages/shell/renderer/parts/avatar/avatar.tsx";
import {
  type TabDot,
  TabStateDot,
} from "../../../../packages/shell/renderer/parts/tab-state-dot/tab-state-dot.tsx";
import { VendorIcon } from "../../../../packages/shell/renderer/parts/vendor-icon/vendor-icon.tsx";
import { MahasView } from "./mahas-view.tsx";
import {
  type AgentRef,
  CODING_LINES,
  LOPHN_AGENT,
  NEW_SESSION_AGENTS,
  type SessionRow,
  APP_FILES,
  APP_INFO,
  ARTIFACTS,
  CHATS,
  DEV_LINES,
  DOCS,
  DOMAINS,
  type DeskScene,
  type FileNode,
  HOME_FILES,
  JOBS,
  type ListRow,
  LOGS,
  OVERVIEW_APPS,
  OVERVIEW_PROJECTS,
  type PanelKey,
  type PlaceKind,
  PLACES,
  PROJECT_FILES,
  type Scene,
  type StripItem,
  type TabRow,
  TERMINAL_LINES,
  WORKFLOWS,
} from "./data.ts";
import { shellIcons } from "./icons.ts";
import styles from "./shell.module.css";

const LOPHN = { kind: "character", shape: "square", color: "coral" } as const;

const PLACE_ICON: Readonly<Record<PlaceKind, LucideIcon>> = {
  home: shellIcons.home,
  project: shellIcons.project,
  app: shellIcons.app,
};

const PANEL: Readonly<Record<PanelKey, { label: string; icon: LucideIcon }>> = {
  files: { label: "Files", icon: shellIcons.folder },
  places: { label: "Places", icon: shellIcons.places },
  jobs: { label: "Jobs", icon: shellIcons.jobs },
  domain: { label: "Domain", icon: shellIcons.domain },
  artifact: { label: "Artifacts", icon: shellIcons.artifact },
  workflow: { label: "Workflows", icon: shellIcons.workflow },
  app: { label: "App", icon: shellIcons.app },
  logs: { label: "Logs", icon: shellIcons.logs },
};

/** 떠 있는 float의 자리. gallery 창 크기(1280×800)에 맞춘 고정값이다. */
const FLOAT_RECTS = [
  { x: 300, y: 56, width: 396, height: 300 },
  { x: 32, y: 420, width: 440, height: 220 },
  { x: 180, y: 240, width: 400, height: 260 },
];

type Side = "a" | "b";

interface DeskState extends DeskScene {
  readonly focus: Side;
}

interface Loc {
  readonly desk: string;
  readonly active: string;
  readonly focus: Side;
}

export function ShellDraft({ scene }: { scene: Scene }) {
  const [left, setLeft] = useState(scene.left ?? true);
  const [right, setRight] = useState(scene.right ?? true);
  const [panel, setPanel] = useState(scene.panel);
  const [session, setSession] = useState(scene.session);
  const [deskKey, setDeskKey] = useState(scene.desk);
  const [desks, setDesks] = useState<Readonly<Record<string, DeskState>>>(() =>
    Object.fromEntries(
      scene.desks.map((desk) => [desk.key, { ...desk, focus: "a" as Side }]),
    ),
  );
  const place = PLACES.find((row) => row.id === scene.place) ?? PLACES[0];
  const desk = desks[deskKey] ?? Object.values(desks)[0];
  const item =
    desk.items.find((row) => row.id === desk.active) ?? desk.items[0];
  const floating = desk.floating ?? [];

  const patchDesk = (
    key: string,
    patch: (desk: DeskState) => Partial<DeskState>,
  ) =>
    setDesks((all) => ({ ...all, [key]: { ...all[key], ...patch(all[key]) } }));
  const update = (patch: (desk: DeskState) => Partial<DeskState>) =>
    patchDesk(desk.key, patch);

  // 이동 기록. desk·tab·split 쪽을 바꿀 때마다 한 칸이고, ← →가 이 기록을 오간다.
  const [trail, setTrail] = useState<{ stack: readonly Loc[]; at: number }>(
    () => {
      const first = desks[scene.desk];
      return {
        stack: [{ desk: scene.desk, active: first?.active ?? "", focus: "a" }],
        at: 0,
      };
    },
  );
  const show = (loc: Loc) => {
    setDeskKey(loc.desk);
    patchDesk(loc.desk, () => ({ active: loc.active, focus: loc.focus }));
  };
  const visit = (loc: Loc) => {
    show(loc);
    setTrail((t) => {
      const here = t.stack[t.at];
      if (
        here?.desk === loc.desk &&
        here.active === loc.active &&
        here.focus === loc.focus
      ) {
        return t;
      }
      const stack = [...t.stack.slice(0, t.at + 1), loc];
      return { stack, at: stack.length - 1 };
    });
  };
  const step = (delta: number) => {
    const at = trail.at + delta;
    const loc = trail.stack[at];
    if (loc === undefined) return;
    show(loc);
    setTrail({ ...trail, at });
  };

  const select = (id: string, focus: Side = "a") =>
    visit({ desk: desk.key, active: id, focus });

  const goDesk = (key: string) => {
    if (key === NEW_DESK) {
      const n = Object.values(desks).filter((d) => !d.workflow).length + 1;
      const fresh: DeskState = {
        key: `desk-${n}`,
        label: `Desk ${n}`,
        items: [],
        active: "",
        minimized: [],
        focus: "a",
      };
      setDesks((all) => ({ ...all, [fresh.key]: fresh }));
      setDeskKey(fresh.key);
      return;
    }
    const target = desks[key];
    if (target !== undefined) {
      visit({ desk: key, active: target.active, focus: target.focus });
    }
  };

  // 옆에서 session을 누르면 그 session tab이 열린 desk로 간다. 어디에도 없으면 지금 desk에 tab으로 연다.
  const openSession = (row: SessionRow, placeId: string) => {
    setSession(row.id);
    if (placeId !== place.id) return;
    const tabId = `t-${row.id}`;
    for (const d of Object.values(desks)) {
      const found = d.items.find(
        (it) => it.tab.id === tabId || it.split?.id === tabId,
      );
      if (found !== undefined) {
        visit({
          desk: d.key,
          active: found.id,
          focus: found.split?.id === tabId ? "b" : "a",
        });
        return;
      }
    }
    const tab: TabRow = {
      id: tabId,
      kind: row.agent.kind === "coding" ? "coding" : "chat",
      title: row.title,
      crumbs: [place.name, row.title],
      agent: row.agent,
      dot: row.dot,
    };
    update((d) => ({ items: [...d.items, { id: tabId, tab }] }));
    visit({ desk: desk.key, active: tabId, focus: "a" });
  };

  const close = (id: string) =>
    update((d) => {
      const items = d.items.filter((row) => row.id !== id);
      return {
        items,
        active: id === d.active ? (items[0]?.id ?? "") : d.active,
      };
    });

  const toggleFloat = (id: string) =>
    update((d) => {
      const open = d.floating ?? [];
      return {
        floating: open.includes(id)
          ? open.filter((key) => key !== id)
          : [...open, id],
      };
    });

  const dock = (tab: TabRow) =>
    update((d) => ({
      items: [...d.items, { id: tab.id, tab }],
      active: tab.id,
      minimized: d.minimized.filter((row) => row.id !== tab.id),
      floating: (d.floating ?? []).filter((key) => key !== tab.id),
    }));

  const discard = (id: string) =>
    update((d) => ({
      minimized: d.minimized.filter((row) => row.id !== id),
      floating: (d.floating ?? []).filter((key) => key !== id),
    }));

  // ⋯ tab 메뉴.
  const tabAction = (action: string) => {
    if (item === undefined) return;
    const index = desk.items.indexOf(item);
    if (action === "close") close(item.id);
    if (action === "float") {
      update((d) => {
        const items = d.items.filter((row) => row.id !== item.id);
        return {
          items,
          active: items[0]?.id ?? "",
          minimized: [...d.minimized, item.tab],
          floating: [...(d.floating ?? []), item.tab.id],
        };
      });
    }
    if (action === "split") {
      const next = desk.items[index + 1] ?? desk.items[index - 1];
      if (next === undefined || next.split !== undefined) return;
      const joined: StripItem = {
        id: `s-${item.tab.id}`,
        tab: item.tab,
        split: next.tab,
      };
      update((d) => ({
        items: d.items
          .filter((row) => row.id !== next.id)
          .map((row) => (row.id === item.id ? joined : row)),
      }));
      visit({ desk: desk.key, active: joined.id, focus: "a" });
    }
    if (action === "unsplit" && item.split !== undefined) {
      const a: StripItem = { id: item.tab.id, tab: item.tab };
      const b: StripItem = { id: item.split.id, tab: item.split };
      update((d) => ({
        items: d.items.flatMap((row) => (row.id === item.id ? [a, b] : [row])),
      }));
      visit({ desk: desk.key, active: a.id, focus: "a" });
    }
  };

  const head = (tab: TabRow) => (
    <CardHead
      tab={tab}
      split={item?.split !== undefined}
      canBack={trail.at > 0}
      canForward={trail.at < trail.stack.length - 1}
      onBack={() => step(-1)}
      onForward={() => step(1)}
      onAction={tabAction}
    />
  );

  return (
    <div
      className={styles.shell}
      data-left={left ? "open" : "closed"}
      data-right={right ? "open" : "closed"}
    >
      <header className={styles.titlebar}>
        <div className={styles.titleLeft}>
          <IconButton
            icon={shellIcons.leftPanel}
            label="Toggle left sidebar"
            size="sm"
            onClick={() => setLeft(!left)}
          />
          {left ? (
            <span className={styles.brand}>
              <Avatar profile={LOPHN} size="sm" />
              lophn
            </span>
          ) : null}
          {place.kind === "project" ? (
            <DeskButton
              desks={Object.values(desks)}
              current={desk}
              onSelect={goDesk}
            />
          ) : null}
          {left ? (
            <>
              <span className={styles.grow} />
              <IconButton icon={shellIcons.search} label="Search" size="sm" />
            </>
          ) : null}
        </div>

        <div className={styles.tabStrip} role="tablist">
          {desk.items.map((row) => (
            <TabButton
              key={row.id}
              item={row}
              active={row.id === item?.id}
              focus={desk.focus}
              onSelect={(side) => select(row.id, side)}
              onClose={() => close(row.id)}
            />
          ))}
          <span className={styles.newTab}>
            <IconButton icon={shellIcons.add} label="New tab" size="sm" />
          </span>
          <span className={styles.drag} />
          {desk.minimized.length > 0 ? (
            <div
              className={styles.minimized}
              role="group"
              aria-label="Minimized"
            >
              {desk.minimized.map((tab) => (
                <Tooltip key={tab.id} content={tab.title}>
                  <button
                    type="button"
                    className={styles.miniTab}
                    aria-label={tab.title}
                    aria-pressed={floating.includes(tab.id)}
                    onClick={() => toggleFloat(tab.id)}
                  >
                    <TabIcon tab={tab} />
                  </button>
                </Tooltip>
              ))}
            </div>
          ) : null}
        </div>

        <div className={styles.titleRight}>
          {right ? (
            <div className={styles.panelTabs} role="tablist">
              {scene.panels.map((key) => (
                <Tooltip key={key} content={PANEL[key].label}>
                  <button
                    type="button"
                    role="tab"
                    className={styles.panelTab}
                    aria-label={PANEL[key].label}
                    aria-selected={key === panel}
                    onClick={() => setPanel(key)}
                  >
                    <Icon icon={PANEL[key].icon} pixels={16} />
                  </button>
                </Tooltip>
              ))}
            </div>
          ) : null}
          <span className={styles.grow} />
          <IconButton
            icon={shellIcons.rightPanel}
            label="Toggle right sidebar"
            size="sm"
            onClick={() => setRight(!right)}
          />
          <span className={styles.windowControls}>
            <IconButton icon={shellIcons.minimize} label="Minimize" size="sm" />
            <IconButton icon={shellIcons.maximize} label="Maximize" size="sm" />
            <IconButton icon={shellIcons.close} label="Close" size="sm" />
          </span>
        </div>
      </header>

      <div className={styles.body}>
        {left ? (
          <LeftSidebar
            place={place.id}
            session={session}
            desks={place.kind === "project" ? Object.values(desks) : []}
            desk={desk.key}
            expanded={scene.expanded ?? []}
            onSession={openSession}
            onDesk={goDesk}
          />
        ) : null}

        <main className={styles.stage}>
          <div className={styles.card}>
            {item === undefined ? (
              <EmptyDesk label={desk.label} />
            ) : item.split === undefined ? (
              <>
                {head(item.tab)}
                <CardContent tab={item.tab} />
              </>
            ) : (
              <div className={styles.split}>
                {(["a", "b"] as const).map((side) => {
                  const tab = side === "a" ? item.tab : item.split!;
                  return (
                    <section
                      key={side}
                      className={styles.splitHalf}
                      data-focused={desk.focus === side || undefined}
                      onPointerDown={() => select(item.id, side)}
                    >
                      {head(tab)}
                      <CardContent tab={tab} />
                    </section>
                  );
                })}
              </div>
            )}
          </div>
          <div className={styles.floatLayer}>
            {floating.map((id, index) => {
              const tab = desk.minimized.find((row) => row.id === id);
              if (tab === undefined) return null;
              const rect = FLOAT_RECTS[index % FLOAT_RECTS.length];
              return (
                <section
                  key={id}
                  className={styles.float}
                  data-active={index === floating.length - 1 || undefined}
                  style={{
                    left: rect.x,
                    top: rect.y,
                    width: rect.width,
                    height: rect.height,
                  }}
                  aria-label={tab.title}
                >
                  <div className={styles.floatBar}>
                    <TabIcon tab={tab} />
                    <span className={styles.floatTitle}>{tab.title}</span>
                    <IconButton
                      icon={shellIcons.minimize}
                      label="Minimize"
                      size="sm"
                      onClick={() => toggleFloat(id)}
                    />
                    <IconButton
                      icon={shellIcons.dock}
                      label="Dock as tab"
                      size="sm"
                      onClick={() => dock(tab)}
                    />
                    <IconButton
                      icon={shellIcons.close}
                      label="Close"
                      size="sm"
                      onClick={() => discard(id)}
                    />
                  </div>
                  <CardContent tab={tab} compact />
                </section>
              );
            })}
          </div>
        </main>

        {right ? (
          <aside className={styles.right}>
            <div className={styles.panelHead}>
              <span className={styles.panelTitle}>{PANEL[panel].label}</span>
              <span className={styles.grow} />
              <IconButton icon={shellIcons.search} label="Filter" size="sm" />
              <IconButton icon={shellIcons.more} label="More" size="sm" />
            </div>
            <div className={styles.panelBody}>
              <PanelBody panel={panel} place={place.kind} />
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

const NEW_DESK = "__new";

function DeskButton({
  desks,
  current,
  onSelect,
}: {
  desks: readonly DeskState[];
  current: DeskState;
  onSelect: (key: string) => void;
}) {
  const own = desks.filter((desk) => !desk.workflow);
  const flows = desks.filter((desk) => desk.workflow);
  const row = (desk: DeskState, index: number, heading?: string) => ({
    id: desk.key,
    heading: index === 0 ? heading : undefined,
    separatorBefore: index === 0 && heading === "Workflows",
    textValue: desk.label,
    leading: (
      <MenuIcon
        icon={
          desk.key === current.key
            ? shellIcons.current
            : desk.workflow
              ? shellIcons.workflow
              : shellIcons.desk
        }
      />
    ),
    label: (
      <span className={styles.deskItem}>
        <span>{desk.label}</span>
        {desk.status === undefined ? null : (
          <span className={styles.deskStatus}>{desk.status}</span>
        )}
      </span>
    ),
  });
  return (
    <span className={styles.deskSlot}>
      <Menu
        placement="corner"
        onSelect={onSelect}
        items={[
          ...own.map((desk, index) => row(desk, index, "Desks")),
          ...flows.map((desk, index) => row(desk, index, "Workflows")),
          {
            id: NEW_DESK,
            label: "New desk",
            separatorBefore: true,
            leading: <MenuIcon icon={shellIcons.add} />,
          },
        ]}
        trigger={
          <button
            type="button"
            className={styles.deskButton}
            data-workflow={current.workflow || undefined}
            data-desk-button=""
            aria-label={`Desk: ${current.label}`}
          >
            <Icon
              icon={current.workflow ? shellIcons.workflow : shellIcons.desk}
              pixels={14}
            />
            <span className={styles.deskLabel}>{current.label}</span>
            <Icon icon={shellIcons.expand} pixels={12} />
          </button>
        }
      />
    </span>
  );
}

function EmptyDesk({ label }: { label: string }) {
  return (
    <div className={styles.emptyDesk}>
      <Icon icon={shellIcons.desk} pixels={24} />
      <p className={styles.emptyTitle}>{label}</p>
      <p className={styles.emptyText}>
        이 desk에는 아직 tab이 없다. 옆의 session을 누르거나 새로 연다.
      </p>
      <span className={styles.emptyActions}>
        <Button size="sm" variant="secondary">
          <Icon icon={shellIcons.newSession} pixels={14} />
          New session
        </Button>
        <Button size="sm" variant="secondary">
          <Icon icon={shellIcons.folder} pixels={14} />
          Open file
        </Button>
      </span>
    </div>
  );
}

function TabButton({
  item,
  active,
  focus,
  onSelect,
  onClose,
}: {
  item: StripItem;
  active: boolean;
  focus: Side;
  onSelect: (side: Side) => void;
  onClose: () => void;
}) {
  const halves: readonly [Side, TabRow][] =
    item.split === undefined
      ? [["a", item.tab]]
      : [
          ["a", item.tab],
          ["b", item.split],
        ];
  return (
    <div
      className={styles.tab}
      role="tab"
      aria-selected={active}
      data-active={active || undefined}
      data-split={item.split === undefined ? undefined : ""}
      onClick={() => onSelect("a")}
    >
      <span className={styles.flareStart} aria-hidden />
      {halves.map(([side, tab]) => (
        <span
          key={side}
          className={styles.tabHalf}
          data-focused={
            (item.split !== undefined && active && focus === side) || undefined
          }
          onClick={(event) => {
            event.stopPropagation();
            onSelect(side);
          }}
        >
          <TabIcon tab={tab} />
          <span className={styles.tabTitle}>{tab.title}</span>
          {tab.dot === undefined ? null : <TabStateDot dot={tab.dot} />}
        </span>
      ))}
      <button
        type="button"
        className={styles.tabClose}
        aria-label={`Close ${item.tab.title}`}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        <Icon icon={shellIcons.close} pixels={12} />
      </button>
      <span className={styles.flareEnd} aria-hidden />
    </div>
  );
}

function TabIcon({ tab }: { tab: TabRow }) {
  switch (tab.kind) {
    case "chat":
    case "coding":
      return <AgentIcon agent={tab.agent ?? LOPHN_AGENT} />;
    case "file":
      return <FileIcon name={tab.title} size={14} />;
    case "terminal":
      return <Icon icon={shellIcons.terminal} pixels={14} />;
    case "app":
      return <Icon icon={shellIcons.app} pixels={14} />;
  }
}

function AgentIcon({ agent }: { agent: AgentRef }) {
  return agent.kind === "lophn" ? (
    <Avatar
      profile={{ kind: "character", shape: agent.shape, color: agent.color }}
      size="sm"
    />
  ) : (
    <VendorIcon vendor={agent.vendor} size={16} />
  );
}

function LeftSidebar({
  place,
  session,
  desks,
  desk,
  expanded: initial,
  onSession,
  onDesk,
}: {
  place: string;
  session: string;
  desks: readonly DeskState[];
  desk: string;
  expanded: readonly string[];
  onSession: (row: SessionRow, placeId: string) => void;
  onDesk: (key: string) => void;
}) {
  const [expanded, setExpanded] = useState<readonly string[]>(initial);
  const toggle = (id: string) =>
    setExpanded((all) =>
      all.includes(id) ? all.filter((key) => key !== id) : [...all, id],
    );

  return (
    <nav className={styles.left}>
      <div className={styles.navGroup}>
        <NewSessionRow />
        <NavRow icon={shellIcons.inbox} label="Inbox" count="2" />
        <NavRow icon={shellIcons.jobs} label="Jobs" />
      </div>

      <div className={styles.sectionHead}>
        <span>Places</span>
        <span className={styles.grow} />
        <IconButton icon={shellIcons.add} label="Add place" size="sm" />
      </div>

      <div className={styles.placeList}>
        {PLACES.map((row) => {
          const here = row.id === place;
          const liveDesks = here
            ? desks.filter((item) => item.workflow && item.live)
            : [];
          const endedDesks = here
            ? desks.filter((item) => item.workflow && !item.live)
            : [];
          const current = row.sessions.filter((item) => item.current);
          const recent = row.sessions.filter((item) => !item.current);
          const recentCount = recent.length + endedDesks.length;
          const open = expanded.includes(row.id);
          return (
            <div key={row.id} className={styles.placeGroup}>
              <div className={styles.placeRow} data-current={here || undefined}>
                <Icon icon={PLACE_ICON[row.kind]} pixels={16} />
                <span className={styles.rowLabel}>{row.name}</span>
              </div>
              {liveDesks.map((item) => (
                <SessionItem
                  key={item.key}
                  icon={<Icon icon={shellIcons.workflow} pixels={14} />}
                  title={item.label}
                  meta={item.status?.split(" · ")[1] ?? ""}
                  dot="waiting"
                  selected={item.key === desk}
                  onClick={() => onDesk(item.key)}
                />
              ))}
              {current.map((item) => (
                <SessionItem
                  key={item.id}
                  icon={<AgentIcon agent={item.agent} />}
                  title={item.title}
                  meta=""
                  dot={item.dot}
                  selected={item.id === session}
                  onClick={() => onSession(item, row.id)}
                />
              ))}
              {recentCount === 0 ? null : (
                <button
                  type="button"
                  className={styles.recentToggle}
                  aria-expanded={open}
                  onClick={() => toggle(row.id)}
                >
                  <Icon
                    icon={open ? shellIcons.expand : shellIcons.collapse}
                    pixels={12}
                  />
                  <span>Recent</span>
                  <span className={styles.rowMeta}>{recentCount}</span>
                </button>
              )}
              {open
                ? [
                    ...endedDesks.map((item) => (
                      <SessionItem
                        key={item.key}
                        recent
                        icon={<Icon icon={shellIcons.workflow} pixels={14} />}
                        title={item.label}
                        meta={item.status?.split(" · ")[0] ?? ""}
                        selected={item.key === desk}
                        onClick={() => onDesk(item.key)}
                      />
                    )),
                    ...recent.map((item) => (
                      <SessionItem
                        key={item.id}
                        recent
                        icon={<AgentIcon agent={item.agent} />}
                        title={item.title}
                        meta={item.when}
                        selected={item.id === session}
                        onClick={() => onSession(item, row.id)}
                      />
                    )),
                  ]
                : null}
            </div>
          );
        })}
      </div>

      <div className={styles.leftFoot}>
        <span className={styles.user}>
          <span className={styles.userMark}>P</span>
          pyosechang
        </span>
        <span className={styles.grow} />
        <IconButton icon={shellIcons.settings} label="Settings" size="sm" />
      </div>
    </nav>
  );
}

function SessionItem({
  icon,
  title,
  meta,
  dot,
  selected,
  recent,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  meta: string;
  dot?: TabDot;
  selected: boolean;
  recent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={styles.sessionRow}
      data-recent={recent || undefined}
      aria-current={selected || undefined}
      onClick={onClick}
    >
      <span className={styles.rowIcon}>{icon}</span>
      <span className={styles.rowLabel}>{title}</span>
      <span className={styles.rowMeta}>{meta}</span>
      <span className={styles.rowDot}>
        {dot === undefined ? null : <TabStateDot dot={dot} />}
      </span>
    </button>
  );
}

function NewSessionRow() {
  return (
    <div className={styles.newSession}>
      <button type="button" className={styles.navRow}>
        <Icon icon={shellIcons.newSession} pixels={16} />
        <span className={styles.rowLabel}>New session</span>
      </button>
      <Menu
        placement="corner"
        onSelect={() => {}}
        items={NEW_SESSION_AGENTS.map((agent, index) => ({
          id: agent.name,
          label: agent.name,
          heading:
            index === 0
              ? "lophn agents"
              : agent.kind === "coding" &&
                  NEW_SESSION_AGENTS[index - 1].kind === "lophn"
                ? "Coding agents"
                : undefined,
          separatorBefore:
            agent.kind === "coding" &&
            NEW_SESSION_AGENTS[index - 1].kind === "lophn",
          leading: (
            <MenuIcon>
              <AgentIcon agent={agent} />
            </MenuIcon>
          ),
        }))}
        trigger={
          <button
            type="button"
            className={styles.newSessionMore}
            aria-label="New session with…"
            data-new-session-menu=""
          >
            <Icon icon={shellIcons.expand} pixels={14} />
          </button>
        }
      />
    </div>
  );
}

function NavRow({
  icon,
  label,
  count,
}: {
  icon: LucideIcon;
  label: string;
  count?: string;
}) {
  return (
    <button type="button" className={styles.navRow}>
      <Icon icon={icon} pixels={16} />
      <span className={styles.rowLabel}>{label}</span>
      {count === undefined ? null : (
        <span className={styles.badge}>{count}</span>
      )}
    </button>
  );
}

function CardHead({
  tab,
  split,
  canBack,
  canForward,
  onBack,
  onForward,
  onAction,
}: {
  tab: TabRow;
  split: boolean;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onAction: (action: string) => void;
}) {
  return (
    <div className={styles.cardHead}>
      <IconButton
        icon={shellIcons.back}
        label="Back"
        size="sm"
        disabled={!canBack}
        onClick={onBack}
        data-trail="back"
      />
      <IconButton
        icon={shellIcons.forward}
        label="Forward"
        size="sm"
        disabled={!canForward}
        onClick={onForward}
      />
      <span className={styles.crumbs}>
        {tab.crumbs.map((crumb, index) => (
          <span key={crumb} className={styles.crumb}>
            {index > 0 ? <span className={styles.crumbSep}>/</span> : null}
            {crumb}
          </span>
        ))}
      </span>
      {tab.kind === "chat" ? (
        <span className={styles.status}>
          <span className={styles.readyDot} aria-hidden />
          Ready
        </span>
      ) : null}
      <span className={styles.grow} />
      <Menu
        placement="corner"
        onSelect={onAction}
        items={[
          {
            id: "float",
            label: "Float",
            leading: <MenuIcon icon={shellIcons.float} />,
          },
          split
            ? {
                id: "unsplit",
                label: "Unsplit",
                leading: <MenuIcon icon={shellIcons.unsplit} />,
              }
            : {
                id: "split",
                label: "Split with next tab",
                leading: <MenuIcon icon={shellIcons.split} />,
              },
          {
            id: "detach",
            label: "Move to new window",
            leading: <MenuIcon icon={shellIcons.detach} />,
          },
          ...(tab.kind === "file"
            ? [
                {
                  id: "copy-path",
                  label: "Copy path",
                  leading: <MenuIcon icon={shellIcons.copy} />,
                },
              ]
            : []),
          {
            id: "close",
            label: "Close tab",
            separatorBefore: true,
            leading: <MenuIcon icon={shellIcons.close} />,
          },
        ]}
        trigger={
          <IconButton
            icon={shellIcons.more}
            label="Tab menu"
            size="sm"
            data-tab-menu=""
          />
        }
      />
    </div>
  );
}

function CardContent({ tab, compact }: { tab: TabRow; compact?: boolean }) {
  return (
    <div
      className={styles.cardBody}
      data-kind={tab.kind}
      data-compact={compact || undefined}
    >
      {tab.kind === "chat" ? <Chat id={tab.id} compact={compact} /> : null}
      {tab.kind === "file" ? (
        <div className={styles.reading}>
          <Markdown
            source={DOCS[tab.id] ?? ""}
            variant={compact ? "chat" : "reading"}
          />
        </div>
      ) : null}
      {tab.kind === "coding" ? (
        <pre className={styles.terminal}>{CODING_LINES.join("\n")}</pre>
      ) : null}
      {tab.kind === "terminal" ? (
        <pre className={styles.terminal}>
          {(tab.id === "t-dev" ? DEV_LINES : TERMINAL_LINES).join("\n")}
        </pre>
      ) : null}
      {tab.kind === "app" ? <MahasView /> : null}
    </div>
  );
}

function Chat({ id, compact }: { id: string; compact?: boolean }) {
  const messages = CHATS[id] ?? [];
  return (
    <div className={styles.chat}>
      <div className={styles.thread}>
        {messages.map((message, index) =>
          message.role === "user" ? (
            <div key={index} className={styles.userMessage}>
              {message.text}
            </div>
          ) : (
            <div key={index} className={styles.agentMessage}>
              <Markdown source={message.text} variant="chat" />
            </div>
          ),
        )}
      </div>
      <div className={styles.composer}>
        <div className={styles.composerInput}>
          {compact ? "Reply…" : "Ask lophn… Type / for commands and skills."}
        </div>
        <div className={styles.composerBar}>
          <IconButton icon={shellIcons.add} label="Attach" size="sm" />
          <span className={styles.grow} />
          {compact ? null : (
            <>
              <span className={styles.chip}>claude-opus-5-5</span>
              <span className={styles.chip}>High</span>
            </>
          )}
          <button type="button" className={styles.send} aria-label="Send">
            <Icon icon={shellIcons.send} pixels={16} />
          </button>
        </div>
      </div>
      {compact ? null : (
        <div className={styles.composerFoot}>
          10% of 1M · 7.4M in · 183k out
        </div>
      )}
    </div>
  );
}

function PanelBody({ panel, place }: { panel: PanelKey; place: PlaceKind }) {
  switch (panel) {
    case "files":
      return (
        <Tree
          nodes={
            place === "home"
              ? HOME_FILES
              : place === "app"
                ? APP_FILES
                : PROJECT_FILES
          }
        />
      );
    case "places":
      return (
        <>
          <Section title="Projects">
            <Rows rows={OVERVIEW_PROJECTS} />
          </Section>
          <Section title="Apps">
            <Rows rows={OVERVIEW_APPS} />
          </Section>
        </>
      );
    case "jobs":
      return <Rows rows={JOBS} icon={shellIcons.jobs} />;
    case "domain":
      return <Rows rows={DOMAINS} icon={shellIcons.domain} />;
    case "artifact":
      return <Rows rows={ARTIFACTS} icon={shellIcons.artifact} />;
    case "workflow":
      return <Rows rows={WORKFLOWS} icon={shellIcons.workflow} />;
    case "logs":
      return <Rows rows={LOGS} icon={shellIcons.logs} />;
    case "app":
      return <Rows rows={APP_INFO} />;
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.panelSection}>
      <div className={styles.sectionHead}>
        <span>{title}</span>
      </div>
      {children}
    </section>
  );
}

function Rows({ rows, icon }: { rows: readonly ListRow[]; icon?: LucideIcon }) {
  return (
    <div className={styles.rows}>
      {rows.map((row) => {
        const glyph = row.kind === undefined ? icon : PLACE_ICON[row.kind];
        return (
          <div key={row.title} className={styles.listRow}>
            {glyph === undefined ? null : (
              <span className={styles.listIcon}>
                <Icon icon={glyph} pixels={16} />
              </span>
            )}
            <span className={styles.listText}>
              <span className={styles.listTitle}>{row.title}</span>
              <span className={styles.listMeta}>{row.meta}</span>
            </span>
            {row.live ? (
              <span className={styles.runningDot} aria-hidden />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function Tree({ nodes }: { nodes: readonly FileNode[] }) {
  return (
    <div className={styles.tree}>
      {nodes.map((node) => (
        <div
          key={`${node.depth}-${node.name}`}
          className={styles.treeRow}
          data-active={node.active || undefined}
          style={{
            paddingInlineStart: `calc(var(--space-4) * ${node.depth + 1})`,
          }}
        >
          <span className={styles.chevron}>
            {node.folder ? (
              <Icon
                icon={node.open ? shellIcons.expand : shellIcons.collapse}
                pixels={12}
              />
            ) : null}
          </span>
          <FileIcon
            name={node.name}
            folder={node.folder}
            open={node.open}
            size={16}
          />
          <span className={styles.rowLabel}>{node.name}</span>
        </div>
      ))}
    </div>
  );
}
