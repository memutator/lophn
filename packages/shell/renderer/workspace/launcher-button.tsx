import { IconButton } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { workspaceIcons } from "../icons/mod.ts";
import { t } from "@lophn/i18n";

interface LauncherButtonProps {
  onLauncher: () => void;
}

// 모든 공간 상단 바 왼쪽 끝의 런처 복귀.
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
