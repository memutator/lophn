// 왼쪽 sidebar. 위에 Inbox·Jobs·Agents, 아래에 workspace(Home, project, app)마다 줄 오른쪽 끝의 +(새 session. hover하면 agent 목록)와 열린 session과 접힌 Recent 줄 하나,
// 맨 아래에 빠른 실행(quick-launch.tsx)과 Settings다. 작업 표시줄이 켜져 있으면 둘 다 작업 표시줄로 가므로 `quick`과 `onSettings`를 주지 않고 맨 아래 줄이 없다.
// 값과 callback만 받아서 project 창 말고 Home과 app workspace도 같은 것을 쓴다.
// Workspaces 아래는 이 컴퓨터의 workspace이고, 그 밑에 다른 기계마다 접히는 묶음(머리에 기계 이름과 상태)이 그 기계의 Home, project,
// 앱을 든다. 다른 기계 묶음은 접힌 채 시작하고 이 창이 그 기계의 workspace를 보이면 펼친다. 꺼진 기계의 줄은 흐리고 열리지 않는다.
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
import {
  type PointerEvent,
  Fragment,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { AppTabIcon } from "../app-frame/app-icon.tsx";
import { useKeyLabel } from "../commands/react.tsx";
import { appPanelBindingId } from "../../../protocol/shell/keybindings.ts";
import { tabKindOf } from "../workspace/kinds/registry.ts";
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
import {
  AgentFaceIcon,
  type AgentChoice,
} from "../parts/agent-session/agent-session.tsx";
import {
  agentSections,
  type HoverSection,
  Keyed,
  sectionHeading,
} from "./agent-sections.tsx";
import { TabStateDot } from "../parts/tab-state-dot/tab-state-dot.tsx";
import { workspaceKey, type WorkspaceRef } from "./desk-model.ts";
import {
  type SidebarSession,
  type SidebarTab,
  type SidebarWorkspace,
  sessionKey,
  withChildren,
} from "./left-sidebar-model.ts";
import styles from "./left-sidebar.module.css";
import {
  HoverList,
  type QuickLaunch,
  QuickLaunchRow,
} from "./quick-launch.tsx";
import { useRemembered } from "./sidebar-memory.tsx";
import { HandSessionsContext } from "../workspace/hand.ts";

export interface LeftSidebarProps {
  workspaces: readonly SidebarWorkspace[];
  /** 이 창이 보이는 workspace. 그 줄이 강조된다. */
  current: WorkspaceRef;
  /** 고른 tab의 session 줄(`sessionKey`). 없으면 강조하지 않는다. */
  selected?: string;
  /** workspace 줄의 +에 hover하면 뜨는 agent(`agentSections`가 lophn agent와 coding agent 묶음으로 나눈다). */
  choices: (workspace: WorkspaceRef) => readonly AgentChoice[];
  /** workspace 줄의 +. 그 workspace의 lophn에서 새 session이다. 다른 workspace면 그 workspace로 가서 연다. */
  onNewSession: (workspace: WorkspaceRef) => void;
  /** + hover 목록에서 고른 agent로 그 workspace의 새 session이다. 다른 workspace면 그 workspace로 가서 연다. */
  onNewSessionWith: (choice: AgentChoice, workspace: WorkspaceRef) => void;
  /** Inbox 질문 카드의 [Open session]. */
  onOpenSession: (session: string) => void;
  /** Jobs overlay의 통로. 없으면 Jobs 줄이 바로 Jobs 탭을 연다. */
  jobs?: JobsSource;
  /** Inbox·Jobs overlay의 [Open in tab]과 Jobs 줄(통로가 없을 때): 그 탭을 연다. */
  onInbox: () => void;
  onJobs: () => void;
  /** Agents 줄: 지금 workspace의 Agents 탭을 연다. 없으면 Agents 줄이 없다. */
  onAgents?: () => void;
  /** workspace 줄 누르기. 앱 줄이면 그 앱 화면 탭으로 간다. */
  onWorkspace: (ref: WorkspaceRef) => void;
  onSession: (workspace: SidebarWorkspace, session: SidebarSession) => void;
  /** 펼친 session 줄 아래의 탭 줄 누르기. 그 탭으로 간다(접힌 float이면 편다). */
  onSessionTab?: (tab: SidebarTab) => void;
  /** Recent 줄을 목록에서 지운다. 주지 않으면 menu가 없다. */
  onRemoveRecent?: (
    workspace: SidebarWorkspace,
    session: SidebarSession,
  ) => void;
  /** Workspaces의 + menu 항목. 둘 다 없으면 +가 없다. */
  onRegisterProject?: () => void;
  onCreateApp?: () => void;
  quick?: QuickLaunch;
  /** `actions`가 있는 current 줄에 hover하면 연필이 뜬다. 누르면 줄이 이름 칸이 된다. */
  onRenameSession?: (
    workspace: SidebarWorkspace,
    session: SidebarSession,
    title: string,
  ) => void;
  /** 같은 줄의 x. 도는 turn을 멈추고 탭을 닫아 Recent로 보낸다. */
  onStopSession?: (
    workspace: SidebarWorkspace,
    session: SidebarSession,
  ) => void;
  /** project·앱 줄 오른쪽 끝에 설정 단추를 둔다. hover와 focus 때만 보인다. project는 Project settings, 앱은 App details이고 다른 workspace면 그 workspace로 가서 연다. Home 줄에는 없다. */
  onWorkspaceSettings?: (workspace: WorkspaceRef) => void;
  /** 없으면 Settings 단추가 없다. */
  onSettings?: () => void;
  /** 기계 id → 명단의 이름. 줄 끝 꼬리표가 쓴다. */
  machineNames?: ReadonlyMap<string, string>;
  /** 올려야 해서 못 붙는 기계 id → 올릴 쪽(client는 이 컴퓨터, host는 그 기계). 꺼진 줄이 "Off" 대신 이유를 쓴다. */
  machineUpdates?: ReadonlyMap<string, "client" | "host">;
  /** workspace 줄의 오른쪽 클릭 menu 항목. 비면 menu가 없다. */
  workspaceMenu?: (workspace: SidebarWorkspace) => readonly MenuItem[];
  onWorkspaceMenu?: (workspace: SidebarWorkspace, id: string) => void;
  /** workspace 줄 아래 한 줄(menu에서 시작한 clone의 진행과 결과). */
  renderNote?: (workspace: SidebarWorkspace) => ReactNode;
  /**
   * 줄을 누른 채 끌기 시작. 탭 줄과 같은 pointer 끌기(tab-drag.tsx)라 화면(탭 줄, 칸)이나 다른 workspace 줄(`data-drop-workspace`)에
   * 놓는다. 없으면 줄을 끌 수 없다.
   */
  onRowDrag?: (
    event: PointerEvent<HTMLElement>,
    workspace: SidebarWorkspace,
    item: SidebarSession,
  ) => void;
}

const WORKSPACE_ICON = {
  home: sidebarIcons.home,
  project: sidebarIcons.project,
  app: shellIcons.app,
} as const satisfies Record<WorkspaceRef["kind"], LucideIcon>;

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
  return agent.kind === "workflow" ? (
    <Icon icon={shellIcons.workflow} pixels={14} />
  ) : (
    <AgentFaceIcon face={agent} />
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

/** 줄 끝의 기계 꼬리표. Workspaces panel의 줄도 쓴다. */
export function MachineTag({ name }: { name: string | undefined }) {
  return name === undefined ? null : (
    <span className={styles.machineTag} data-machine-tag="">
      {name}
    </span>
  );
}

function SessionRow({
  item,
  selected,
  recent,
  onClick,
  onMenu,
  dot = true,
  machineName,
  onDragStart,
  dropSession,
}: {
  item: SidebarSession;
  selected: boolean;
  recent: boolean;
  onClick: () => void;
  onMenu?: (at: { x: number; y: number }) => void;
  /** false면 줄 끝 점을 그리지 않는다. 점은 줄 밖의 Stop 단추가 대신 보인다. */
  dot?: boolean;
  machineName?: string;
  onDragStart?: (event: PointerEvent<HTMLButtonElement>) => void;
  /** 끄는 browser 탭을 이 줄에 놓으면 이 session에 넘긴다(tab-drag.tsx). 이 컴퓨터의 열린 lophn session 줄만이다(hand.ts). */
  dropSession?: string;
}) {
  return (
    <button
      type="button"
      className={styles.sessionRow}
      onPointerDown={onDragStart}
      data-drop-session={dropSession}
      disabled={item.offline}
      data-offline={item.offline}
      data-machine={item.machine}
      data-recent={recent || undefined}
      data-session={item.kind === "session" ? item.ref : undefined}
      data-terminal={item.kind === "terminal" ? item.ref : undefined}
      data-draft={item.kind === "draft" ? item.ref : undefined}
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
      <MachineTag name={machineName} />
      {recent && item.at > 0 ? (
        <span className={styles.rowMeta}>{ageOf(item.at)}</span>
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
  workspaces,
  current,
  selected,
  choices,
  onNewSession,
  onNewSessionWith,
  onOpenSession,
  jobs,
  onInbox,
  onJobs,
  onAgents,
  onWorkspace,
  onSession,
  onSessionTab,
  onRemoveRecent,
  onRegisterProject,
  onCreateApp,
  quick,
  onRenameSession,
  onStopSession,
  onWorkspaceSettings,
  onSettings,
  machineNames,
  machineUpdates,
  workspaceMenu,
  onWorkspaceMenu,
  renderNote,
  onRowDrag,
}: LeftSidebarProps) {
  const nameOf = (machine: string | undefined) =>
    machine === undefined ? undefined : (machineNames?.get(machine) ?? "");
  const offlineLabel = (machine: string | undefined) => {
    const update =
      machine === undefined ? undefined : machineUpdates?.get(machine);
    if (update === undefined) return t("left-sidebar.label.off");
    return update === "client"
      ? t("machine-update.viewer.status-desktop-client")
      : t("machine-update.viewer.status-host", { name: nameOf(machine) ?? "" });
  };
  const keyLabel = useKeyLabel();
  const newSessionKeys = keyLabel("new.agent");
  // 이름 칸이 열린 current 줄(`sessionKey`). 저장하지 않는다.
  const [renaming, setRenaming] = useState<string | null>(null);
  // 펼친 Recent와 그 page는 workspace를 옮겨도 창 메모리에 기억한다. 저장하지 않는다.
  const [expanded, setExpanded] = useRemembered("recentExpanded");
  const [pages, setPages] = useRemembered("recentPages");
  const turnPage = (key: string, page: number) =>
    setPages((all) => new Map(all).set(key, page));
  const toggle = (key: string) =>
    setExpanded((all) => {
      const next = new Set(all);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  // 탭 줄을 펼친 session. 창 메모리에 둔다.
  const [tabsExpanded, setTabsExpanded] = useRemembered("sessionTabsOpen");
  const toggleSessionTabs = (session: string) =>
    setTabsExpanded((all) => {
      const next = new Set(all);
      if (!next.delete(session)) next.add(session);
      return next;
    });
  // 펼친 다른 기계 묶음. 창 메모리에 둔다.
  const [machinesOpen, setMachinesOpen] = useRemembered("machinesOpen");
  const toggleMachine = (machine: string) =>
    setMachinesOpen((all) => {
      const next = new Set(all);
      if (!next.delete(machine)) next.add(machine);
      return next;
    });
  const [rowMenu, setRowMenu] = useState<{
    readonly workspace: SidebarWorkspace;
    readonly items: readonly MenuItem[];
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const [menu, setMenu] = useState<{
    readonly workspace: SidebarWorkspace;
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
  const currentKey = workspaceKey(current);

  const dragFrom =
    (workspace: SidebarWorkspace, item: SidebarSession) =>
    (event: PointerEvent<HTMLButtonElement>) =>
      onRowDrag?.(event, workspace, item);
  // 끄는 browser 탭을 놓을 수 있는 session(이 컴퓨터의 열린 lophn session). 다른 기계의 줄과 끝난 줄은 놓을 자리가 아니다.
  const handSessions = useContext(HandSessionsContext);
  const canDrag = (item: SidebarSession) =>
    onRowDrag !== undefined &&
    item.kind !== "workflow" &&
    item.offline !== true;
  // current 줄 하나와, 펼쳤으면 그 session의 탭 줄, 그 아래 팀 자식 줄(한 단계 들여쓴다).
  const renderItem = (
    workspace: SidebarWorkspace,
    here: boolean,
    item: SidebarSession,
  ): ReactElement => {
    const itemKey = sessionKey(item);
    const actions =
      item.actions &&
      (onRenameSession !== undefined || onStopSession !== undefined);
    const tabs = item.tabs ?? [];
    const tabsOpen = tabs.length > 0 && tabsExpanded.has(item.ref);
    // Stop 단추가 있는 줄은 점을 그 단추 안에 둔다(평소 점, hover하면 x).
    const row = (
      <SessionRow
        item={item}
        selected={here && itemKey === selected}
        recent={false}
        dot={!actions || onStopSession === undefined}
        machineName={nameOf(item.machine)}
        onClick={() => onSession(workspace, item)}
        {...(canDrag(item) ? { onDragStart: dragFrom(workspace, item) } : {})}
        {...(item.kind === "session" && handSessions?.has(item.ref) === true
          ? { dropSession: item.ref }
          : {})}
      />
    );
    const toggleTabs =
      tabs.length === 0 ? null : (
        <button
          type="button"
          className={styles.tabsToggle}
          aria-expanded={tabsOpen}
          aria-label={t(
            tabsOpen
              ? "left-sidebar.button.session-tabs-hide"
              : "left-sidebar.button.session-tabs-show",
          )}
          data-session-tabs-toggle={item.ref}
          onClick={() => toggleSessionTabs(item.ref)}
        >
          <Icon
            icon={tabsOpen ? shellIcons.expand : sidebarIcons.collapsed}
            pixels={12}
          />
        </button>
      );
    let line: ReactElement;
    if (actions && renaming === itemKey) {
      line = (
        <SessionRename
          title={item.title}
          onDone={(name) => {
            setRenaming(null);
            if (name !== null) onRenameSession?.(workspace, item, name);
          }}
        />
      );
    } else if (actions) {
      line = (
        <div className={styles.sessionLine} data-session-line={itemKey}>
          {toggleTabs}
          {row}
          <span className={styles.rowActions}>
            {onRenameSession === undefined ||
            item.kind === "draft" ||
            item.noRename === true ? null : (
              <button
                type="button"
                className={styles.rowAction}
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
                className={styles.rowAction}
                aria-label={t("left-sidebar.button.stop-session")}
                data-session-stop=""
                data-dot={item.dot === null ? undefined : ""}
                onClick={() => onStopSession(workspace, item)}
              >
                {item.dot === null ? null : (
                  <TabStateDot dot={item.dot} className={styles.stopDot} />
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
    } else if (toggleTabs !== null) {
      line = (
        <div className={styles.treeLine}>
          {toggleTabs}
          {row}
        </div>
      );
    } else line = row;
    return (
      <Fragment key={itemKey}>
        {line}
        {tabsOpen ? (
          <div className={styles.sessionTabs} data-session-tabs={item.ref}>
            {tabs.map((tab) => (
              <button
                key={`${workspaceKey(tab.workspace)}\0${tab.key}`}
                type="button"
                className={styles.tabRow}
                data-owned-tab={tab.key}
                data-place={tab.place}
                onClick={() => onSessionTab?.(tab)}
              >
                <span className={styles.rowIcon}>
                  <Icon
                    icon={tabKindOf(tab.kind)?.icon ?? shellIcons.app}
                    pixels={14}
                  />
                </span>
                <span className={styles.rowLabel}>{tab.title}</span>
              </button>
            ))}
          </div>
        ) : null}
        {item.children === undefined ? null : (
          <div className={styles.teamChildren} data-team-children={item.ref}>
            {item.children.map((child) => renderItem(workspace, here, child))}
          </div>
        )}
      </Fragment>
    );
  };
  const renderWorkspace = (workspace: SidebarWorkspace) => {
    const key = workspaceKey(workspace.ref);
    const here = key === currentKey;
    const open = expanded.has(key);
    // 줄이 줄어 page가 사라지면 마지막 page를 보인다.
    const pageCount = Math.ceil(workspace.recent.length / RECENT_PAGE);
    const page = Math.min(pages.get(key) ?? 0, Math.max(pageCount - 1, 0));
    const shown = workspace.recent.slice(
      page * RECENT_PAGE,
      (page + 1) * RECENT_PAGE,
    );
    return (
      <div
        key={key}
        className={styles.workspaceGroup}
        data-workspace={key}
        data-offline={workspace.offline}
      >
        <div
          className={styles.workspaceHead}
          {...(workspace.offline ? {} : { "data-drop-workspace": key })}
        >
          <button
            type="button"
            className={styles.workspaceRow}
            data-current={here || undefined}
            aria-current={here || undefined}
            disabled={workspace.offline}
            onClick={() => onWorkspace(workspace.ref)}
            onContextMenu={(event) => {
              const items = workspaceMenu?.(workspace) ?? [];
              if (items.length === 0) return;
              event.preventDefault();
              setRowMenu({
                workspace,
                items,
                x: event.clientX,
                y: event.clientY,
              });
            }}
          >
            {workspace.ref.kind === "app" ? (
              <AppTabIcon
                app={workspace.ref.id}
                machine={workspace.ref.machine ?? null}
                pixels={16}
                fallback={WORKSPACE_ICON.app}
              />
            ) : (
              <Icon icon={WORKSPACE_ICON[workspace.ref.kind]} pixels={16} />
            )}
            {/* 기계는 묶음 머리가 말한다. 묶음 안의 Home은 그냥 Home이다. */}
            <span className={styles.rowLabel}>
              {workspace.ref.kind === "home"
                ? t("left-sidebar.label.home")
                : workspace.name}
            </span>
          </button>
          {/* Project settings는 이 컴퓨터만, App details는 다른 기계의 앱도 연다(오프라인 제외). */}
          {((workspace.ref.kind === "project" &&
            workspace.ref.machine === undefined) ||
            (workspace.ref.kind === "app" && !workspace.offline)) &&
          onWorkspaceSettings !== undefined ? (
            <span className={styles.workspaceSettings}>
              <button
                type="button"
                className={styles.rowAction}
                aria-label={t(
                  workspace.ref.kind === "app"
                    ? "left-sidebar.button.app-detail"
                    : "left-sidebar.button.project-settings",
                )}
                data-workspace-settings=""
                onClick={() => onWorkspaceSettings(workspace.ref)}
              >
                <Icon icon={commonIcons.settings} pixels={14} />
              </button>
            </span>
          ) : null}
          {workspace.offline ? null : (
            <span className={styles.workspaceNew} data-here={here || undefined}>
              <HoverList
                id="new-session"
                sections={agentSections(
                  choices(workspace.ref),
                  newSessionKeys,
                  (choice) => onNewSessionWith(choice, workspace.ref),
                )}
                tip={
                  here && newSessionKeys !== null ? (
                    <Keyed
                      label={t("left-sidebar.button.new-session-in", {
                        workspace: workspace.name,
                      })}
                      keys={newSessionKeys}
                    />
                  ) : null
                }
                trigger={
                  <button
                    type="button"
                    className={styles.rowAction}
                    aria-label={t("left-sidebar.button.new-session-in", {
                      workspace: workspace.name,
                    })}
                    data-workspace-new={key}
                    onClick={() => onNewSession(workspace.ref)}
                  >
                    <Icon icon={shellIcons.add} pixels={14} />
                  </button>
                }
              />
            </span>
          )}
        </div>
        {renderNote?.(workspace)}
        {workspace.current.map((group) => (
          <Fragment key={group.desk?.key ?? ""}>
            {/* desk를 하나만 쓰면 지금처럼 줄만 둔다. */}
            {workspace.current.length < 2 ? null : (
              <div
                className={styles.deskHead}
                data-sidebar-desk={group.desk?.key ?? ""}
              >
                {group.desk?.label}
              </div>
            )}
            {group.items.map((item) => renderItem(workspace, here, item))}
          </Fragment>
        ))}
        {workspace.recent.length === 0 ? null : (
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
            <span className={styles.rowMeta}>{workspace.recent.length}</span>
          </button>
        )}
        {open
          ? shown.map((item) => (
              <SessionRow
                key={sessionKey(item)}
                item={item}
                selected={here && sessionKey(item) === selected}
                recent
                machineName={nameOf(item.machine)}
                onClick={() => onSession(workspace, item)}
                {...(canDrag(item)
                  ? { onDragStart: dragFrom(workspace, item) }
                  : {})}
                onMenu={
                  onRemoveRecent === undefined || item.kind === "workflow"
                    ? undefined
                    : (at) => setMenu({ workspace, item, ...at })
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
                total: workspace.recent.length,
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
  };
  // 이 컴퓨터의 줄과 다른 기계마다의 줄. 줄의 순서(기계마다 Home, project, 앱)는 그대로다.
  const mine = workspaces.filter((row) => row.ref.machine === undefined);
  const machineGroups: { machine: string; rows: SidebarWorkspace[] }[] = [];
  for (const row of workspaces) {
    const machine = row.ref.machine;
    if (machine === undefined) continue;
    const group = machineGroups.find((one) => one.machine === machine);
    if (group === undefined) machineGroups.push({ machine, rows: [row] });
    else group.rows.push(row);
  }

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
        {onAgents === undefined ? null : (
          <NavRow
            icon={commonIcons.agents}
            label={t("left-sidebar.button.agents")}
            onClick={onAgents}
            data-nav="agents"
          />
        )}
      </div>

      <div className={styles.sectionHead}>
        <span>{t("left-sidebar.heading.workspaces")}</span>
        <span className={styles.grow} />
        {addItems.length === 0 ? null : (
          <Menu
            items={addItems}
            onSelect={(id) =>
              (id === "project" ? onRegisterProject : onCreateApp)?.()
            }
            trigger={
              <button
                type="button"
                className={styles.rowAction}
                aria-label={t("left-sidebar.button.add-workspace")}
                data-add-workspace=""
              >
                <Icon icon={shellIcons.add} pixels={14} />
              </button>
            }
          />
        )}
      </div>

      <div className={styles.workspaceList}>
        {mine.map(renderWorkspace)}
        {machineGroups.map(({ machine, rows }) => {
          const open = machinesOpen.has(machine) || machine === current.machine;
          const off = rows.every((row) => row.offline === true);
          const running = rows.reduce(
            (count, row) =>
              count +
              row.current.reduce(
                (all, group) => all + group.items.flatMap(withChildren).length,
                0,
              ),
            0,
          );
          return (
            <div
              key={machine}
              className={styles.machineGroup}
              data-machine-group={machine}
              data-offline={off || undefined}
            >
              <button
                type="button"
                className={styles.machineHead}
                aria-expanded={open}
                data-machine-toggle={machine}
                onClick={() => toggleMachine(machine)}
              >
                <Icon
                  icon={open ? shellIcons.expand : sidebarIcons.collapsed}
                  pixels={12}
                />
                <Icon icon={sidebarIcons.machine} pixels={14} />
                <span className={styles.rowLabel}>{nameOf(machine)}</span>
                {off ? (
                  <span className={styles.rowMeta} data-offline-label="">
                    {offlineLabel(machine)}
                  </span>
                ) : !open && running > 0 ? (
                  <span className={styles.rowMeta}>{running}</span>
                ) : null}
              </button>
              {open ? rows.map(renderWorkspace) : null}
            </div>
          );
        })}
      </div>

      {quick === undefined && onSettings === undefined ? null : (
        <div className={styles.foot}>
          <QuickLaunchRow quick={quick} />
          <span className={styles.grow} />
          {onSettings === undefined ? null : (
            <IconButton
              icon={settingsEntryIcon}
              label={t("left-sidebar.button.settings")}
              size="sm"
              data-nav="settings"
              onClick={onSettings}
            />
          )}
        </div>
      )}

      {rowMenu === null ? null : (
        <Menu
          open
          onOpenChange={(next) => {
            if (!next) setRowMenu(null);
          }}
          trigger={
            <span
              className={styles.menuAnchor}
              style={{ left: rowMenu.x, top: rowMenu.y }}
            />
          }
          items={[...rowMenu.items]}
          onSelect={(id) => {
            onWorkspaceMenu?.(rowMenu.workspace, id);
            setRowMenu(null);
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
            onRemoveRecent?.(menu.workspace, menu.item);
            setMenu(null);
          }}
        />
      )}
    </div>
  );
}
