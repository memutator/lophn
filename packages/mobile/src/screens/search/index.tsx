import { t } from "@lophn/i18n";
import type { PlaceOf } from "../../app/nav.ts";
import { Placeholder } from "../../app/placeholder.tsx";

export function SearchScreen(_: { place: PlaceOf<"search"> }) {
  return <Placeholder top="back" title={t("left-sidebar.button.quick-search")} />;
}
