import { t } from "@lophn/i18n";
import type { PlaceOf } from "../../app/nav.ts";
import { Placeholder } from "../../app/placeholder.tsx";

export function AgentsScreen(_: { place: PlaceOf<"agents"> }) {
  return <Placeholder top="menu" title={t("left-sidebar.button.agents")} />;
}

export function AgentScreen(_: { place: PlaceOf<"agent"> }) {
  return <Placeholder top="back" title={t("left-sidebar.button.agents")} />;
}
