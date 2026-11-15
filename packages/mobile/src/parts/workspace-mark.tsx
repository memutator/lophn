import { Icon, Mark, type MarkTone } from "@lophn/ui-native";
import { FolderOpen, Home } from "lucide-react-native";
import type { WorkspaceIcon } from "../data/mod.ts";

/** A workspace's mark: the Home icon, a project's folder, an app's colored letter. `lg` is the Home screen's app tile. */
export function WorkspaceMark({
  icon,
  name,
  size = "sm",
}: {
  icon: WorkspaceIcon;
  name: string;
  size?: "sm" | "lg";
}) {
  switch (icon.kind) {
    case "home":
      return <Icon icon={Home} size={19} />;
    case "project":
      return <Icon icon={FolderOpen} size={19} />;
    case "app":
      return (
        <Mark
          kind="app"
          name={icon.letter || name}
          tone={icon.tone as MarkTone}
          size={size}
        />
      );
  }
}
