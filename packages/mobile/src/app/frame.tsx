// The frame every place lives in: the sidebar as a drawer from the left edge, and a stack of places beside it.
// 600 wide or more (an unfolded phone, a tablet) the sidebar stays open and the stack sits in a card beside it
// (tools/wireframes/drafts/phone/more.tsx WideFlow). A phone held sideways is wide but too short for that: the
// sidebar would show two rows of workspaces and the screen half a card, so it keeps the drawer. No tab bar.
import { useTheme } from "@lophn/ui-native";
import { createDrawerNavigator } from "@react-navigation/drawer";
import {
  CommonActions,
  type NavigationProp,
  type ParamListBase,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useMemo, useRef, useState } from "react";
import { useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ComputersSheet } from "./computers-sheet.tsx";
import { type Frame as FrameValue, FrameContext } from "./nav.ts";
import { ROUTES } from "./routes.tsx";
import { Sidebar } from "./sidebar.tsx";

const Drawer = createDrawerNavigator();
const Stack = createNativeStackNavigator();

const WIDE = 600;
const TALL = 480;

function Places() {
  return (
    <Stack.Navigator
      initialRouteName="home"
      screenOptions={{ headerShown: false, animation: "slide_from_right" }}
    >
      {ROUTES.map(([name, Route]) => (
        <Stack.Screen key={name} name={name} component={Route} />
      ))}
    </Stack.Navigator>
  );
}

export function Frame({
  navigation,
}: {
  navigation: NavigationProp<ParamListBase>;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const wide = width >= WIDE && height >= TALL;
  const [picking, setPicking] = useState(false);
  const stack = useRef<NavigationProp<ParamListBase> | null>(null);
  const frame = useMemo<FrameValue>(
    () => ({ wide, openComputers: () => setPicking(true), stack }),
    [wide],
  );
  return (
    <FrameContext value={frame}>
      <View style={{ flex: 1, backgroundColor: theme.color.surface.shell }}>
      <Drawer.Navigator
        drawerContent={(props) => <Sidebar {...props} />}
        screenOptions={({ route }) => ({
          headerShown: false,
          drawerType: wide ? "permanent" : "front",
          drawerStyle: {
            width: wide ? 320 + insets.left : Math.min(326, width - 48),
            backgroundColor: theme.color.surface.shell,
            borderRightWidth: 0,
            // React Navigation rounds the drawer's outer corners; the wireframe's sidebar is square.
            borderTopRightRadius: 0,
            borderBottomRightRadius: 0,
          },
          overlayColor: theme.color.scrim,
          // The edge swipe opens the sidebar on a top-level place; deeper in, it is the way back.
          swipeEnabled:
            !wide &&
            ((route as { state?: { index?: number } }).state?.index ?? 0) === 0,
          sceneStyle: wide
            ? {
                marginTop: insets.top + 10,
                marginRight: insets.right + 10,
                marginBottom: insets.bottom + 10,
                borderRadius: 20,
                overflow: "hidden",
                backgroundColor: theme.color.surface.base,
              }
            : { backgroundColor: theme.color.surface.base },
        })}
      >
        <Drawer.Screen name="places" component={Places} />
      </Drawer.Navigator>
      </View>
      <ComputersSheet
        open={picking}
        onClose={() => setPicking(false)}
        onPick={() =>
          stack.current?.reset({ index: 0, routes: [{ name: "home" }] })
        }
        onPair={() => navigation.dispatch(CommonActions.navigate("scan"))}
      />
    </FrameContext>
  );
}
