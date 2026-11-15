// The project workspace and the app workspace, and what opens from them: a workflow run, a file, an app's activity.
import { Screen, TopBar } from "@lophn/ui-native";
import { type PlaceOf, useNav } from "../../app/nav.ts";
import { useWorkspaces } from "../../data/mod.ts";
import { AppWorkspace } from "./app.tsx";
import { ProjectWorkspace } from "./project.tsx";

export { AppActivityScreen } from "./app.tsx";
export { FileScreen } from "./files.tsx";
export { WorkflowRunScreen } from "./workflows.tsx";

export function WorkspaceScreen({ place }: { place: PlaceOf<"workspace"> }) {
  const nav = useNav();
  const view = useWorkspaces().find((one) => one.key === place.workspace.id);
  // The list has not got the workspace yet (just opened, or its computer is not read): an empty screen with the menu.
  if (view === undefined) {
    return <Screen top={<TopBar {...nav.menuButton} title="" />} />;
  }
  return view.kind === "app" ? (
    <AppWorkspace view={view} />
  ) : (
    <ProjectWorkspace view={view} />
  );
}
