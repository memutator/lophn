import { IconButton } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { workspaceIcons } from "../icons/mod.ts";
import { t } from "@lophn/wording";

interface LauncherButtonProps {
  onLauncher: () => void;
}

// 모든 공간 왼쪽 위의 런처 복귀. sidebar 접힘 때는 상단 바가 그린다.
export function LauncherButton({ onLauncher }: LauncherButtonProps) {
  const label = t("project-workspace.button.launcher");
  return (
    <Tooltip content={label}>
      <IconButton
        icon={workspaceIcons.launcher}
        label={label}
        data-launcher-back=""
        onClick={onLauncher}
      />
    </Tooltip>
  );
}
