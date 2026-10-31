// Settings 공간 왼쪽 끝의 icon 세로 줄. 항목을 누르면 그 panel을 열고, 열린 항목에는 오른쪽 띠와 배경을 둔다.
import { Icon, type IconProps } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import styles from "./project-sidebar.module.css";

export interface ActivityEntry<K extends string = string> {
  readonly key: K;
  readonly label: string;
  readonly icon: IconProps["icon"];
}

export function ActivityBar<K extends string>({
  entries,
  selected,
  open,
  onSelect,
}: {
  entries: readonly ActivityEntry<K>[];
  /** 마지막으로 고른 panel. */
  selected: K;
  /** panel이 열려 있다. 접히면 열린 항목 표시가 없다. */
  open: boolean;
  onSelect: (key: K) => void;
}) {
  return (
    <div
      className={styles.activityBar}
      role="toolbar"
      aria-orientation="vertical"
      aria-label={t("project-workspace.label.activity-bar")}
    >
      <div className={styles.activityGroup}>
        {entries.map((entry) => {
          const active = open && entry.key === selected;
          return (
            <Tooltip key={entry.key} content={entry.label}>
              <button
                type="button"
                className={styles.activityButton}
                aria-label={entry.label}
                aria-pressed={active}
                data-active={active || undefined}
                data-activity={entry.key}
                onClick={() => onSelect(entry.key)}
              >
                <Icon icon={entry.icon} pixels={18} />
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
