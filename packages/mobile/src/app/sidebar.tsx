// The sidebar: the desktop's list on the phone (tools/wireframes/drafts/phone/shell.tsx SidebarBody; the Pages line is
// page.tsx). The computer it belongs to, Inbox, Jobs, Agents, its browser Pages, then every workspace with its sessions,
// and Settings at the bottom.
import { t } from "@lophn/i18n";
import {
  Badge,
  ComputerPicker,
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
import { Fragment, useContext, useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { lophnIdOf } from "../../../protocol/lophn-agent/workspaces.ts";
import {
  installedOf,
  type CodingSession,
  useCodingSessions,
  useCurrentComputer,
  useInbox,
  useKeepLists,
  useLocalApps,
  previewOnly,
  usePhoneApps,
  useWithSavedLists,
  useWorkspaces,
  withLocalApps,
  type WorkspaceView,
} from "../data/mod.ts";
import { Character, Face, LOPHN, SESSION_DOT, WorkspaceMark } from "../parts/mod.ts";
import { codingPlace, codingTitle, harnessProfile, stateOf as codingState, TerminalMark } from "../screens/coding/parts.tsx";
import { stateOf } from "./computer-state.ts";
import { FrameContext, type Place, paramsOf } from "./nav.ts";

type Shown = { name: string; params?: Record<string, unknown> };

// The sidebar line a screen belongs to: a place opened from another lights up the line it came from.
function lineOf(shown: Shown): string {
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
    case "workspace":
      return `workspace:${(params.workspace as { id: string }).id}`;
    case "workflow-run":
    case "file":
      return `workspace:${params.project as string}`;
    case "app-activity":
      return `workspace:${params.app as string}`;
    case "app":
      return `workspace:${params.id as string}`;
    case "session":
    case "terminal":
      return `session:${params.session as string}`;
    case "diff":
      return `session:${(params.session as { session: string }).session}`;
    default:
      return shown.name;
  }
}

export function Sidebar({ state, navigation }: DrawerContentComponentProps) {
  const frame = useContext(FrameContext);
  const insets = useSafeAreaInsets();
  const computer = useCurrentComputer();
  // The sidebar is always mounted in the frame, so it is what keeps the phone's apps in sync (useLocalApps) and the
  // computer's lists and icons on the phone (useKeepLists).
  useKeepLists();
  const installed = installedOf(useLocalApps());
  const workspaces = withLocalApps(useWithSavedLists(useWorkspaces()), installed);
  // One read of every project's coding sessions; it follows the coding_sessions change event, so the rows come and go
  // without a reload.
  const coding = useCodingSessions().sessions;
  const { count } = useInbox();
  // An app on this phone opens its screen even when the computer lists only its preview.
  const phone = new Map<string, PhoneLine>([
    ...usePhoneApps().apps.map((one): [string, PhoneLine] => [
      one.app,
      previewOnly(one) ? "preview" : "screen",
    ]),
    ...installed.map((one): [string, PhoneLine] => [one.app, "screen"]),
  ]);

  const stack = state.routes[0]?.state;
  const shown = (stack?.routes[stack.index ?? 0] as Shown | undefined) ?? {
    name: "home",
  };
  const on = lineOf(shown);

  const show = (place: Place) => {
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
  const open = (place: Place) => {
    frame.stack.current?.dispatch(
      StackActions.push(place.name, paramsOf(place)),
    );
    if (!frame.wide) navigation.closeDrawer();
  };

  const state_ = computer === null ? null : stateOf(computer);
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
      {computer !== null && state_ !== null && (
        <ComputerPicker
          icon={Monitor}
          name={computer.name}
          state={state_.text}
          tone={state_.tone ?? "off"}
          onPress={frame.openComputers}
        />
      )}
      <SidebarList>
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
        {workspaces.map((workspace) => (
          <Workspace
            key={workspace.key}
            workspace={workspace}
            phone={phone.get(workspace.key)}
            coding={coding.filter((one) => one.project === workspace.key)}
            on={on}
            show={show}
            open={open}
          />
        ))}
      </SidebarList>
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

/** What an app's line opens: its phone screen, or the running preview when only the preview has a phone screen. */
type PhoneLine = "screen" | "preview";

function Workspace({
  workspace,
  phone,
  coding,
  on,
  show,
  open,
}: {
  workspace: WorkspaceView;
  /** An app with a phone screen or on this phone: its line opens the screen, or the running preview when only the
   * preview has one. */
  phone: PhoneLine | undefined;
  /** The project's running coding sessions on the computer. */
  coding: readonly CodingSession[];
  on: string;
  show: (place: Place) => void;
  open: (place: Place) => void;
}) {
  const name = workspace.name ?? t("left-sidebar.label.home");
  const place: Place =
    workspace.workspace === null
      ? { name: "home" }
      : phone === undefined
        ? { name: "workspace", workspace: workspace.workspace }
        : phone === "preview"
          ? { name: "app", id: workspace.key, preview: true }
          : { name: "app", id: workspace.key };
  // The desktop keeps the rest of the last 7 days under a folded Recent of the workspace on screen only.
  const here =
    workspace.workspace === null
      ? on === "home"
      : on === `workspace:${workspace.key}` ||
        [...workspace.groups.flatMap((group) => group.rows), ...workspace.recent].some(
          (row) => on === `session:${row.id}`,
        );
  const [recentOpen, setRecentOpen] = useState(false);
  const sessionRow = (row: WorkspaceView["recent"][number]) => (
    <SessionRow
      key={row.id}
      face={<Face profile={row.who?.profile ?? LOPHN} size={20} />}
      title={row.title ?? t("left-sidebar.label.untitled")}
      tone={SESSION_DOT[row.status]}
      on={on === `session:${row.id}`}
      onPress={() =>
        show({
          name: "session",
          session: row.id,
          // A session's agent is known once its first event arrives; until then it is its workspace's lophn.
          agent: row.agent ?? lophnIdOf(row.workspace),
          workspace: row.workspace,
        })
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
        label={
          phone === "preview"
            ? t("mobile.drive.list.app", { name })
            : name
        }
        on={
          workspace.workspace === null
            ? on === "home"
            : on === `workspace:${workspace.key}`
        }
        end={
          <IconButton
            icon={Plus}
            label={t("left-sidebar.label.new-session")}
            tone="muted"
            size={18}
            onPress={() => open({ name: "new-session", ...(workspace.workspace === null ? {} : { workspace: workspace.workspace }) })}
          />
        }
        onPress={() => show(place)}
      />
      {coding.length > 0 && after === -1 && <CodingLines sessions={coding} on={on} show={show} />}
      {workspace.groups.map((group, at) => (
        <Fragment key={group.label ?? ""}>
          {group.label !== null && <WorktreeLabel>{group.label}</WorktreeLabel>}
          {group.rows.map(sessionRow)}
          {at === after && <CodingLines sessions={coding} on={on} show={show} />}
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
  sessions,
  on,
  show,
}: {
  sessions: readonly CodingSession[];
  on: string;
  show: (place: Place) => void;
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
        on={on === `session:${session.session}`}
        onPress={() => show(codingPlace(session))}
      />
    ));
}
