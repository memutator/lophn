import { t } from "@lophn/i18n";
import type { PlaceOf } from "../../app/nav.ts";
import { Placeholder } from "../../app/placeholder.tsx";

export function HomeScreen(_: { place: PlaceOf<"home"> }) {
  return <Placeholder top="menu" title={t("left-sidebar.label.home")} />;
}
