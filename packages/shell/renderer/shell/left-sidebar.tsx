// 왼쪽 sidebar. 위에 New session·Inbox·Jobs, 아래에 place(Home, project, app)마다 열린 session과 이 place의 접힌 Recent 줄 하나,
// 맨 아래에 빠른 실행(Terminal · Browser · App ▾ · Search)과 Settings다. 값과 callback만 받아서 project 창 말고 Home과 app place도 같은 것을 쓴다.
import { t } from "@lophn/i18n";
import { Menu, MenuIcon, type MenuItem, Tooltip } from "@lophn/ui/overlay";
import { Icon, IconButton } from "@lophn/ui/primitives";
import type { LucideIcon } from "lucide-react";
import { Fragment, type ReactNode, useState } from "react";

import { useAppIcon } from "../app-frame/app-icon.tsx";
import { WaitingLayer } from "../desktop/connection/waiting/waiting-layer.tsx";
import { JobsLayer } from "../desktop/jobs/jobs-layer.tsx";
import type { JobsSource } from "../desktop/jobs/source.ts";
import {
  browserIcons,
  commonIcons,
  notificationsIcon,
  settingsEntryIcon,
  shellIcons,
  sidebarIcons,
  workspaceIcons,
} from "../icons/mod.ts";
import { Avatar } from "../parts/avatar/avatar.tsx";
import { TabStateDot } from "../parts/tab-state-dot/tab-state-dot.tsx";
import { VendorIcon } from "../parts/vendor-icon/vendor-icon.tsx";
import { placeKey, type PlaceRef } from "./desk-model.ts";
import {
  type NewSessionAgent,
  type NewSessionCoding,
  type SidebarPlace,
  type SidebarSession,
  sessionKey,
} from "./left-sidebar-model.ts";
import styles from "./left-sidebar.module.css";

/** 고정한 앱 panel 단추. id는 `order`의 id다. */
export interface QuickPinButton {
  id: string;
  app: string;
  label: string;
  onOpen: () => void;
}

/** 맨 아래 줄의 빠른 실행. 핸들러·항목이 없는 단추는 그리지 않는다. */
export interface QuickLaunch {
  /** 단추 id(terminal · browser · app · search · 고정 id)의 순서. 없으면 기본 순서에 고정 없음이다. 모르는 id는 건너뛴다. */
  order?: readonly string[];
  pins?: readonly QuickPinButton[];
  onTerminal?: () => void;
  onBrowser?: () => void;
  /** Search 탭(project) 또는 팔레트(Home 등 검색 탭이 없는 place). */
  onSearch?: () => void;
  /** App ▾의 항목(이 place의 앱 화면·앱 panel). 비면 단추가 없다. */
  appItems?: readonly MenuItem[];
  onApp?: (id: string) => void;
}

export interface LeftSidebarProps {
  places: readonly SidebarPlace[];
  /** 이 창이 보이는 place. 그 줄이 강조된다. */
  current: PlaceRef;
  /** 고른 tab의 session 줄(`sessionKey`). 없으면 강조하지 않는다. */
  selected?: string;
  /** New session ▾의 lophn agent와 coding agent. coding이 비면 그 묶음이 없다. */
  agents: readonly NewSessionAgent[];
  coding: readonly NewSessionCoding[];
  /** New session 줄을 누른다. 이 place의 lophn에서 새 session이다. */
  onNewSession: () => void;
  onNewSessionWith: (kind: "lophn" | "coding", id: string) => void;
  /** Inbox 질문 카드의 [Open session]. */
  onOpenSession: (session: string) => void;
  /** Jobs overlay의 통로. 없으면 Jobs 줄이 바로 Jobs 탭을 연다. */
  jobs?: JobsSource;
  /** Inbox·Jobs overlay의 [Open in tab]과 Jobs 줄(통로가 없을 때): 그 탭을 연다. */
  onInbox: () => void;
  onJobs: () => void;
  onPlace: (ref: PlaceRef) => void;
  onSession: (place: SidebarPlace, session: SidebarSession) => void;
  /** Recent 줄을 목록에서 지운다. 주지 않으면 menu가 없다. */
  onRemoveRecent?: (place: SidebarPlace, session: SidebarSession) => void;
  /** Places의 + menu 항목. 둘 다 없으면 +가 없다. */
  onRegisterProject?: () => void;
  onCreateApp?: () => void;
  quick?: QuickLaunch;
  /** 이 창의 project 줄에 설정 단추를 둔다(Home·앱 place는 주지 않는다). */
  onProjectSettings?: () => void;
  onSettings: () => void;
}

const DEFAULT_QUICK = ["terminal", "browser", "app", "search"] as const;

const PLACE_ICON = {
  home: sidebarIcons.home,
  project: sidebarIcons.project,
  app: shellIcons.app,
} as const satisfies Record<PlaceRef["kind"], LucideIcon>;

// 줄 오른쪽 끝의 짧은 시각. Recent는 7일 안이라 일까지만 센다.
function ageOf(at: number): string {
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1)
    return t("left-sidebar.label.age", { unit: "now", value: 0 });
  if (minutes < 60) {
    return t("left-sidebar.label.age", { unit: "minute", value: minutes });
  }
  if (minutes < 24 * 60) {
    return t("left-sidebar.label.age", {
      unit: "hour",
      value: Math.floor(minutes / 60),
    });
  }
  return t("left-sidebar.label.age", {
    unit: "day",
    value: Math.floor(minutes / (24 * 60)),
  });
}

function AgentMark({ agent }: { agent: SidebarSession["agent"] }) {
  if (agent.kind === "lophn")
    return <Avatar profile={agent.profile} size="sm" />;
  if (agent.kind === "workflow") {
    return <Icon icon={shellIcons.workflow} pixels={14} />;
  }
  return agent.vendor === undefined ? (
    <Icon icon={shellIcons.terminal} pixels={14} />
  ) : (
    <VendorIcon vendor={agent.vendor} size={16} />
  );
}

function QuickPin({ pin }: { pin: QuickPinButton }) {
  // 앱이 선언한 icon이 없으면 기본 앱 panel 아이콘이다.
  const icon = useAppIcon(pin.app);
  return (
    <Tooltip content={pin.label}>
      <button
        type="button"
        className={styles.quickPin}
        aria-label={pin.label}
        data-quick-pin={pin.app}
        onClick={pin.onOpen}
      >
        {icon === undefined ? (
          <Icon icon={workspaceIcons.appPanel} pixels={16} />
        ) : (
          <img src={icon} alt="" width={16} height={16} />
        )}
      </button>
    </Tooltip>
  );
}

function NavRow({
  icon,
  label,
  count,
  ...rest
}: {
  icon: LucideIcon;
  label: string;
  count?: number;
  onClick?: () => void;
  "aria-expanded"?: boolean;
  "data-nav": string;
}) {
  return (
    <button type="button" className={styles.navRow} {...rest}>
      <Icon icon={icon} pixels={16} />
      <span className={styles.rowLabel}>{label}</span>
      {count === undefined || count === 0 ? null : (
        <span className={styles.badge}>{count}</span>
      )}
    </button>
  );
}

function NewSessionRow({
  agents,
  coding,
  onNewSession,
  onNewSessionWith,
}: Pick<
  LeftSidebarProps,
  "agents" | "coding" | "onNewSession" | "onNewSessionWith"
>) {
  const items: MenuItem[] = [
    ...agents.map((agent, index) => ({
      id: `lophn:${agent.id}`,
      label: agent.name,
      heading: index === 0 ? t("left-sidebar.heading.lophn-agents") : undefined,
      leading: (
        <MenuIcon>
          <Avatar profile={agent.profile} size="sm" />
        </MenuIcon>
      ),
    })),
    ...coding.map((agent, index) => ({
      id: `coding:${agent.id}`,
      label: agent.name,
      heading:
        index === 0 ? t("left-sidebar.heading.coding-agents") : undefined,
      separatorBefore: index === 0 && agents.length > 0,
      leading: (
        <MenuIcon>
          {agent.vendor === undefined ? (
            <Icon icon={shellIcons.terminal} pixels={14} />
          ) : (
            <VendorIcon vendor={agent.vendor} size={16} />
          )}
        </MenuIcon>
      ),
    })),
  ];
  return (
    <div className={styles.newSession}>
      <button
        type="button"
        className={styles.navRow}
        data-nav="new-session"
        onClick={onNewSession}
      >
        <Icon icon={shellIcons.newSession} pixels={16} />
        <span className={styles.rowLabel}>
          {t("left-sidebar.button.new-session")}
        </span>
      </button>
      {items.length === 0 ? null : (
        <Menu
          placement="corner"
          items={items}
          onSelect={(id) => {
            const [kind, ...rest] = id.split(":");
            onNewSessionWith(kind as "lophn" | "coding", rest.join(":"));
          }}
          trigger={
            <button
              type="button"
              className={styles.newSessionMore}
              aria-label={t("left-sidebar.button.new-session-with")}
              data-new-session-menu=""
            >
              <Icon icon={shellIcons.expand} pixels={14} />
            </button>
          }
        />
      )}
    </div>
  );
}

function SessionRow({
  item,
  selected,
  recent,
  onClick,
  onMenu,
}: {
  item: SidebarSession;
  selected: boolean;
  recent: boolean;
  onClick: () => void;
  onMenu?: (at: { x: number; y: number }) => void;
}) {
  return (
    <button
      type="button"
      className={styles.sessionRow}
      data-recent={recent || undefined}
      data-session={item.kind === "session" ? item.ref : undefined}
      data-terminal={item.kind === "terminal" ? item.ref : undefined}
      data-workflow={item.kind === "workflow" ? item.ref : undefined}
      aria-current={selected || undefined}
      onClick={onClick}
      onContextMenu={(event) => {
        if (onMenu === undefined) return;
        event.preventDefault();
        onMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      <span className={styles.rowIcon}>
        <AgentMark agent={item.agent} />
      </span>
      <span className={styles.rowLabel}>{item.title}</span>
      {recent && item.at > 0 ? (
        <span className={styles.rowMeta}>{ageOf(item.at)}</span>
      ) : null}
      {!recent && item.kind === "workflow" ? (
        <span className={styles.rowMeta}>
          {t("left-sidebar.label.your-turn")}
        </span>
      ) : null}
      <span className={styles.rowDot}>
        {recent || item.dot === null ? null : <TabStateDot dot={item.dot} />}
      </span>
    </button>
  );
}

export function LeftSidebar({
  places,
  current,
  selected,
  agents,
  coding,
  onNewSession,
  onNewSessionWith,
  onOpenSession,
  jobs,
  onInbox,
  onJobs,
  onPlace,
  onSession,
  onRemoveRecent,
  onRegisterProject,
  onCreateApp,
  quick,
  onProjectSettings,
  onSettings,
}: LeftSidebarProps) {
  // 펼친 Recent는 place마다 기억한다. 저장하지 않는다.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (key: string) =>
    setExpanded((all) => {
      const next = new Set(all);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const [menu, setMenu] = useState<{
    readonly place: SidebarPlace;
    readonly item: SidebarSession;
    readonly x: number;
    readonly y: number;
  } | null>(null);

  const addItems: MenuItem[] = [
    ...(onRegisterProject === undefined
      ? []
      : [
          {
            id: "project",
            label: t("left-sidebar.button.register-project"),
            leading: <MenuIcon icon={sidebarIcons.project} />,
          },
        ]),
    ...(onCreateApp === undefined
      ? []
      : [
          {
            id: "app",
            label: t("left-sidebar.button.create-app"),
            leading: <MenuIcon icon={shellIcons.app} />,
          },
        ]),
  ];
  const currentKey = placeKey(current);

  const quickButtons: Record<string, ReactNode> = {
    terminal:
      quick?.onTerminal === undefined ? null : (
        <IconButton
          icon={workspaceIcons.terminal}
          label={t("left-sidebar.button.quick-terminal")}
          size="sm"
          data-quick="terminal"
          onClick={quick.onTerminal}
        />
      ),
    browser:
      quick?.onBrowser === undefined ? null : (
        <IconButton
          icon={browserIcons.globe}
          label={t("left-sidebar.button.quick-browser")}
          size="sm"
          data-quick="browser"
          onClick={quick.onBrowser}
        />
      ),
    app:
      quick?.appItems === undefined || quick.appItems.length === 0 ? null : (
        <Menu
          items={[...quick.appItems]}
          onSelect={(id) => quick.onApp?.(id)}
          trigger={
            <IconButton
              icon={workspaceIcons.appPanel}
              label={t("left-sidebar.button.quick-app")}
              size="sm"
              data-quick="app"
            />
          }
        />
      ),
    search:
      quick?.onSearch === undefined ? null : (
        <IconButton
          icon={shellIcons.search}
          label={t("left-sidebar.button.quick-search")}
          size="sm"
          data-quick="search"
          onClick={quick.onSearch}
        />
      ),
    ...Object.fromEntries(
      (quick?.pins ?? []).map((pin) => [pin.id, <QuickPin pin={pin} />]),
    ),
  };

  return (
    <div
      className={styles.sidebar}
      role="navigation"
      aria-label={t("left-sidebar.label.nav")}
    >
      <div className={styles.navGroup}>
        <NewSessionRow
          agents={agents}
          coding={coding}
          onNewSession={onNewSession}
          onNewSessionWith={onNewSessionWith}
        />
        <WaitingLayer
          align="side"
          onOpenSession={onOpenSession}
          onOpenTab={onInbox}
          renderTrigger={({ count, open, toggle: toggleInbox }) => (
            <button
              type="button"
              className={styles.navRow}
              data-nav="inbox"
              data-waiting-trigger=""
              aria-expanded={open}
              onClick={toggleInbox}
            >
              <Icon icon={notificationsIcon} pixels={16} />
              <span className={styles.rowLabel}>
                {t("left-sidebar.button.inbox")}
              </span>
              {count === 0 ? null : (
                <span className={styles.badge}>{count}</span>
              )}
            </button>
          )}
        />
        {jobs === undefined ? (
          <NavRow
            icon={shellIcons.jobs}
            label={t("left-sidebar.button.jobs")}
            onClick={onJobs}
            data-nav="jobs"
          />
        ) : (
          <JobsLayer
            source={jobs}
            onOpenTab={onJobs}
            renderTrigger={({ open, toggle: toggleJobs }) => (
              <NavRow
                icon={shellIcons.jobs}
                label={t("left-sidebar.button.jobs")}
                onClick={toggleJobs}
                aria-expanded={open}
                data-nav="jobs"
              />
            )}
          />
        )}
      </div>

      <div className={styles.sectionHead}>
        <span>{t("left-sidebar.heading.places")}</span>
        <span className={styles.grow} />
        {addItems.length === 0 ? null : (
          <Menu
            items={addItems}
            onSelect={(id) =>
              (id === "project" ? onRegisterProject : onCreateApp)?.()
            }
            trigger={
              <IconButton
                icon={shellIcons.add}
                label={t("left-sidebar.button.add-place")}
                size="sm"
                data-add-place=""
              />
            }
          />
        )}
      </div>

      <div className={styles.placeList}>
        {places.map((place) => {
          const key = placeKey(place.ref);
          const here = key === currentKey;
          const open = expanded.has(key);
          return (
            <div
              key={key}
              className={styles.placeGroup}
              data-place={key}
              data-here={here || undefined}
            >
              <div className={styles.placeHead}>
                <button
                  type="button"
                  className={styles.placeRow}
                  data-current={here || undefined}
                  aria-current={here || undefined}
                  onClick={() => onPlace(place.ref)}
                >
                  <Icon icon={PLACE_ICON[place.ref.kind]} pixels={16} />
                  <span className={styles.rowLabel}>{place.name}</span>
                </button>
                {here &&
                place.ref.kind === "project" &&
                onProjectSettings !== undefined ? (
                  <IconButton
                    icon={commonIcons.settings}
                    label={t("left-sidebar.button.project-settings")}
                    size="sm"
                    data-place-settings=""
                    onClick={onProjectSettings}
                  />
                ) : null}
              </div>
              {place.current.map((item) => (
                <SessionRow
                  key={sessionKey(item)}
                  item={item}
                  selected={here && sessionKey(item) === selected}
                  recent={false}
                  onClick={() => onSession(place, item)}
                />
              ))}
              {place.recent.length === 0 ? null : (
                <button
                  type="button"
                  className={styles.recentToggle}
                  aria-expanded={open}
                  data-recent-toggle={key}
                  onClick={() => toggle(key)}
                >
                  <Icon
                    icon={open ? shellIcons.expand : sidebarIcons.collapsed}
                    pixels={12}
                  />
                  <span>{t("left-sidebar.label.recent")}</span>
                  <span className={styles.rowMeta}>{place.recent.length}</span>
                </button>
              )}
              {open
                ? place.recent.map((item) => (
                    <SessionRow
                      key={sessionKey(item)}
                      item={item}
                      selected={here && sessionKey(item) === selected}
                      recent
                      onClick={() => onSession(place, item)}
                      onMenu={
                        onRemoveRecent === undefined || item.kind === "workflow"
                          ? undefined
                          : (at) => setMenu({ place, item, ...at })
                      }
                    />
                  ))
                : null}
            </div>
          );
        })}
      </div>

      <div className={styles.foot}>
        {(quick?.order ?? DEFAULT_QUICK).map((id) => (
          <Fragment key={id}>{quickButtons[id] ?? null}</Fragment>
        ))}
        <span className={styles.grow} />
        <IconButton
          icon={settingsEntryIcon}
          label={t("left-sidebar.button.settings")}
          size="sm"
          data-nav="settings"
          onClick={onSettings}
        />
      </div>

      {menu === null ? null : (
        <Menu
          open
          onOpenChange={(next) => {
            if (!next) setMenu(null);
          }}
          trigger={
            <span
              className={styles.menuAnchor}
              style={{ left: menu.x, top: menu.y }}
            />
          }
          items={[
            {
              id: "remove",
              label: t("left-sidebar.button.remove-recent"),
              leading: <MenuIcon icon={shellIcons.close} />,
            },
          ]}
          onSelect={() => {
            onRemoveRecent?.(menu.place, menu.item);
            setMenu(null);
          }}
        />
      )}
    </div>
  );
}
