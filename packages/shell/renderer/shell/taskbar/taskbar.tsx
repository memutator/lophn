// 작업 표시줄. workspace 창 맨 아래 줄이다. 왼쪽 끝은 빠른 실행(ShellFrame의 `taskbarStart` slot), 그 뒤 이 component가 float chip
// (전역 float, 지금 desk의 float 순서), 오른쪽에 tray 자리와 맨 끝 Settings 단추를 그린다.
// ShellFrame의 `taskbar` slot에 들어가고, 줄의 틀(높이, 바탕)은 ShellFrame이 정한다.
import { t } from "@lophn/i18n";
import { IconButton } from "@lophn/ui/primitives";
import type { ReactNode } from "react";

import { settingsEntryIcon } from "../../icons/mod.ts";

import { type FloatChip, FloatChips } from "./float-chips.tsx";
import styles from "./taskbar.module.css";

export interface TaskbarProps {
  /** 전역 float chip. */
  globalFloats: readonly FloatChip[];
  /** 지금 desk의 float chip. */
  floats: readonly FloatChip[];
  /** 지금 펴져 있는 chip의 key. */
  floating: readonly string[];
  onToggleGlobalFloat: (key: string) => void;
  onToggleFloat: (key: string) => void;
  /** 오른쪽 tray 자리. */
  tray?: ReactNode;
  onSettings: () => void;
}

export function Taskbar({
  globalFloats,
  floats,
  floating,
  onToggleGlobalFloat,
  onToggleFloat,
  tray,
  onSettings,
}: TaskbarProps) {
  return (
    <>
      <FloatChips
        global={globalFloats}
        desk={floats}
        pressed={floating}
        named
        className={styles.chips}
        onToggleGlobal={onToggleGlobalFloat}
        onToggleDesk={onToggleFloat}
      />
      <span className={styles.grow} />
      {tray === undefined ? null : <div className={styles.tray}>{tray}</div>}
      <IconButton
        icon={settingsEntryIcon}
        label={t("left-sidebar.button.settings")}
        size="sm"
        data-nav="settings"
        onClick={onSettings}
      />
    </>
  );
}
