import { t } from "@lophn/i18n";
import type { PlaceOf } from "../../app/nav.ts";
import { Placeholder } from "../../app/placeholder.tsx";

export function InboxScreen(_: { place: PlaceOf<"inbox"> }) {
  return <Placeholder top="menu" title={t("left-sidebar.button.inbox")} />;
}

export function AppUpdateScreen(_: { place: PlaceOf<"app-update"> }) {
  return <Placeholder top="back" title={t("left-sidebar.button.inbox")} />;
}
