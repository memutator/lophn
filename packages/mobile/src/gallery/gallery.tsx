// Dev only: the phone UI kit drawn with the wireframes' made-up data. Nothing here talks to a computer.
import {
  Label,
  Row,
  type Scheme,
  Screen,
  SegmentedControl,
  ThemeProvider,
  TopBar,
} from "@lophn/ui-native";
import { type ReactElement, useEffect, useState } from "react";
import { BackHandler, View } from "react-native";
import {
  ControlsPage,
  ConversationPage,
  DisplayPage,
  FramePage,
  OverlaysPage,
  SidebarPage,
  ThreadPage,
} from "./parts.tsx";
import {
  AnswerScreen,
  ApprovalScreen,
  HomeScreen,
  InboxScreen,
  OrdersScreen,
  QuestionScreen,
  SettingsScreen,
  WelcomeScreen,
  WorkingScreen,
} from "./screens.tsx";

type Draw = (back: () => void) => ReactElement;

const PARTS: [string, Draw][] = [
  ["Frame", (back) => <FramePage onBack={back} />],
  ["Display", (back) => <DisplayPage onBack={back} />],
  ["Controls", (back) => <ControlsPage onBack={back} />],
  ["Overlays", (back) => <OverlaysPage onBack={back} />],
  ["Sidebar parts", (back) => <SidebarPage onBack={back} />],
  ["Conversation", (back) => <ConversationPage onBack={back} />],
  ["MessageList", (back) => <ThreadPage onBack={back} />],
];

// The example screens have no back button of their own; the phone's back returns here.
const SCREENS: [string, Draw][] = [
  ["Welcome", () => <WelcomeScreen />],
  ["Home", () => <HomeScreen />],
  ["Sidebar", () => <HomeScreen sidebar />],
  ["Session · Answer", () => <AnswerScreen />],
  ["Session · Working", () => <WorkingScreen />],
  ["Session · Approval", () => <ApprovalScreen />],
  ["Session · Question", () => <QuestionScreen />],
  ["What it did", () => <AnswerScreen steps />],
  ["Inbox · Now", () => <InboxScreen />],
  ["Orders", () => <OrdersScreen />],
  ["Settings", () => <SettingsScreen />],
];

const PAGES = new Map([...PARTS, ...SCREENS]);

export function Gallery({ onExit }: { onExit: () => void }) {
  const [page, setPage] = useState<string>();
  const [scheme, setScheme] = useState<Scheme>("light");
  const back = () => setPage(undefined);

  useEffect(() => {
    const handler = BackHandler.addEventListener("hardwareBackPress", () => {
      if (page === undefined) return false;
      setPage(undefined);
      return true;
    });
    return () => handler.remove();
  }, [page]);

  const draw = page === undefined ? undefined : PAGES.get(page);
  return (
    <ThemeProvider scheme={scheme}>
      {draw !== undefined ? (
        // A fresh page each time so a sheet or drawer opens again.
        <View key={page} style={{ flex: 1 }}>
          {draw(back)}
        </View>
      ) : (
        <Screen
          top={<TopBar left="close" onLeft={onExit} title="UI kit gallery" />}
          scroll
        >
          <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
            <SegmentedControl
              items={["Light", "Dark"]}
              on={scheme === "light" ? 0 : 1}
              onChange={(at) => setScheme(at === 0 ? "light" : "dark")}
            />
          </View>
          <Label>Parts</Label>
          {PARTS.map(([name]) => (
            <Row key={name} title={name} onPress={() => setPage(name)} />
          ))}
          <Label>Screens</Label>
          {SCREENS.map(([name]) => (
            <Row key={name} title={name} onPress={() => setPage(name)} />
          ))}
        </Screen>
      )}
    </ThemeProvider>
  );
}
