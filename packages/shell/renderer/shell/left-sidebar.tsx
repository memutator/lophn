// 왼쪽 sidebar. 위에 Inbox·Jobs, 아래에 place(Home, project, app)마다 줄 오른쪽 끝의 +(새 session)와 열린 session과 이 place의 접힌 Recent 줄 하나,
// 맨 아래에 빠른 실행(Terminal · Browser · App · Search와 고정 앱 panel. 앞 셋은 hover 목록이 있다)과 Settings다. 값과 callback만 받아서 project 창 말고 Home과 app place도 같은 것을 쓴다.
import { t } from "@lophn/i18n";
import {
  Menu,
  MenuIcon,
  type MenuItem,
  Popover,
  PopoverRow,
  Tooltip,
} from "@lophn/ui/overlay";
import { Icon, IconButton } from "@lophn/ui/primitives";
import type { LucideIcon } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";

import { useAppIcon } from "../app-frame/app-icon.tsx";
import { WaitingLayer } from "../desktop/connection/waiting/waiting-layer.tsx";
import { JobsLayer } from "../desktop/jobs/jobs-layer.tsx";
import type { JobsSource } from "../desktop/jobs/source.ts";
import {
  actionIcons,
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

/** 빠른 실행 단추에 hover하면 뜨는 목록의 한 줄. 누르면 바로 연다. */
export interface QuickHoverItem {
  id: string;
  label: string;
  /** 줄 앞 아이콘(앱 icon, favicon, vendor 아이콘). */
  leading: ReactNode;
  onSelect: () => void;
}

/** 맨 아래 줄의 빠른 실행. 핸들러·항목이 없는 단추는 그리지 않는다. */
export interface QuickLaunch {
  /** 단추 id(terminal · browser · app · search · 고정 id)의 순서. 없으면 기본 순서에 고정 없음이다. 모르는 id는 건너뛴다. */
  order?: readonly string[];
  pins?: readonly QuickPinButton[];
  onTerminal?: () => void;
  /** Terminal hover: 즐겨찾기한 coding agent. 누르면 그 명령어로 새 터미널이다. */
  terminalItems?: readonly QuickHoverItem[];
  onBrowser?: () => void;
  /** Browser hover: bookmark. 누르면 그 주소로 새 browser 탭이다. */
  browserItems?: readonly QuickHoverItem[];
  /** Search 탭(project) 또는 팔레트(Home 등 검색 탭이 없는 place). */
  onSearch?: () => void;
  /** App 단추 누르기: 앱을 고르는 앱 panel 탭. */
  onApp?: () => void;
  /** App hover: 앱 화면(앱 place)과 앱 panel 화면. 둘 다 없으면 단추가 없다. */
  appItems?: readonly QuickHoverItem[];
}

export interface LeftSidebarProps {
  places: readonly SidebarPlace[];
  /** 이 창이 보이는 place. 그 줄이 강조된다. */
  current: PlaceRef;
  /** 고른 tab의 session 줄(`sessionKey`). 없으면 강조하지 않는다. */
  selected?: string;
  /** 이 창 place의 + 오른쪽 클릭 menu의 lophn agent와 coding agent. coding이 비면 그 묶음이 없다. */
  agents: readonly NewSessionAgent[];
  coding: readonly NewSessionCoding[];
  /** place 줄의 +. 그 place의 lophn에서 새 session이다. 다른 place면 그 place로 가서 연다. */
  onNewSession: (place: PlaceRef) => void;
  /** 이 창 place의 + 오른쪽 클릭 menu에서 고른 agent로 새 session이다. */
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
  /** 이 창이 보이는 place의 current 줄(workflow 밖)에 hover하면 연필이 뜬다. 누르면 줄이 이름 칸이 된다. */
  onRenameSession?: (
    place: SidebarPlace,
    session: SidebarSession,
    title: string,
  ) => void;
  /** 같은 줄의 x. 도는 turn을 멈추고 탭을 닫아 Recent로 보낸다. */
  onStopSession?: (place: SidebarPlace, session: SidebarSession) => void;
  /** 이 창의 project·앱 줄 오른쪽 끝에 설정 단추를 둔다. hover와 focus 때만 보인다. project는 Project settings, 앱은 App details 탭을 연다. Home은 주지 않는다. */
  onPlaceSettings?: () => void;
  onSettings: () => void;
}

const DEFAULT_QUICK = ["terminal", "browser", "app", "search"] as const;

const PLACE_ICON = {
  home: sidebarIcons.home,
  project: sidebarIcons.project,
  app: shellIcons.app,
} as const satisfies Record<PlaceRef["kind"], LucideIcon>;

// 펼친 Recent가 한 번에 보이는 줄 수. 넘으면 page로 나눈다.
const RECENT_PAGE = 10;

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

/** 빠른 실행 단추. hover 목록이 있으면 pointer를 올릴 때 그 목록이 뜨고, 누르기는 단추 자기 일이다. */
function QuickButton({
  id,
  icon,
  label,
  items,
  onClick,
}: {
  id: string;
  icon: LucideIcon;
  label: string;
  items?: readonly QuickHoverItem[];
  onClick?: () => void;
}) {
  const button = (
    <IconButton
      icon={icon}
      label={label}
      size="sm"
      data-quick={id}
      onClick={onClick}
    />
  );
  if (items === undefined || items.length === 0) return button;
  return (
    <Popover hover trigger={button}>
      <div className={styles.quickHoverHead} data-quick-hover={id}>
        {label}
      </div>
      {items.map((item) => (
        <PopoverRow key={item.id} onSelect={item.onSelect}>
          <span className={styles.quickHoverIcon}>{item.leading}</span>
          <span className={styles.quickHoverLabel}>{item.label}</span>
        </PopoverRow>
      ))}
    </Popover>
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

// Enter나 blur는 확정(빈 이름이나 같은 이름은 아무것도 하지 않는다), Escape는 취소다. unmount 때 blur가 한 번 더
// 와도 두 번 확정하지 않는다.
function SessionRename({
  title,
  onDone,
}: {
  title: string;
  onDone: (name: string | null) => void;
}) {
  const done = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name === null || name === title ? null : name);
  };
  return (
    <div className={styles.sessionRenameLine}>
      <input
        ref={input}
        className={styles.sessionRename}
        aria-label={t("left-sidebar.label.session-name")}
        defaultValue={title}
        data-session-rename-input=""
        onBlur={(event) => finish(event.currentTarget.value.trim() || null)}
        onKeyDown={(event) => {
          // 작업대 단축키로 키가 새지 않게 한다.
          event.stopPropagation();
          if (event.key === "Enter") {
            finish(event.currentTarget.value.trim() || null);
          } else if (event.key === "Escape") finish(null);
        }}
      />
    </div>
  );
}

function SessionRow({
  item,
  selected,
  recent,
  onClick,
  onMenu,
  dot = true,
}: {
  item: SidebarSession;
  selected: boolean;
  recent: boolean;
  onClick: () => void;
  onMenu?: (at: { x: number; y: number }) => void;
  /** false면 줄 끝 점을 그리지 않는다. 점은 줄 밖의 Stop 단추가 대신 보인다. */
  dot?: boolean;
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
      {dot ? (
        <span className={styles.rowDot}>
          {recent || item.dot === null ? null : <TabStateDot dot={item.dot} />}
        </span>
      ) : null}
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
  onRenameSession,
  onStopSession,
  onPlaceSettings,
  onSettings,
}: LeftSidebarProps) {
  // 이 창 place의 + 오른쪽 클릭 menu 자리.
  const [newMenu, setNewMenu] = useState<{ x: number; y: number } | null>(null);
  const newItems: MenuItem[] = [
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
  // 이름 칸이 열린 current 줄(`sessionKey`). 저장하지 않는다.
  const [renaming, setRenaming] = useState<string | null>(null);
  // 펼친 Recent와 그 page는 place마다 기억한다. 저장하지 않는다.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [pages, setPages] = useState<ReadonlyMap<string, number>>(new Map());
  const turnPage = (key: string, page: number) =>
    setPages((all) => new Map(all).set(key, page));
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
        <QuickButton
          id="terminal"
          icon={workspaceIcons.terminal}
          label={t("left-sidebar.button.quick-terminal")}
          items={quick.terminalItems}
          onClick={quick.onTerminal}
        />
      ),
    browser:
      quick?.onBrowser === undefined ? null : (
        <QuickButton
          id="browser"
          icon={browserIcons.globe}
          label={t("left-sidebar.button.quick-browser")}
          items={quick.browserItems}
          onClick={quick.onBrowser}
        />
      ),
    app:
      quick?.onApp === undefined &&
      (quick?.appItems ?? []).length === 0 ? null : (
        <QuickButton
          id="app"
          icon={workspaceIcons.appPanel}
          label={t("left-sidebar.button.quick-app")}
          items={quick?.appItems}
          onClick={quick?.onApp}
        />
      ),
    search:
      quick?.onSearch === undefined ? null : (
        <QuickButton
          id="search"
          icon={shellIcons.search}
          label={t("left-sidebar.button.quick-search")}
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
          // 줄이 줄어 page가 사라지면 마지막 page를 보인다.
          const pageCount = Math.ceil(place.recent.length / RECENT_PAGE);
          const page = Math.min(
            pages.get(key) ?? 0,
            Math.max(pageCount - 1, 0),
          );
          const shown = place.recent.slice(
            page * RECENT_PAGE,
            (page + 1) * RECENT_PAGE,
          );
          return (
            <div key={key} className={styles.placeGroup} data-place={key}>
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
                place.ref.kind !== "home" &&
                onPlaceSettings !== undefined ? (
                  <span className={styles.placeSettings}>
                    <IconButton
                      icon={commonIcons.settings}
                      label={t(
                        place.ref.kind === "app"
                          ? "left-sidebar.button.app-detail"
                          : "left-sidebar.button.project-settings",
                      )}
                      size="sm"
                      data-place-settings=""
                      onClick={onPlaceSettings}
                    />
                  </span>
                ) : null}
                <span className={styles.placeNew} data-here={here || undefined}>
                  <IconButton
                    icon={shellIcons.add}
                    label={t("left-sidebar.button.new-session-in", {
                      place: place.name,
                    })}
                    size="sm"
                    data-place-new={key}
                    onClick={() => onNewSession(place.ref)}
                    onContextMenu={(event) => {
                      if (!here || newItems.length === 0) return;
                      event.preventDefault();
                      setNewMenu({ x: event.clientX, y: event.clientY });
                    }}
                  />
                </span>
              </div>
              {place.current.map((item) => {
                const itemKey = sessionKey(item);
                const actions =
                  here &&
                  item.kind !== "workflow" &&
                  (onRenameSession !== undefined ||
                    onStopSession !== undefined);
                // Stop 단추가 있는 줄은 점을 그 단추 안에 둔다(평소 점, hover하면 x).
                const row = (
                  <SessionRow
                    item={item}
                    selected={here && itemKey === selected}
                    recent={false}
                    dot={!actions || onStopSession === undefined}
                    onClick={() => onSession(place, item)}
                  />
                );
                if (!actions) return <Fragment key={itemKey}>{row}</Fragment>;
                if (renaming === itemKey) {
                  return (
                    <SessionRename
                      key={itemKey}
                      title={item.title}
                      onDone={(name) => {
                        setRenaming(null);
                        if (name !== null) onRenameSession?.(place, item, name);
                      }}
                    />
                  );
                }
                return (
                  <div
                    key={itemKey}
                    className={styles.sessionLine}
                    data-session-line={itemKey}
                  >
                    {row}
                    <span className={styles.sessionActions}>
                      {onRenameSession === undefined ? null : (
                        <button
                          type="button"
                          className={styles.sessionAction}
                          aria-label={t("left-sidebar.button.rename-session")}
                          data-session-rename=""
                          onClick={() => setRenaming(itemKey)}
                        >
                          <Icon icon={actionIcons.edit} pixels={14} />
                        </button>
                      )}
                      {onStopSession === undefined ? null : (
                        <button
                          type="button"
                          className={styles.sessionAction}
                          aria-label={t("left-sidebar.button.stop-session")}
                          data-session-stop=""
                          data-dot={item.dot === null ? undefined : ""}
                          onClick={() => onStopSession(place, item)}
                        >
                          {item.dot === null ? null : (
                            <TabStateDot
                              dot={item.dot}
                              className={styles.stopDot}
                            />
                          )}
                          <Icon
                            icon={shellIcons.close}
                            pixels={14}
                            className={styles.stopCross}
                          />
                        </button>
                      )}
                    </span>
                  </div>
                );
              })}
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
                ? shown.map((item) => (
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
              {open && pageCount > 1 ? (
                <div className={styles.pager} data-recent-pager={key}>
                  <IconButton
                    icon={sidebarIcons.previous}
                    label={t("left-sidebar.button.previous-page")}
                    size="sm"
                    disabled={page === 0}
                    onClick={() => turnPage(key, page - 1)}
                  />
                  <span className={styles.pagerText}>
                    {t("left-sidebar.label.recent-page", {
                      start: page * RECENT_PAGE + 1,
                      end: page * RECENT_PAGE + shown.length,
                      total: place.recent.length,
                    })}
                  </span>
                  <IconButton
                    icon={sidebarIcons.next}
                    label={t("left-sidebar.button.next-page")}
                    size="sm"
                    disabled={page >= pageCount - 1}
                    onClick={() => turnPage(key, page + 1)}
                  />
                </div>
              ) : null}
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

      {newMenu === null ? null : (
        <Menu
          open
          onOpenChange={(next) => {
            if (!next) setNewMenu(null);
          }}
          trigger={
            <span
              className={styles.menuAnchor}
              style={{ left: newMenu.x, top: newMenu.y }}
            />
          }
          items={newItems}
          onSelect={(id) => {
            const [kind, ...rest] = id.split(":");
            onNewSessionWith(kind as "lophn" | "coding", rest.join(":"));
            setNewMenu(null);
          }}
        />
      )}
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
