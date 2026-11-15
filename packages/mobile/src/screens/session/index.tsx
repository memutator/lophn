import { t } from "@lophn/i18n";
import type { PlaceOf } from "../../app/nav.ts";
import { Placeholder } from "../../app/placeholder.tsx";
import { useWorkspaces } from "../../data/mod.ts";

export function SessionScreen({ place }: { place: PlaceOf<"session"> }) {
  const row = useWorkspaces()
    .flatMap((one) => [...one.groups.flatMap((group) => group.rows), ...one.recent])
    .find((one) => one.id === place.session);
  return (
    <Placeholder top="menu" title={row?.title ?? t("left-sidebar.label.untitled")} />
  );
}

export function NewSessionScreen(_: { place: PlaceOf<"new-session"> }) {
  return <Placeholder top="menu" title={t("left-sidebar.label.new-session")} />;
}

export function DiffScreen({ place }: { place: PlaceOf<"diff"> }) {
  return <Placeholder top="back" title={place.entry} />;
}
