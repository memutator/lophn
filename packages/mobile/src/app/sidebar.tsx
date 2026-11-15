// The sidebar: the desktop's list on the phone (tools/wireframes/drafts/phone/shell.tsx SidebarBody). The computer it
// belongs to, Inbox, Jobs, Agents, then every workspace with its sessions, and Settings at the bottom.
import { t } from "@lophn/i18n";
import {
  Badge,
  ComputerPicker,
  type DotTone,
  IconButton,
  NavRow,
  SessionRow,
  SidebarFoot,
  SidebarHead,
  SidebarLabel,
  SidebarList,
  WorkspaceRow,
  WorktreeLabel,
} from "@lophn/ui-native";
import type { DrawerContentComponentProps } from "@react-navigation/drawer";
import { StackActions } from "@react-navigation/native";
import {
  Bell,
  Clock,
  Monitor,
  Plus,
  Search,
  Settings,
  Users,
} from "lucide-react-native";
import { Fragment, useContext } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { lophnIdOf } from "../../../protocol/lophn-agent/workspaces.ts";
import {
  type SessionStatus,
  useCurrentComputer,
  useInbox,
  useWorkspaces,
  type WorkspaceView,
} from "../data/mod.ts";
import { Character, Face, LOPHN, WorkspaceMark } from "../parts/mod.ts";
import { stateOf } from "./computer-state.ts";
import { FrameContext, type Place, paramsOf } from "./nav.ts";

const DOT: Record<SessionStatus, DotTone | undefined> = {
  waiting: "warning",
  working: "good",
  failed: "critical",
  idle: undefined,
};

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
    case "computer":
    case "appearance":
    case "gallery":
      return "settings";
    case "workspace":
      return `workspace:${(params.workspace as { id: string }).id}`;
    case "workflow-run":
    case "file":
      return `workspace:${params.project as string}`;
    case "app-activity":
      return `workspace:${params.app as string}`;
    case "session":
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
  const workspaces = useWorkspaces();
  const { count } = useInbox();

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
            on={on}
            show={show}
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

function Workspace({
  workspace,
  on,
  show,
}: {
  workspace: WorkspaceView;
  on: string;
  show: (place: Place) => void;
}) {
  const name = workspace.name ?? t("left-sidebar.label.home");
  const place: Place =
    workspace.workspace === null
      ? { name: "home" }
      : { name: "workspace", workspace: workspace.workspace };
  return (
    <>
      <WorkspaceRow
        lead={<WorkspaceMark icon={workspace.icon} name={name} />}
        label={name}
        on={
          workspace.workspace === null
            ? on === "home"
            : on === `workspace:${workspace.key}`
        }
        onPress={() => show(place)}
      />
      {workspace.groups.map((group) => (
        <Fragment key={group.label ?? ""}>
          {group.label !== null && <WorktreeLabel>{group.label}</WorktreeLabel>}
          {group.rows.map((row) => (
            <SessionRow
              key={row.id}
              face={<Face profile={row.who?.profile ?? LOPHN} size={20} />}
              title={row.title ?? t("left-sidebar.label.untitled")}
              tone={DOT[row.status]}
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
          ))}
        </Fragment>
      ))}
    </>
  );
}
