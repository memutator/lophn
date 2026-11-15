// Where the phone can go and how a screen gets there. Every place inside the frame (the sidebar and its stack) is one of
// `Place`; a screen opens another with `useNav().open(place)`. The screen of a place gets the place as its `place` prop.
import type { TopBarProps } from "@lophn/ui-native";
import {
  CommonActions,
  DrawerActions,
  type NavigationProp,
  type ParamListBase,
  StackActions,
  useNavigation,
} from "@react-navigation/native";
import { createContext, useContext, useMemo } from "react";
import type { AgentId, ConversationTarget, Workspace } from "../data/mod.ts";

export type Place =
  | { readonly name: "home" }
  | { readonly name: "search" }
  | { readonly name: "inbox" }
  /** Reviewing an app's new version before allowing it: the Inbox entry's id. */
  | { readonly name: "app-update"; readonly id: string }
  | { readonly name: "jobs" }
  | { readonly name: "job"; readonly id: string }
  | { readonly name: "agents" }
  | { readonly name: "agent"; readonly id: AgentId }
  /** A project or an app. Home is `home`. */
  | { readonly name: "workspace"; readonly workspace: Workspace }
  | {
      readonly name: "workflow-run";
      readonly project: string;
      readonly run: string;
    }
  /** A file of a project, `path` relative to the project folder. */
  | { readonly name: "file"; readonly project: string; readonly path: string }
  | { readonly name: "app-activity"; readonly app: string }
  | ({ readonly name: "session" } & ConversationTarget)
  /** A file change in a conversation: the thread entry that holds it. */
  | {
      readonly name: "diff";
      readonly session: ConversationTarget;
      readonly entry: string;
    }
  | {
      readonly name: "new-session";
      readonly workspace?: Workspace | null;
      readonly agent?: AgentId;
      /** What was already typed in the box that led here. */
      readonly text?: string;
    }
  | { readonly name: "settings" }
  | { readonly name: "computer"; readonly key: string }
  | { readonly name: "appearance" }
  /** Dev builds only: the kit gallery. */
  | { readonly name: "gallery" }
  /** Pairing another computer: the start flow from Scan. */
  | { readonly name: "pair" };

export type PlaceName = Place["name"];
export type PlaceOf<N extends PlaceName> = Extract<Place, { name: N }>;

export interface Frame {
  /** 600 wide or more: the sidebar stays open beside the screen, and screens drop their menu button. */
  readonly wide: boolean;
  openComputers(): void;
  /** The frame's stack, kept by its screens, so the sidebar and the computer picker can replace what it shows. */
  readonly stack: { current: NavigationProp<ParamListBase> | null };
}

export const FrameContext = createContext<Frame>({
  wide: false,
  openComputers: () => {},
  stack: { current: null },
});

export interface Nav {
  /** Opens a place on top of the current screen. */
  open(place: Place): void;
  back(): void;
  openSidebar(): void;
  /** The Computers sheet (the computer chip on Home, the sidebar's computer line). */
  openComputers(): void;
  readonly wide: boolean;
  /** For a top-level screen's TopBar: the menu button, or none when the sidebar stays open. `<TopBar {...nav.menuButton} …/>` */
  readonly menuButton: Pick<TopBarProps, "left" | "onLeft">;
}

export function paramsOf(place: Place): object {
  const { name: _, ...params } = place;
  return params;
}

export function useNav(): Nav {
  const navigation = useNavigation();
  const frame = useContext(FrameContext);
  return useMemo(() => {
    const openSidebar = () => navigation.dispatch(DrawerActions.openDrawer());
    return {
      open(place) {
        navigation.dispatch(
          place.name === "pair"
            ? CommonActions.navigate({ name: "scan" })
            : StackActions.push(place.name, paramsOf(place)),
        );
      },
      back: () => navigation.goBack(),
      openSidebar,
      openComputers: frame.openComputers,
      wide: frame.wide,
      menuButton: frame.wide
        ? { left: "none" }
        : { left: "menu", onLeft: openSidebar },
    };
  }, [navigation, frame]);
}
