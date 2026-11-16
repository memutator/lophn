// Pairing, Paired and the screens that say why pairing did not work.
import { t } from "@lophn/i18n";
import {
  Button,
  Field,
  Icon,
  Input,
  Plain,
  Screen,
  Text,
  useTheme,
} from "@lophn/ui-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  Bell,
  Check,
  ClockAlert,
  Monitor,
  QrCode,
  RefreshCw,
  Smartphone,
  Unplug,
} from "lucide-react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Animated, Easing, View } from "react-native";
import { nameOf, type RootParams } from "../../app/root-params.ts";
import { useComputers } from "../../data/mod.ts";
import { usePush } from "../../push/provider.tsx";
import { EnterCodeSheet } from "./enter-code.tsx";
import { Center, Disc, Foot, Hero, Lead } from "./parts.tsx";

function Device({ icon }: { icon: typeof Monitor }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: 64,
        height: 64,
        borderWidth: 1,
        borderColor: theme.color.border.base,
        borderRadius: 20,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.color.surface.subtle,
      }}
    >
      <Icon icon={icon} size={28} />
    </View>
  );
}

function Dots() {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 5 }}>
      {[1, 0.6, 0.3].map((opacity) => (
        <View
          key={opacity}
          style={{
            width: 5,
            height: 5,
            borderRadius: 999,
            opacity,
            backgroundColor: theme.color.text.muted,
          }}
        />
      ))}
    </View>
  );
}

function Ring({ now }: { now: boolean }) {
  const theme = useTheme();
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!now) return;
    const loop = Animated.loop(
      Animated.timing(turn, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [now, turn]);
  return (
    <Animated.View
      style={{
        width: 18,
        height: 18,
        borderWidth: 2,
        borderRadius: 999,
        borderColor: theme.color.border.strong,
        borderTopColor: now
          ? theme.color.text.primary
          : theme.color.border.strong,
        transform: [
          {
            rotate: turn.interpolate({
              inputRange: [0, 1],
              outputRange: ["0deg", "360deg"],
            }),
          },
        ],
      }}
    />
  );
}

function Progress({
  state,
  children,
}: {
  state: "done" | "now" | "next";
  children: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      {state === "done" ? (
        <Icon icon={Check} size={18} color={theme.color.status.good.text} />
      ) : (
        <Ring now={state === "now"} />
      )}
      <Text variant="control" tone={state === "next" ? "disabled" : "primary"}>
        {children}
      </Text>
    </View>
  );
}

// The code was read: pair with it, then wait for the first connection to open.
export function PairingScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootParams, "pairing">) {
  const { qr } = route.params;
  const { add, computers } = useComputers();
  const [paired, setPaired] = useState(false);
  const status = computers.find((one) => one.key === qr.key)?.status;

  useEffect(() => {
    let live = true;
    void add(qr).then((failure) => {
      if (!live) return;
      if (failure === undefined) setPaired(true);
      else
        navigation.replace("pair-failed", {
          // The core answers a wrong, used or expired code with unauthorized (core/remote/host.ts).
          why:
            failure.kind === "refused" && failure.code === "unauthorized"
              ? "expired"
              : "unreachable",
          qr,
        });
    });
    return () => {
      live = false;
    };
  }, [add, qr, navigation]);

  useEffect(() => {
    if (paired && status === "connected")
      navigation.replace("paired", { key: qr.key });
  }, [paired, status, navigation, qr.key]);

  return (
    <Screen
      footer={
        <Foot>
          <Button variant="ghost" onPress={() => navigation.goBack()}>
            {t("common.button.cancel")}
          </Button>
        </Foot>
      }
    >
      <Center>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <Device icon={Smartphone} />
          <Dots />
          <Device icon={Monitor} />
        </View>
        <Hero size="h1" top={28}>
          {t("mobile.start.heading.pairing", { name: nameOf(qr) })}
        </Hero>
        <View style={{ gap: 12, marginTop: 28 }}>
          <Progress state="done">
            {t("mobile.start.step.code-accepted")}
          </Progress>
          <Progress state={paired ? "done" : "now"}>
            {t("mobile.start.step.keys-exchanged")}
          </Progress>
          <Progress state={paired ? "now" : "next"}>
            {t("mobile.start.step.opening")}
          </Progress>
        </View>
      </Center>
    </Screen>
  );
}

// Paired: the person checks the name the computer goes by on this phone, then lands on Home.
export function PairedScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootParams, "paired">) {
  const theme = useTheme();
  const { computers, rename } = useComputers();
  const computer = computers.find((one) => one.key === route.params.key);
  const [name, setName] = useState(computer?.name ?? "");
  const push = usePush();
  const done = () => {
    if (computer !== undefined && name.trim() !== computer.name)
      rename(computer.key, name);
    navigation.reset({ index: 0, routes: [{ name: "frame" }] });
  };
  // Notifications are asked about once, here; Settings › Notifications turns them on later.
  const asking = push.status === "off" && !push.asked;
  return (
    <Screen
      footer={
        <Foot>
          {asking ? (
            <>
              <Button
                variant="primary"
                size="lg"
                icon={Bell}
                onPress={() => {
                  void push.turnOn();
                  done();
                }}
              >
                {t("mobile.notifications.button.turn-on")}
              </Button>
              <Button
                variant="ghost"
                onPress={() => {
                  push.skip();
                  done();
                }}
              >
                {t("common.button.not-now")}
              </Button>
            </>
          ) : (
            <Button variant="primary" size="lg" onPress={done}>
              {t("mobile.start.button.continue")}
            </Button>
          )}
        </Foot>
      }
    >
      <Center>
        <Disc icon={Check} size={34} color={theme.color.status.good.text} />
        <Hero size="h1">
          {t("mobile.start.heading.paired", { name: computer?.name ?? "" })}
        </Hero>
        <Lead>{t("mobile.start.intro.paired")}</Lead>
        <Plain style={{ alignSelf: "stretch", marginTop: 28, padding: 16 }}>
          <Field label={t("mobile.computer.label.shown-as")}>
            <Input value={name} onChangeText={setName} onSubmit={done} />
          </Field>
        </Plain>
        {asking && (
          <Plain
            style={{
              alignSelf: "stretch",
              marginTop: 12,
              padding: 16,
              flexDirection: "row",
              gap: 12,
            }}
          >
            <Icon icon={Bell} size={22} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text weight="semibold">
                {t("mobile.notifications.heading.know-when")}
              </Text>
              <Text variant="note" tone="muted">
                {t("mobile.notifications.note.ask")}
              </Text>
            </View>
          </Plain>
        )}
      </Center>
    </Screen>
  );
}

function Failed({
  icon,
  title,
  text,
  primary,
  secondary,
  sheet,
}: {
  icon: typeof Unplug;
  title: string;
  text: string;
  primary: ReactNode;
  secondary: ReactNode;
  sheet?: ReactNode;
}) {
  return (
    <Screen
      footer={
        <Foot>
          {primary}
          {secondary}
        </Foot>
      }
    >
      <Center>
        <Disc icon={icon} size={32} />
        <Hero size="h1">{title}</Hero>
        <Lead>{text}</Lead>
      </Center>
      {sheet}
    </Screen>
  );
}

export function PairFailedScreen({
  navigation,
  route,
}: NativeStackScreenProps<RootParams, "pair-failed">) {
  const { why, qr } = route.params;
  const [entering, setEntering] = useState(false);
  if (why === "unreachable") {
    return (
      <Failed
        icon={Unplug}
        title={t("mobile.start.heading.unreachable", { name: nameOf(qr) })}
        text={t("mobile.start.intro.unreachable")}
        primary={
          <Button
            variant="primary"
            size="lg"
            icon={RefreshCw}
            onPress={() => navigation.replace("pairing", { qr })}
          >
            {t("common.button.retry")}
          </Button>
        }
        secondary={
          <Button variant="ghost" onPress={() => navigation.replace("scan")}>
            {t("mobile.start.button.scan-different")}
          </Button>
        }
      />
    );
  }
  return (
    <Failed
      icon={ClockAlert}
      title={t("mobile.start.heading.expired")}
      text={t("mobile.start.intro.expired")}
      primary={
        <Button
          variant="primary"
          size="lg"
          icon={QrCode}
          onPress={() => navigation.replace("scan")}
        >
          {t("mobile.start.button.scan-again")}
        </Button>
      }
      secondary={
        <Button variant="ghost" onPress={() => setEntering(true)}>
          {t("mobile.start.button.enter-code")}
        </Button>
      }
      sheet={
        <EnterCodeSheet
          open={entering}
          onClose={() => setEntering(false)}
          onCode={(next) => navigation.replace("pairing", { qr: next })}
        />
      }
    />
  );
}
