// Every place inside the frame and the screen that shows it. A screen gets its place as the `place` prop.
import { type ComponentType, useContext, useEffect, useLayoutEffect } from "react";
import {
  SafeAreaInsetsContext,
  type EdgeInsets,
} from "react-native-safe-area-context";
import {
  type NavigationProp,
  type ParamListBase,
  useIsFocused,
} from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { AgentScreen, AgentsScreen } from "../screens/agents/index.tsx";
import { AppScreen } from "../screens/apps/index.tsx";
import { HomeScreen } from "../screens/home/index.tsx";
import { AppUpdateScreen, InboxScreen } from "../screens/inbox/index.tsx";
import { JobScreen, JobsScreen } from "../screens/jobs/index.tsx";
import { OpenTapped } from "../open/opener.tsx";
import { usePush } from "../push/provider.tsx";
import { NotificationsScreen } from "../push/screen.tsx";
import { SearchScreen } from "../screens/search/index.tsx";
import {
  DiffScreen,
  NewSessionScreen,
  SessionScreen,
} from "../screens/session/index.tsx";
import {
  AppearanceScreen,
  ComputerScreen,
  GalleryScreen,
  ProvidersScreen,
  SettingsScreen,
} from "../screens/settings/index.tsx";
import { TerminalScreen } from "../screens/terminal/index.tsx";
import { WidgetPickScreen } from "../screens/widgets/index.tsx";
import {
  AppActivityScreen,
  FileScreen,
  WorkflowRunScreen,
  WorkspaceScreen,
} from "../screens/workspace/index.tsx";
import { FrameContext, type PlaceName, type PlaceOf } from "./nav.ts";

type Screens = {
  [N in Exclude<PlaceName, "pair">]: ComponentType<{ place: PlaceOf<N> }>;
};

const SCREENS: Screens = {
  home: HomeScreen,
  search: SearchScreen,
  inbox: InboxScreen,
  "app-update": AppUpdateScreen,
  jobs: JobsScreen,
  job: JobScreen,
  agents: AgentsScreen,
  agent: AgentScreen,
  workspace: WorkspaceScreen,
  "workflow-run": WorkflowRunScreen,
  file: FileScreen,
  "app-activity": AppActivityScreen,
  app: AppScreen,
  "widget-pick": WidgetPickScreen,
  session: SessionScreen,
  diff: DiffScreen,
  terminal: TerminalScreen,
  "new-session": NewSessionScreen,
  settings: SettingsScreen,
  computer: ComputerScreen,
  providers: ProvidersScreen,
  appearance: AppearanceScreen,
  notifications: NotificationsScreen,
  gallery: GalleryScreen,
};

const NO_INSETS: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

function routeOf(name: string, Screen: ComponentType<{ place: never }>) {
  return function Route({ navigation, route }: NativeStackScreenProps<ParamListBase>) {
    const frame = useContext(FrameContext);
    const push = usePush();
    const focused = useIsFocused();
    const session = (route.params as { session?: string } | undefined)?.session;
    // Tells the computers which session is in front, so they do not push about it.
    useEffect(() => {
      if (name === "session" && focused && typeof session === "string")
        return push.look(session);
    }, [push.look, focused, session]);
    // The frame resets this stack when the sidebar picks a place or the computer changes.
    useLayoutEffect(() => {
      frame.stack.current = navigation as NavigationProp<ParamListBase>;
    }, [frame, navigation]);
    const screen = (
      <>
        <Screen place={{ name, ...(route.params ?? {}) } as never} />
        {name === "home" && <OpenTapped />}
      </>
    );
    // On a wide screen the frame already keeps the screen inside the safe area, as a card beside the sidebar.
    return frame.wide ? (
      <SafeAreaInsetsContext value={NO_INSETS}>{screen}</SafeAreaInsetsContext>
    ) : (
      screen
    );
  };
}

export const ROUTES = Object.entries(SCREENS).map(
  ([name, Screen]) =>
    [name, routeOf(name, Screen as ComponentType<{ place: never }>)] as const,
);
