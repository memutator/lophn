// The project's coding sessions on top of its Sessions tab (tools/wireframes/drafts/phone/coding.tsx Sessions): what
// runs in the computer's lophn app now, a chat with its state, a terminal with a small Terminal mark. When the app is
// not running there, one line says so in the group's place.
import { t } from "@lophn/i18n";
import { Dot, Icon, Label, Row, Text } from "@lophn/ui-native";
import { Monitor } from "lucide-react-native";
import { View } from "react-native";
import { useNav } from "../../app/nav.ts";
import { useCodingSessions, useCurrentComputer } from "../../data/mod.ts";
import { Face } from "../../parts/mod.ts";
import { codingPlace, harnessProfile, stateOf, TerminalMark } from "./parts.tsx";

function NotRunning({ computer }: { computer: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start", paddingHorizontal: 20, paddingVertical: 8 }}>
      <Icon icon={Monitor} size={22} tone="muted" />
      <View style={{ flex: 1 }}>
        <Text>{t("mobile.coding.notice.not-running", { computer })}</Text>
        <Text variant="note" tone="muted" style={{ marginTop: 2 }}>
          {t("mobile.coding.notice.not-running-sub")}
        </Text>
      </View>
    </View>
  );
}

/** The coding sessions of one project. Nothing when the app runs and has none. */
export function CodingSessionList({ project }: { project: string }) {
  const nav = useNav();
  const { shell, sessions } = useCodingSessions(project);
  const computer = useCurrentComputer()?.name ?? "";
  if (shell !== "absent" && sessions.length === 0) return null;
  return (
    <>
      <Label>{t("mobile.ops.agents.coding", { computer })}</Label>
      {shell === "absent" ? (
        <NotRunning computer={computer} />
      ) : (
        sessions.map((session) => {
          const state = stateOf(session);
          const terminal = session.view === "tui";
          return (
            <Row
              key={session.session}
              lead={<Face profile={harnessProfile(session.harness, session.label)} size={24} />}
              title={session.title ?? session.label}
              sub={
                terminal ? (
                  <>
                    <TerminalMark />
                    {state.text !== null && <Text variant="small">{state.text}</Text>}
                  </>
                ) : (
                  (state.text ?? undefined)
                )
              }
              end={<Dot tone={state.tone} />}
              onPress={() => nav.open(codingPlace(session))}
            />
          );
        })
      )}
    </>
  );
}
