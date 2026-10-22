// project 창 왼쪽 끝의 icon 세로 줄. 위쪽은 panel 항목, 아래쪽은 바로 가기. 누르면 그 panel을 열고 열린 항목을 다시 누르면 접는다.
// 열린 항목에는 왼쪽 띠와 배경을 둔다. 접히면 bar만 남는다.
import type { LucideIcon } from "lucide-react";
import { Icon } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";

import { LauncherButton } from "../../../../packages/shell/renderer/workspace/launcher-button.tsx";
import styles from "./workflow.module.css";

export interface ActivityItem {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

export function ActivityBar(
  { entries, shortcuts, selected, open, onSelect, onShortcut }: {
    entries: readonly ActivityItem[];
    shortcuts: readonly ActivityItem[];
    /** 마지막으로 고른 panel. */
    selected: string;
    /** panel이 열려 있다. 접히면 열린 항목 표시가 없다. */
    open: boolean;
    onSelect: (id: string) => void;
    onShortcut: (id: string) => void;
  },
) {
  const button = (item: ActivityItem, active: boolean, onClick: () => void) => (
    <Tooltip key={item.id} content={item.label}>
      <button
        type="button"
        className={styles.barButton}
        aria-label={item.label}
        aria-pressed={active}
        data-active={active || undefined}
        data-bar-item={item.id}
        onClick={onClick}
      >
        <Icon icon={item.icon} pixels={iconPixels("large")} />
      </button>
    </Tooltip>
  );
  return (
    <nav className={styles.bar} aria-label="Project">
      <div className={styles.barHead}>
        <LauncherButton onLauncher={() => {}} />
      </div>
      <div className={styles.barGroup}>
        {entries.map((item) =>
          button(item, open && item.id === selected, () => onSelect(item.id))
        )}
      </div>
      <div className={styles.barSpacer} />
      <div className={styles.barGroup}>
        {shortcuts.map((item) =>
          button(item, false, () => onShortcut(item.id))
        )}
      </div>
    </nav>
  );
}
