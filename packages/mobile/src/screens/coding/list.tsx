// The project's coding sessions on top of its Sessions tab (tools/wireframes/drafts/phone/coding.tsx Sessions): what
// runs in the computer's lophn app now, a chat with its state, a terminal with a small Terminal mark. When the app is
// not running there, one line says so in the group's place.
import { t } from "@lophn/i18n";
import { Button, Dot, Label, Row, Text } from "@lophn/ui-native";
import { MessageSquare, Plus } from "lucide-react-native";
import { useState } from "react";
import { View } from "react-native";
import { isCodingBuiltin, codingBuiltinOf } from "../../../../protocol/lophn-agent/workspaces.ts";
import { useNav } from "../../app/nav.ts";
import { useCodingSessions, useCurrentComputer, useWorkspaces } from "../../data/mod.ts";
import { Face, useLocked } from "../../parts/mod.ts";
import { useOpenCoding } from "./open.tsx";
import { codingPlace, harnessProfile, stateOf, TerminalMark } from "./parts.tsx";
import { NotRunning } from "./wake.tsx";

/** The project's latest past coding session (a harness agent's session of the ledger), for Continue as chat. */
function useLatestPast(project: string) {
  const view = useWorkspaces().find((one) => one.key === project);
  const rows = view === undefined ? [] : [...view.groups.flatMap((group) => group.rows), ...view.recent];
  return rows
    .filter((row) => row.agent !== null && isCodingBuiltin(row.agent))
    .sort((a, b) => b.at - a.at)[0];
}

/** Right after the app was started from the phone: nothing runs yet (its terminals ended with it), so New session and Continue are here. */
function RunningEmpty({ project, computer }: { project: string; computer: string }) {
  const nav = useNav();
  const locked = useLocked();
  const past = useLatestPast(project);
  const builtin = past?.agent == null ? null : codingBuiltinOf(past.agent);
  const { open, busy, problem } = useOpenCoding(false);
  return (
    <View style={{ paddingHorizontal: 20, paddingVertical: 8 }}>
      <Text>{t("mobile.coding.notice.running-empty", { computer })}</Text>
      {past !== undefined && builtin !== null && (
        <Text variant="note" tone="muted" style={{ marginTop: 2 }}>
          {t("mobile.coding.notice.continue-latest", { title: past.title ?? t("left-sidebar.label.untitled") })}
        </Text>
      )}
      {problem !== null && (
        <Text variant="small" tone="critical" style={{ marginTop: 8 }}>
          {problem.text}
        </Text>
      )}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <Button
          size="sm"
          icon={Plus}
          disabled={locked}
          onPress={() => nav.open({ name: "new-session", workspace: { kind: "project", id: project } })}
        >
          {t("left-sidebar.label.new-session")}
        </Button>
        {past !== undefined && builtin !== null && (
          <Button
            size="sm"
            variant="primary"
            icon={MessageSquare}
            disabled={locked || busy}
            onPress={() => void open(project, builtin.harness, builtin.label, { session: past.id })}
          >
            {t("mobile.coding.button.continue")}
          </Button>
        )}
      </View>
    </View>
  );
}

/** The coding sessions of one project. Nothing when the app runs and has none. */
export function CodingSessionList({ project }: { project: string }) {
  const nav = useNav();
  const { shell, sessions } = useCodingSessions(project);
  const computer = useCurrentComputer()?.name ?? "";
  // Set when the app was started from here: until the screen goes away, an empty list is explained instead of hidden.
  const [woken, setWoken] = useState(false);
  if (shell !== "absent" && sessions.length === 0 && !woken) return null;
  return (
    <>
      <Label>{t("mobile.ops.agents.coding", { computer })}</Label>
      {shell === "absent" ? (
        <NotRunning computer={computer} onWoken={() => setWoken(true)} />
      ) : sessions.length === 0 ? (
        <RunningEmpty project={project} computer={computer} />
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
