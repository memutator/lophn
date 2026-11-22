import { t } from "@lophn/i18n";
import {
  Button,
  Divider,
  Plain,
  Screen,
  Text,
  useTheme,
} from "@lophn/ui-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { QrCode } from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import type { RootParams } from "../../app/root-params.ts";
import { Rich } from "../../app/rich.tsx";
import { Character, LOPHN } from "../../parts/mod.ts";
import { EnterCodeSheet } from "./enter-code.tsx";
import { Center, Foot, Hero, Lead } from "./parts.tsx";

function Step({ n, children }: { n: number; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 16,
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 999,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.color.ink.background,
        }}
      >
        <Text variant="caption" weight="semibold" tone="inverse">
          {String(n)}
        </Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
    </View>
  );
}

export function WelcomeScreen({
  navigation,
}: NativeStackScreenProps<RootParams, "welcome">) {
  const [entering, setEntering] = useState(false);
  return (
    <Screen
      footer={
        <Foot>
          <Button
            variant="primary"
            size="lg"
            icon={QrCode}
            onPress={() => navigation.navigate("scan")}
          >
            {t("mobile.start.button.scan")}
          </Button>
          <Button variant="ghost" onPress={() => setEntering(true)}>
            {t("mobile.start.button.enter-code")}
          </Button>
          <Text
            variant="note"
            tone="muted"
            align="center"
            style={{ marginTop: 4 }}
          >
            {t("mobile.start.note.encrypted")}
          </Text>
        </Foot>
      }
    >
      <Center>
        <Character look={LOPHN} size={92} />
        <Hero>{t("mobile.start.heading.welcome")}</Hero>
        <Lead>{t("mobile.start.intro.welcome")}</Lead>
        <Plain style={{ alignSelf: "stretch", marginTop: 28 }}>
          <Step n={1}>
            <Text variant="control">{t("mobile.start.step.open")}</Text>
          </Step>
          <Divider inset={16} />
          <Step n={2}>
            <Rich
              id="mobile.start.step.settings"
              name="place"
              value={t("mobile.start.label.settings-remote")}
              variant="control"
            />
          </Step>
          <Divider inset={16} />
          <Step n={3}>
            <Rich
              id="mobile.start.step.add"
              name="button"
              value={t("settings.heading.remote-add")}
              variant="control"
            />
          </Step>
        </Plain>
      </Center>
      <EnterCodeSheet
        open={entering}
        onClose={() => setEntering(false)}
        onCode={(invite) => navigation.navigate("pairing", { invite })}
      />
    </Screen>
  );
}
