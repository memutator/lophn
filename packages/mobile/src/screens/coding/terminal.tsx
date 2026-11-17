// A coding session that runs in a terminal tab on the computer (tools/wireframes/drafts/phone/terminal.tsx). Its
// conversation does not reach the phone, so the session screen is the terminal itself, typed into from the phone. Switch
// to chat sits in the top bar's menu and asks first (SwitchSheet); once the session is a chat the session screen shows
// the conversation.
import { t } from "@lophn/i18n";
import { Menu } from "@lophn/ui-native";
import { MessageSquare } from "lucide-react-native";
import { useState } from "react";
import { useNav } from "../../app/nav.ts";
import type { CodingSession } from "../../data/mod.ts";
import { Face } from "../../parts/mod.ts";
import { TerminalView } from "../terminal/index.tsx";
import { harnessProfile, stateOf } from "./parts.tsx";
import { SwitchSheet } from "./switch-sheet.tsx";

export function TerminalSession({ session }: { session: CodingSession }) {
  const nav = useNav();
  const [sheet, setSheet] = useState<"menu" | "switch" | null>(null);
  return (
    <>
      <TerminalView
        session={session.session}
        project={session.project}
        left={nav.menuButton}
        onMore={() => setSheet("menu")}
      />
      <Menu
        open={sheet === "menu"}
        onClose={() => setSheet(null)}
        lead={<Face profile={harnessProfile(session.harness, session.label)} size={34} />}
        title={session.title ?? session.label}
        sub={stateOf(session).text ?? session.label}
        items={[
          {
            label: t("mobile.coding.button.switch-to-chat"),
            icon: MessageSquare,
            onSelect: () => setSheet("switch"),
          },
        ]}
      />
      <SwitchSheet session={sheet === "switch" ? session : null} onClose={() => setSheet(null)} />
    </>
  );
}
