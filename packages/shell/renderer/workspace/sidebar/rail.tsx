// 접힌 project sidebar의 바로 가기 rail. 펼치기 단추는 머리 줄에 있고 이 rail은 그 아래
// Terminal · Agent · Search를 세로로 둔다. 단추를 누르면 어느 탭을
// 열지는 부르는 쪽(window)이 정한다.
import { IconButton, type IconProps } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import {
  conversationIcons,
  paletteIcons,
  workspaceIcons,
} from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import styles from "./project-sidebar.module.css";

const RAIL_ACTIONS = ["terminal", "agent", "search"] as const;
export type RailAction = typeof RAIL_ACTIONS[number];

const ICONS: Readonly<Record<RailAction, IconProps["icon"]>> = {
  terminal: workspaceIcons.terminal,
  agent: conversationIcons.dock,
  search: paletteIcons.search,
};

export function Rail({ onRail }: { onRail: (action: RailAction) => void }) {
  const labels: Readonly<Record<RailAction, string>> = {
    terminal: t("project-workspace.label.rail-terminal"),
    agent: t("project-workspace.label.rail-agent"),
    search: t("project-workspace.label.rail-search"),
  };
  return (
    <div
      className={styles.rail}
      role="toolbar"
      aria-label={t("project-workspace.label.rail-shortcuts")}
    >
      {RAIL_ACTIONS.map((action) => (
        <Tooltip key={action} content={labels[action]}>
          <IconButton
            icon={ICONS[action]}
            label={labels[action]}
            data-rail-action={action}
            onClick={() =>
              onRail(action)}
          />
        </Tooltip>
      ))}
    </div>
  );
}
