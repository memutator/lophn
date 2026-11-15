import { t } from "@lophn/i18n";
import type { PlaceOf } from "../../app/nav.ts";
import { Placeholder } from "../../app/placeholder.tsx";
import { useWorkspaces } from "../../data/mod.ts";

export function WorkspaceScreen({ place }: { place: PlaceOf<"workspace"> }) {
  const found = useWorkspaces().find(
    (one) => one.key === place.workspace.id,
  );
  return (
    <Placeholder top="menu" title={found?.name ?? t("left-sidebar.heading.workspaces")} />
  );
}

export function WorkflowRunScreen({ place }: { place: PlaceOf<"workflow-run"> }) {
  return <Placeholder top="back" title={place.run} />;
}

export function FileScreen({ place }: { place: PlaceOf<"file"> }) {
  return <Placeholder top="back" title={place.path} />;
}

export function AppActivityScreen(_: { place: PlaceOf<"app-activity"> }) {
  return <Placeholder top="back" title={t("left-sidebar.heading.workspaces")} />;
}
