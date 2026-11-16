// A coding session that runs in a terminal tab on the computer (tools/wireframes/drafts/phone/coding.tsx InTerminal).
// Its conversation does not reach the phone, so where the composer would be there is one line and Switch to chat, or
// the reason it cannot switch now. View terminal opens the terminal's own screen.
import { t } from "@lophn/i18n";
import { AskCard, Button, Dot, Screen, Text } from "@lophn/ui-native";
import { MessageSquare, SquareTerminal } from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { View } from "react-native";
import { useNav } from "../../app/nav.ts";
import type { CodingSession } from "../../data/mod.ts";
import { Face, useLocked } from "../../parts/mod.ts";
import { blockedText, harnessProfile, stateOf } from "./parts.tsx";
import { SwitchSheet } from "./switch-sheet.tsx";

export function TerminalSession({
  session,
  computer,
  top,
}: {
  session: CodingSession;
  computer: string;
  top: ReactNode;
}) {
  const nav = useNav();
  const locked = useLocked();
  const [asking, setAsking] = useState(false);
  const state = stateOf(session);
  const blocked = session.switch?.blocked ?? null;
  return (
    <>
      <Screen
        top={top}
        footer={
          <View style={{ paddingBottom: 6 }}>
            <AskCard>
              <Text variant="control" tone="secondary">
                {blocked === null
                  ? t("mobile.coding.notice.in-terminal")
                  : blockedText(blocked, session.label, computer)}
              </Text>
              <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 12 }}>
                <Button
                  variant={blocked === null ? "primary" : "secondary"}
                  icon={MessageSquare}
                  disabled={blocked !== null || locked}
                  onPress={() => setAsking(true)}
                >
                  {t("mobile.coding.button.switch-to-chat")}
                </Button>
              </View>
            </AskCard>
          </View>
        }
      >
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 }}>
          <Face profile={harnessProfile(session.harness, session.label)} size={56} />
          <Text variant="heading" weight="semibold" align="center" style={{ marginTop: 14 }}>
            {t("mobile.coding.heading.in-terminal", { harness: session.label })}
          </Text>
          {state.text !== null && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 }}>
              <Dot tone={state.tone ?? "off"} />
              <Text variant="detail" tone="muted">
                {state.text}
              </Text>
            </View>
          )}
          <View style={{ marginTop: 18 }}>
            <Button
              icon={SquareTerminal}
              onPress={() => nav.open({ name: "terminal", session: session.session, project: session.project })}
            >
              {t("mobile.terminal.button.view")}
            </Button>
          </View>
        </View>
      </Screen>
      <SwitchSheet session={asking ? session : null} onClose={() => setAsking(false)} />
    </>
  );
}
