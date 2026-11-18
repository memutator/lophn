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
import {
  type AgentId,
  type CodingTarget,
  type ConversationTarget,
  useComputers,
  type Workspace,
} from "../data/mod.ts";

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
  /** A file of a project, `path` relative to `folder` (one of its folders, absolute; without it the first). */
  | {
      readonly name: "file";
      readonly project: string;
      readonly path: string;
      readonly folder?: string;
    }
  | { readonly name: "app-activity"; readonly app: string }
  /** A user app's phone screen; without `screen` its first one. An app with no phone screen opens its workspace. With
   * `preview` it is the preview running on the computer (Preview from lophn) instead of the live app. */
  | { readonly name: "app"; readonly id: string; readonly screen?: string; readonly preview?: true }
  /**
   * "Choose a widget". `widget`: a placed widget that shows nothing yet (`configure`: the launcher waits for the answer);
   * `app`: from an app's menu, only that app's widgets, to place a new one.
   */
  | {
      readonly name: "widget-pick";
      readonly widget?: number;
      readonly configure?: boolean;
      readonly app?: { readonly host: string; readonly id: string };
    }
  /** A lophn agent's session, or a coding session of the computer's lophn app. */
  | ({ readonly name: "session" } & (ConversationTarget | CodingTarget))
  /** A file change in a conversation: the thread entry that holds it. */
  | {
      readonly name: "diff";
      readonly session: ConversationTarget | CodingTarget;
      readonly entry: string;
    }
  /** The terminal a coding session runs in on the computer, its screen as text. */
  | {
      readonly name: "terminal";
      readonly session: string;
      readonly project: string;
    }
  /** The computer's browser pages, and one of them seen (and used, if the computer lets this phone type) from here. */
  | { readonly name: "pages" }
  | { readonly name: "page"; readonly tab: string }
  | {
      readonly name: "new-session";
      readonly workspace?: Workspace | null;
      readonly agent?: AgentId;
      /** What was already typed in the box that led here. */
      readonly text?: string;
    }
  | { readonly name: "settings" }
  | { readonly name: "computer"; readonly key: string }
  /** A computer's providers: connect one with an API key or a sign-in by code. Any paired computer, not only the one on screen. */
  | { readonly name: "providers"; readonly key: string }
  | { readonly name: "appearance" }
  | { readonly name: "notifications" }
  /** Dev builds only: the kit gallery. */
  | { readonly name: "gallery" }
  /** Pairing another computer: the start flow from Scan. */
  | { readonly name: "pair" };

export type PlaceName = Place["name"];
export type PlaceOf<N extends PlaceName> = Extract<Place, { name: N }>;

export interface Frame {
  /** 600 wide or more and tall enough: the sidebar stays open beside the screen, and screens drop their menu button. */
  readonly wide: boolean;
  openComputers(): void;
  /** The frame's stack, kept by its screens, so the sidebar and the computer filter can replace what it shows. */
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
  /**
   * Opens a place of `computer` from the one list. Another computer than the one on screen becomes the one on screen and
   * the place opens over Home: no screen of the computer before stays under it.
   */
  openOn(computer: string, place: Place): void;
  back(): void;
  openSidebar(): void;
  /** The Computers sheet, the one list's filter (the pill on Home, the sidebar's filter row). */
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
  const { current, select } = useComputers();
  return useMemo(() => {
    const openSidebar = () => navigation.dispatch(DrawerActions.openDrawer());
    const open = (place: Place) =>
      navigation.dispatch(
        place.name === "pair"
          ? CommonActions.navigate({ name: "scan" })
          : StackActions.push(place.name, paramsOf(place)),
      );
    return {
      open,
      openOn(computer, place) {
        if (computer === current) return open(place);
        select(computer);
        frame.stack.current?.reset({
          index: place.name === "home" ? 0 : 1,
          routes: [
            { name: "home" },
            ...(place.name === "home" ? [] : [{ name: place.name, params: paramsOf(place) }]),
          ],
        });
      },
      back: () => navigation.goBack(),
      openSidebar,
      openComputers: frame.openComputers,
      wide: frame.wide,
      menuButton: frame.wide
        ? { left: "none" }
        : { left: "menu", onLeft: openSidebar },
    };
  }, [navigation, frame, current, select]);
}
