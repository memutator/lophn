// The app's root: the start flow while no computer is paired, then the frame.
import { useTheme } from "@lophn/ui-native";
import {
  DefaultTheme,
  NavigationContainer,
  useNavigationContainerRef,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useEffect } from "react";
import { useComputers } from "../data/mod.ts";
import { WelcomeScreen } from "../screens/start/welcome.tsx";
import { ScanScreen } from "../screens/start/scan.tsx";
import {
  PairedScreen,
  PairFailedScreen,
  PairingScreen,
} from "../screens/start/pairing.tsx";
import { Frame } from "./frame.tsx";
import type { RootParams } from "./root-params.ts";

const Stack = createNativeStackNavigator<RootParams>();

export function Root() {
  const theme = useTheme();
  const { ready, computers } = useComputers();
  const navigation = useNavigationContainerRef<RootParams>();
  const none = computers.length === 0;

  // The last computer was removed: back to the start.
  useEffect(() => {
    if (none && navigation.isReady()) {
      if (navigation.getRootState()?.routes[0]?.name === "frame") {
        navigation.reset({ index: 0, routes: [{ name: "welcome" }] });
      }
    }
  }, [none, navigation]);

  if (!ready) return null;
  return (
    <NavigationContainer
      ref={navigation}
      theme={{
        ...DefaultTheme,
        dark: theme.scheme === "dark",
        colors: {
          ...DefaultTheme.colors,
          primary: theme.color.text.primary,
          background: theme.color.surface.base,
          card: theme.color.surface.base,
          text: theme.color.text.primary,
          border: theme.color.border.subtle,
        },
      }}
    >
      <Stack.Navigator
        initialRouteName={none ? "welcome" : "frame"}
        screenOptions={{ headerShown: false, animation: "slide_from_right" }}
      >
        <Stack.Screen name="frame" component={Frame} />
        <Stack.Screen name="welcome" component={WelcomeScreen} />
        <Stack.Screen name="scan" component={ScanScreen} />
        <Stack.Screen name="pairing" component={PairingScreen} />
        <Stack.Screen name="paired" component={PairedScreen} />
        <Stack.Screen name="pair-failed" component={PairFailedScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
