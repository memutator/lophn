// The sidebar: the desktop's list on the phone with every paired computer in it (tools/wireframes/drafts/phone/shell.tsx
// SidebarBody). The filter (every computer, or one), Inbox, Jobs, Agents and Pages of the computer on screen, then each
// computer's workspaces with their sessions, and Settings at the bottom. While more than one computer shows, a workspace
// line says its computer and each computer's Home is "Home · <computer>". A computer that is not reached is one line, its
// name and state, with the apps that run on this phone under it. A line opens on its own computer.
import { t } from "@lophn/i18n";
import {
  Badge,
  ComputerPicker,
  Dot,
  Icon,
  IconButton,
  NavRow,
  SessionRow,
  SidebarFoot,
  SidebarHead,
  SidebarLabel,
  SidebarList,
  Text,
  WorkspaceRow,
  WorktreeLabel,
} from "@lophn/ui-native";
import type { DrawerContentComponentProps } from "@react-navigation/drawer";
import { StackActions } from "@react-navigation/native";
import {
  Bell,
  ChevronDown,
  ChevronRight,
  Clock,
  Globe,
  Monitor,
  Plus,
  Search,
  Settings,
  Users,
} from "lucide-react-native";
import { Fragment, type ReactNode, useContext, useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { lophnIdOf } from "../../../protocol/lophn-agent/workspaces.ts";
import {
  type CodingSession,
  type ComputerItem,
  type ComputerLines,
  ComputerScope,
  type PhoneLine,
  useComputers,
  useEveryComputer,
  useInbox,
  type WorkspaceView,
} from "../data/mod.ts";
import { Character, Face, LOPHN, SESSION_DOT, WorkspaceMark } from "../parts/mod.ts";
import { codingPlace, codingTitle, harnessProfile, stateOf as codingState, TerminalMark } from "../screens/coding/parts.tsx";
import { NewAppSheet } from "../screens/home/new-app.tsx";
import { filterStateOf, stateOf } from "./computer-state.ts";
import { FrameContext, type Place, paramsOf } from "./nav.ts";

type Shown = { name: string; params?: Record<string, unknown> };

// The sidebar line a screen belongs to: a place opened from another lights up the line it came from. A screen is always
// of the computer on screen, so the workspace and session lines carry that computer's key.
function lineOf(shown: Shown, computer: string | null): string {
  const params = shown.params ?? {};
  switch (shown.name) {
    case "app-update":
      return "inbox";
    case "job":
      return "jobs";
    case "agent":
      return "agents";
    case "page":
      return "pages";
    case "computer":
    case "appearance":
    case "notifications":
    case "gallery":
      return "settings";
    case "home":
      return `home:${computer}`;
    case "workspace":
      return `workspace:${computer}:${(params.workspace as { id: string }).id}`;
    case "workflow-run":
    case "file":
      return `workspace:${computer}:${params.project as string}`;
    case "app-activity":
      return `workspace:${computer}:${params.app as string}`;
    case "app":
      return `workspace:${computer}:${params.id as string}`;
    case "session":
    case "terminal":
      return `session:${computer}:${params.session as string}`;
    case "diff":
      return `session:${computer}:${(params.session as { session: string }).session}`;
    default:
      return shown.name;
  }
}

/** Shows a place of a computer, switching to it first: the stack is Home and the place. */
type Show = (place: Place, computer?: string) => void;

export function Sidebar({ state, navigation }: DrawerContentComponentProps) {
  const frame = useContext(FrameContext);
  const insets = useSafeAreaInsets();
  const { computers, disputed, current, select } = useComputers();
  const { shown, many, filter } = useEveryComputer();
  const { count } = useInbox();
  const [creatingApp, setCreatingApp] = useState(false);
  const here = computers.find((one) => one.key === current) ?? null;
  // The filter's computer, or the only one: the filter row shows it as the computer row did.
  const one =
    computers.find((each) => each.key === filter) ??
    (computers.length === 1 ? computers[0]! : null);
  const filterState =
    one === null
      ? filterStateOf(computers)
      : stateOf(one, disputed.has(one.key));

  const stack = state.routes[0]?.state;
  const top = (stack?.routes[stack.index ?? 0] as Shown | undefined) ?? {
    name: "home",
  };
  const on = lineOf(top, current);

  const show: Show = (place, computer) => {
    if (computer !== undefined && computer !== current) select(computer);
    frame.stack.current?.reset({
      index: place.name === "home" ? 0 : 1,
      routes: [
        { name: "home" },
        ...(place.name === "home"
          ? []
          : [{ name: place.name, params: paramsOf(place) }]),
      ],
    });
    if (!frame.wide) navigation.closeDrawer();
  };
  const open: Show = (place, computer) => {
    if (computer !== undefined && computer !== current) return show(place, computer);
    frame.stack.current?.dispatch(
      StackActions.push(place.name, paramsOf(place)),
    );
    if (!frame.wide) navigation.closeDrawer();
  };

  return (
    <View
      style={{
        flex: 1,
        paddingTop: insets.top + (frame.wide ? 10 : 0),
        paddingBottom: insets.bottom,
        paddingLeft: insets.left,
      }}
    >
      <SidebarHead
        lead={<Character profile={LOPHN} size={26} />}
        title={t("mobile.frame.label.brand")}
        right={
          <IconButton
            icon={Search}
            label={t("left-sidebar.button.quick-search")}
            tone="muted"
            size={20}
            onPress={() => open({ name: "search" })}
          />
        }
      />
      <ComputerPicker
        icon={Monitor}
        name={one?.name ?? t("mobile.computer.filter.all")}
        state={filterState.text}
        tone={filterState.tone ?? "off"}
        onPress={frame.openComputers}
      />
      <SidebarList>
        {many && here !== null && <SidebarLabel>{here.name}</SidebarLabel>}
        <NavRow
          icon={Bell}
          label={t("left-sidebar.button.inbox")}
          end={count > 0 ? <Badge count={count} /> : undefined}
          on={on === "inbox"}
          onPress={() => show({ name: "inbox" })}
        />
        <NavRow
          icon={Clock}
          label={t("left-sidebar.button.jobs")}
          on={on === "jobs"}
          onPress={() => show({ name: "jobs" })}
        />
        <NavRow
          icon={Users}
          label={t("left-sidebar.button.agents")}
          on={on === "agents"}
          onPress={() => show({ name: "agents" })}
        />
        <NavRow
          icon={Globe}
          label={t("mobile.page.title")}
          on={on === "pages"}
          onPress={() => show({ name: "pages" })}
        />
        <SidebarLabel
          end={
            <IconButton
              icon={Plus}
              label={t("left-sidebar.label.new-session")}
              tone="muted"
              size={18}
              onPress={() => open({ name: "new-session" })}
            />
          }
        >
          {t("left-sidebar.heading.workspaces")}
        </SidebarLabel>
        {shown.some((lines) => lines.computer.status === "connected") && (
          <NavRow
            icon={Plus}
            label={t("home.button.new-app")}
            on={false}
            onPress={() => setCreatingApp(true)}
          />
        )}
        {shown.map((lines) => (
          // The scope gives the workspace marks this computer's kept icons.
          <ComputerScope key={lines.computer.key} computer={lines.computer.key}>
            <ComputerBlock lines={lines} many={many} on={on} show={show} open={open} />
          </ComputerScope>
        ))}
      </SidebarList>
      <NewAppSheet
        open={creatingApp}
        onClose={() => setCreatingApp(false)}
        onCreate={(text) => {
          const target =
            shown.find((lines) => lines.computer.key === current && lines.computer.status === "connected")?.computer.key ??
            shown.find((lines) => lines.computer.status === "connected")?.computer.key;
          if (target !== undefined) open({ name: "new-session", workspace: null, text }, target);
        }}
      />
      <SidebarFoot>
        <NavRow
          icon={Settings}
          label={t("left-sidebar.button.settings")}
          on={on === "settings"}
          onPress={() => show({ name: "settings" })}
        />
      </SidebarFoot>
    </View>
  );
}

/** One computer's lines: its workspaces while it is reached (or reaching), else its name and state and its phone apps. */
function ComputerBlock({
  lines,
  many,
  on,
  show,
  open,
}: {
  lines: ComputerLines;
  many: boolean;
  on: string;
  show: Show;
  open: Show;
}) {
  const { setFilter } = useEveryComputer();
  const { computer } = lines;
  const away = computer.status !== "connected" && computer.status !== "connecting";
  const workspaces = away
    ? lines.workspaces.filter((one) => one.kind === "app" && lines.installed.has(one.key))
    : lines.workspaces;
  return (
    <>
      {away && (
        <Away
          computer={computer}
          on={on === `home:${computer.key}`}
          onPress={() => {
            // Its Home says why it is away and has Try again.
            setFilter(computer.key);
            show({ name: "home" }, computer.key);
          }}
        />
      )}
      {workspaces.map((workspace) => (
        <Workspace
          key={workspace.key}
          computer={computer}
          many={many}
          workspace={workspace}
          phone={lines.phone.get(workspace.key)}
          coding={lines.coding.filter((one) => one.project === workspace.key)}
          on={on}
          show={show}
          open={open}
        />
      ))}
    </>
  );
}

/** A computer that is not reached, in place of its workspaces. */
function Away({
  computer,
  on,
  onPress,
}: {
  computer: ComputerItem;
  on: boolean;
  onPress: () => void;
}) {
  const { disputed } = useComputers();
  const state = stateOf(computer, disputed.has(computer.key));
  return (
    <WorkspaceRow
      lead={<Icon icon={Monitor} size={19} />}
      label={computer.name}
      on={on}
      end={
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Dot tone={state.tone ?? "off"} />
          <Tag>{state.text}</Tag>
        </View>
      }
      onPress={onPress}
    />
  );
}

/** The computer a line is of, at its end. */
function Tag({ children }: { children: string }) {
  return (
    <Text variant="caption" tone="muted" numberOfLines={1} style={{ maxWidth: 96 }}>
      {children}
    </Text>
  );
}

function Workspace({
  computer,
  many,
  workspace,
  phone,
  coding,
  on,
  show,
  open,
}: {
  computer: ComputerItem;
  /** More than one computer shows: the line says its computer. */
  many: boolean;
  workspace: WorkspaceView;
  /** An app with a phone screen or on this phone: its line opens the screen, or the running preview when only the
   * preview has one. */
  phone: PhoneLine | undefined;
  /** The project's running coding sessions on the computer. */
  coding: readonly CodingSession[];
  on: string;
  show: Show;
  open: Show;
}) {
  const { key } = computer;
  const home = workspace.workspace === null;
  const name = workspace.name ?? t("left-sidebar.label.home");
  const place: Place =
    workspace.workspace === null
      ? { name: "home" }
      : phone === undefined
        ? { name: "workspace", workspace: workspace.workspace }
        : phone === "preview"
          ? { name: "app", id: workspace.key, preview: true }
          : { name: "app", id: workspace.key };
  const line = home ? `home:${key}` : `workspace:${key}:${workspace.key}`;
  // The desktop keeps the rest of the last 7 days under a folded Recent of the workspace on screen only.
  const here =
    on === line ||
    [...workspace.groups.flatMap((group) => group.rows), ...workspace.recent].some(
      (row) => on === `session:${key}:${row.id}`,
    );
  const [recentOpen, setRecentOpen] = useState(false);
  const sessionRow = (row: WorkspaceView["recent"][number]) => (
    <SessionRow
      key={row.id}
      face={<Face profile={row.who?.profile ?? LOPHN} size={20} />}
      title={row.title ?? t("left-sidebar.label.untitled")}
      tone={SESSION_DOT[row.status]}
      on={on === `session:${key}:${row.id}`}
      onPress={() =>
        show(
          {
            name: "session",
            session: row.id,
            // A session's agent is known once its first event arrives; until then it is its workspace's lophn.
            agent: row.agent ?? lophnIdOf(row.workspace),
            workspace: row.workspace,
          },
          key,
        )
      }
    />
  );
  const label =
    phone === "preview"
      ? t("mobile.drive.list.app", { name })
      : home && many
        ? t("mobile.computer.label.home-on", { computer: computer.name })
        : name;
  const plus: ReactNode = (
    <IconButton
      icon={Plus}
      label={t("left-sidebar.label.new-session")}
      tone="muted"
      size={18}
      onPress={() =>
        open({ name: "new-session", ...(workspace.workspace === null ? {} : { workspace: workspace.workspace }) }, key)
      }
    />
  );
  // The desktop puts a project's terminal sessions after its lophn sessions; the phone does not know their desk, so they
  // follow the first group that is not a named desk (no label, or Main), or come first when every group is a desk.
  const after = coding.length === 0 ? -1 : workspace.groups.findIndex((group) => group.label === null || group.label === "Main");
  return (
    <>
      <WorkspaceRow
        lead={<WorkspaceMark icon={workspace.icon} name={name} />}
        label={label}
        on={on === line}
        end={
          many && !home ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Tag>{computer.name}</Tag>
              {plus}
            </View>
          ) : (
            plus
          )
        }
        onPress={() => show(place, key)}
      />
      {coding.length > 0 && after === -1 && <CodingLines computer={key} sessions={coding} on={on} show={show} />}
      {workspace.groups.map((group, at) => (
        <Fragment key={group.label ?? ""}>
          {group.label !== null && <WorktreeLabel>{group.label}</WorktreeLabel>}
          {group.rows.map(sessionRow)}
          {at === after && <CodingLines computer={key} sessions={coding} on={on} show={show} />}
        </Fragment>
      ))}
      {here && workspace.recent.length > 0 && (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: recentOpen }}
            onPress={() => setRecentOpen((open) => !open)}
            style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 34, paddingVertical: 6 }}
          >
            <Icon icon={recentOpen ? ChevronDown : ChevronRight} size={14} />
            <Text variant="caption" tone="muted">
              {`${t("left-sidebar.label.recent")} · ${workspace.recent.length}`}
            </Text>
          </Pressable>
          {recentOpen && workspace.recent.map(sessionRow)}
        </>
      )}
    </>
  );
}

/** A project's running coding sessions, in the desktop's order (by session id, the terminal tab's id). They look as they
 * do on the project screen: same face, title, state dot and Terminal mark. */
function CodingLines({
  computer,
  sessions,
  on,
  show,
}: {
  computer: string;
  sessions: readonly CodingSession[];
  on: string;
  show: Show;
}) {
  return [...sessions]
    .sort((a, b) => (a.session < b.session ? -1 : a.session > b.session ? 1 : 0))
    .map((session) => (
      <SessionRow
        key={session.session}
        face={<Face profile={harnessProfile(session.harness, session.label)} size={20} />}
        title={codingTitle(session)}
        mark={session.view === "tui" ? <TerminalMark /> : undefined}
        tone={codingState(session).tone}
        on={on === `session:${computer}:${session.session}`}
        onPress={() => show(codingPlace(session), computer)}
      />
    ));
}
