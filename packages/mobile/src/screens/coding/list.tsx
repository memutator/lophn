// The project's coding sessions on top of its Sessions tab (tools/wireframes/drafts/phone/coding.tsx Sessions): what
// runs on the computer now, a chat with its state, a terminal with a small Terminal mark. When the list does not come,
// one line says so in the group's place.
import { t } from "@lophn/i18n";
import { Dot, Label, Row, Text } from "@lophn/ui-native";
import { useNav } from "../../app/nav.ts";
import { useCodingSessions, useCurrentComputer } from "../../data/mod.ts";
import { Face } from "../../parts/mod.ts";
import { codingPlace, codingTitle, harnessAvatar, ReadFailed, stateOf, TerminalMark } from "./parts.tsx";

/** The coding sessions of one project. Nothing while loading or when none runs. */
export function CodingSessionList({ project }: { project: string }) {
  const nav = useNav();
  const { sessions, status, reload } = useCodingSessions(project);
  const computer = useCurrentComputer()?.name ?? "";
  if (status === "loading" || (status === "ready" && sessions.length === 0)) return null;
  return (
    <>
      <Label>{t("mobile.ops.agents.coding", { computer })}</Label>
      {status === "failed" ? (
        <ReadFailed computer={computer} onRetry={reload} />
      ) : (
        sessions.map((session) => {
          const state = stateOf(session);
          const terminal = session.view === "tui";
          return (
            <Row
              key={session.session}
              lead={<Face look={harnessAvatar(session.harness, session.label)} size={24} />}
              title={codingTitle(session)}
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
